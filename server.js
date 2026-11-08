#!/usr/bin/env node
'use strict';

/*
 * FC Coin Lab — on-device server
 * -----------------------------
 * Boots the MITM proxy and the control panel. On iOS the app launches this
 * with nodejs-mobile; the WKWebView loads the panel from 127.0.0.1.
 *
 *   node server.js                  proxy :8080  panel :8081
 *   node server.js --port=9100      custom panel port
 *   node server.js --no-proxy       panel only (laptop mode)
 *   node server.js --promote        pick a capture as template.json
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');

const ARGS = process.argv.slice(2);
const argVal = (k, d) => {
  const hit = ARGS.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.split('=')[1] : d;
};

const CONFIG = {
  proxyPort: +argVal('proxy-port', 8080),
  panelPort: +argVal('port', 8081),
  noProxy: ARGS.includes('--no-proxy'),

  apiHostMatch: /(ea\.com|easports|fifamobile|eamobile)/i,

  dataDir: process.env.FC_DATA_DIR || path.join(__dirname, 'data'),
  templateFile: null,
  captureDir: null,

  intervalMs: 500,
  jitterMs: 140,
  concurrency: 4,
  batchSize: 400,
  restBetweenBatchesMs: 40000,

  baseCoins: 5000,
  coinSpread: 180,
  baseXp: 95,
  xpSpread: 40,
  lossChance: 0.19,
  drawChance: 0.08,
  coinCap: 1_000_000_000,
};

CONFIG.captureDir = path.join(CONFIG.dataDir, 'captures');
CONFIG.templateFile = path.join(CONFIG.dataDir, 'template.json');
fs.mkdirSync(CONFIG.captureDir, { recursive: true });

// ────────────────────────────── STATE ────────────────────────────────
const state = {
  running: false,
  sent: 0,
  failed: 0,
  coinsAdded: 0,
  pendingDelta: 0,
  template: null,
  isForm: false,
  log: [],
};

const COIN = /^(coins?|coinbalance|coinamount|coinreward|rewardcoins|balance|credits?|softcurrency)$/i;
const XP = /^(xp|xpamount|xpreward|experience|experiencereward)$/i;
const ID = /^(id|matchid|gameid|reportid|sessionid|guid|uuid|correlationid|transactionid)$/i;
const TIME = /^(timestamp|utc|utctime|datetime|servertime|clienttime|date|playedat|completedat)$/i;
const HOME = /^(homescore|homegoals|team1score|teamascore)$/i;
const AWAY = /^(awayscore|awaygoals|team2score|teambscore)$/i;

const rand = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function logLine(m) {
  const line = `[${new Date().toTimeString().slice(0, 8)}] ${m}`;
  state.log.unshift(line);
  if (state.log.length > 200) state.log.pop();
  console.log(line);
}

// ────────────────────────── PAYLOAD FORGERY ──────────────────────────
function rollOutcome() {
  const r = Math.random();
  if (r < CONFIG.lossChance) return { h: rand(0, 1), a: rand(1, 3) };
  if (r < CONFIG.lossChance + CONFIG.drawChance) {
    const g = rand(0, 2);
    return { h: g, a: g };
  }
  return { h: rand(1, 4), a: rand(0, 2) };
}

function ctxFor() {
  const o = rollOutcome();
  return {
    coins: Math.max(1200, CONFIG.baseCoins + rand(-CONFIG.coinSpread, CONFIG.coinSpread)),
    xp: Math.max(10, CONFIG.baseXp + rand(-CONFIG.xpSpread, CONFIG.xpSpread)),
    uuid: crypto.randomUUID(),
    now: Date.now(),
    dur: rand(180, 420),
    h: o.h,
    a: o.a,
    poss: rand(38, 62),
    shots: rand(4, 14),
    sot: rand(2, 7),
    passes: rand(90, 260),
    passAcc: rand(62, 91),
    tackles: rand(6, 22),
    fouls: rand(1, 9),
    corners: rand(0, 8),
  };
}

function mutate(node, c, hint) {
  if (Array.isArray(node)) return node.map((n) => mutate(n, c, hint));
  if (node && typeof node === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(node)) out[k] = mutate(v, c, k);
    return out;
  }
  if (!hint) return node;
  const k = hint.toLowerCase();
  if (COIN.test(k)) return c.coins;
  if (XP.test(k)) return c.xp;
  if (ID.test(k)) return c.uuid;
  if (TIME.test(k)) {
    if (typeof node === 'string') return new Date(c.now).toISOString();
    return node > 1e12 ? c.now : Math.floor(c.now / 1000);
  }
  if (HOME.test(k)) return c.h;
  if (AWAY.test(k)) return c.a;
  if (typeof node !== 'number') return node;
  if (/duration|elapsed|timeplayed|matchtime/i.test(k)) return c.dur;
  if (/possession/i.test(k)) return c.poss;
  if (/shotsontarget|shotson/i.test(k)) return c.sot;
  if (/^shots$/i.test(k)) return c.shots;
  if (/^passes$/i.test(k)) return c.passes;
  if (/passaccuracy/i.test(k)) return c.passAcc;
  if (/tackles/i.test(k)) return c.tackles;
  if (/fouls/i.test(k)) return c.fouls;
  if (/corners/i.test(k)) return c.corners;
  return node;
}

function forge(c) {
  if (state.isForm) {
    const p = new URLSearchParams(state.template);
    const o = new URLSearchParams();
    for (const [k, v] of p.entries()) {
      const lk = k.toLowerCase();
      if (COIN.test(lk)) o.set(k, c.coins);
      else if (XP.test(lk)) o.set(k, c.xp);
      else if (ID.test(lk)) o.set(k, c.uuid);
      else if (TIME.test(lk)) o.set(k, c.now);
      else if (HOME.test(lk)) o.set(k, c.h);
      else if (AWAY.test(lk)) o.set(k, c.a);
      else o.set(k, v);
    }
    return o.toString();
  }
  return JSON.stringify(mutate(state.template, c));
}

// ─────────────────────────── REPLAY ENGINE ───────────────────────────
let lastDispatch = 0;
const inflight = new Set();

async function fireOne() {
  const c = ctxFor();
  const gap = Math.max(0, CONFIG.intervalMs + rand(-CONFIG.jitterMs, CONFIG.jitterMs) - (Date.now() - lastDispatch));
  if (gap) await sleep(gap);
  lastDispatch = Date.now();

  const headers = { ...state.template.headers };
  delete headers['content-length'];
  delete headers['accept-encoding'];
  delete headers.host;
  headers['content-type'] = state.isForm
    ? 'application/x-www-form-urlencoded'
    : 'application/json';

  const t = (async () => {
    try {
      const r = await fetch(state.template.url, {
        method: state.template.method || 'POST',
        headers,
        body: forge(c),
      });
      if (!r.ok) {
        state.failed++;
        if (r.status === 401) logLine('401 — token expired, recapture');
        return;
      }
      state.sent++;
      state.coinsAdded += c.coins;
      state.pendingDelta += c.coins;
    } catch {
      state.failed++;
    }
  })();

  inflight.add(t);
  t.finally(() => inflight.delete(t));
}

async function runQueue(target) {
  if (!state.template) return;
  state.running = true;
  const goal = Math.min(target || CONFIG.coinCap, CONFIG.coinCap);
  let n = 0;

  while (state.running && state.coinsAdded < goal) {
    if (inflight.size < CONFIG.concurrency) {
      await fireOne();
      if (++n >= CONFIG.batchSize) {
        n = 0;
        logLine(`resting ${CONFIG.restBetweenBatchesMs / 1000}s`);
        await sleep(CONFIG.restBetweenBatchesMs);
      }
    } else {
      await sleep(25);
    }
  }
  state.running = false;
  logLine(`stopped · sent ${state.sent} · failed ${state.failed}`);
}

// ──────────────────────── RESPONSE PATCHING ──────────────────────────
function patchBalance(json, d) {
  let hit = false;
  (function walk(n) {
    if (!n || typeof n !== 'object') return;
    for (const [k, v] of Object.entries(n)) {
      if (typeof v === 'number' && /^(coins?|coinbalance|balance|credits?)$/i.test(k)) {
        n[k] = v + d;
        hit = true;
      } else if (v && typeof v === 'object') walk(v);
    }
  })(json);
  return hit;
}

// ───────────────────────────── THE PROXY ─────────────────────────────
function startProxy() {
  let Proxy;
  try {
    ({ Proxy } = require('http-mitm-proxy'));
  } catch {
    logLine('http-mitm-proxy missing — panel-only mode');
    return;
  }

  const proxy = new Proxy();
  proxy.onError(() => {});

  proxy.onRequest((ctx, cb) => {
    const req = ctx.clientToProxyRequest;
    const host = req.headers.host || '';
    if (!CONFIG.apiHostMatch.test(host)) return cb();
    if (ctx.proxyToServerRequestOptions?.headers) {
      ctx.proxyToServerRequestOptions.headers['accept-encoding'] = 'identity';
    }
    const m = (req.method || 'GET').toUpperCase();
    if (m === 'POST' || m === 'PUT') {
      const chunks = [];
      req.on('data', (x) => chunks.push(x));
      req.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        if (/coin|reward|match|game|result|finish|complete/i.test(req.url) && raw.length < 20000) {
          const name = `${Date.now()}_${crypto.randomBytes(3).toString('hex')}.json`;
          try {
            fs.writeFileSync(
              path.join(CONFIG.captureDir, name),
              JSON.stringify({ url: `https://${host}${req.url}`, method: m, headers: req.headers, body: raw }, null, 2)
            );
            logLine(`captured ${req.url.slice(0, 50)}`);
          } catch {}
        }
        cb();
      });
      return;
    }
    cb();
  });

  proxy.onResponse((ctx, cb) => {
    const res = ctx.serverToProxyResponse;
    const ct = String(res.headers['content-type'] || '');
    const d = state.pendingDelta;
    if (!ct.includes('json') || d <= 0) return cb();

    const chunks = [];
    res.on('data', (x) => chunks.push(x));
    res.on('end', () => {
      let body = Buffer.concat(chunks);
      try {
        const json = JSON.parse(body.toString('utf8'));
        if (patchBalance(json, d)) {
          body = Buffer.from(JSON.stringify(json));
          delete res.headers['content-length'];
          delete res.headers['content-encoding'];
          state.pendingDelta = 0;
        }
      } catch {}
      ctx.proxyToClientResponse.writeHead(res.statusCode, res.headers);
      ctx.proxyToClientResponse.end(body);
      cb();
    });
    res.on('error', () => cb());
  });

  proxy.listen({ port: CONFIG.proxyPort }, () => {
    logLine(`proxy listening :${CONFIG.proxyPort}`);
  });
}

// ─────────────────────────────── PANEL ───────────────────────────────
const PANEL = `<!doctype html><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<title>FC Coin Lab</title>
<style>
  :root{color-scheme:dark}
  *{box-sizing:border-box}
  body{margin:0;font:15px/1.5 ui-monospace,Menlo,monospace;background:#0b0d10;color:#d6dae0;
       padding:22px 18px calc(30px + env(safe-area-inset-bottom));-webkit-text-size-adjust:100%}
  h1{margin:0;font-size:15px;letter-spacing:.16em;text-transform:uppercase;color:#fff}
  .sub{color:#59636f;font-size:11px;letter-spacing:.05em;margin:3px 0 20px}
  input,button{font:inherit;border-radius:12px;border:1px solid #232b34;background:#0e1216;color:#d6dae0}
  input{width:100%;padding:13px;margin-bottom:11px;font-size:16px}
  button{width:100%;padding:19px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;cursor:pointer}
  #go{background:#c8102e;border-color:#c8102e;color:#fff;font-size:17px;box-shadow:0 6px 22px -8px #c8102e}
  #go:disabled{opacity:.4;box-shadow:none}
  #stop{background:#161c23;margin-top:9px;padding:14px;font-size:13px}
  .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:18px 0}
  .k{background:#0e1216;border:1px solid #1b222a;border-radius:11px;padding:11px 9px;overflow:hidden}
  .k b{display:block;font-size:16px;color:#fff;white-space:nowrap;text-overflow:ellipsis;overflow:hidden}
  .k span{font-size:9px;color:#59636f;text-transform:uppercase;letter-spacing:.11em}
  details{background:#0e1216;border:1px solid #1b222a;border-radius:12px;padding:13px;margin-top:16px}
  summary{font-size:12px;letter-spacing:.09em;text-transform:uppercase;color:#8b96a3;cursor:pointer}
  ol{margin:12px 0 0;padding-left:19px;font-size:12px;color:#7d8896;line-height:1.85}
  a{color:#e0484f}
  pre{margin:16px 0 0;max-height:190px;overflow:auto;font-size:10.5px;line-height:1.6;color:#6c7784;
      background:#080a0d;padding:11px;border-radius:11px;border:1px solid #151b22;white-space:pre-wrap}
</style>
<h1>FC Coin Lab</h1>
<div class="sub">replay engine · 5,000/match · 500 ms</div>
<input id="amount" type="number" inputmode="numeric" value="1000000000">
<button id="go">Add Coins</button>
<button id="stop">Stop</button>
<div class="grid">
  <div class="k"><b id="s">0</b><span>sent</span></div>
  <div class="k"><b id="c">0</b><span>coins</span></div>
  <div class="k"><b id="f">0</b><span>failed</span></div>
</div>
<details><summary>Setup / status</summary><ol id="setup"></ol></details>
<pre id="log"></pre>
<script>
const $=i=>document.getElementById(i);
$('go').onclick=()=>fetch('/add-coins',{method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify({amount:+$('amount').value})});
$('stop').onclick=()=>fetch('/stop',{method:'POST'});
const fmt=n=>n>=1e9?(n/1e9).toFixed(2)+'B':n>=1e6?(n/1e6).toFixed(2)+'M':n.toLocaleString();
setInterval(async()=>{
  let s; try{ s=await(await fetch('/status')).json(); }catch{ return; }
  $('s').textContent=fmt(s.sent); $('c').textContent=fmt(s.coinsAdded); $('f').textContent=fmt(s.failed);
  $('log').textContent=s.log.join('\\n');
  $('go').disabled=s.running||!s.hasTemplate;
  $('go').textContent=s.running?'Running…':(s.hasTemplate?'Add Coins':'No template');
  $('setup').innerHTML=s.setup.map(t=>'<li>'+t+'</li>').join('');
},900);
</script>`;

function setupSteps() {
  const s = [];
  s.push(`Proxy target: <b>127.0.0.1:${CONFIG.proxyPort}</b>`);
  s.push('Wi-Fi → your network → Configure Proxy → Manual → 127.0.0.1 / ' + CONFIG.proxyPort);
  s.push('Safari → <a href="http://mitm.it">mitm.it</a> → install the certificate');
  s.push('Settings → General → About → Certificate Trust → enable it');
  s.push('Open FC Mobile, play ONE match, come back here');
  s.push(state.template ? 'Template: <b>loaded</b>' : 'Template: <b>missing</b> — tap “Pick template” below');
  return s;
}

const panel = http.createServer((req, res) => {
  const url = req.url.split('?')[0];

  if (req.method === 'POST' && url === '/add-coins') {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      if (!state.template) return res.end('no template');
      if (state.running) return res.end('busy');
      const { amount } = JSON.parse(Buffer.concat(chunks).toString() || '{}');
      state.sent = state.failed = state.coinsAdded = 0;
      runQueue(amount);
      res.end('ok');
    });
    return;
  }
  if (req.method === 'POST' && url === '/stop') {
    state.running = false;
    return res.end('ok');
  }
  if (url === '/promote') {
    promote();
    return res.end('ok');
  }
  if (url === '/status') {
    res.setHeader('content-type', 'application/json');
    return res.end(JSON.stringify({
      running: state.running, sent: state.sent, failed: state.failed,
      coinsAdded: state.coinsAdded, hasTemplate: !!state.template, setup: setupSteps(), log: state.log.slice(0, 50),
    }));
  }
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.end(PANEL);
});

// ──────────────────────────── TEMPLATE ───────────────────────────────
function loadTemplate() {
  if (!fs.existsSync(CONFIG.templateFile)) return false;
  const t = JSON.parse(fs.readFileSync(CONFIG.templateFile, 'utf8'));
  state.isForm = /x-www-form-urlencoded/.test(t.headers?.['content-type'] || '');
  if (!state.isForm) {
    try { t.body = JSON.parse(t.body); } catch { state.isForm = true; }
  }
  state.template = t;
  return true;
}

function promote() {
  const files = fs.readdirSync(CONFIG.captureDir).filter((f) => f.endsWith('.json'));
  if (!files.length) return logLine('no captures to promote');
  let best = null, score = -1;
  for (const f of files) {
    const c = JSON.parse(fs.readFileSync(path.join(CONFIG.captureDir, f), 'utf8'));
    const sc = (c.body.match(/coin/gi) || []).length + (/match|result|finish/i.test(c.url) ? 5 : 0);
    if (sc > score) { score = sc; best = c; }
  }
  fs.writeFileSync(CONFIG.templateFile, JSON.stringify(best, null, 2));
  logLine(`template promoted: ${best.url.slice(0, 60)}`);
}

// ─────────────────────────────── MAIN ────────────────────────────────
if (ARGS.includes('--promote')) {
  promote();
  process.exit(0);
}

loadTemplate();
if (!CONFIG.noProxy) startProxy();
panel.listen(CONFIG.panelPort, '127.0.0.1', () => logLine(`panel :${CONFIG.panelPort}`));

// keep the process alive under nodejs-mobile
process.on('uncaughtException', (e) => logLine(`crash: ${e.message}`));
