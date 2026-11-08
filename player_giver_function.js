'use strict';

/*
 * Player grants with a hard 10 second cooldown.
 * Roster = live FC Mobile top-10 per position, defence → midfield → attack.
 */

const { RewardEngine, log } = require('./coin_server_editor');

const COOLDOWN_MS = 10_000;

const ROSTER = {
  Defense: {
    CB: [
      { n: 'Cannavaro', o: 124, id: 239064, card: '239064_BD27_ICON' },
      { n: 'Van Dijk', o: 122, id: 203376, card: '203376_CHA26_LIVE' },
      { n: 'Lúcio', o: 122, id: 266690, card: '266690_GC26_ICON' },
      { n: 'Chiellini', o: 122, id: 138956, card: '138956_CHA26_ICON' },
      { n: 'Baresi', o: 122, id: 239528, card: '239528_BD27_ICON' },
      { n: 'Blanc', o: 122, id: 238444, card: '238444_ANN27_ICON' },
      { n: 'Varane', o: 122, id: 201535, card: '201535_NUMERO26_ICON' },
      { n: 'Kompany', o: 122, id: 251483, card: '251483_CHA26_ICON' },
      { n: 'Desailly', o: 121, id: 239526, card: '239526_CHA26_ICON' },
      { n: 'Barzagli', o: 121, id: 137186, card: '137186_CHA26_ICON' },
    ],
    LB: [
      { n: 'Zanetti', o: 122, id: 239517, card: '239517_UB27_ICON' },
      { n: 'Cucurella', o: 122, id: 239231, card: '239231_TWG26_WINNER' },
      { n: 'Dest', o: 122, id: 251804, card: '251804_STELLAR27_LIVE' },
      { n: 'Lahm', o: 122, id: 256154, card: '256154_CHA26_ICON' },
      { n: 'Nuno Mendes', o: 122, id: 252145, card: '252145_BD27_LIVE' },
      { n: 'Davies', o: 121, id: 234396, card: '234396_ANN27_LIVE' },
      { n: 'Petit', o: 121, id: 238414, card: '238414_ANN27_ICON' },
      { n: 'Maldini', o: 120, id: 238440, card: '238440_SS26_ICON' },
      { n: 'Gvardiol', o: 120, id: 251517, card: '251517_CHA26_LIVE' },
      { n: 'Capdevila', o: 120, id: 25924, card: '25924_TWG26_ICON' },
    ],
    RB: [
      { n: 'Maicon', o: 122, id: 135455, card: '135455_CL27_ICON' },
      { n: 'Zanetti', o: 122, id: 239517, card: '239517_UB27_ICON' },
      { n: 'Lahm', o: 122, id: 256154, card: '256154_CHA26_ICON' },
      { n: 'Dest', o: 122, id: 251804, card: '251804_STELLAR27_LIVE' },
      { n: 'Valencia', o: 121, id: 167905, card: '167905_UB27_ICON' },
      { n: 'Cafu', o: 120, id: 261278, card: '261278_TWG26_ICON' },
      { n: 'Puyol', o: 120, id: 238386, card: '238386_TWG26_ICON' },
      { n: 'Layún', o: 120, id: 178322, card: '178322_ANN27_ICON' },
      { n: 'Valverde', o: 120, id: 239053, card: '239053_CHA26_LIVE' },
      { n: 'Gusto', o: 119, id: 259307, card: '259307_CHA26_LIVE' },
    ],
  },
  Midfield: {
    CDM: [
      { n: 'Beckenbauer', o: 124, id: 168473, card: '168473_BD27_ICON' },
      { n: 'Rodri', o: 123, id: 231866, card: '231866_BD27_LIVE' },
      { n: 'Rijkaard', o: 122, id: 239421, card: '239421_NUMERO26_ICON' },
      { n: 'Makélélé', o: 122, id: 242859, card: '242859_CHA26_ICON' },
      { n: 'Rice', o: 122, id: 234378, card: '234378_BD27_LIVE' },
      { n: 'Gilberto Silva', o: 121, id: 47390, card: '47390_ANN27_ICON' },
      { n: 'Petit', o: 121, id: 238414, card: '238414_ANN27_ICON' },
      { n: 'Ramires', o: 121, id: 184943, card: '184943_GC26_ICON' },
      { n: 'Dunga', o: 121, id: 192190, card: '192190_NUMERO26_ICON' },
      { n: 'Xabi Alonso', o: 120, id: 269601, card: '269601_TWG26_ICON' },
    ],
    CM: [
      { n: 'Schweinsteiger', o: 124, id: 256339, card: '256339_ST27_ICON' },
      { n: 'Vitinha', o: 122, id: 255253, card: '255253_BD27_LIVE' },
      { n: 'Bellingham', o: 122, id: 252371, card: '252371_ANN27_LIVE' },
      { n: 'Zidane', o: 122, id: 248450, card: '248450_NUMERO26_ICON' },
      { n: 'Bruno Fernandes', o: 122, id: 212198, card: '212198_NUMERO26_LIVE' },
      { n: 'Beckham', o: 122, id: 258779, card: '258779_ANN27_ICON' },
      { n: 'Pirlo', o: 121, id: 247614, card: '247614_CHA26_ICON' },
      { n: 'Kroos', o: 121, id: 182521, card: '182521_CHA26_ICON' },
      { n: 'Gerrard', o: 121, id: 242931, card: '242931_CHA26_ICON' },
      { n: 'Pedri', o: 121, id: 251854, card: '251854_BD27_LIVE' },
    ],
    CAM: [
      { n: 'Baggio', o: 123, id: 243078, card: '243078_BD27_ICON' },
      { n: 'Charlton', o: 122, id: 230025, card: '230025_STELLAR27_ICON' },
      { n: 'Messi', o: 122, id: 158023, card: '158023_ANN27_LIVE' },
      { n: 'Kewell', o: 122, id: 266801, card: '266801_ST27_ICON' },
      { n: 'Bergkamp', o: 121, id: 4000, card: '4000_NUMERO26_ICON' },
      { n: 'Sneijder', o: 121, id: 274750, card: '274750_CHA26_ICON' },
      { n: 'Hagi', o: 121, id: 239057, card: '239057_CHA26_ICON' },
      { n: 'Ronaldinho', o: 120, id: 238395, card: '238395_TWG26_ICON' },
      { n: 'Olise', o: 120, id: 247827, card: '247827_TWG26_MM' },
      { n: 'Musiala', o: 120, id: 256790, card: '256790_NUMERO26_LIVE' },
    ],
  },
  Attack: {
    LW: [
      { n: 'dos Santos', o: 123, id: 170369, card: '170369_ST27_ICON' },
      { n: 'Mbappé', o: 122, id: 231747, card: '231747_TWG26_WINNER' },
      { n: 'Vini Jr.', o: 122, id: 238794, card: '238794_NUMERO26_LIVE' },
      { n: 'Kewell', o: 122, id: 266801, card: '266801_ST27_ICON' },
      { n: 'Hazard', o: 121, id: 183277, card: '183277_NUMERO26_ICON' },
      { n: 'Kvaratskhelia', o: 121, id: 247635, card: '247635_CHA26_LIVE' },
      { n: 'Hagi', o: 121, id: 239057, card: '239057_CHA26_ICON' },
      { n: 'Quaresma', o: 121, id: 20775, card: '20775_GC26_ICON' },
      { n: 'Ronaldinho', o: 120, id: 238395, card: '238395_TWG26_ICON' },
      { n: 'Rivaldo', o: 120, id: 242950, card: '242950_TWG26_ICON' },
    ],
    RW: [
      { n: 'Lamine Yamal', o: 124, id: 277643, card: '277643_BD27_LIVE' },
      { n: 'Garrincha', o: 124, id: 247555, card: '247555_STELLAR27_ICON' },
      { n: 'Dembélé', o: 122, id: 231443, card: '231443_NUMERO26_LIVE' },
      { n: 'Bale', o: 122, id: 71557, card: '71557_CHA26_ICON' },
      { n: 'Jairzinho', o: 122, id: 268514, card: '268514_ANN27_ICON' },
      { n: 'Messi', o: 122, id: 158023, card: '158023_ANN27_LIVE' },
      { n: 'Yamal', o: 121, id: 277643, card: '277643_TWG26_WINNER' },
      { n: 'Quaresma', o: 121, id: 20775, card: '20775_GC26_ICON' },
      { n: 'Olise', o: 120, id: 247827, card: '247827_UTOTS26_LIVE' },
      { n: 'Maradona', o: 120, id: 190042, card: '190042_TWG26_ICON' },
    ],
    ST: [
      { n: 'Ronaldo', o: 124, id: 237064, card: '237064_BD27_ICON' },
      { n: "Eto'o", o: 124, id: 255358, card: '255358_ST27_ICON' },
      { n: 'Shevchenko', o: 123, id: 239420, card: '239420_BD27_ICON' },
      { n: 'Baggio', o: 123, id: 243078, card: '243078_BD27_ICON' },
      { n: 'Mbappé', o: 123, id: 231747, card: '231747_BD27_LIVE' },
      { n: 'Dembélé', o: 122, id: 231443, card: '231443_BD27_LIVE' },
      { n: 'Osimhen', o: 122, id: 232293, card: '232293_CHA26_LIVE' },
      { n: 'C. Ronaldo', o: 122, id: 20801, card: '20801_ANN27_LIVE' },
      { n: 'Agüero', o: 122, id: 153079, card: '153079_ANN27_ICON' },
      { n: 'Eusébio', o: 120, id: 242520, card: '242520_TWG26_ICON' },
    ],
  },
};

const state = { given: 0, nextAt: 0 };

const engine = new RewardEngine({
  kind: 'player',
  defaultAmount: 1,
  amountSpread: 0,
  intervalMs: 400,
  concurrency: 1,
  batchSize: 1,
  claimScore: (c) => {
    let s = 0;
    if (/player|card|pack|grant|claim|unlock|reward/i.test(c.url)) s += 6;
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
  log(`granting ${entry.n} (${position})`);
  engine.run(1, { playerId: entry.id, card: entry.card }).catch((e) => log(`grant failed: ${e.message}`));

  return { ok: true, player: entry.n, wait: COOLDOWN_MS / 1000 };
}

module.exports = { engine, state, give, cooldownLeft, roster: () => ROSTER, init: (o) => engine.init(o) };
