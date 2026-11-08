'use strict';

/*
 * Gem grants — same engine, tighter chunk size and slower cadence.
 */

const { RewardEngine, log } = require('./coin_giver_function');

const engine = new RewardEngine({
  kind: 'gems',
  defaultAmount: 500,
  amountSpread: 25,
  intervalMs: 700,
  jitterMs: 180,
  concurrency: 2,
  batchSize: 120,
  restMs: 30000,
  cap: 50_000_000,
  claimScore: (c) => {
    let s = 0;
    if (/gem|claim|collect|reward|daily|quest/i.test(c.url)) s += 6;
    s += (c.body.match(/gem/gi) || []).length * 2;
    return s;
  },
});

module.exports = { engine, init: (o) => engine.init(o), give: (a) => engine.run(a), log };
