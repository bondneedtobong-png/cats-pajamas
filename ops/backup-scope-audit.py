#!/usr/bin/env python3
"""Observational backup-source audit. Never execute or print builder source.

All diagnostic reasons are fixed labels. Paths from configuration are redacted
unless they match the two documented media directories. No archive is opened:
empty archives cannot establish source coverage. UNKNOWN does not gate release.
"""
import argparse
import hashlib
import json
import os
import pathlib
import re
import shlex
import stat
import subprocess

PROJECT = '/opt/cats-pajamas-club'
EXPECTED = '/opt/cats-pajamas-uploads/events'
LEGACY = PROJECT + '/uploads-runtime/events'
MAX_SOURCE = 256 * 1024
MAX_ENTRIES = 100000


class Unknown(Exception):
    pass


def canonical(value):
    if not isinstance(value, str) or not re.fullmatch(r'/[A-Za-z0-9_./-]{1,255}', value):
        raise Unknown('invalid_path')
    path = pathlib.PurePosixPath(value)
    if '..' in path.parts or str(path) != value or value == '/':
        raise Unknown('invalid_path')
    return value


def media_label(value):
    return value if value in (EXPECTED, LEGACY) else 'OTHER'


def trusted(path, directory=False):
    """Reject aliases, reparse points and writable/non-root-owned ancestors."""
    canonical(str(path))
    target = pathlib.Path(path)
    for item in [*reversed(target.parents), target]:
        info = item.lstat()
        if stat.S_ISLNK(info.st_mode) or getattr(info, 'st_file_attributes', 0) & 1024:
            raise Unknown('path_alias')
        if info.st_uid != 0 or info.st_mode & 0o022:
            raise Unknown('untrusted_path')
        if item != target and not stat.S_ISDIR(info.st_mode):
            raise Unknown('invalid_parent')
    info = target.lstat()
    if not (stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode)):
        raise Unknown('invalid_file_type')
    return info


def read_private(path, limit=MAX_SOURCE):
    before = trusted(path)
    if before.st_size > limit:
        raise Unknown('input_size_limit')
    # O_NOFOLLOW plus fstat protects the final component from replacement.
    descriptor = os.open(path, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0))
    with os.fdopen(descriptor, 'rb') as stream:
        info = os.fstat(stream.fileno())
        if (info.st_dev, info.st_ino) != (before.st_dev, before.st_ino):
            raise Unknown('input_changed')
        payload = stream.read(limit + 1)
    if len(payload) > limit:
        raise Unknown('input_size_limit')
    return payload


def unit_executable(raw):
    """systemctl's structured ExecStart value, never a shell command."""
    if len(raw) > 65536 or raw.count('ExecStart=') != 1:
        raise Unknown('unit_format')
    lines = raw.splitlines()
    if len(lines) != 2 or any('=' not in line for line in lines):
        raise Unknown('unit_format')
    fields = dict(line.split('=', 1) for line in lines)
    if set(fields) != {'ExecStart', 'User'}:
        raise Unknown('unit_format')
    if fields.get('User', '') not in ('', 'root'):
        raise Unknown('unit_not_root')
    value = fields['ExecStart']
    match = re.fullmatch(r'\{ path=([^ ;]+) ; argv\[\]=(.*?) ; ignore_errors=(?:yes|no) ; [^{}]*\}', value)
    if not match:
        raise Unknown('unit_format')
    executable = canonical(match[1])
    if not executable.startswith(('/usr/local/sbin/', '/usr/local/bin/', '/usr/bin/', '/bin/')):
        raise Unknown('executable_location')
    try:
        args = shlex.split(match[2])
    except ValueError:
        raise Unknown('unit_arguments') from None
    if not args or args[0] != executable:
        raise Unknown('unit_arguments')
    source = executable
    if pathlib.PurePosixPath(executable).name in ('bash', 'sh', 'dash'):
        # No -c, environment expansion, inline programs, or interpreter options.
        if len(args) != 2:
            raise Unknown('interpreter_arguments')
        source = canonical(args[1])
        if not source.startswith(('/usr/local/sbin/', '/usr/local/bin/')):
            raise Unknown('builder_location')
    elif len(args) != 1:
        raise Unknown('builder_arguments')
    return executable, source


