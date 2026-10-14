#!/usr/bin/env python3
"""Non-private fixtures for the restore verifier; no Docker or live service."""
import importlib.util, json, pathlib, subprocess, tarfile, tempfile, gzip, io, unittest, sys
from contextlib import contextmanager
sys.dont_write_bytecode = True
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('proof',pathlib.Path(__file__).with_name('backup-restore-proof.py'))
proof=importlib.util.module_from_spec(spec); spec.loader.exec_module(proof)
@contextmanager
def fixture_directory():
    with tempfile.TemporaryDirectory(prefix='cats-proof-fixture-') as folder:
        target = pathlib.Path(folder).resolve()
        assert target.parent == pathlib.Path(tempfile.gettempdir()).resolve()
        assert target.name.startswith('cats-proof-fixture-')
        yield folder

class RestoreFixtures(unittest.TestCase):
    def test_archive_and_restored_content(self):
        sql='CREATE SCHEMA fixture;\nALTER TABLE public.events OWNER TO fixture_owner;\nCOPY public.events (id, "time", note) FROM stdin;\n2\t12:00\tРљРѕС‚ рџђ€\n1\t\\N\tСЃС‚СЂРѕРєР°\\nРґРІР°\n\\.\n'
        with fixture_directory() as temp:
            archive=pathlib.Path(temp)/'fixture.tar.gz'
            with tarfile.open(archive,'w:gz') as tar:
                payload=gzip.compress(sql.encode()); info=tarfile.TarInfo('./database.sql.gz');info.size=len(payload);tar.addfile(info,io.BytesIO(payload))
                # Unreadable/invalid env content must never enter helper decoding.
                info=tarfile.TarInfo('./app.env'); info.size=1;tar.addfile(info,io.BytesIO(b'\xff'))
            proof.prepare(archive,temp)
            expected=json.loads((pathlib.Path(temp)/'expected.json').read_text())
            self.assertEqual(expected['tables'][0]['rows'],2)
            def run(args,input,**kwargs):
                self.assertIn('/tmp',args)
                query=input.decode()
                output='fixture\n' if 'pg_namespace' in query else 'fixture_owner\n' if 'pg_roles' in query else 'public.events\n' if 'pg_tables' in query else '1\t\\N\tСЃС‚СЂРѕРєР°\\nРґРІР°\n2\t12:00\tРљРѕС‚ рџђ€\n'
                return subprocess.CompletedProcess(args,0,output.encode(),b'')
            with patch.object(proof.subprocess,'run',run), patch('builtins.print'):
                proof.verify(temp,'fixture-container')
            with patch.object(proof.subprocess,'run',lambda *a,**k:subprocess.CompletedProcess(a,0,b'wrong\n',b'')):
                with self.assertRaises(RuntimeError):proof.verify(temp,'fixture-container')
    def test_unsafe_archive_names_and_duplicate_sql(self):
        for name in ('../database.sql.gz', '/database.sql.gz'):
            with self.subTest(name=name), fixture_directory() as temp:
                archive=pathlib.Path(temp)/'fixture.tar.gz'
                with tarfile.open(archive,'w:gz') as tar:
                    payload=gzip.compress(b'fixture'); info=tarfile.TarInfo(name); info.size=len(payload);tar.addfile(info,io.BytesIO(payload))
                with self.assertRaises(ValueError):proof.prepare(archive,temp)
        with fixture_directory() as temp:
            archive=pathlib.Path(temp)/'fixture.tar.gz'
            with tarfile.open(archive,'w:gz') as tar:
                for name in ('./database.sql.gz','database.sql.gz'):
                    payload=gzip.compress(b'fixture');info=tarfile.TarInfo(name);info.size=len(payload);tar.addfile(info,io.BytesIO(payload))
            with self.assertRaises(ValueError):proof.prepare(archive,temp)
    def test_sqlstate_diagnostics(self):
        text='psql:<stdin>:17: ERROR:  42P07 private relation detail\nERROR:  42501 private permission detail\npsql:-:23: ERROR:  XX000 private detail\nDETAIL: secret\nCONTEXT: private SQL\nERROR: private password is secret\npsql:<stdin>:9: ERROR: 42P070 invalid code\n'
        self.assertEqual(proof.safe_errors(text),['SQLSTATE=42P07 line=17','SQLSTATE=42501','SQLSTATE=XX000 line=23'])
        self.assertEqual(proof.safe_errors('ERROR:  42P01\n'),['SQLSTATE=42P01'])
    def test_hash_order_independent_and_content_sensitive(self):
        self.assertEqual(proof.digest(['a\n','b\n']),proof.digest(['b\n','a\n']))
        self.assertNotEqual(proof.digest(['a\n']),proof.digest(['b\n']))
if __name__=='__main__':unittest.main()
