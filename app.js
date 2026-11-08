#!/usr/bin/env node
'use strict';

/*
 * FCheats — app entry.
 * Wires the proxy, the three grant modules and the panel together.
 *
 *   node app.js
 *   node app.js --port=8081 --proxy-port=8080 --data-dir=/path
 *   node app.js --no-proxy
 */

const http = require('http');
const path = require('path');
const fs = require('fs');

const VERSION = '1.1.0';
const ARGS = process.argv.slice(2);
const arg = (k, d) => {
  const hit = ARGS.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.split('=').slice(1).join('=') : d;
};

const PORT = +arg('port', 8081);
const PROXY_PORT = +arg('proxy-port', 8080);
const NO_PROXY = ARGS.includes('--no-proxy');
const DATA_DIR = arg('data-dir', path.join(__dirname, 'data'));

fs.mkdirSync(DATA_DIR, { recursive: true });

const core = require('./coin_giver_function');
const gems = require('./gem_giver_function');
const players = require('./player_giver_function');

core.init({ dataDir: DATA_DIR });
gems.init({ dataDir: DATA_DIR });
players.init({ dataDir: DATA_DIR });

const ENGINES = [core.engine, gems.engine, players.engine];
const { log } = core;

const PANEL = `<!doctype html><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<title>FCheats</title>
<style>
  :root{color-scheme:dark}
  *{box-sizing:border-box}
  body{margin:0;font:15px/1.5 ui-monospace,Menlo,monospace;background:#0b0d10;color:#d6dae0;
       padding:22px 18px calc(34px + env(safe-area-inset-bottom));-webkit-text-size-adjust:100%}
  h1{margin:0;font-size:15px;letter-spacing:.16em;text-transform:uppercase;color:#fff}
  .sub{color:#59636f;font-size:11px;letter-spacing:.05em;margin:3px 0 22px}
  section{border:1px solid #1b222a;border-radius:14px;padding:14px;margin-bottom:13px;background:#0e1216}
  .lbl{font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#6c7784;margin-bottom:9px}
  input,select,button{font:inherit;border-radius:11px;border:1px solid #232b34;background:#0b0f13;color:#d6dae0}
  input,select{width:100%;padding:13px;margin-bottom:10px;font-size:16px;appearance:none}
  button{width:100%;padding:16px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;cursor:pointer}
  button:disabled{opacity:.4}
  .coins button{background:#c8102e;border-color:#c8102e;color:#fff;font-size:16px}
  .gems button{background:#2f6fd0;border-color:#2f6fd0;color:#fff;font-size:16px}
  .ply button{background:#1d8a55;border-color:#1d8a55;color:#fff;font-size:15px}
  .grid{display:grid;grid-template-columns:repeat(4,1fr);gap:7px;margin:16px 0}
  .k{background:#0b0f13;border:1px solid #1b222a;border-radius:10px;padding:10px 8px;overflow:hidden}
  .k b{display:block;font-size:15px;color:#fff;white-space:nowrap;text-overflow:ellipsis;overflow:hidden}
  .k span{font-size:9px;color:#59636f;text-transform:uppercase;letter-spacing:.1em}
  details{background:#0b0f13;border:1px solid #1b222a;border-radius:11px;padding:12px;margin-top:6px}
  summary{font-size:11px;letter-spacing:.09em;text-transform:uppercase;color:#8b96a3;cursor:pointer}
  ol{margin:11px 0 0;padding-left:18px;font-size:12px;color:#7d8896;line-height:1.85}
  a{color:#e0484f}
  pre{margin:13px 0 0;max-height:150px;overflow:auto;font-size:10px;line-height:1.6;color:#6c7784;
      background:#080a0d;padding:10px;border-radius:10px;border:1px solid #151b22;white-space:pre-wrap}
  footer{margin-top:14px;font-size:10px;color:#3f4853;text-align:center;letter-spacing:.1em}
</style>
<h1>FCheats</h1>
<div class="sub">coins · gems · players</div>

<section class="coins">
  <div class="lbl">Coins</div>
  <input id="coinAmt" type="number" inputmode="numeric" value="1000000000">
  <button id="goCoins">Add Coins</button>
</section>

<section class="gems">
  <div class="lbl">Gems</div>
  <input id="gemAmt" type="number" inputmode="numeric" value="5000">
  <button id="goGems">Add Gems</button>
</section>

<section class="ply">
  <div class="lbl">Player</div>
  <select id="pos"></select>
  <select id="who"></select>
  <button id="goPlayer">Give Player</button>
</section>

<div class="grid">
  <div class="k"><b id="sc">0</b><span>coins</span></div>
  <div class="k"><b id="sg">0</b><span>gems</span></div>
  <div class="k"><b id="sp">0</b><span>players</span></div>
  <div class="k"><b id="sf">0</b><span>failed</span></div>
</div>

<details><summary>Setup / status</summary><ol id="setup"></ol></details>
<pre id="log"></pre>
<footer id="ver"></footer>

<script>
const $=i=>document.getElementById(i);
const fmt=n=>n>=1e9?(n/1e9).toFixed(2)+'B':n>=1e6?(n/1e6).toFixed(2)+'M':n.toLocaleString();
const post=(u,b)=>fetch(u,{method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify(b||{})});
let roster=null, cd=0;

async function boot(){
  roster=await(await fetch('/roster')).json();
  $('pos').innerHTML=Object.entries(roster).map(([line,pos])=>
    '<optgroup label="'+line+'">'+
    Object.keys(pos).map(p=>'<option value="'+p+'">'+p+'</option>').join('')+
    '</optgroup>').join('');
  fill();
}
function fill(){
  const line=$('pos').selectedOptions[0].parentNode.label;
  const list=(roster[line]||{})[$('pos').value]||[];
  $('who').innerHTML=list.map(p=>'<option value="'+p.id+'">'+p.o+' · '+p.n+
    ' · '+(p.p/1e6).toFixed(1)+'M</option>').join('');
}
}
$('pos').onchange=fill;
$('goCoins').onclick=()=>post('/coins',{amount:+$('coinAmt').value});
$('goGems').onclick=()=>post('/gems',{amount:+$('gemAmt').value});
$('goPlayer').onclick=()=>post('/player',{position:$('pos').value,playerId:+$('who').value});

setInterval(async()=>{
  let s; try{ s=await(await fetch('/status')).json(); }catch{ return; }
  $('sc').textContent=fmt(s.coins); $('sg').textContent=fmt(s.gems);
  $('sp').textContent=s.players; $('sf').textContent=s.failed;
  $('log').textContent=s.log.join('\\n');
  $('setup').innerHTML=s.setup.map(t=>'<li>'+t+'</li>').join('');
  $('ver').textContent='v'+s.version;
  cd=s.cooldown;
  $('goCoins').disabled=s.busy; $('goGems').disabled=s.busy;
  $('goPlayer').disabled=s.busy||cd>0||!s.hasPlayerTemplate;
  $('goPlayer').textContent=cd>0?'Wait '+cd+'s':(s.hasPlayerTemplate?'Give Player':'No template');
},500);

boot();
</script>`;

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  const readBody = () => new Promise((r) => {
    const c = [];
    req.on('data', (x) => c.push(x));
    req.on('end', () => { try { r(JSON.parse(Buffer.concat(c).toString() || '{}')); } catch { r({}); } });
  });

  (async () => {
    if (req.method === 'POST') {
      const b = await readBody();
      if (url === '/coins') { if (core.engine.busy) return res.end('busy'); core.engine.run(b.amount); return res.end('ok'); }
      if (url === '/gems')  { if (gems.engine.busy) return res.end('busy'); gems.engine.run(b.amount); return res.end('ok'); }
      if (url === '/player') {
        const r = players.give(b.position, b.playerId);
        res.statusCode = r.ok ? 200 : 429;
        return res.end(JSON.stringify(r));
      }
      if (url === '/stop') { ENGINES.forEach((e) => (e.running = false)); return res.end('ok'); }
      if (url === '/promote') { ENGINES.forEach((e) => e.promote()); return res.end('ok'); }
    }

    if (url === '/roster') {
      res.setHeader('content-type', 'application/json');
      return res.end(JSON.stringify(players.roster()));
    }

    if (url === '/status') {
      res.setHeader('content-type', 'application/json');
      return res.end(JSON.stringify({
        version: VERSION,
        coins: core.engine.total, gems: gems.engine.total, players: players.state.given,
        failed: ENGINES.reduce((a, e) => a + e.failed, 0),
        busy: ENGINES.some((e) => e.busy),
        cooldown: players.cooldownLeft(),
        hasPlayerTemplate: !!players.engine.template,
        setup: [
          `Proxy target: <b>127.0.0.1:${PROXY_PORT}</b>`,
          `Wi-Fi → network → Configure Proxy → Manual → 127.0.0.1 / ${PROXY_PORT}`,
          'Safari → <a href="http://mitm.it">mitm.it</a> → install certificate',
          'Settings → General → About → Certificate Trust → enable',
          'In game: finish a match, collect a gem reward, open one player pack',
          core.engine.template ? 'Coins: <b>ready</b>' : 'Coins: <b>missing</b>',
          gems.engine.template ? 'Gems: <b>ready</b>' : 'Gems: <b>missing</b>',
          players.engine.template ? 'Players: <b>ready</b>' : 'Players: <b>missing</b>',
        ],
        log: core.state.log.slice(0, 40),
      }));
    }

    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(PANEL);
  })();
});

if (!NO_PROXY) core.startProxy(ENGINES, PROXY_PORT);
server.listen(PORT, '127.0.0.1', () => log(`panel :${PORT} · v${VERSION}`));

process.on('uncaughtException', (e) => log(`crash: ${e.message}`));
