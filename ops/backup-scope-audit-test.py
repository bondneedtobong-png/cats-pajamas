#!/usr/bin/env python3
"""Local-only synthetic fixtures. No systemd/PM2 calls or production paths."""
import contextlib
import importlib.util
import io
import json
import os
import pathlib
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('scope', pathlib.Path(__file__).with_name('backup-scope-audit.py'))
scope = importlib.util.module_from_spec(spec)
spec.loader.exec_module(scope)
SECRET = 'SENTINEL_DO_NOT_DISCLOSE_41f8'


@contextlib.contextmanager
def fixture_directory():
    # TemporaryDirectory owns only this new, verified local fixture root.
    with tempfile.TemporaryDirectory(prefix='cats-scope-fixture-') as folder:
        root = pathlib.Path(folder).resolve()
        assert root.parent == pathlib.Path(tempfile.gettempdir()).resolve()
        assert root.name.startswith('cats-scope-fixture-')
        yield root


def unit(path='/usr/local/sbin/cats-pajamas-backup', args=None):
    return 'User=root\nExecStart={ path=' + path + ' ; argv[]=' + (args or path) + ' ; ignore_errors=no ; start_time=[n/a] ; stop_time=[n/a] ; pid=0 ; code=(null) ; status=0/0 }\n'


