#!/usr/bin/env python3
"""Root-only, hash-pinned builder/helper installation; no service changes.

install:  python3 -B backup-builder-install.py --state RELEASE_STATE
          --candidate TRUSTED_BUILDER --helper TRUSTED_HELPER
rollback: python3 -B backup-builder-install.py --state RELEASE_STATE --rollback

Candidate files must first be copied from the checked commit into a trusted,
root-owned non-writable path (not /var/tmp). The rollback receipt and originals
remain under RELEASE_STATE/backup-builder-rollback. No arbitrary target option.
"""
import argparse
import contextlib
import hashlib
import json
import os
import pathlib
import re
import stat
import sys
import tempfile
import time

OLD_SHA = '1f30569966ebb585694c7d077642615cf808d79685dfbf27f3055e0580bc199a'
BUILDER_SHA = 'bb6dcf8e4c3c3d74d7c7d2bf613ddc438a5a8ab37d1e62991d782de3c155c2a9'
HELPER_SHA = '65ae040fd884ac0c7604aeb19f430baa6c7d2ab17dd16ae801712c90f0a69f94'
TARGET = pathlib.Path('/usr/local/sbin/cats-pajamas-backup')
HELPER = pathlib.Path('/usr/local/lib/cats-backup-runtime/backup-runtime-media.py')
STATE_ROOT = pathlib.Path('/var/backups/cats-pajamas-release')
LOCK = pathlib.Path('/var/lock/cats-pajamas-backup.lock')
LIMIT = 256 * 1024
ARTIFACT = 'backup-builder-rollback'


def digest(data):
    return hashlib.sha256(data).hexdigest()


def require_root():
    if os.name != 'posix' or os.geteuid() != 0:
        raise ValueError('root_required')


def trusted(path, kind='file'):
    path = pathlib.Path(path)
    if not path.is_absolute() or pathlib.Path(os.path.abspath(path)) != path:
        raise ValueError('path_rejected')
    for item in [*reversed(path.parents), path]:
        info = item.lstat()
        if stat.S_ISLNK(info.st_mode) or getattr(info, 'st_file_attributes', 0) & 1024:
            raise ValueError('alias_rejected')
        if info.st_uid != 0 or info.st_mode & 0o022:
            raise ValueError('ownership_rejected')
        wanted = stat.S_ISDIR if item != path or kind == 'dir' else stat.S_ISREG
        if not wanted(info.st_mode):
            raise ValueError('type_rejected')
    return info


def read_checked(path, expected=None, installed=False):
    info = trusted(path)
    if info.st_size > LIMIT or info.st_size < 1 or (installed and stat.S_IMODE(info.st_mode) != 0o700):
        raise ValueError('size_or_mode_rejected')
    descriptor = os.open(path, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0))
    with os.fdopen(descriptor, 'rb') as stream:
        opened = os.fstat(stream.fileno())
        if (opened.st_dev, opened.st_ino) != (info.st_dev, info.st_ino):
            raise ValueError('source_changed')
        data = stream.read(LIMIT + 1)
    after = trusted(path)
    if len(data) != info.st_size or (info.st_dev, info.st_ino, info.st_mtime_ns, info.st_size) != (after.st_dev, after.st_ino, after.st_mtime_ns, after.st_size):
        raise ValueError('source_changed')
    if expected is not None and digest(data) != expected:
        raise ValueError('hash_rejected')
    return data


def release_state(value):
    value = pathlib.Path(value)
    if value.parent != STATE_ROOT or not re.fullmatch(r'ci-[a-f0-9]{40}-[0-9]+-[0-9]+', value.name):
        raise ValueError('state_rejected')
    info = trusted(value, 'dir')
    if stat.S_IMODE(info.st_mode) != 0o700:
        raise ValueError('state_mode_rejected')
    return value


def secure_created(path, mode):
    os.chown(path, 0, 0)
    os.chmod(path, mode)


def sync_dir(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def write_new(path, data, mode=0o700):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, 'O_NOFOLLOW', 0), mode)
    try:
        secure_created(path, mode)
        with os.fdopen(fd, 'wb') as stream:
            fd = -1  # The stream now owns it, including on write failure.
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
    finally:
        if fd >= 0:
            os.close(fd)