def env_setting(text):
    matches, multiline = [], None
    for line in text.splitlines():
        if multiline:
            if re.search(r'(?<!\\)' + re.escape(multiline), line):
                multiline = None
            continue
        assignment = re.fullmatch(r'\s*(?:export\s+)?([\w.-]+)\s*=(.*)', line)
        if not assignment:
            continue
        key, value = assignment.groups()
        value = value.strip()
        if key == 'EVENT_UPLOADS_DIR':
            matches.append(value)
        if value.startswith(('"', "'", '`')) and not re.search(r'(?<!\\)' + re.escape(value[0]), value[1:]):
            multiline = value[0]
    if not matches:
        return None
    if len(matches) != 1:
        raise Unknown('duplicate_upload_setting')
    value = matches[0].strip()
    if value.startswith(('"', "'")):
        quote = value[0]
        match = re.fullmatch(re.escape(quote) + r'([^\r\n]*?)' + re.escape(quote) + r'\s*(?:#.*)?', value)
        if not match:
            raise Unknown('upload_setting_format')
        value = match[1]
    else:
        value = re.split(r'\s+#', value, maxsplit=1)[0].strip()
    return canonical(value) if value else None


def nginx_alias(text):
    lexer = shlex.shlex(text, posix=True, punctuation_chars='{};')
    lexer.whitespace_split = True
    lexer.commenters = '#'
    try:
        tokens = []
        for token in lexer:
            tokens.extend(list(token) if re.fullmatch(r'[{};]+', token) else [token])
    except ValueError:
        raise Unknown('nginx_format') from None
    aliases = []
    for index, token in enumerate(tokens):
        if token != 'location':
            continue
        if tokens[index + 1:index + 4] != ['^~', '/uploads/events/', '{']:
            # Other locations touching this prefix can make selection ambiguous.
            if '/uploads/events/' in tokens[index + 1:index + 4]:
                raise Unknown('nginx_location_ambiguous')
            continue
        depth, found, cursor = 1, [], index + 4
        while cursor < len(tokens) and depth:
            item = tokens[cursor]
            if item == '{':
                depth += 1
            elif item == '}':
                depth -= 1
            elif item == 'alias' and depth == 1:
                if cursor + 2 >= len(tokens) or tokens[cursor + 2] != ';':
                    raise Unknown('nginx_alias_format')
                found.append(canonical(tokens[cursor + 1].rstrip('/')))
            cursor += 1
        if depth or len(found) != 1:
            raise Unknown('nginx_alias_ambiguous')
        aliases += found
    if len(aliases) != 1:
        raise Unknown('nginx_location_ambiguous')
    return aliases[0]


