#!/usr/bin/env python3
"""Capture private runtime-media proof; stdout contains aggregate evidence only."""
import gzip
import hashlib
import json
import os
import pathlib
import re
import stat
import sys
import tarfile
import tempfile
import time
from urllib.parse import urlsplit

MAX = 512 * 1024 * 1024
MAX_ENTRIES = 100000
ROOT = 'cats-pajamas-uploads'
CHUNK = 65536


class Rejected(Exception):
    pass


def require(value, code='rejected'):
    if not value:
        raise Rejected(code)


def identity(info):
    # Windows Python 3.14 lstat reports legacy creation-time in st_ctime_ns,
    # while fstat reports change-time. Birthtime is consistent across both;
    # same-handle reads additionally compare change-time below. POSIX retains
    # its native ctime check as well as device/inode/size/mtime.
    return (info.st_dev, info.st_ino, info.st_mode, info.st_size,
            info.st_mtime_ns, getattr(info, 'st_birthtime_ns', info.st_ctime_ns) if os.name == 'nt' else info.st_ctime_ns)


def handle_identity(info):
    return (*identity(info), info.st_ctime_ns)


def check_path(value, directory=False):
    path = pathlib.Path(value)
    require(path.is_absolute() and os.path.normpath(str(path)) == str(path), 'path_rejected')
    for item in [*reversed(path.parents), path]:
        info = item.lstat()
        require(not stat.S_ISLNK(info.st_mode) and not (getattr(info, 'st_file_attributes', 0) & 1024), 'path_rejected')
        if item != path:
            require(stat.S_ISDIR(info.st_mode), 'path_rejected')
    info = path.lstat()
    require(stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode), 'path_rejected')
    return info


def canonical(name, directory=False):
    if directory and name.endswith('/'):
        name = name[:-1]
    path = pathlib.PurePosixPath(name)
    require(isinstance(name, str) and len(name) <= 4096 and str(path) == name
            and not path.is_absolute() and '..' not in path.parts
            and path.parts and path.parts[0] == ROOT and len(path.parts) <= 32
            and not any(ord(c) < 32 or c in '\\:<>"|?*' for c in name), 'member_path_rejected')
    require(all(part and not part.endswith((' ', '.')) for part in path.parts), 'member_path_rejected')
    if len(path.parts) >= 2 and path.parts[1] == 'events':
        parts = path.parts[2:]
        if directory:
            require(len(parts) <= 1 and (not parts or re.fullmatch(r'[A-Za-z0-9_-]{1,255}', parts[0])), 'event_path_rejected')
        else:
            require(len(parts) == 2 and re.fullmatch(r'[A-Za-z0-9_-]{1,255}', parts[0]), 'event_path_rejected')
            match = re.fullmatch(r'(0|[1-9][0-9]*)(\.thumb)?\.webp', parts[1])
            require(match and len(match[1]) <= 16 and int(match[1]) <= 9007199254740991, 'event_path_rejected')
    return name


class Budget:
    def __init__(self, limit):
        require(type(limit) is int and 1024 <= limit <= MAX, 'size_limit')
        self.limit = limit
        self.deadline = time.monotonic() + 120

    def tick(self):
        require(time.monotonic() < self.deadline, 'time_limit')


def fingerprint(stream, size, budget, webp=False):
    require(0 <= size <= budget.limit, 'size_limit')
    digest = hashlib.sha256()
    remaining = size

    def take(count):
        nonlocal remaining
        require(0 <= count <= remaining, 'webp_rejected' if webp else 'file_changed')
        output = bytearray()
        while count:
            budget.tick()
            data = stream.read(min(count, CHUNK))
            require(data, 'file_changed')
            digest.update(data)
            remaining -= len(data)
            count -= len(data)
            output.extend(data)
        return bytes(output)

    if webp:
        require(size >= 20, 'webp_rejected')
        header = take(12)
        require(header[:4] == b'RIFF' and header[8:] == b'WEBP'
                and int.from_bytes(header[4:8], 'little') + 8 == size, 'webp_rejected')
        frame = False
        while remaining:
            require(remaining >= 8, 'webp_rejected')
            chunk = take(8)
            kind, length = chunk[:4], int.from_bytes(chunk[4:], 'little')
            require(length + length % 2 <= remaining, 'webp_rejected')
            minimum = {b'VP8 ': 10, b'VP8L': 5, b'VP8X': 10, b'ANMF': 16}.get(kind, 0)
            require(length >= minimum, 'webp_rejected')
            frame = frame or kind in (b'VP8 ', b'VP8L', b'ANMF')
            while length:
                count = min(length, CHUNK)
                take(count)
                length -= count
            if int.from_bytes(chunk[4:], 'little') % 2:
                require(take(1) == b'\0', 'webp_rejected')
        require(frame, 'webp_rejected')
    else:
        while remaining:
            take(min(remaining, CHUNK))
    require(not stream.read(1), 'file_changed')
    return digest.hexdigest()


