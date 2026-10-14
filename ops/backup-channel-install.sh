#!/bin/bash
# Explicit, one-time bootstrap; may run only in the separately authorized manual workflow.
set -euo pipefail
[[ $EUID == 0 && $# == 1 ]] || { echo 'Usage: sudo bash ops/backup-channel-install.sh NEW_PUBLIC_KEY_FILE' >&2; exit 1; }
source_dir=$(cd -- "$(dirname -- "$0")" && pwd -P)
command -v node >/dev/null
[[ $(command -v node) == /usr/bin/node ]] || { echo 'Expected /usr/bin/node' >&2; exit 1; }
command -v gzip >/dev/null
command -v tar >/dev/null
systemctl cat cats-pajamas-backup.service >/dev/null
[[ -z $(systemctl show cats-pajamas-backup.service -p User --value) || $(systemctl show cats-pajamas-backup.service -p User --value) == root ]] || { echo 'Existing backup service must run as root; review required' >&2; exit 1; }
# Refuse existing identities/configuration rather than modifying unknown access.
if getent passwd cats-backup >/dev/null; then echo "Existing backup user rejected" >&2; exit 1; fi
if getent group cats-backup >/dev/null; then echo "Existing backup group rejected" >&2; exit 1; fi
for path in /usr/local/lib/cats-backup /usr/local/sbin/cats-backup-export /var/lib/cats-backup-export /etc/ssh/cats-backup /etc/ssh/sshd_config.d/90-cats-backup.conf /etc/systemd/system/cats-pajamas-backup.service.d; do
  [[ ! -e $path && ! -L $path ]] || { echo "Existing configuration rejected: $path" >&2; exit 1; }
done
[[ -f $1 && ! -L $1 ]] || exit 1
IFS= read -r public_key < "$1"
[[ $(wc -l < "$1") == 1 && $public_key =~ ^ssh-ed25519\ [A-Za-z0-9+/]+={0,2}(\ [A-Za-z0-9._@-]+)?$ ]] || { echo 'Expected one new Ed25519 public key' >&2; exit 1; }
ssh-keygen -l -f "$1" >/dev/null
[[ -f /etc/ssh/sshd_config && ! -L /etc/ssh/sshd_config ]]
grep -Eq '^Include[[:space:]]+/etc/ssh/sshd_config.d/\*\.conf' /etc/ssh/sshd_config || { echo 'sshd drop-in Include required' >&2; exit 1; }
for file in backup-channel.mjs backup-envelope.mjs backup-recipient.pem backup-export.sh; do [[ -f $source_dir/$file && ! -L $source_dir/$file ]]; done
# Existing shared parents are never chmod/chown'ed. Refuse aliases.
for parent in /usr/local/lib /usr/local/sbin /var/lib /etc/ssh /etc/systemd/system; do
  [[ -d $parent && ! -L $parent && $(realpath -e "$parent") == "$parent" ]] || exit 1
done
if [[ -e /etc/ssh/sshd_config.d || -L /etc/ssh/sshd_config.d ]]; then
  [[ -d /etc/ssh/sshd_config.d && ! -L /etc/ssh/sshd_config.d && $(realpath -e /etc/ssh/sshd_config.d) == /etc/ssh/sshd_config.d ]] || exit 1
fi
committed=0
user_created=0
reload_attempted=0
created_dirs=()
# Each exact target was checked absent above. Record before writes to cover partial writes.
created_files=(/usr/local/lib/cats-backup/backup-channel.mjs /usr/local/lib/cats-backup/backup-envelope.mjs /usr/local/lib/cats-backup/backup-recipient.pem /usr/local/sbin/cats-backup-export /var/lib/cats-backup-export/latest.enc /etc/ssh/cats-backup/authorized_keys /etc/ssh/sshd_config.d/90-cats-backup.conf /etc/systemd/system/cats-pajamas-backup.service.d/90-encrypted-export.conf)
rollback() {
  result=$?
  trap - EXIT
  if [[ $committed != 1 ]]; then
    set +e
    for file in "${created_files[@]}"; do rm -f -- "$file"; done
    for ((index=${#created_dirs[@]}-1; index>=0; index--)); do rmdir -- "${created_dirs[index]}"; done
    if [[ $user_created == 1 ]]; then
      userdel cats-backup
      if getent group cats-backup >/dev/null; then groupdel cats-backup; fi
    fi
    systemctl daemon-reload
    if [[ $reload_attempted == 1 ]]; then systemctl reload ssh; fi
    echo 'Backup bootstrap rolled back; schedule remains disabled.' >&2
  fi
  exit "$result"
}
trap rollback EXIT
create_dir() {
  mkdir -- "$1"
  created_dirs+=("$1")
  chown "$2" "$1"
  chmod "$3" "$1"
}
useradd --system --user-group --home-dir /var/lib/cats-backup-export --shell /bin/sh cats-backup
user_created=1
create_dir /usr/local/lib/cats-backup root:root 755
install -o root -g root -m 644 "$source_dir/backup-channel.mjs" "$source_dir/backup-envelope.mjs" "$source_dir/backup-recipient.pem" /usr/local/lib/cats-backup/
install -o root -g root -m 755 "$source_dir/backup-export.sh" /usr/local/sbin/cats-backup-export
create_dir /var/lib/cats-backup-export root:cats-backup 2750
create_dir /etc/ssh/cats-backup root:root 755
if [[ ! -d /etc/ssh/sshd_config.d ]]; then create_dir /etc/ssh/sshd_config.d root:root 755; fi
printf 'restrict,command="/usr/local/sbin/cats-backup-export" %s\n' "$public_key" > /etc/ssh/cats-backup/authorized_keys
chmod 644 /etc/ssh/cats-backup/authorized_keys
cat > /etc/ssh/sshd_config.d/90-cats-backup.conf <<'EOF'
Match User cats-backup
    AuthorizedKeysFile /etc/ssh/cats-backup/authorized_keys
    AuthenticationMethods publickey
    PasswordAuthentication no
    KbdInteractiveAuthentication no
    DisableForwarding yes
    PermitTTY no
    ForceCommand /usr/local/sbin/cats-backup-export
Match all
EOF
/usr/sbin/sshd -t
create_dir /etc/systemd/system/cats-pajamas-backup.service.d root:root 755
cat > /etc/systemd/system/cats-pajamas-backup.service.d/90-encrypted-export.conf <<'EOF'
[Service]
ExecStartPost=/usr/bin/node /usr/local/lib/cats-backup/backup-channel.mjs publish
EOF
# Validate effective policy, including any earlier server Match directives.
effective=$(/usr/sbin/sshd -T -C user=cats-backup,host=localhost,addr=127.0.0.1)
for rule in 'forcecommand /usr/local/sbin/cats-backup-export' 'authorizedkeysfile /etc/ssh/cats-backup/authorized_keys' 'authenticationmethods publickey' 'disableforwarding yes' 'permittty no'; do
  grep -Fxq "$rule" <<< "$effective" || { echo "Effective SSH policy rejected: $rule" >&2; exit 1; }
done
/usr/bin/node /usr/local/lib/cats-backup/backup-channel.mjs publish
systemctl daemon-reload
reload_attempted=1
systemctl reload ssh
committed=1
echo 'Installed restricted backup channel. GitHub schedule remains disabled until explicitly enabled.'