class ScopeFixtures(unittest.TestCase):
    def test_literal_exact_parent_legacy_and_empty(self):
        for source in [scope.EXPECTED, '/opt/cats-pajamas-uploads', '/opt']:
            result = scope.tar_selection('tar -czf "$WORK/runtime.tar.gz" -C ' + source + ' .')
            self.assertEqual(result['status'], 'SELECTS_EXPECTED_TREE')
            self.assertFalse(result['runtime_copy_verified'])
        result = scope.tar_selection('APP=' + scope.PROJECT + '\ntar -czf "$WORK/runtime.tar.gz" -C "$APP" uploads-runtime')
        self.assertEqual(result['status'], 'DOES_NOT_SELECT_EXPECTED_TREE')
        self.assertTrue(result['selects_legacy_tree'])
        self.assertEqual(scope.observe(lambda: scope.tar_selection('# ' + scope.EXPECTED))['status'], 'UNKNOWN')
        self.assertEqual(scope.tar_selection('set -Eeuo pipefail\ntar -cf out -C ' + scope.EXPECTED + ' .')['status'], 'SELECTS_EXPECTED_TREE')

    def test_shell_settings_termination_and_archive_overwrite_are_unknown(self):
        command = 'tar -cf out -C ' + scope.EXPECTED + ' .'
        cases = ['set -a\nTAR_OPTIONS=--exclude=*\n' + command,
                 'TAR_OPTIONS=/literal\n' + command,
                 'TAR=/usr/bin/tar\n' + command,
                 'exit 0\n' + command, 'exec true\n' + command,
                 command + '\ntar -cf out -C /tmp .',
                 command + '\ntar -cf other -C /tmp .',
                 'mkdir /tmp/' + SECRET + '\n' + command,
                 'UNKNOWN=' + SECRET + '\n' + command,
                 'set -n\n' + command, 'set -x\n' + command,
                 'WORK=$(echo ' + SECRET + ')\n' + command,
                 'tar -cf "$(echo ' + SECRET + ')" -C ' + scope.EXPECTED + ' .']
        for index, source in enumerate(cases):
            with self.subTest(case=index):
                result = scope.observe(lambda: scope.tar_selection(source))
                self.assertEqual(result['status'], 'UNKNOWN')
                self.assertNotIn(SECRET, json.dumps(result))

    def test_tar_ambiguous_syntax_never_passes(self):
        cases = [
            'tar -czf out --exclude=events -C ' + scope.EXPECTED + ' .',
            'if false; then\ntar -czf out -C ' + scope.EXPECTED + ' .\nfi',
            'echo ' + scope.EXPECTED + '\ntar -cf out "$UNSET"',
            'DIR=' + scope.EXPECTED + '\nexport DIR=/elsewhere\ntar -cf out -C "$DIR" .',
            'DIR=' + scope.EXPECTED + '\nunset DIR\ntar -cf out -C "$DIR" .',
            'tar -- -c -f out -C ' + scope.EXPECTED + ' .',
            'tar -cf out -C ' + scope.EXPECTED + ' ../events',
            'tar -cf out -C ' + scope.EXPECTED + ' . | cat',
            'tar -cf out -C ' + scope.EXPECTED + ' . \\',
            'tar -tf archive',
            '. /some/source\ntar -cf out -C ' + scope.EXPECTED + ' .',
            'DIR=' + scope.EXPECTED + "\ntar -cf out -C '$DIR' .",
            'DIR=' + scope.EXPECTED + "\ntar -cf out -C $'DIR' .",
            'DIR=' + scope.EXPECTED + '\ntar -cf out -C \\$DIR .',
            'DIR=' + scope.EXPECTED + '\nDIR+=/other\ntar -cf out -C "$DIR" .',
            'DIR=' + scope.EXPECTED + '\nX=$((DIR=1))\ntar -cf out -C "$DIR" .',
            'DIR=' + scope.EXPECTED + '\ntrap "DIR=/other" DEBUG\ntar -cf out -C "$DIR" .',
            'DIR=' + scope.EXPECTED + '\n$COMMAND DIR\ntar -cf out -C "$DIR" .',
        ]
        for source in cases:
            with self.subTest(case=cases.index(source)):
                self.assertEqual(scope.observe(lambda: scope.tar_selection(source))['status'], 'UNKNOWN')

    def test_unit_selects_only_executable_and_literal_script(self):
        self.assertEqual(scope.unit_executable(unit()), ('/usr/local/sbin/cats-pajamas-backup',) * 2)
        self.assertEqual(scope.unit_executable(unit('/usr/bin/bash', '/usr/bin/bash /usr/local/sbin/cats-pajamas-backup'))[1], '/usr/local/sbin/cats-pajamas-backup')
        for raw in [unit('/usr/bin/bash', '/usr/bin/bash -c ' + SECRET), unit('/tmp/' + SECRET),
                    unit().replace('User=root', 'User=' + SECRET), unit() + 'ExecStart=' + SECRET,
                    unit().replace('argv[]=', 'argv[]=' + SECRET + ' '),
                    unit('/usr/local/sbin/../' + SECRET)]:
            rendered = json.dumps(scope.observe(lambda: scope.unit_executable(raw)))
            self.assertIn('UNKNOWN', rendered)
            self.assertNotIn(SECRET, rendered)

    def test_dotenv_only_whitelisted_setting_and_no_multiline_confusion(self):
        text = 'API_KEY=' + SECRET + '\nexport EVENT_UPLOADS_DIR="' + scope.EXPECTED + '" # okay\n'
        self.assertEqual(scope.env_setting(text), scope.EXPECTED)
        self.assertIsNone(scope.env_setting('KEY="' + SECRET + '\nEVENT_UPLOADS_DIR=' + scope.EXPECTED + '\n"\n'))
        for text in ['EVENT_UPLOADS_DIR=/tmp/' + SECRET, 'EVENT_UPLOADS_DIR=https://' + SECRET,
                     'EVENT_UPLOADS_DIR=$(echo ' + SECRET + ')', 'EVENT_UPLOADS_DIR=' + scope.EXPECTED + '\nEVENT_UPLOADS_DIR=/' + SECRET]:
            result = scope.observe(lambda: {'path': scope.media_label(scope.env_setting(text))})
            self.assertNotIn(SECRET, json.dumps(result))

    def test_nginx_exact_alias_and_conflicts(self):
        text = 'server { ssl_certificate_key /private/' + SECRET + '; location ^~ /uploads/events/ { alias ' + scope.EXPECTED + '/;expires 7d;} }'
        self.assertEqual(scope.nginx_alias(text), scope.EXPECTED)
        for text in [text + text, text.replace('^~', '='), text.replace('alias', 'root'),
                     text.replace('events/;', 'events/../secret/;')]:
            result = scope.observe(lambda: scope.nginx_alias(text))
            self.assertEqual(result['status'], 'UNKNOWN')
            self.assertNotIn(SECRET, json.dumps(result))

    def test_initial_process_override_and_missing_startup_setting(self):
        data = ('SECRET=' + SECRET + '\0EVENT_UPLOADS_DIR=' + scope.EXPECTED + '\0').encode()
        self.assertEqual(scope.initial_process_value(data), scope.EXPECTED)
        for data in [('SECRET=' + SECRET).encode(), b'EVENT_UPLOADS_DIR=\0',
                     ('EVENT_UPLOADS_DIR=' + scope.EXPECTED + '\0EVENT_UPLOADS_DIR=/' + SECRET).encode(),
                     ('EVENT_UPLOADS_DIR=https://' + SECRET).encode()]:
            result = scope.observe(lambda: {'path': scope.media_label(scope.initial_process_value(data))})
            self.assertEqual(result['status'], 'UNKNOWN')
            self.assertNotIn(SECRET, json.dumps(result))

    def test_unreadable_errors_and_secret_subprocess_output_are_redacted(self):
        with patch.object(scope.subprocess, 'run', side_effect=subprocess.CalledProcessError(1, SECRET, output=SECRET)):
            result = scope.audit('/etc/nginx/synthetic.conf')
        self.assertNotIn(SECRET, json.dumps(result))
        self.assertEqual(result['builder']['status'], 'UNKNOWN')
        self.assertTrue(result['observational'])

    def test_aggregate_report_never_prints_private_input(self):
        payload = ('#!/bin/bash\n# ' + SECRET + '\ntar -czf "$WORK/' + SECRET + '" -C ' + scope.EXPECTED + ' .\n').encode()
        conf = ('ssl_certificate_key /private/' + SECRET + '; location ^~ /uploads/events/ { alias ' + scope.EXPECTED + '/; }').encode()
        def private(path, limit=scope.MAX_SOURCE):
            if path.endswith('.env'):
                return ('PASSWORD=' + SECRET + '\nEVENT_UPLOADS_DIR=' + scope.EXPECTED).encode()
            return conf if path.endswith('.conf') else payload
        completed = subprocess.CompletedProcess([], 0, unit().encode())
        info = type('Info', (), {'st_mode': 0o100755})()
        with patch.object(scope.subprocess, 'run', return_value=completed), patch.object(scope, 'trusted', return_value=info), \
             patch.object(scope, 'read_private', side_effect=private), patch.object(scope, 'process_setting', return_value=scope.EXPECTED), \
             patch.object(scope, 'tree_counts', return_value={'status': 'OBSERVED', 'files': 0, 'bytes': 0}):
            result = scope.audit('/etc/nginx/synthetic.conf')
        rendered = json.dumps(result)
        self.assertNotIn(SECRET, rendered)
        self.assertEqual(result['expected_media_selected'], 'SELECTS_EXPECTED_TREE')
        self.assertTrue(result['api_nginx_paths_match'])
        self.assertFalse(result['archive_content_verified'])
        self.assertFalse(result['configured_api']['startup_loaded_verified'])

    def test_path_alias_reparse_and_permissions_rejected(self):
        for mode, uid, attrs in [(0o120777, 0, 0), (0o100777, 0, 0), (0o100755, 1000, 0), (0o100755, 0, 1024)]:
            bad = type('Info', (), {'st_mode': mode, 'st_uid': uid, 'st_file_attributes': attrs})()
            def info(path):
                if str(path) == '/usr/local/sbin/synthetic':
                    return bad
                return type('Info', (), {'st_mode': 0o40755, 'st_uid': 0, 'st_file_attributes': 0})()
            with patch.object(pathlib.Path, 'lstat', info):
                self.assertEqual(scope.observe(lambda: scope.trusted('/usr/local/sbin/synthetic'))['status'], 'UNKNOWN')

    def test_bounded_private_local_fixture(self):
        with fixture_directory() as root:
            item = root / 'local-input'
            item.write_bytes(SECRET.encode())
            with patch.object(scope, 'trusted', return_value=item.lstat()):
                self.assertEqual(scope.read_private(str(item)), SECRET.encode())
                result = scope.observe(lambda: scope.read_private(str(item), 2))
            self.assertNotIn(SECRET, json.dumps(result))
            self.assertEqual(result['reason'], 'input_size_limit')

    @unittest.skipUnless(os.name == 'posix', 'fd-relative traversal is Linux-only')
    def test_counts_do_not_follow_links_or_print_names(self):
        with fixture_directory() as root:
            (root / 'media').mkdir()
            (root / 'media' / SECRET).write_bytes(b'123')
            (root / 'media' / 'alias').symlink_to(root, target_is_directory=True)
            info = (root / 'media').lstat()
            with patch.object(scope, 'trusted', return_value=info):
                result = scope.tree_counts(str(root / 'media'))
            self.assertEqual((result['files'], result['bytes'], result['links_or_special']), (1, 3, 1))
            self.assertNotIn(SECRET, json.dumps(result))


if __name__ == '__main__':
    unittest.main(verbosity=1)