def is_event(name):
    return name.startswith(ROOT + '/events/')


def inventory(root, budget):
    before_root = check_path(root, True)
    rows, directories, stats = {}, set(), {}
    total = 0
    posix = os.name == 'posix'
    flags = os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0)
    directory_flags = flags | getattr(os, 'O_DIRECTORY', 0)

    def walk(folder, relative, fd=None):
        nonlocal total
        budget.tick()
        canonical(relative, True)
        before = os.fstat(fd) if fd is not None else check_path(folder, True)
        directories.add(relative)
        require(len(directories) + len(rows) <= MAX_ENTRIES, 'entry_limit')
        with os.scandir(fd if fd is not None else folder) as scan:
            names = sorted(entry.name for entry in scan)
        for name in names:
            budget.tick()
            full, member = folder / name, relative + '/' + name
            info = os.stat(name, dir_fd=fd, follow_symlinks=False) if fd is not None else full.lstat()
            require(not stat.S_ISLNK(info.st_mode) and not (getattr(info, 'st_file_attributes', 0) & 1024), 'path_rejected')
            if stat.S_ISDIR(info.st_mode):
                child = os.open(name, directory_flags, dir_fd=fd) if fd is not None else None
                try:
                    if child is not None:
                        require(identity(os.fstat(child)) == identity(info), 'live_changed')
                    walk(full, member, child)
                finally:
                    if child is not None:
                        os.close(child)
            else:
                canonical(member)
                require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1, 'path_rejected')
                total += info.st_size
                require(total <= budget.limit and len(rows) + len(directories) < MAX_ENTRIES, 'size_limit')
                if fd is None:
                    require(identity(check_path(full)) == identity(info), 'live_changed')
                opened = os.open(name, flags, dir_fd=fd) if fd is not None else os.open(full, flags)
                with os.fdopen(opened, 'rb') as stream:
                    opened_info = os.fstat(stream.fileno())
                    require(identity(opened_info) == identity(info), 'live_changed')
                    digest = fingerprint(stream, info.st_size, budget, is_event(member))
                    require(handle_identity(os.fstat(stream.fileno())) == handle_identity(opened_info), 'live_changed')
                after = os.stat(name, dir_fd=fd, follow_symlinks=False) if fd is not None else check_path(full)
                require(identity(after) == identity(info), 'live_changed')
                rows[member] = {'bytes': info.st_size, 'sha256': digest}
                stats[member] = identity(info)
        after = os.fstat(fd) if fd is not None else check_path(folder, True)
        require(identity(before) == identity(after), 'live_changed')
        stats[relative] = identity(after)

    root_fd = os.open(root, directory_flags) if posix else None
    try:
        if root_fd is not None:
            require(identity(os.fstat(root_fd)) == identity(before_root), 'live_changed')
        walk(pathlib.Path(root), ROOT, root_fd)
    finally:
        if root_fd is not None:
            os.close(root_fd)
    require(identity(check_path(root, True)) == identity(before_root), 'live_changed')
    require(ROOT + '/events' in directories, 'events_root_missing')
    return rows, directories, stats


def expand_gzip(source, target, budget):
    before = check_path(source)
    require(before.st_size <= budget.limit, 'size_limit')
    opened = os.open(source, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0))
    total = 0
    with os.fdopen(opened, 'rb') as raw, gzip.GzipFile(fileobj=raw) as zipped, open(target, 'xb') as output:
        opened_info = os.fstat(raw.fileno())
        require(identity(opened_info) == identity(before), 'input_changed_open')
        while True:
            budget.tick()
            data = zipped.read(min(CHUNK, budget.limit - total + 1))
            if not data:
                break
            total += len(data)
            require(total <= budget.limit, 'expanded_size_limit')
            output.write(data)
        require(handle_identity(os.fstat(raw.fileno())) == handle_identity(opened_info), 'input_changed_read')
    require(identity(check_path(source)) == identity(before), 'input_changed_path')