def tar_selection(source):
    """Recognize only unconditional, literal GNU tar create commands.

    No shell evaluation. Only comments, static scalar directory assignments,
    error-handling set flags and one tar command are recognized. Other shell
    statements, implicit tar settings and multiple archives are inconclusive.
    A result concerns declared source operands, not execution or delivery.
    """
    constants, selections, tar_commands = {}, [], 0
    for raw in source.splitlines():
        line = raw.strip()
        if not line or line.startswith('#'):
            continue
        if re.search(r'[|&;<>`]|\\$|\$\(', line):
            raise Unknown('builder_shell_syntax')
        assignment = re.fullmatch(r'([A-Za-z_][A-Za-z0-9_]*)=(.*)', line)
        if assignment:
            key, value = assignment.groups()
            if key in ('TAR', 'TAR_OPTIONS', 'TAPE', 'GZIP', 'BZIP', 'BZIP2', 'COMPRESS',
                       'XZ_OPT', 'XZ_DEFAULTS', 'PATH', 'ENV', 'BASH_ENV', 'SHELLOPTS',
                       'BASHOPTS', 'IFS', 'LD_PRELOAD', 'LD_LIBRARY_PATH'):
                raise Unknown('builder_implicit_environment')
            try:
                parsed = shlex.split(value, comments=True)
            except ValueError:
                raise Unknown('builder_assignment_syntax') from None
            if len(parsed) != 1:
                raise Unknown('builder_dynamic_assignment')
            constants[key] = canonical(parsed[0])
            continue
        try:
            parts = shlex.split(line, comments=True)
        except ValueError:
            raise Unknown('builder_syntax') from None
        if parts and parts[0] == 'set':
            # These flags only stop on failures; -a/-n/-x and all other shell
            # state changes must not alter implicit tar selection/execution.
            flags = parts[1:]
            if (len(flags) == 1 and re.fullmatch(r'-[eEu]+', flags[0])) or (
                    len(flags) == 2 and re.fullmatch(r'-[eEu]*o', flags[0]) and flags[1] == 'pipefail'):
                continue
            raise Unknown('builder_set_options')
        if not parts or parts[0] not in ('tar', '/bin/tar', '/usr/bin/tar'):
            raise Unknown('builder_unknown_statement')
        tar_commands += 1
        if tar_commands != 1:
            raise Unknown('builder_multiple_tar_commands')
        # shlex removes quote provenance. Reject forms where its token value
        # could look like expansion but the shell actually treats it literally.
        if re.search(r"'[^']*\$[^']*'|\\\$|\$['\"]", line):
            raise Unknown('tar_quoted_expansion')
        # Expansions are permitted only for a whole, static scalar operand.
        for index, part in enumerate(parts):
            match = re.fullmatch(r'\$(?:\{([A-Za-z_]\w*)\}|([A-Za-z_]\w*))', part)
            if match and (match[1] or match[2]) in constants:
                parts[index] = constants[match[1] or match[2]]
        args, base, paths, create = parts[1:], None, [], False
        while args:
            item = args.pop(0)
            if item in ('-C', '--directory'):
                if not args:
                    raise Unknown('tar_arguments')
                base = canonical(args.pop(0))
            elif item in ('-f', '--file'):
                if not args:
                    raise Unknown('tar_arguments')
                args.pop(0)  # Archive destination is never reported/evaluated.
            elif item in ('-c', '--create'):
                create = True
            elif re.fullmatch(r'-[czjf]+', item) and 'c' in item and item.endswith('f'):
                create = True
                if not args:
                    raise Unknown('tar_arguments')
                args.pop(0)
            elif item in ('-z', '-j', '--gzip', '--bzip2'):
                pass
            elif item.startswith('-') or re.search(r'[$`*?\[\]{};<>]', item):
                raise Unknown('tar_dynamic_or_filter')
            else:
                if item.startswith('/'):
                    paths.append(canonical(item))
                elif base is not None and '..' not in pathlib.PurePosixPath(item).parts:
                    paths.append(canonical(str(pathlib.PurePosixPath(base) / item)))
                else:
                    raise Unknown('tar_relative_source')
        if not create or not paths:
            raise Unknown('tar_not_literal_create')
        selections += paths
    if not selections:
        raise Unknown('builder_no_recognized_tar')
    covers = lambda path: EXPECTED == path or EXPECTED.startswith(path + '/')
    return {'status': 'SELECTS_EXPECTED_TREE' if any(map(covers, selections)) else 'DOES_NOT_SELECT_EXPECTED_TREE',
            'recognized_tar_sources': len(selections),
            'selects_legacy_tree': any(LEGACY == p or LEGACY.startswith(p + '/') for p in selections),
            'builder_environment_verified': False, 'runtime_copy_verified': False}


def tree_counts(path):
    info = trusted(path, directory=True)
    counts = {'status': 'OBSERVED', 'files': 0, 'directories': 1, 'bytes': 0,
              'links_or_special': 0, 'root_mode': oct(stat.S_IMODE(info.st_mode)), 'root_owned': True}
    flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
    stack = [os.open(path, flags)]
    try:
        while stack:
            fd = stack.pop()
            try:
                # Every descendant opens relative to an already-open directory.
                # A rename cannot redirect traversal through a new parent alias.
                with os.scandir(fd) as entries:
                    for entry in entries:
                        item = entry.stat(follow_symlinks=False)
                        if stat.S_ISREG(item.st_mode):
                            counts['files'] += 1
                            counts['bytes'] += item.st_size
                        elif stat.S_ISDIR(item.st_mode):
                            counts['directories'] += 1
                            stack.append(os.open(entry.name, flags, dir_fd=fd))
                        else:
                            counts['links_or_special'] += 1
                        if counts['files'] + counts['directories'] + counts['links_or_special'] > MAX_ENTRIES:
                            raise Unknown('tree_entry_limit')
            finally:
                os.close(fd)
    finally:
        for fd in stack:
            os.close(fd)
    return counts


