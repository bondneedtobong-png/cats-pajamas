import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
const shellPath = path => process.platform === 'win32' ? path.replaceAll('\\','/').replace(/^([A-Za-z]):/, (_,drive)=>'/'+drive.toLowerCase()) : path;
{
  const temp=mkdtempSync(join(tmpdir(),'cats-installer-test-'));
  try {
    const original=readFileSync(new URL('./backup-channel-install.sh',import.meta.url),'utf8');
    for(const mode of ['existing-user','existing-group','sshd','policy','publish','reload','success']) {
      const root=join(temp,mode), bin=join(root,'bin'), ops=join(root,'ops');
      for(const path of [bin,ops,...['/usr/local/lib','/usr/local/sbin','/var/lib','/etc/ssh/sshd_config.d','/etc/systemd/system'].map(p=>root+p)]) mkdirSync(path,{recursive:true});
      writeFileSync(root+'/etc/ssh/sshd_config',`Include ${shellPath(root)}/etc/ssh/sshd_config.d/*.conf\n`);
      writeFileSync(root+'/etc/ssh/sshd_config.d/preexisting.conf','preserve');
      const stub=`#!/bin/bash
set -eu
cmd=$(basename "$0")
echo "$cmd $*" >> "$ROOT/log"
case "$cmd" in
getent) if [[ $1 == passwd ]]; then test -f "$ROOT/user"; else test -f "$ROOT/group"; fi ;;
useradd) touch "$ROOT/user" "$ROOT/group" ;;
userdel) rm "$ROOT/user" ;;
groupdel) rm "$ROOT/group" ;;
chown|ssh-keygen) : ;;
install) while [[ $1 == -* ]]; do shift 2; done; cp -- "$@" ;;
node) [[ $MODE != publish ]]; touch "$ROOT/var/lib/cats-backup-export/latest.enc" ;;
sshd)
  if [[ $1 == -t ]]; then [[ $MODE != sshd ]];
  elif [[ $MODE != policy ]]; then
    printf '%s\\n' "forcecommand $ROOT/usr/local/sbin/cats-backup-export" "authorizedkeysfile $ROOT/etc/ssh/cats-backup/authorized_keys" 'authenticationmethods publickey' 'disableforwarding yes' 'permittty no'
  else echo 'forcecommand unexpected'; fi ;;
systemctl)
  if [[ $1 == show ]]; then echo root;
  elif [[ $1 == reload && $MODE == reload && ! -f $ROOT/reload-failed ]]; then touch "$ROOT/reload-failed"; exit 1; fi ;;
esac
`;
      for(const cmd of ['getent','useradd','userdel','groupdel','chown','ssh-keygen','install','node','sshd','systemctl']) writeFileSync(join(bin,cmd),stub,{mode:0o755});
      for(const file of ['backup-channel.mjs','backup-envelope.mjs','backup-recipient.pem','backup-export.sh']) cpSync(new URL('./'+file,import.meta.url),join(ops,file));
      // Transform only fixture source, never production configuration, into isolated filesystem.
      const shellRoot=shellPath(root), shellBin=shellPath(bin);
      const script=original.replace('[[ $EUID == 0 && $# == 1 ]]','[[ $# == 1 ]]')
        .replaceAll('/usr/bin/node',shellBin+'/node').replaceAll('/usr/sbin/sshd',shellBin+'/sshd')
        .replaceAll('/usr/local/',shellRoot+'/usr/local/').replaceAll('/var/lib',shellRoot+'/var/lib').replaceAll('/etc/',shellRoot+'/etc/');
      writeFileSync(join(ops,'install.sh'),script);
      writeFileSync(join(root,'new.pub'),'ssh-ed25519 AAAATEST fixture\n');
      if(mode==='existing-user') writeFileSync(join(root,'user'),'existing');
      if(mode==='existing-group') writeFileSync(join(root,'group'),'existing');
      const result=spawnSync(bash,['-c','export PATH="$ROOT/bin:/usr/bin:/bin"; exec bash "$1" "$2"','fixture',shellPath(join(ops,'install.sh')),shellPath(join(root,'new.pub'))],{env:{...process.env,PATH:shellBin+':/usr/bin:/bin',ROOT:shellRoot,MODE:mode},encoding:'utf8'});
      assert.equal(result.status,mode==='success'?0:1,`${mode}: ${result.stderr}`);
      const log=readFileSync(join(root,'log'),'utf8');
      assert.equal(readFileSync(root+'/etc/ssh/sshd_config.d/preexisting.conf','utf8'),'preserve');
      if(mode.startsWith('existing')) {
        assert.ok(!log.includes('useradd ') && !log.includes('install '),'Preexisting identity caused mutation');
        assert.equal(readFileSync(join(root,mode==='existing-user'?'user':'group'),'utf8'),'existing');
      } else if(mode==='success') {
        assert.ok(existsSync(root+'/var/lib/cats-backup-export/latest.enc'));
        assert.ok(log.indexOf('node ') < log.indexOf('systemctl reload ssh'));
        assert.ok(!log.includes('userdel '));
      } else {
        for(const path of ['/usr/local/lib/cats-backup','/usr/local/sbin/cats-backup-export','/var/lib/cats-backup-export','/etc/ssh/cats-backup','/etc/ssh/sshd_config.d/90-cats-backup.conf','/etc/systemd/system/cats-pajamas-backup.service.d']) assert.ok(!existsSync(root+path),`${mode}: rollback left ${path}`);
        assert.ok(!existsSync(root+'/user') && !existsSync(root+'/group'));
        if(mode==='reload') assert.equal((log.match(/systemctl reload ssh/g)||[]).length,2);
      }
    }
    console.log('PASS: installer rejects existing identities without mutation; rollback sshd/policy/publish/reload; initial publication precedes commit');
  } finally {
    assert.ok(resolve(temp).startsWith(resolve(tmpdir())) && temp.includes('cats-installer-test-'));
    rmSync(temp,{recursive:true,force:true});
  }
}
