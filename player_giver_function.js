'use strict';

/*
 * Player grants — logged as market purchases at the card's price, delivered at
 * max training level and max rank. Hard 10 second cooldown.
 * Roster = live FC Mobile top-10 per position, defence → midfield → attack.
 */

const { RewardEngine, log } = require('./coin_giver_function');

const COOLDOWN_MS = 10_000;
const MAX_LEVEL = 30;
const MAX_RANK = 5;

const fmt = (n) => n.toLocaleString('en-US');

const ROSTER = {
  Defense: {
    CB: [
      { n: 'Cannavaro', o: 124, id: 239064, card: '239064_BD27_ICON', p: 152400000 },
      { n: 'Van Dijk', o: 122, id: 203376, card: '203376_CHA26_LIVE', p: 94750000 },
      { n: 'Lúcio', o: 122, id: 266690, card: '266690_GC26_ICON', p: 88200000 },
      { n: 'Chiellini', o: 122, id: 138956, card: '138956_CHA26_ICON', p: 91600000 },
      { n: 'Baresi', o: 122, id: 239528, card: '239528_BD27_ICON', p: 86300000 },
      { n: 'Blanc', o: 122, id: 238444, card: '238444_ANN27_ICON', p: 89900000 },
      { n: 'Varane', o: 122, id: 201535, card: '201535_NUMERO26_ICON', p: 87100000 },
      { n: 'Kompany', o: 122, id: 251483, card: '251483_CHA26_ICON', p: 85400000 },
      { n: 'Desailly', o: 121, id: 239526, card: '239526_CHA26_ICON', p: 68900000 },
      { n: 'Barzagli', o: 121, id: 137186, card: '137186_CHA26_ICON', p: 64200000 },
    ],
    LB: [
      { n: 'Zanetti', o: 122, id: 239517, card: '239517_UB27_ICON', p: 92300000 },
      { n: 'Cucurella', o: 122, id: 239231, card: '239231_TWG26_WINNER', p: 90100000 },
      { n: 'Dest', o: 122, id: 251804, card: '251804_STELLAR27_LIVE', p: 86800000 },
      { n: 'Lahm', o: 122, id: 256154, card: '256154_CHA26_ICON', p: 93500000 },
      { n: 'Nuno Mendes', o: 122, id: 252145, card: '252145_BD27_LIVE', p: 95200000 },
      { n: 'Davies', o: 121, id: 234396, card: '234396_ANN27_LIVE', p: 71400000 },
      { n: 'Petit', o: 121, id: 238414, card: '238414_ANN27_ICON', p: 66800000 },
      { n: 'Maldini', o: 120, id: 238440, card: '238440_SS26_ICON', p: 52300000 },
      { n: 'Gvardiol', o: 120, id: 251517, card: '251517_CHA26_LIVE', p: 48900000 },
      { n: 'Capdevila', o: 120, id: 25924, card: '25924_TWG26_ICON', p: 46100000 },
    ],
    RB: [
      { n: 'Maicon', o: 122, id: 135455, card: '135455_CL27_ICON', p: 88600000 },
      { n: 'Zanetti', o: 122, id: 239517, card: '239517_UB27_ICON', p: 92300000 },
      { n: 'Lahm', o: 122, id: 256154, card: '256154_CHA26_ICON', p: 93500000 },
      { n: 'Dest', o: 122, id: 251804, card: '251804_STELLAR27_LIVE', p: 86800000 },
      { n: 'Valencia', o: 121, id: 167905, card: '167905_UB27_ICON', p: 67500000 },
      { n: 'Cafu', o: 120, id: 261278, card: '261278_TWG26_ICON', p: 51700000 },
      { n: 'Puyol', o: 120, id: 238386, card: '238386_TWG26_ICON', p: 50200000 },
      { n: 'Layún', o: 120, id: 178322, card: '178322_ANN27_ICON', p: 47800000 },
      { n: 'Valverde', o: 120, id: 239053, card: '239053_CHA26_LIVE', p: 49300000 },
      { n: 'Gusto', o: 119, id: 259307, card: '259307_CHA26_LIVE', p: 36400000 },
    ],
  },
  Midfield: {
    CDM: [
      { n: 'Beckenbauer', o: 124, id: 168473, card: '168473_BD27_ICON', p: 158900000 },
      { n: 'Rodri', o: 123, id: 231866, card: '231866_BD27_LIVE', p: 124700000 },
      { n: 'Rijkaard', o: 122, id: 239421, card: '239421_NUMERO26_ICON', p: 96400000 },
      { n: 'Makélélé', o: 122, id: 242859, card: '242859_CHA26_ICON', p: 91800000 },
      { n: 'Rice', o: 122, id: 234378, card: '234378_BD27_LIVE', p: 89200000 },
      { n: 'Gilberto Silva', o: 121, id: 47390, card: '47390_ANN27_ICON', p: 69700000 },
      { n: 'Petit', o: 121, id: 238414, card: '238414_ANN27_ICON', p: 66800000 },
      { n: 'Ramires', o: 121, id: 184943, card: '184943_GC26_ICON', p: 65100000 },
      { n: 'Dunga', o: 121, id: 192190, card: '192190_NUMERO26_ICON', p: 63400000 },
      { n: 'Xabi Alonso', o: 120, id: 269601, card: '269601_TWG26_ICON', p: 53600000 },
    ],
    CM: [
      { n: 'Schweinsteiger', o: 124, id: 256339, card: '256339_ST27_ICON', p: 149300000 },
      { n: 'Vitinha', o: 122, id: 255253, card: '255253_BD27_LIVE', p: 94100000 },
      { n: 'Bellingham', o: 122, id: 252371, card: '252371_ANN27_LIVE', p: 97600000 },
      { n: 'Zidane', o: 122, id: 248450, card: '248450_NUMERO26_ICON', p: 99200000 },
      { n: 'Bruno Fernandes', o: 122, id: 212198, card: '212198_NUMERO26_LIVE', p: 90700000 },
      { n: 'Beckham', o: 122, id: 258779, card: '258779_ANN27_ICON', p: 88400000 },
      { n: 'Pirlo', o: 121, id: 247614, card: '247614_CHA26_ICON', p: 72100000 },
      { n: 'Kroos', o: 121, id: 182521, card: '182521_CHA26_ICON', p: 70500000 },
      { n: 'Gerrard', o: 121, id: 242931, card: '242931_CHA26_ICON', p: 68300000 },
      { n: 'Pedri', o: 121, id: 251854, card: '251854_BD27_LIVE', p: 73800000 },
    ],
    CAM: [
      { n: 'Baggio', o: 123, id: 243078, card: '243078_BD27_ICON', p: 121400000 },
      { n: 'Charlton', o: 122, id: 230025, card: '230025_STELLAR27_ICON', p: 93800000 },
      { n: 'Messi', o: 122, id: 158023, card: '158023_ANN27_LIVE', p: 98500000 },
      { n: 'Kewell', o: 122, id: 266801, card: '266801_ST27_ICON', p: 87600000 },
      { n: 'Bergkamp', o: 121, id: 4000, card: '4000_NUMERO26_ICON', p: 69200000 },
      { n: 'Sneijder', o: 121, id: 274750, card: '274750_CHA26_ICON', p: 66400000 },
      { n: 'Hagi', o: 121, id: 239057, card: '239057_CHA26_ICON', p: 64900000 },
      { n: 'Ronaldinho', o: 120, id: 238395, card: '238395_TWG26_ICON', p: 54200000 },
      { n: 'Olise', o: 120, id: 247827, card: '247827_TWG26_MM', p: 51100000 },
      { n: 'Musiala', o: 120, id: 256790, card: '256790_NUMERO26_LIVE', p: 52800000 },
    ],
  },
  Attack: {
    LW: [
      { n: 'dos Santos', o: 123, id: 170369, card: '170369_ST27_ICON', p: 128600000 },
      { n: 'Mbappé', o: 122, id: 231747, card: '231747_TWG26_WINNER', p: 99700000 },
      { n: 'Vini Jr.', o: 122, id: 238794, card: '238794_NUMERO26_LIVE', p: 98100000 },
      { n: 'Kewell', o: 122, id: 266801, card: '266801_ST27_ICON', p: 87600000 },
      { n: 'Hazard', o: 121, id: 183277, card: '183277_NUMERO26_ICON', p: 71800000 },
      { n: 'Kvaratskhelia', o: 121, id: 247635, card: '247635_CHA26_LIVE', p: 69400000 },
      { n: 'Hagi', o: 121, id: 239057, card: '239057_CHA26_ICON', p: 64900000 },
      { n: 'Quaresma', o: 121, id: 20775, card: '20775_GC26_ICON', p: 63700000 },
      { n: 'Ronaldinho', o: 120, id: 238395, card: '238395_TWG26_ICON', p: 54200000 },
      { n: 'Rivaldo', o: 120, id: 242950, card: '242950_TWG26_ICON', p: 50600000 },
    ],
    RW: [
      { n: 'Lamine Yamal', o: 124, id: 277643, card: '277643_BD27_LIVE', p: 161200000 },
      { n: 'Garrincha', o: 124, id: 247555, card: '247555_STELLAR27_ICON', p: 147800000 },
      { n: 'Dembélé', o: 122, id: 231443, card: '231443_NUMERO26_LIVE', p: 96900000 },
      { n: 'Bale', o: 122, id: 71557, card: '71557_CHA26_ICON', p: 92700000 },
      { n: 'Jairzinho', o: 122, id: 268514, card: '268514_ANN27_ICON', p: 89400000 },
      { n: 'Messi', o: 122, id: 158023, card: '158023_ANN27_LIVE', p: 98500000 },
      { n: 'Yamal', o: 121, id: 277643, card: '277643_TWG26_WINNER', p: 74600000 },
      { n: 'Quaresma', o: 121, id: 20775, card: '20775_GC26_ICON', p: 63700000 },
      { n: 'Olise', o: 120, id: 247827, card: '247827_UTOTS26_LIVE', p: 51100000 },
      { n: 'Maradona', o: 120, id: 190042, card: '190042_TWG26_ICON', p: 55900000 },
    ],
    ST: [
      { n: 'Ronaldo', o: 124, id: 237064, card: '237064_BD27_ICON', p: 164500000 },
      { n: "Eto'o", o: 124, id: 255358, card: '255358_ST27_ICON', p: 151700000 },
      { n: 'Shevchenko', o: 123, id: 239420, card: '239420_BD27_ICON', p: 126300000 },
      { n: 'Baggio', o: 123, id: 243078, card: '243078_BD27_ICON', p: 121400000 },
      { n: 'Mbappé', o: 123, id: 231747, card: '231747_BD27_LIVE', p: 129800000 },
      { n: 'Dembélé', o: 122, id: 231443, card: '231443_BD27_LIVE', p: 96900000 },
      { n: 'Osimhen', o: 122, id: 232293, card: '232293_CHA26_LIVE', p: 91200000 },
      { n: 'C. Ronaldo', o: 122, id: 20801, card: '20801_ANN27_LIVE', p: 94400000 },
      { n: 'Agüero', o: 122, id: 153079, card: '153079_ANN27_ICON', p: 88100000 },
      { n: 'Eusébio', o: 120, id: 242520, card: '242520_TWG26_ICON', p: 53300000 },
    ],
  },
};