def archive_inventory(plain, budget):
    rows, directories, seen = {}, set(), set()

    class Reader:
        def __init__(self, stream):
            self.stream = stream

        def read(self, size=-1):
            budget.tick()
            require(0 <= size <= budget.limit, 'metadata_size_limit')
            return self.stream.read(size)

        def __getattr__(self, name):
            return getattr(self.stream, name)

    total, end = 0, 0
    with open(plain, 'rb') as raw, tarfile.open(fileobj=Reader(raw), mode='r:') as tar:
        for item in tar:
            budget.tick()
            require(item.isdir() or item.type in (tarfile.REGTYPE, tarfile.AREGTYPE), 'member_type_rejected')
            name = canonical(item.name, item.isdir())
            require(name.casefold() not in seen and len(seen) < MAX_ENTRIES, 'duplicate_or_entry_limit')
            require(not item.pax_headers and item.offset_data == item.offset + 512 and item.offset == end, 'hidden_header_rejected')
            seen.add(name.casefold())
            require(item.size >= 0 and (not item.isdir() or item.size == 0), 'size_limit')
            total += item.size
            require(total <= budget.limit, 'size_limit')
            end = item.offset_data + ((item.size + 511) // 512) * 512
            if item.isdir():
                directories.add(name)
            else:
                with tar.extractfile(item) as stream:
                    rows[name] = {'bytes': item.size, 'sha256': fingerprint(stream, item.size, budget, is_event(name))}
        require(seen and not tar.pax_headers, 'members_missing')
        size = os.fstat(raw.fileno()).st_size
        require(size % 512 == 0 and size - end >= 1024, 'tar_tail_rejected')
        raw.seek(end)
        while True:
            budget.tick()
            data = raw.read(CHUNK)
            if not data:
                break
            require(not any(data), 'tar_tail_rejected')
    return rows, directories


def copy_field(text):
    if text == r'\N':
        return None
    data, output, index = text.encode('utf-8'), bytearray(), 0
    escapes = {ord('b'): 8, ord('f'): 12, ord('n'): 10, ord('r'): 13,
               ord('t'): 9, ord('v'): 11, ord('\\'): 92}
    while index < len(data):
        byte = data[index]
        index += 1
        if byte != 92:
            output.append(byte)
            continue
        require(index < len(data), 'copy_escape_rejected')
        byte = data[index]
        index += 1
        if byte in escapes:
            output.append(escapes[byte])
        elif 48 <= byte <= 55:
            digits = bytes([byte])
            while index < len(data) and len(digits) < 3 and 48 <= data[index] <= 55:
                digits += bytes([data[index]])
                index += 1
            require(int(digits, 8) <= 255, 'copy_escape_rejected')
            output.append(int(digits, 8))
        elif byte == ord('x'):
            digits = bytearray()
            while index < len(data) and len(digits) < 2 and chr(data[index]) in '0123456789abcdefABCDEF':
                digits.append(data[index])
                index += 1
            require(digits, 'copy_escape_rejected')
            output.append(int(digits, 16))
        else:
            output.append(byte)
    return output.decode('utf-8')


def database_refs(plain, rows, budget):
    local, remote, other = set(), set(), set()
    state, columns, found, events = None, None, 0, 0
    header = re.compile(r'^COPY (?:public|"public")\.(?:events|"events") \(([^\n]+)\) FROM stdin;$')
    with open(plain, 'r', encoding='utf-8', newline='') as sql:
        while True:
            budget.tick()
            line = sql.readline(8 * 1024 * 1024 + 1)
            if not line:
                break
            require(len(line.encode('utf-8')) <= 8 * 1024 * 1024, 'sql_line_limit')
            line = line.removesuffix('\n').removesuffix('\r')
            if state:
                if line == r'\.':
                    state = None
                    continue
                if state == 'other':
                    continue
                fields = line.split('\t')
                require(len(fields) == len(columns), 'copy_row_rejected')
                values = dict(zip(columns, fields))
                photos = []
                if 'image_urls' in values:
                    value = copy_field(values['image_urls'])
                    photos = [] if value is None else json.loads(value)
                    require(isinstance(photos, list) and all(isinstance(v, str) for v in photos), 'copy_images_rejected')
                    photos = [v for v in photos if v]
                if not photos and 'image_url' in values:
                    value = copy_field(values['image_url'])
                    if value:
                        photos = [value]
                for url in photos:
                    if url.startswith(('/uploads/events', 'uploads/events')):
                        match = re.fullmatch(r'/?uploads/events/([A-Za-z0-9_-]{1,255})/(0|[1-9][0-9]*)\.webp', url)
                        require(match, 'database_local_ref_rejected')
                        member = ROOT + '/events/' + match[1] + '/' + match[2] + '.webp'
                        canonical(member)
                        require(member in rows and member[:-5] + '.thumb.webp' in rows, 'database_local_ref_missing')
                        local.add(member)
                    elif urlsplit(url).scheme.lower() in ('http', 'https'):
                        require(urlsplit(url).netloc, 'database_url_rejected')
                        remote.add(url)
                    else:
                        other.add(url)
                events += 1
                require(events <= MAX_ENTRIES and len(local) + len(remote) + len(other) <= MAX_ENTRIES, 'entry_limit')
                continue
            match = header.fullmatch(line)
            if match:
                found += 1
                require(found == 1 and re.fullmatch(r'(?:[a-z_][a-z_0-9]*|"[a-z_][a-z_0-9]*")(?:, ?(?:[a-z_][a-z_0-9]*|"[a-z_][a-z_0-9]*"))*', match[1]), 'copy_header_rejected')
                columns = [v.strip().strip('"') for v in match[1].split(',')]
                require(len(columns) == len(set(columns)) and {'image_urls', 'image_url'} & set(columns), 'copy_header_rejected')
                state = 'events'
            elif line.startswith('COPY '):
                require(re.fullmatch(r'COPY .+ FROM stdin;', line) and not re.search(r'\bevents\b', line), 'copy_header_rejected')
                state = 'other'
    require(found == 1 and state is None, 'copy_block_missing_or_truncated')
    return {'event_rows': events, 'local_main_refs': sorted(local),
            'remote_refs_outside_scope': len(remote), 'other_refs_outside_scope': len(other)}


def pairs_check(rows):
    files = [name for name in rows if is_event(name)]
    for name in files:
        paired = name[:-11] + '.webp' if name.endswith('.thumb.webp') else name[:-5] + '.thumb.webp'
        require(paired in rows, 'image_pair_missing')
    return files


def manifest_check(manifest, rows, directories):
    keys = {'version', 'root', 'capture', 'source_empty', 'events_empty', 'files', 'directories',
            'file_count', 'bytes', 'event_files', 'event_pairs', 'database',
            'webp_structure_verified', 'full_decode_verified'}
    require(isinstance(manifest, dict) and set(manifest) == keys
            and manifest['version'] == 1 and manifest['root'] == ROOT
            and manifest['capture'] == 'archive_live_hash_parity', 'manifest_rejected')
    event_files = pairs_check(rows)
    require(ROOT in directories and ROOT + '/events' in directories, 'events_root_missing')
    require(manifest['files'] == [{'path': name, **rows[name]} for name in sorted(rows)]
            and manifest['directories'] == sorted(directories)
            and type(manifest['file_count']) is int and manifest['file_count'] == len(rows)
            and type(manifest['bytes']) is int and manifest['bytes'] == sum(row['bytes'] for row in rows.values())
            and type(manifest['event_files']) is int and manifest['event_files'] == len(event_files)
            and type(manifest['event_pairs']) is int and manifest['event_pairs'] == len(event_files) // 2
            and manifest['source_empty'] is (not rows) and manifest['events_empty'] is (not event_files)
            and manifest['webp_structure_verified'] is True and manifest['full_decode_verified'] is False,
            'manifest_inventory_mismatch')
    refs = manifest['database']
    require(isinstance(refs, dict) and set(refs) == {'event_rows', 'local_main_refs', 'remote_refs_outside_scope', 'other_refs_outside_scope'}, 'manifest_refs_rejected')
    require(all(type(refs[key]) is int and 0 <= refs[key] <= MAX_ENTRIES for key in ('event_rows', 'remote_refs_outside_scope', 'other_refs_outside_scope'))
            and isinstance(refs['local_main_refs'], list) and len(refs['local_main_refs']) <= MAX_ENTRIES
            and all(isinstance(name, str) for name in refs['local_main_refs'])
            and sorted(set(refs['local_main_refs'])) == refs['local_main_refs'], 'manifest_refs_rejected')
    for name in refs['local_main_refs']:
        canonical(name)
        require(is_event(name) and not name.endswith('.thumb.webp') and name in rows
                and name[:-5] + '.thumb.webp' in rows, 'database_local_ref_missing')
    return refs


def report(manifest, payload):
    refs = manifest['database']
    return {'ok': True, 'file_count': manifest['file_count'], 'bytes': manifest['bytes'],
            'event_files': manifest['event_files'], 'event_pairs': manifest['event_pairs'],
            'source_empty': manifest['source_empty'], 'events_empty': manifest['events_empty'],
            'db_local_refs': len(refs['local_main_refs']),
            'db_remote_refs_outside_scope': refs['remote_refs_outside_scope'],
            'db_other_refs_outside_scope': refs['other_refs_outside_scope'],
            'manifest_sha256': hashlib.sha256(payload).hexdigest()}


def scratch_create(parent):
    check_path(parent, True)
    folder = pathlib.Path(tempfile.mkdtemp(prefix='.runtime-proof-', dir=parent))
    os.chmod(folder, 0o700)
    check_path(folder, True)
    return folder


def scratch_remove(folder, parent):
    check_path(folder, True)
    check_path(parent, True)
    require(folder.parent == parent and folder.name.startswith('.runtime-proof-'), 'cleanup_rejected')
    for name in ('archive.tar', 'database.sql', 'manifest.json', 'outer.tar', 'runtime-uploads.tar.gz', 'database.sql.gz', 'runtime-manifest.json'):
        item = folder / name
        if item.exists():
            check_path(item)
            item.unlink()
    folder.rmdir()


def private_bytes(source, limit):
    before = check_path(source)
    require(before.st_size <= limit, 'size_limit')
    opened = os.open(source, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0))
    with os.fdopen(opened, 'rb') as stream:
        opened_info = os.fstat(stream.fileno())
        require(identity(opened_info) == identity(before), 'input_changed')
        data = stream.read(limit + 1)
        require(handle_identity(os.fstat(stream.fileno())) == handle_identity(opened_info), 'input_changed')
    require(len(data) == before.st_size and identity(check_path(source)) == identity(before), 'input_changed')
    return data


