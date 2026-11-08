'use strict';

/*
 * Shared replay engine + MITM proxy, plus the coin grant configuration.
 *
 * The gem and player modules import RewardEngine from here, so this file is the
 * engine as well as the coin config. One engine instance per reward kind; each
 * owns its own captures and template.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const state = { log: [] };
const log = (m) => {
  const line = `[${new Date().toTimeString().slice(0, 8)}] ${m}`;
  state.log.unshift(line);
  if (state.log.length > 200) state.log.pop();
  console.log(line);
};

const rand = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const KEY = {
  amount: /^(coins?|coinamount|coinreward|rewardcoins|gems?|gemamount|gemreward|rewardgems|balance|credits?)$/i,
  xp: /^(xp|xpamount|xpreward|experience)$/i,
  player: /^(playerid|player_id|itemid|item_id|cardid|card_id|definitionid|resourceid|assetid)$/i,
  card: /^(card|cardref|cardrefid|version|variant|program)$/i,
  level: /^(level|traininglevel|playertraininglevel|xp_level)$/i,
  rank: /^(rank|ranklevel|skillrank|cardrank)$/i,
  id: /^(id|matchid|gameid|reportid|sessionid|guid|uuid|transactionid|claimid)$/i,
  time: /^(timestamp|utc|utctime|datetime|servertime|clienttime|date|playedat|completedat)$/i,
  home: /^(homescore|homegoals|team1score|teamascore)$/i,
  away: /^(awayscore|awaygoals|team2score|teambscore)$/i,
};

class RewardEngine {
  constructor(o) {
    this.kind = o.kind;
    this.defaultAmount = o.defaultAmount ?? 5000;
    this.amountSpread = o.amountSpread ?? 180;
    this.intervalMs = o.intervalMs ?? 500;
    this.jitterMs = o.jitterMs ?? 140;
    this.concurrency = o.concurrency ?? 4;
    this.batchSize = o.batchSize ?? 400;
    this.restMs = o.restMs ?? 40000;
    this.cap = o.cap ?? Infinity;
    this.claimScore = o.claimScore ?? (() => 0);
    this.matchStats = !!o.matchStats;

    // occasional oversized reward, so payouts aren't flat
    this.milestoneChance = o.milestoneChance ?? 0;
    this.milestoneMin = o.milestoneMin ?? 2.5;
    this.milestoneMax = o.milestoneMax ?? 4;

    this.template = null;
    this.isForm = false;
    this.running = false;
    this.busy = false;
    this.sent = 0;
    this.failed = 0;
    this.total = 0;
    this.pendingDelta = 0;
    this.inflight = new Set();
    this.lastDispatch = 0;
  }

  init({ dataDir }) {
    this.captureDir = path.join(dataDir, 'captures', this.kind);
    this.templateFile = path.join(dataDir, `${this.kind}.template.json`);
    fs.mkdirSync(this.captureDir, { recursive: true });
    this.load();
  }

  load() {
    if (!fs.existsSync(this.templateFile)) return;
    try {
      const t = JSON.parse(fs.readFileSync(this.templateFile, 'utf8'));
      this.isForm = /x-www-form-urlencoded/.test(t.headers?.['content-type'] || '');
      if (!this.isForm) t.body = JSON.parse(t.body);
      this.template = t;
    } catch (e) {
      log(`${this.kind}: template unreadable — ${e.message}`);
    }
  }

  record(url, method, headers, body) {
    const name = `${Date.now()}_${crypto.randomBytes(3).toString('hex')}.json`;
    try {
      fs.writeFileSync(path.join(this.captureDir, name),
        JSON.stringify({ url, method, headers, body }, null, 2));
      log(`captured ${this.kind}: ${url.slice(0, 48)}`);
    } catch {}
  }

  promote() {
    const files = fs.readdirSync(this.captureDir).filter((f) => f.endsWith('.json'));
    if (!files.length) return log(`no ${this.kind} captures`);
    let best = null, score = -1;
    for (const f of files) {
      const c = JSON.parse(fs.readFileSync(path.join(this.captureDir, f), 'utf8'));
      const s = this.claimScore(c);
      if (s > score) { score = s; best = c; }
    }
    fs.writeFileSync(this.templateFile, JSON.stringify(best, null, 2));
    this.load();
    log(`${this.kind} template promoted`);
  }

  ctx(amount, vars) {
    let base = Math.max(1, (amount || this.defaultAmount) + rand(-this.amountSpread, this.amountSpread));
    if (this.milestoneChance && Math.random() < this.milestoneChance) {
      const mult = this.milestoneMin + Math.random() * (this.milestoneMax - this.milestoneMin);
      base = Math.round(base * mult);
    }
    return {
      amount: base,
      xp: rand(60, 140),
      uuid: crypto.randomUUID(),
      now: Date.now(),
      playerId: vars?.playerId ?? null,
      card: vars?.card ?? null,
      level: vars?.level ?? null,
      rank: vars?.rank ?? null,
      dur: rand(180, 420),
      h: rand(0, 4), a: rand(0, 3),
      poss: rand(38, 62), shots: rand(4, 14), sot: rand(2, 7),
      passes: rand(90, 260), passAcc: rand(62, 91),
      tackles: rand(6, 22), fouls: rand(1, 9), corners: rand(0, 8),
    };
  }

  mutate(node, c, hint) {
    if (Array.isArray(node)) return node.map((n) => this.mutate(n, c, hint));
    if (node && typeof node === 'object') {
      const out = {};
      for (const [k, v] of Object.entries(node)) out[k] = this.mutate(v, c, k);
      return out;
    }
    if (!hint) return node;
    const k = hint.toLowerCase();

    if (c.playerId != null && KEY.player.test(k)) return c.playerId;
    if (c.card != null && KEY.card.test(k)) return c.card;
    if (c.level != null && KEY.level.test(k)) return c.level;
    if (c.rank != null && KEY.rank.test(k)) return c.rank;
    if (KEY.amount.test(k)) return c.amount;
    if (KEY.xp.test(k)) return c.xp;
    if (KEY.id.test(k)) return c.uuid;
    if (KEY.time.test(k)) {
      if (typeof node === 'string') return new Date(c.now).toISOString();
      return node > 1e12 ? c.now : Math.floor(c.now / 1000);
    }
    if (this.matchStats) {
      if (KEY.home.test(k)) return c.h;
      if (KEY.away.test(k)) return c.a;
      if (typeof node !== 'number') return node;
      if (/duration|elapsed|timeplayed|matchtime/i.test(k)) return c.dur;
      if (/possession/i.test(k)) return c.poss;
      if (/shotson/i.test(k)) return c.sot;
      if (/^shots$/i.test(k)) return c.shots;
      if (/^passes$/i.test(k)) return c.passes;
      if (/passaccuracy/i.test(k)) return c.passAcc;
      if (/tackles/i.test(k)) return c.tackles;
      if (/fouls/i.test(k)) return c.fouls;
      if (/corners/i.test(k)) return c.corners;
    }
    return node;
  }

  forge(amount, vars) {
    const c = this.ctx(amount, vars);
    if (this.isForm) {
      const o = new URLSearchParams();
      for (const [k, v] of new URLSearchParams(this.template).entries()) {
        const lk = k.toLowerCase();
        if (vars?.playerId != null && KEY.player.test(lk)) o.set(k, vars.playerId);
        else if (vars?.card != null && KEY.card.test(lk)) o.set(k, vars.card);
        else if (vars?.level != null && KEY.level.test(lk)) o.set(k, vars.level);
        else if (vars?.rank != null && KEY.rank.test(lk)) o.set(k, vars.rank);
        else if (KEY.amount.test(lk)) o.set(k, c.amount);
        else if (KEY.xp.test(lk)) o.set(k, c.xp);
        else if (KEY.id.test(lk)) o.set(k, c.uuid);
        else if (KEY.time.test(lk)) o.set(k, c.now);
        else o.set(k, v);
      }
      return { body: o.toString(), coins: c.amount };
    }
    return { body: JSON.stringify(this.mutate(this.template, c)), coins: c.amount };
  }

  async fire(amount, vars) {
    const { body, coins } = this.forge(amount, vars);
    const headers = { ...this.template.headers };
    delete headers['content-length'];
    delete headers['accept-encoding'];
    delete headers.host;
    headers['content-type'] = this.isForm ? 'application/x-www-form-urlencoded' : 'application/json';

    try {
      const r = await fetch(this.template.url, { method: this.template.method || 'POST', headers, body });
      if (!r.ok) {
        this.failed++;
        if (r.status === 401) log(`${this.kind}: 401 — token expired`);
        return false;
      }
      this.sent++;
      this.total += coins;
      this.pendingDelta += coins;
      return true;
    } catch {
      this.failed++;
      return false;
    }
  }

  async run(target, vars) {
    if (!this.template) return log(`${this.kind}: no template`);
    if (this.busy) return;
    this.busy = true;
    this.running = true;
    this.sent = this.failed = this.total = 0;
    const goal = Math.min(target || this.defaultAmount, this.cap);
    let n = 0;

    while (this.running && this.total < goal) {
      if (this.inflight.size < this.concurrency) {
        const gap = Math.max(0, this.intervalMs + rand(-this.jitterMs, this.jitterMs) - (Date.now() - this.lastDispatch));
        if (gap) await sleep(gap);
        this.lastDispatch = Date.now();

        const t = this.fire(target, vars);
        this.inflight.add(t);
        t.finally(() => this.inflight.delete(t));

        if (++n >= this.batchSize) {
          n = 0;
          log(`${this.kind}: resting ${this.restMs / 1000}s`);
          await sleep(this.restMs);
        }
      } else {
        await sleep(20);
      }
    }
    this.running = false;
    this.busy = false;
    log(`${this.kind}: done · sent ${this.sent} · failed ${this.failed}`);
  }

  patch(json, delta) {
    let hit = false;
    const walk = (n) => {
      if (!n || typeof n !== 'object') return;
      for (const [k, v] of Object.entries(n)) {
        if (typeof v === 'number' && /^(coins?|coinbalance|balance|gems?|gembalance|credits?)$/i.test(k)) {
          n[k] = v + delta;
          hit = true;
        } else if (v && typeof v === 'object') walk(v);
      }
    };
    walk(json);
    return hit;
  }
}

function startProxy(engines, port) {
  let Proxy;
  try { ({ Proxy } = require('http-mitm-proxy')); }
  catch { return log('http-mitm-proxy missing — panel only'); }

  const proxy = new Proxy();
  proxy.onError(() => {});

  proxy.onRequest((ctx, cb) => {
    const req = ctx.clientToProxyRequest;
    const host = req.headers.host || '';
    if (!/(ea\.com|easports|fifamobile|eamobile)/i.test(host)) return cb();
    if (ctx.proxyToServerRequestOptions?.headers) {
      ctx.proxyToServerRequestOptions.headers['accept-encoding'] = 'identity';
    }
    const m = (req.method || 'GET').toUpperCase();
    if (m !== 'POST' && m !== 'PUT') return cb();

    const chunks = [];
    req.on('data', (x) => chunks.push(x));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (raw.length > 20000) return cb();
      let best = null, score = 0;
      for (const e of engines) {
        const s = e.claimScore({ url: req.url, body: raw });
        if (s > score) { score = s; best = e; }
      }
      if (best) best.record(`https://${host}${req.url}`, m, req.headers, raw);
      cb();
    });
  });

  proxy.onResponse((ctx, cb) => {
    const res = ctx.serverToProxyResponse;
    const ct = String(res.headers['content-type'] || '');
    const delta = engines.reduce((a, e) => a + e.pendingDelta, 0);
    if (!ct.includes('json') || delta <= 0) return cb();

    const chunks = [];
    res.on('data', (x) => chunks.push(x));
    res.on('end', () => {
      let body = Buffer.concat(chunks);
      try {
        const json = JSON.parse(body.toString('utf8'));
        if (engines[0].patch(json, delta)) {
          body = Buffer.from(JSON.stringify(json));
          delete res.headers['content-length'];
          delete res.headers['content-encoding'];
          engines.forEach((e) => (e.pendingDelta = 0));
        }
      } catch {}
      ctx.proxyToClientResponse.writeHead(res.statusCode, res.headers);
      ctx.proxyToClientResponse.end(body);
      cb();
    });
    res.on('error', () => cb());
  });

  proxy.listen({ port }, () => log(`proxy :${port}`));
}

const engine = new RewardEngine({
  kind: 'coins',
  defaultAmount: 5000,
  amountSpread: 180,
  intervalMs: 500,
  matchStats: true,
  cap: 1_000_000_000,
  milestoneChance: 0.04,
  milestoneMin: 2,
  milestoneMax: 3,
  claimScore: (c) => {
    let s = 0;
    if (/coin|reward|match|result|finish|complete/i.test(c.url)) s += 6;
    s += (c.body.match(/coin/gi) || []).length;
    return s;
  },
});

module.exports = { RewardEngine, engine, state, log, startProxy, init: (o) => engine.init(o) };
