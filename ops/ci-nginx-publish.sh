#!/usr/bin/env bash
set -Eeuo pipefail
sha=${1:?expected commit required}
[[ "$sha" =~ ^[0-9a-f]{40}$ ]]
runid=${2:?workflow run and attempt required}
[[ "$runid" =~ ^[0-9]+-[0-9]+$ ]]
state=/var/backups/cats-pajamas-release/ci-$sha-$runid
cd /opt/cats-pajamas-club
[[ $(git rev-parse HEAD) == "$sha" && -f dist_current/404.html ]]
[[ $(cat "$state/preflight-passed") == "$sha" ]]
IFS= read -r config < "$state/config-path"
[[ "$config" == /etc/nginx/sites-available/* || "$config" == /etc/nginx/sites-enabled/* ]]
[[ $(realpath -e "$config") == "$config" && -f "$config" ]]
cmp -s "$config" "$state/before.conf"
temporary="${config}.cats-ci-$sha-$runid"
[[ ! -e "$temporary" && ! -L "$temporary" ]]
mutated=0
restore() {
  status=$?
  trap - EXIT
  rm -f -- "$temporary"
  if (( status != 0 && mutated == 1 )); then
    install -m 644 "$state/before.conf" "$temporary"
    mv -T "$temporary" "$config"
    if nginx -t && systemctl reload nginx; then
      echo 'Nginx original restored; independently healthy application release may remain.' >&2
    else
      echo 'Nginx restoration requires operator attention.' >&2
    fi
  fi
  exit "$status"
}
trap restore EXIT
install -m 644 "$state/candidate.conf" "$temporary"
mutated=1
mv -T "$temporary" "$config"
nginx -t
systemctl reload nginx
bash ops/ci-release-postflight.sh "$sha"
printf '%s\n' "$sha" > "$state/publish-passed"
echo "PASS production release commit=$sha nginx=true"