def initial_process_value(data):
    if len(data) > 1024 * 1024:
        raise Unknown('api_environment_limit')
    values = [item.split(b'=', 1)[1] for item in data.split(b'\0') if item.startswith(b'EVENT_UPLOADS_DIR=')]
    if len(values) > 1:
        raise Unknown('api_environment_ambiguous')
    if not values or not values[0]:
        raise Unknown('dotenv_startup_state_unverified')
    return canonical(values[0].decode('utf-8'))


def process_setting():
    """Read existing PM2 PID metadata and procfs; do not invoke PM2."""
    root = '/root/.pm2/pids'
    trusted(root, directory=True)
    candidates = list(pathlib.Path(root).glob('cats-api-*.pid'))
    if len(candidates) != 1:
        raise Unknown('api_pid_ambiguous')
    value = read_private(str(candidates[0]), 32).decode('ascii').strip()
    if not re.fullmatch(r'[1-9][0-9]{0,8}', value):
        raise Unknown('api_pid_format')
    proc = pathlib.Path('/proc') / value
    def identity():
        # Process name may contain spaces/parentheses; starttime follows its
        # final closing parenthesis. Detect PID reuse across the private reads.
        return (proc / 'stat').read_text().rsplit(')', 1)[1].split()[19]
    started = identity()
    # cwd is intentionally read as link text, never traversed.
    if proc.stat().st_uid != 0 or os.readlink(proc / 'cwd') != PROJECT:
        raise Unknown('api_process_identity')
    command = (proc / 'cmdline').read_bytes()
    if len(command) > 65536 or not re.fullmatch(rb'(?:node )?/opt/cats-pajamas-club/server\.js\x00+', command):
        raise Unknown('api_process_identity')
    with (proc / 'environ').open('rb') as stream:
        data = stream.read(1024 * 1024 + 1)
    if identity() != started:
        raise Unknown('api_process_changed')
    return initial_process_value(data)


def observe(action):
    try:
        return action()
    except Unknown as error:
        # Labels originate in this module, never in subprocess/file errors.
        return {'status': 'UNKNOWN', 'reason': str(error)}
    except Exception:
        return {'status': 'UNKNOWN', 'reason': 'unavailable_or_unreadable'}


def audit(nginx):
    result = {'audit': 'backup_source_scope', 'observational': True,
              'archive_content_verified': False, 'runtime_scope': 'UNKNOWN'}
    def builder():
        unit = subprocess.run(['systemctl', 'show', 'cats-pajamas-backup.service',
                               '--property=ExecStart,User', '--no-pager'],
                              stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=10, check=True)
        executable, source = unit_executable(unit.stdout.decode('utf-8'))
        executable_info = trusted(executable)
        payload = read_private(source)
        return {'executable': executable, 'source': source, 'root_owned_nonwritable': True,
                'executable_mode': oct(stat.S_IMODE(executable_info.st_mode)),
                'source_sha256': hashlib.sha256(payload).hexdigest(),
                'selection': observe(lambda: tar_selection(payload.decode('utf-8')))}
    result['builder'] = observe(builder)
    result['configured_api'] = observe(lambda: {'path': media_label(env_setting(read_private(PROJECT + '/.env').decode('utf-8'))),
                                              'startup_loaded_verified': False})
    result['effective_api'] = observe(lambda: {'status': 'OBSERVED_INITIAL_PROCESS_OVERRIDE', 'path': media_label(process_setting())})
    result['nginx'] = observe(lambda: {'path': media_label(nginx_alias(read_private(nginx).decode('utf-8')))})
    result['expected_media'] = {'path': EXPECTED, **observe(lambda: tree_counts(EXPECTED))}
    effective, alias = result['effective_api'].get('path'), result['nginx'].get('path')
    result['api_nginx_paths_match'] = effective == alias if effective in (EXPECTED, LEGACY) and alias in (EXPECTED, LEGACY) else 'UNKNOWN'
    result['effective_api_uses_expected_tree'] = effective == EXPECTED if effective in (EXPECTED, LEGACY) else 'UNKNOWN'
    result['nginx_uses_expected_tree'] = alias == EXPECTED if alias in (EXPECTED, LEGACY) else 'UNKNOWN'
    result['expected_media_selected'] = result['builder'].get('selection', {}).get('status', 'UNKNOWN')
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--nginx-config', required=True)
    args = parser.parse_args()
    # No traceback, command output, config values, or exception details escape.
    print(json.dumps(observe(lambda: audit(canonical(args.nginx_config))), sort_keys=True))


if __name__ == '__main__':
    main()