def verify(nested, manifest_path, limit=MAX, database=None):
    budget = Budget(limit)
    check_path(nested)
    payload = private_bytes(manifest_path, 16 * 1024 * 1024)
    manifest = json.loads(payload)
    parent = pathlib.Path(manifest_path).parent
    scratch = scratch_create(parent)
    try:
        plain = scratch / 'archive.tar'
        expand_gzip(nested, plain, budget)
        rows, directories = archive_inventory(plain, budget)
        refs = manifest_check(manifest, rows, directories)
        if database is not None:
            sql = scratch / 'database.sql'
            expand_gzip(database, sql, budget)
            require(database_refs(sql, rows, budget) == refs, 'database_manifest_mismatch')
        return report(manifest, payload)
    finally:
        scratch_remove(scratch, parent)


def verify_backup(outer, limit=MAX):
    budget = Budget(limit)
    check_path(outer)
    parent = pathlib.Path(outer).parent
    scratch = scratch_create(parent)
    expected = {'runtime-uploads.tar.gz', 'runtime-manifest.json', 'database.sql.gz', 'nginx.conf', 'app.env', 'supabase.env'}
    selected = {'runtime-uploads.tar.gz', 'runtime-manifest.json', 'database.sql.gz'}
    try:
        plain = scratch / 'outer.tar'
        expand_gzip(outer, plain, budget)
        seen, end, root_entry = set(), 0, False

        class Reader:
            def __init__(self, stream):
                self.stream = stream

            def read(self, size=-1):
                budget.tick()
                require(0 <= size <= budget.limit, 'metadata_size_limit')
                return self.stream.read(size)

            def __getattr__(self, name):
                return getattr(self.stream, name)

        with open(plain, 'rb') as raw, tarfile.open(fileobj=Reader(raw), mode='r:') as tar:
            for item in tar:
                budget.tick()
                require(not item.pax_headers and item.offset_data == item.offset + 512 and item.offset == end, 'hidden_header_rejected')
                require(item.size >= 0, 'size_limit')
                end = item.offset_data + ((item.size + 511) // 512) * 512
                if item.isdir() and item.name in ('.', './'):
                    require(not root_entry and item.size == 0 and not seen, 'outer_members_rejected')
                    root_entry = True
                    continue
                name = item.name[2:] if item.name.startswith('./') else item.name
                require(name in expected and name not in seen and item.type in (tarfile.REGTYPE, tarfile.AREGTYPE), 'outer_members_rejected')
                seen.add(name)
                if name in selected:
                    cap = 16 * 1024 * 1024 if name == 'runtime-manifest.json' else limit
                    require(item.size <= cap, 'size_limit')
                    with tar.extractfile(item) as source, open(scratch / name, 'xb') as target:
                        remaining = item.size
                        while remaining:
                            budget.tick()
                            chunk = source.read(min(CHUNK, remaining))
                            require(chunk, 'outer_member_truncated')
                            target.write(chunk)
                            remaining -= len(chunk)
            require(seen == expected and not tar.pax_headers, 'outer_members_rejected')
            size = os.fstat(raw.fileno()).st_size
            require(size % 512 == 0 and size - end >= 1024, 'tar_tail_rejected')
            raw.seek(end)
            while True:
                budget.tick()
                data = raw.read(CHUNK)
                if not data:
                    break
                require(not any(data), 'tar_tail_rejected')
        return verify(scratch / 'runtime-uploads.tar.gz', scratch / 'runtime-manifest.json', limit, scratch / 'database.sql.gz')
    finally:
        scratch_remove(scratch, parent)


def capture(nested, live_root, database, output, limit=MAX):
    budget = Budget(limit)
    output = pathlib.Path(output)
    require(output.is_absolute() and not output.exists(), 'output_exists_or_invalid')
    check_path(output.parent, True)
    check_path(nested)
    check_path(database)
    first, first_dirs, first_stats = inventory(live_root, budget)
    scratch = scratch_create(output.parent)
    try:
        archive_plain, sql_plain = scratch / 'archive.tar', scratch / 'database.sql'
        expand_gzip(nested, archive_plain, budget)
        archive, directories = archive_inventory(archive_plain, budget)
        require(archive == first and directories == first_dirs, 'archive_live_mismatch')
        event_files = pairs_check(archive)
        expand_gzip(database, sql_plain, budget)
        refs = database_refs(sql_plain, archive, budget)
        last, last_dirs, last_stats = inventory(live_root, budget)
        require(first == last and first_dirs == last_dirs and first_stats == last_stats, 'live_changed')
        manifest = {'version': 1, 'root': ROOT, 'capture': 'archive_live_hash_parity',
                    'source_empty': not archive, 'events_empty': not event_files,
                    'files': [{'path': name, **archive[name]} for name in sorted(archive)],
                    'directories': sorted(directories), 'file_count': len(archive),
                    'bytes': sum(row['bytes'] for row in archive.values()),
                    'event_files': len(event_files), 'event_pairs': len(event_files) // 2,
                    'database': refs, 'webp_structure_verified': True, 'full_decode_verified': False}
        payload = (json.dumps(manifest, sort_keys=True, ensure_ascii=True, separators=(',', ':')) + '\n').encode('utf-8')
        require(len(payload) <= 16 * 1024 * 1024, 'manifest_size_limit')
        partial = scratch / 'manifest.json'
        fd = os.open(partial, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'wb') as stream:
            stream.write(payload)
            stream.flush()
            os.fsync(stream.fileno())
        check_path(output.parent, True)
        os.link(partial, output)
        return report(manifest, payload)
    finally:
        scratch_remove(scratch, output.parent)


if __name__ == '__main__':
    try:
        require(len(sys.argv) > 1, 'invocation_rejected')
        if os.name == 'posix':
            import resource
            soft, hard = resource.getrlimit(resource.RLIMIT_CPU)
            ceiling = min([120] + [value for value in (soft, hard) if value != resource.RLIM_INFINITY])
            resource.setrlimit(resource.RLIMIT_CPU, (ceiling, hard))
        mode, args = sys.argv[1], sys.argv[2:]
        if mode == 'capture' and len(args) == 4:
            result = capture(*args)
        elif mode == 'verify' and len(args) == 2:
            result = verify(*args)
        elif mode == 'verify-backup' and len(args) == 1:
            result = verify_backup(*args)
        else:
            raise Rejected('invocation_rejected')
        print(json.dumps(result, sort_keys=True))
    except Rejected as error:
        print('FAIL runtime_media ' + str(error), file=sys.stderr)
        sys.exit(1)
    except Exception:
        print('FAIL runtime_media unavailable_or_invalid', file=sys.stderr)
        sys.exit(1)
