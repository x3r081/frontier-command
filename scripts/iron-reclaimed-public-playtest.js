import { writeFile } from 'node:fs/promises';
import { createCampaignGame, updateCampaign } from '../src/game/campaign.js';
import { createSoloRecorder, SOLO_REPLAY_VERSION, validateSoloReplay } from '../src/game/replay.js';
import { SoloClock, SOLO_STEP_SECONDS } from '../src/game/soloClock.js';

const MISSION_INDEX = 15;
const TICK_LIMIT = 300 * 30;

function living(game, ids) {
  return (ids || []).filter(id => {
    const entity = game.getEntity(id);
    return entity && entity.hp > 0 && !entity.embarkedIn;
  });
}

function issue(game, method, ids, ...args) {
  game.select(ids);
  const result = game[method](...args);
  if (!result?.ok) throw new Error(`${method} rejected: ${result?.reason || 'unknown reason'}`);
  return result;
}

/**
 * Drive Iron Reclaimed through public player commands on the production 30 Hz
 * clock. This deliberately uses the ordinary squad, enemy AI and combat rules.
 */
export function runIronReclaimedPlaytest({ route = 'south', difficulty = 'normal', seed = 41073, record = true } = {}) {
  if (!['north', 'south'].includes(route)) throw new RangeError('route must be north or south');
  if (!['easy', 'normal', 'hard'].includes(difficulty)) throw new RangeError('Unknown difficulty');
  if (!Number.isSafeInteger(seed) || seed < 1 || seed > 0xffffffff) throw new RangeError('Invalid seed');

  const game = createCampaignGame(MISSION_INDEX, difficulty, seed, 'standard', 'none', 'none',
    'none', 'none', null, SOLO_REPLAY_VERSION);
  const clock = new SoloClock();
  const recorder = record ? createSoloRecorder(game, clock) : null;
  const state = game.campaignState;
  const commands = recorder?.commands;
  const envelope = {
    mode: 'campaign', difficulty, faction: 'aegis', seed,
    scenarioId: 'iron-reclaimed', doctrineId: 'standard', fieldOrderId: 'none',
    carryoverId: 'none', supplyId: 'none', routePayoffId: 'none', campaignVeteran: null,
  };

  const engineer = state.engineerId;
  const startingIds = game.units.filter(unit => unit.owner === 'player').map(unit => unit.id);
  const combatIds = startingIds.filter(id => id !== engineer);
  let recommissionOrdered = false;
  let passOrdered = false;
  let eastOrdered = false;
  let engineerEastOrdered = false;
  let extractionOrdered = false;
  let routeAmbushCleared = false;
  const targetPass = route === 'north' ? { x: 31.5, y: 18.5 } : { x: 31.5, y: 35.5 };
  const extraction = state.extraction;

  const advanceOne = () => clock.advance(SOLO_STEP_SECONDS, dt => {
    game.update(dt);
    updateCampaign(game, MISSION_INDEX, dt, SOLO_REPLAY_VERSION);
    return game.status === 'playing';
  });

  try {
    // Start the channel with the signal Engineer. The engine owns both the
    // powered-workshop check and the 520-credit deduction.
    while (game.status === 'playing' && !game.campaignState.recommissionedVehicleId && clock.completedTicks < TICK_LIMIT) {
      if (!recommissionOrdered) {
        issue(game, 'issueRecommissionWreck', [engineer], state.wreckId);
        recommissionOrdered = true;
      }
      advanceOne();
    }

    while (game.status === 'playing' && clock.completedTicks < TICK_LIMIT) {
      const current = game.campaignState;
      const rendezvous = current.rendezvous;
      const vehicleId = current.recommissionedVehicleId;
      const vehicle = game.getEntity(vehicleId);
      const combatGroup = living(game, [...combatIds, vehicleId]);
      if (current.phase === 'escort-to-relay' && !passOrdered) {
        if (!vehicle || !combatGroup.length) break;
        issue(game, 'issueMove', combatGroup, targetPass.x, targetPass.y, true);
        passOrdered = true;
      }

      const ambush = current.routeAmbushFired && current.routeAmbushUnitIds?.length > 0
        ? current.routeAmbushUnitIds.every(id => !game.getEntity(id) || game.getEntity(id).hp <= 0)
        : false;
      if (current.routeChoice && ambush) routeAmbushCleared = true;
      if (current.phase === 'escort-to-relay' && current.routeChoice && !eastOrdered) {
        issue(game, 'issueMove', living(game, [...combatIds, vehicleId]), rendezvous.x, rendezvous.y, true);
        eastOrdered = true;
      }
      if (current.phase === 'escort-to-relay' && eastOrdered && routeAmbushCleared && !engineerEastOrdered) {
        const atEast = vehicle && Math.hypot(vehicle.x - rendezvous.x, vehicle.y - rendezvous.y) <= rendezvous.radius;
        if (atEast) {
          issue(game, 'issueMove', [engineer], rendezvous.x, rendezvous.y);
          engineerEastOrdered = true;
        }
      }
      if (current.phase === 'extract-team' && !extractionOrdered) {
        issue(game, 'issueMove', living(game, [engineer, vehicleId]), extraction.x, extraction.y);
        extractionOrdered = true;
      }

      advanceOne();
    }
  } finally {
    recorder?.dispose();
  }

  if (game.status !== 'victory' || !game.campaignComplete) {
    const survivors = game.units.filter(unit => unit.owner === 'player').map(({ id, defId, hp, x, y }) =>
      ({ id, defId, hp: Math.round(hp), x: Number(x.toFixed(1)), y: Number(y.toFixed(1)) }));
    const reason = [...game.events].reverse().find(event => /fail|defeat/i.test(event.type))?.message;
    throw new Error(`Playtest did not win: status=${game.status}, phase=${game.campaignState.phase}, elapsed=${game.campaignState.elapsed.toFixed(1)}s, route=${game.campaignState.routeChoice}, reason=${reason || 'unknown'}, survivors=${JSON.stringify(survivors)}, recent=${JSON.stringify(game.events.slice(-6))}`);
  }
  const summary = {
    mission: 'iron-reclaimed', route: game.campaignState.routeChoice, requestedRoute: route,
    difficulty, seed, status: game.status, elapsedSeconds: Number(game.time.toFixed(3)),
    campaignElapsedSeconds: Number(game.campaignState.elapsed.toFixed(3)),
    phase: game.campaignState.phase, engineerId: engineer,
    vehicleId: game.campaignState.recommissionedVehicleId,
    engineerHp: Math.round(game.getEntity(engineer)?.hp || 0),
    vehicleHp: Math.round(game.getEntity(game.campaignState.recommissionedVehicleId)?.hp || 0),
    fieldOrderStatus: game.campaignState.fieldOrderStatus || null,
  };
  const completedTicks = clock.completedTicks;
  if (record) validateSoloReplay(envelope, commands, completedTicks, SOLO_REPLAY_VERSION);
  return { game, commands: commands || [], completedTicks, envelope, summary };
}

async function cli() {
  const args = process.argv.slice(2);
  const writeAt = args.indexOf('--write');
  const outputPath = writeAt >= 0 ? args[writeAt + 1] : null;
  const specs = [
    { route: 'north', difficulty: 'normal', seed: 41073 },
    { route: 'south', difficulty: 'normal', seed: 41073 },
    { route: 'south', difficulty: 'hard', seed: 41073 },
  ];
  const results = specs.map(spec => runIronReclaimedPlaytest({ ...spec, record: true }));
  const payload = results.map(({ commands, completedTicks, envelope, summary }) =>
    ({ envelope, commands, completedTicks, summary }));
  if (outputPath) await writeFile(outputPath, `${JSON.stringify(payload)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify(payload.map(({ summary, completedTicks, commands }) =>
    ({ ...summary, completedTicks, commandCount: commands.length })))}\n`);
}

if (process.argv[1]?.endsWith('/iron-reclaimed-public-playtest.js')) {
  cli().catch(error => { console.error(error); process.exitCode = 1; });
}