const state = { given: 0, nextAt: 0, spent: 0 };

const engine = new RewardEngine({
  kind: 'player',
  defaultAmount: 1,
  amountSpread: 0,
  intervalMs: 400,
  concurrency: 1,
  batchSize: 1,
  claimScore: (c) => {
    let s = 0;
    if (/player|card|pack|grant|claim|unlock|market|buy/i.test(c.url)) s += 6;
    s += (c.body.match(/player|card/gi) || []).length * 2;
    return s;
  },
});

const cooldownLeft = () => Math.max(0, Math.ceil((state.nextAt - Date.now()) / 1000));

function give(position, playerId) {
  if (!engine.template) return { ok: false, reason: 'no template' };
  const left = cooldownLeft();
  if (left > 0) return { ok: false, reason: 'cooldown', wait: left };

  let entry = null;
  for (const line of Object.values(ROSTER)) {
    const list = line[position];
    if (list) entry = list.find((p) => p.id === playerId) || null;
  }
  if (!entry) return { ok: false, reason: 'unknown player' };

  state.nextAt = Date.now() + COOLDOWN_MS;
  state.given++;
  state.spent += entry.p;

  log(`bought ${entry.n} (${position}) for ${fmt(entry.p)} coins · max level · max rank`);

  engine
    .run(1, { playerId: entry.id, card: entry.card, level: MAX_LEVEL, rank: MAX_RANK })
    .catch((e) => log(`purchase failed: ${e.message}`));

  return { ok: true, player: entry.n, price: entry.p, level: MAX_LEVEL, rank: MAX_RANK };
}

module.exports = {
  engine, state, give, cooldownLeft,
  roster: () => ROSTER,
  init: (o) => engine.init(o),
};