def replace_checked(path, data, expected_current):
    trusted(path.parent, 'dir')
    fd, temporary = tempfile.mkstemp(prefix='.cats-builder-', dir=path.parent)
    temporary = pathlib.Path(temporary)
    try:
        secure_created(temporary, 0o700)
        with os.fdopen(fd, 'wb') as stream:
            fd = -1
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        if expected_current is None:
            # Exclusive publication when the helper did not previously exist.
            os.link(temporary, path)
        else:
            before = trusted(path)
            read_checked(path, expected_current, installed=True)
            after = trusted(path)
            if (before.st_dev, before.st_ino) != (after.st_dev, after.st_ino):
                raise ValueError('target_changed')
            os.replace(temporary, path)
        sync_dir(path.parent)
        read_checked(path, digest(data), installed=True)
    finally:
        if fd >= 0:
            os.close(fd)
        if temporary.exists() and temporary.parent == path.parent and temporary.name.startswith('.cats-builder-'):
            temporary.unlink()


@contextlib.contextmanager
def backup_lock():
    import fcntl
    # Sole distro alias exception: the existing root-owned lock inode in the
    # sticky /run/lock directory. All code/state paths keep strict guards.
    trusted(pathlib.Path('/var'), 'dir')
    trusted(pathlib.Path('/run'), 'dir')
    alias = pathlib.Path('/var/lock').lstat()
    directory = pathlib.Path('/run/lock').lstat()
    if not stat.S_ISLNK(alias.st_mode) or alias.st_uid != 0 or os.readlink('/var/lock') != '/run/lock':
        raise ValueError('lock_alias_rejected')
    if not stat.S_ISDIR(directory.st_mode) or directory.st_uid != 0 or stat.S_IMODE(directory.st_mode) != 0o1777:
        raise ValueError('lock_parent_rejected')
    before = LOCK.lstat()
    if not stat.S_ISREG(before.st_mode) or before.st_uid != 0 or stat.S_IMODE(before.st_mode) != 0o600 or before.st_nlink != 1 or before.st_size != 0:
        raise ValueError('lock_file_rejected')
    fd = os.open(LOCK, os.O_RDWR | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        opened = os.fstat(fd)
        def lock_identity(info):
            return (info.st_dev, info.st_ino, info.st_mode, info.st_uid, info.st_nlink, info.st_size)
        if lock_identity(opened) != lock_identity(before):
            raise ValueError('lock_changed')
        until = time.monotonic() + 5
        while True:
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                if time.monotonic() >= until:
                    raise ValueError('lock_busy') from None
                time.sleep(0.05)
        if lock_identity(LOCK.lstat()) != lock_identity(opened):
            raise ValueError('lock_changed')
        yield
    finally:
        os.close(fd)


def load_receipt(state):
    folder = state / ARTIFACT
    trusted(folder, 'dir')
    receipt = json.loads(read_checked(folder / 'receipt.json'))
    expected = {'version', 'state', 'old_builder', 'new_builder', 'old_helper', 'new_helper', 'created_parent'}
    if set(receipt) != expected or receipt['version'] != 1 or receipt['state'] != state.name or receipt['old_builder'] != OLD_SHA or receipt['new_builder'] != BUILDER_SHA or receipt['new_helper'] != HELPER_SHA or type(receipt['created_parent']) is not bool:
        raise ValueError('receipt_rejected')
    read_checked(folder / 'original-builder.sh', OLD_SHA, installed=True)
    if receipt['old_helper'] is not None:
        if receipt['old_helper'] != HELPER_SHA:
            raise ValueError('old_helper_rejected')
        read_checked(folder / 'original-helper.py', receipt['old_helper'], installed=True)
    return receipt


def create_receipt(state, old_builder, old_helper, created_parent):
    folder = state / ARTIFACT
    if folder.exists() or folder.is_symlink():
        return load_receipt(state)
    folder.mkdir(mode=0o700)
    secure_created(folder, 0o700)
    receipt = {'version': 1, 'state': state.name, 'old_builder': OLD_SHA, 'new_builder': BUILDER_SHA,
               'old_helper': digest(old_helper) if old_helper is not None else None,
               'new_helper': HELPER_SHA, 'created_parent': created_parent}
    write_new(folder / 'original-builder.sh', old_builder)
    if old_helper is not None:
        write_new(folder / 'original-helper.py', old_helper)
    write_new(folder / 'receipt.json', (json.dumps(receipt, sort_keys=True) + '\n').encode(), 0o600)
    sync_dir(folder)
    sync_dir(state)
    return load_receipt(state)


def rollback_locked(state):
    receipt = load_receipt(state)
    current_builder = read_checked(TARGET, installed=True)
    current_helper = read_checked(HELPER, installed=True) if HELPER.exists() or HELPER.is_symlink() else None
    if digest(current_builder) not in (OLD_SHA, BUILDER_SHA) or (current_helper is not None and digest(current_helper) != HELPER_SHA):
        raise ValueError('rollback_drift')
    if digest(current_builder) == BUILDER_SHA:
        replace_checked(TARGET, read_checked(state / ARTIFACT / 'original-builder.sh', OLD_SHA), BUILDER_SHA)
    if receipt['old_helper'] is not None:
        saved = read_checked(state / ARTIFACT / 'original-helper.py', receipt['old_helper'])
        replace_checked(HELPER, saved, HELPER_SHA if current_helper is not None else None)
    elif current_helper is not None:
        read_checked(HELPER, HELPER_SHA, installed=True)
        HELPER.unlink()
        sync_dir(HELPER.parent)
    if receipt['created_parent'] and HELPER.parent.exists():
        trusted(HELPER.parent, 'dir')
        # Unknown contents are preserved. Only our empty directory can go away.
        if not any(HELPER.parent.iterdir()):
            HELPER.parent.rmdir()
            sync_dir(HELPER.parent.parent)
    return {'status': 'ROLLED_BACK', 'builder_sha256': OLD_SHA, 'helper_restored': receipt['old_helper'] is not None}


def install(candidate, helper, state):
    require_root()
    state = release_state(state)
    if not isinstance(HELPER_SHA, str) or not re.fullmatch(r'[a-f0-9]{64}', HELPER_SHA):
        raise ValueError('reviewed_helper_required')
    code = read_checked(pathlib.Path(candidate), BUILDER_SHA)
    helper_code = read_checked(pathlib.Path(helper), HELPER_SHA)
    with backup_lock():
        old = read_checked(TARGET, installed=True)
        old_helper = read_checked(HELPER, installed=True) if HELPER.exists() or HELPER.is_symlink() else None
        if digest(old) == BUILDER_SHA:
            if old_helper is None or digest(old_helper) != HELPER_SHA:
                raise ValueError('bundle_drift')
            return {'status': 'UNCHANGED', 'builder_sha256': BUILDER_SHA, 'helper_sha256': HELPER_SHA}
        if digest(old) != OLD_SHA or old_helper is not None and digest(old_helper) != HELPER_SHA:
            raise ValueError('source_drift')
        missing_parent = not HELPER.parent.exists()
        trusted(HELPER.parent.parent if missing_parent else HELPER.parent, 'dir')
        create_receipt(state, old, old_helper, missing_parent)
        try:
            if missing_parent:
                HELPER.parent.mkdir(mode=0o700)
                secure_created(HELPER.parent, 0o700)
            replace_checked(HELPER, helper_code, HELPER_SHA if old_helper is not None else None)
            replace_checked(TARGET, code, OLD_SHA)
            return {'status': 'INSTALLED', 'builder_sha256': BUILDER_SHA, 'helper_sha256': HELPER_SHA}
        except Exception:
            rollback_locked(state)
            raise


def rollback(state):
    require_root()
    state = release_state(state)
    with backup_lock():
        return rollback_locked(state)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--state', required=True)
    parser.add_argument('--candidate')
    parser.add_argument('--helper')
    parser.add_argument('--rollback', action='store_true')
    args = parser.parse_args()
    try:
        if args.rollback:
            if args.candidate or args.helper:
                raise ValueError('rollback_arguments')
            result = rollback(args.state)
        else:
            if not args.candidate or not args.helper:
                raise ValueError('install_arguments')
            result = install(args.candidate, args.helper, args.state)
        print(json.dumps(result, sort_keys=True))
    except Exception:
        print('FAIL backup builder bundle: guarded operation rejected', file=sys.stderr)
        raise SystemExit(1)


if __name__ == '__main__':
    main()
