#!/usr/bin/env bash
set -Eeuo pipefail
sha=${1:?expected commit required}
[[ "$sha" =~ ^[0-9a-f]{40}$ ]]
cd /opt/cats-pajamas-club
[[ $(git rev-parse HEAD) == "$sha" ]]
curl_args=(--silent --show-error --connect-timeout 5 --max-time 15 --resolve cats-pajamas.ru:443:127.0.0.1)
body=$(mktemp)
trap 'rm -f -- "$body"' EXIT
for route in / /menu/ /booking /auth /profile /app /admin /booking-rules /privacy /game/; do
  code=$(curl "${curl_args[@]}" -o "$body" -w '%{http_code}' "https://cats-pajamas.ru$route")
  [[ "$code" == 200 ]]
  if [[ "$route" == /menu/ ]]; then node ops/verify-menu-html.mjs "$body"; fi
done
for route in "/ci-unknown-$sha" /booking/deeper "/assets/ci-missing-$sha.js" "/fonts/ci-missing-$sha.woff2"; do
  code=$(curl "${curl_args[@]}" -o "$body" -w '%{http_code}' "https://cats-pajamas.ru$route")
  [[ "$code" == 404 ]]
  grep -q 'noindex, nofollow' "$body"
done
curl "${curl_args[@]}" --fail https://cats-pajamas.ru/health | node -e 'let s="";process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>{try{process.exit(JSON.parse(s).ok===true?0:1)}catch{process.exit(1)}})'
# A missing revision would mean the new API or PostgREST schema cache cannot
# read the additive migration. Inspect the public menu without changing it.
curl "${curl_args[@]}" --fail https://cats-pajamas.ru/api/bar-menu | node -e '
let s="";process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>{try{
const d=JSON.parse(s),r=d.configRevision;
if(!Array.isArray(d.menu)||!d.menu.length||(r!==null&&(!Number.isSafeInteger(r)||r<0)))process.exit(1);
console.log("PASS public menu settings revision available");
}catch{process.exit(1)}})'
# Invalid direction is rejected before SQL takes any lock or reads/writes rows.
# This validates service-role grants and the live PostgREST schema cache. The
# raw environment, URL, key and error payload never reach release logs.
timeout 15 node --input-type=module <<'JS'
import fs from 'node:fs';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
try {
  const config = dotenv.parse(fs.readFileSync('.env'));
  const client = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: (url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(6000) }) } });
  for (const rpc of ['move_team_member_atomic', 'move_cocktail_atomic']) {
    const { error } = await client.rpc(rpc, { p_id: null, p_direction: 'ci-invalid', p_expected: null });
    const verified = error?.code === 'PT400';
    console.log(`${verified ? 'PASS' : 'FAIL'} ${rpc} schema_cache=${verified}`);
    if (!verified) process.exit(1);
  }
} catch {
  console.log('FAIL content_reorder_rpc schema_cache=false');
  process.exit(1);
}
JS
curl "${curl_args[@]}" --fail -H 'Content-Type: application/json' -d '{"action":"login_options"}' https://cats-pajamas.ru/api/auth | node -e 'let s="";process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>{try{process.exit(JSON.parse(s).demoOtpEnabled===false?0:1)}catch{process.exit(1)}})'
# Raw PM2 JSON stays in the pipe; only a boolean result reaches the log.
timeout 10 pm2 jlist | node --input-type=module -e '
import fs from "node:fs"; import dotenv from "dotenv";
const e=dotenv.parse(fs.readFileSync(".env"));let s="";
process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>{try{
const apps=JSON.parse(s);for(const name of ["cats-api","cats-bot"]){
const a=apps.find(a=>a.name===name),p=a?.pm2_env;
if(!a?.pid||p.status!=="online"||p.NODE_ENV!=="production"||p.SESSION_SECRET!==e.SESSION_SECRET||
(p.SESSION_VERSION||"1")!==(e.SESSION_VERSION||"1")||Number(p.SESSION_TTL_SECONDS||604800)!==Number(e.SESSION_TTL_SECONDS||604800)||p.AUTH_DEMO_OTP==="true"||p.ALLOW_DEMO_PAYMENTS==="true")process.exit(1);
}console.log("PASS process_configuration=true");}catch{process.exit(1)}});'
echo "PASS postflight commit=$sha routes=true unknown_404=true health=true demo_disabled=true release=$(basename "$(readlink dist_current)")"
