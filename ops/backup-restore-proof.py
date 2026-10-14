#!/usr/bin/env python3
"""Private archive analysis and exact-column PostgreSQL COPY comparison."""
import gzip, hashlib, json, pathlib, re, subprocess, sys, tarfile

def digest(rows):
    return hashlib.sha256(''.join(sorted(rows)).encode('utf-8')).hexdigest()

def safe_errors(text):
    """Return only sqlstate and optional source line; never server detail."""
    result=[]
    pattern=re.compile(r'^(?:psql:(?:<stdin>|-):(\d+):\s*)?ERROR:\s+([0-9A-Z]{5})(?=\s|$)')
    for line in text.splitlines():
        match=pattern.match(line)
        if match:
            item='SQLSTATE='+match[2]
            if match[1]: item+=' line='+match[1]
            result.append(item)
    return result

def diagnostics(work):
    for name in ('roles.log','sql.log'):
        path=pathlib.Path(work)/name
        if path.is_file():
            for item in safe_errors(path.read_text(errors='replace')): print(item)

def prepare(archive, work):
    work = pathlib.Path(work)
    with tarfile.open(archive, 'r:gz') as tar:
        members = tar.getmembers()
        for member in members:
            path = pathlib.PurePosixPath(member.name)
            if path.is_absolute() or '..' in path.parts or member.issym() or member.islnk():
                raise ValueError('Unsafe archive member')
        matches = [m for m in members if m.name.lstrip('./') == 'database.sql.gz']
        if len(matches) != 1 or not matches[0].isfile() or matches[0].size > 512*1024*1024:
            raise ValueError('SQL member rejected')
        with gzip.GzipFile(fileobj=tar.extractfile(matches[0])) as zipped:
            payload = zipped.read(512*1024*1024+1)
        if len(payload) > 512*1024*1024:
            raise ValueError('SQL size limit')
        sql = payload.decode('utf-8')
    # Input is the administrator-owned local pg_dump; never read env members.
    blocks = []
    for m in re.finditer(r'^COPY (public\.\w+) \(([^\n]+)\) FROM stdin;\n(.*?)^\\\.$', sql, re.M|re.S):
        columns = m.group(2)
        if not re.fullmatch(r'(?:\w+|"\w+")(?:, (?:\w+|"\w+"))*', columns):
            raise ValueError('Unexpected COPY columns')
        rows = m.group(3).splitlines(keepends=True)
        blocks.append({'table':m.group(1), 'columns':columns, 'rows':len(rows), 'sha256':digest(rows)})
    if not blocks or len({b['table'] for b in blocks}) != len(blocks):
        raise ValueError('Missing or duplicate public tables')
    roles = sorted(set(re.findall(r'OWNER TO (\w+);',sql) + re.findall(r' TO (\w+)(?:;| WITH GRANT OPTION;)',sql)) - {'postgres','PUBLIC'})
    schemas = sorted(set(re.findall(r'^CREATE SCHEMA (\w+);',sql,re.M)))
    (work/'database.sql').write_text(sql,encoding='utf-8')
    (work/'roles.sql').write_text(''.join('CREATE ROLE "'+r+'" NOLOGIN;\n' for r in roles),encoding='utf-8')
    (work/'expected.json').write_text(json.dumps({'tables':blocks,'roles':roles,'schemas':schemas}),encoding='utf-8')

def verify(work, container):
    expected=json.loads((pathlib.Path(work)/'expected.json').read_text())
    def query(sql):
        p=subprocess.run(['docker','exec','-i',container,'psql','-h','/tmp','-q','-X','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-At'],input=sql.encode(),stdout=subprocess.PIPE,stderr=subprocess.PIPE)
        if p.returncode: raise RuntimeError('Verification query failed')
        return p.stdout.decode('utf-8')
    schemas=set(query('SELECT nspname FROM pg_namespace;').splitlines())
    roles=set(query('SELECT rolname FROM pg_roles;').splitlines())
    if not set(expected['schemas'])<=schemas or not set(expected['roles'])<=roles:
        raise RuntimeError('Schema or role mismatch')
    tables=set(query("SELECT schemaname||'.'||tablename FROM pg_tables WHERE schemaname='public';").splitlines())
    if tables != {b['table'] for b in expected['tables']}: raise RuntimeError('Public table set mismatch')
    result=[]
    for b in expected['tables']:
        rows=query("SET timezone='UTC';\nCOPY "+b['table']+' ('+b['columns']+') TO STDOUT;').splitlines(keepends=True)
        # psql command tag for SET is suppressed by -q below through query command.
        if rows and rows[0]=='SET\n': rows=rows[1:]
        if len(rows)!=b['rows'] or digest(rows)!=b['sha256']: raise RuntimeError('Public content mismatch')
        result.append({k:b[k] for k in ('table','rows','sha256')})
    print(json.dumps({'restore':'PASS','public_tables':len(result),'public_rows':sum(b['rows'] for b in result),'schemas_verified':len(expected['schemas']),'referenced_roles_verified':len(expected['roles']),'tables':result}))

if __name__=='__main__':
    try:
        if sys.argv[1]=='prepare': prepare(sys.argv[2],sys.argv[3])
        elif sys.argv[1]=='diagnostics': diagnostics(sys.argv[2])
        elif sys.argv[1]=='verify': verify(sys.argv[2],sys.argv[3])
        else: raise ValueError('Mode rejected')
    except Exception:
        print('FAIL backup restore helper: '+sys.argv[1],file=sys.stderr)
        sys.exit(1)
