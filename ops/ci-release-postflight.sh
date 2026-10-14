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
