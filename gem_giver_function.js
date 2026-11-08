'use strict';

/*
 * Gem grants — same anti-pattern treatment as coins: spread amounts, milestone
 * payouts, fresh claim/session ids per call, jittered cadence, batches and rest.
 * Chunks are smaller and slower because the gem economy is the tightest one.
 */

const { RewardEngine, log } = require('./coin_giver_function');

const engine = new RewardEngine({
  kind: 'gems',
  defaultAmount: 500,
  amountSpread: 65,
  intervalMs: 700,
  jitterMs: 260,
  concurrency: 3,
  batchSize: 90,
  restMs: 25000,
  cap: 50_000_000,
  milestoneChance: 0.07,
  milestoneMin: 2.5,
  milestoneMax: 4,
  claimScore: (c) => {
    let s = 0;
    if (/gem|claim|collect|reward|daily|quest|streak|milestone/i.test(c.url)) s += 6;
    s += (c.body.match(/gem/gi) || []).length * 2;
    s += (c.body.match(/claim|session|streak/gi) || []).length;
    return s;
  },
});

module.exports = { engine, init: (o) => engine.init(o), give: (a) => engine.run(a), log };
