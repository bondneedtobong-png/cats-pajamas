// Run after menu prerender, before home prerender: input still has an empty root.
import { readFileSync, writeFileSync } from 'node:fs';
const input = new URL('../dist/index.html', import.meta.url);
let html = readFileSync(input, 'utf8');
if (!html.includes('<div id="root"></div>')) throw new Error('404 prerender requires the clean build shell');
html = html.replace(/<title>[\s\S]*?<\/title>/, "<title>Страница не найдена — The Cat's Pajamas Club</title>")
 .replace(/<link rel="canonical"[^>]*>/, '')
 .replace(/<script\b[^>]*type="application\/ld\+json"[^>]*>[\s\S]*?<\/script>/g, '')
 .replace(/<meta (?:name="(?:description|twitter:title|twitter:description)"|property="og:(?:url|title|description)")[^>]*>/g, '')
 .replace('</head>', '<meta name="robots" content="noindex, nofollow">\n</head>')
 .replace('<div id="root"></div>', '<div id="root"><main style="min-height:100vh;display:grid;place-content:center;text-align:center;background:var(--bg,#1C101A);color:var(--text,#C6BFB5);font-family:Georgia,serif;padding:24px"><p style="color:var(--gold,#B08900);font-size:64px;margin:0">404</p><h1>Этот столик не найден</h1><p>Похоже, вы заглянули туда, где джаз ещё не звучит. Такой страницы нет — но бар точно есть.</p><a href="/" style="color:var(--gold,#B08900)">← НА ГЛАВНУЮ</a></main></div>');
writeFileSync(new URL('../dist/404.html', import.meta.url), html);
console.log('[prerender-404] dist/404.html: noindex page with React entry assets');
