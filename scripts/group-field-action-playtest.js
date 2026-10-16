// Public-command gameplay proof for a paid Guardian or Specter field-action
// cohort. This keeps the default skirmish economy and AI active throughout.
import { Game, BUILDING_DEFS, UNIT_DEFS } from '../src/game/engine.js';
import { activateSelectedUnitAbility, getFieldAbilityCohort } from '../src/game/fieldAbilities.js';
import { SoloClock, SOLO_STEP_SECONDS } from '../src/game/soloClock.js';
import { createSoloPlayback, createSoloRecorder, validateSoloReplay, SOLO_REPLAY_VERSION } from '../src/game/replay.js';

const DEADLINE_SECONDS = 220;
const MAX_TICKS = Math.floor(DEADLINE_SECONDS / SOLO_STEP_SECONDS);
const ENVELOPE = Object.freeze({
  mode: 'skirmish', difficulty: 'easy', seed: 24, scenarioId: 'shard-valley',
  victoryMode: 'elimination', skirmishOpening: 'established',
});

function requireOk(result, action) {
  if (!result?.ok) throw new Error(`${action}: ${result?.reason || 'command rejected'}`);
  return result;
}

function findBuildSiteNearYard(game, defId, yard, anchor = yard) {
  const def = BUILDING_DEFS[defId];
  const candidates = [];
  for (let y = 0; y < game.height - def.h + 1; y++) for (let x = 0; x < game.width - def.w + 1; x++) {
    const distance = Math.hypot(x + def.w / 2 - (anchor.x + anchor.w / 2),
      y + def.h / 2 - (anchor.y + anchor.h / 2));
    if (distance <= 10 && game.canPlaceBuilding(defId, x, y, 'player').ok)
      candidates.push({ x, y, distance });
  }
  candidates.sort((a, b) => a.distance - b.distance || a.y - b.y || a.x - b.x);
  return candidates[0] || null;
}

function findMovePoint(game, units) {
  const center = units.reduce((sum, unit) => ({ x: sum.x + unit.x / units.length,
    y: sum.y + unit.y / units.length }), { x: 0, y: 0 });
  const candidates = [];
  for (let y = 1; y < game.height - 1; y++) for (let x = 1; x < game.width - 1; x++) {
    const point = { x: x + 0.5, y: y + 0.5 };
    const distance = Math.hypot(point.x - center.x, point.y - center.y);
    if (distance < 2.5 || distance > 6 || game.fog[y]?.[x] !== 2 || !game.terrain[y]?.[x]?.walkable)
      continue;
    if (game.buildings.some(building => building.hp > 0 && x >= building.x - 0.2 &&
        x <= building.x + building.w && y >= building.y - 0.2 && y <= building.y + building.h)) continue;
    if (game.units.some(unit => unit.hp > 0 && !units.includes(unit) &&
        Math.hypot(unit.x - point.x, unit.y - point.y) < 1.2)) continue;
    candidates.push({ ...point, distance });
  }
  candidates.sort((a, b) => Math.abs(a.distance - 4) - Math.abs(b.distance - 4) ||
    a.y - b.y || a.x - b.x);
  return candidates[0] || null;
}

function findFactoryGuardAnchor(game, factory, movingUnits) {
  const enemyYard = game.buildings.find(building => building.owner === 'enemy' && building.defId === 'command');
  const fx = factory.x + factory.w / 2, fy = factory.y + factory.h / 2;
  const ex = enemyYard ? enemyYard.x + enemyYard.w / 2 : game.width - fx;
  const ey = enemyYard ? enemyYard.y + enemyYard.h / 2 : 1;
  const length = Math.hypot(ex - fx, ey - fy) || 1;
  const desired = { x: fx + (ex - fx) / length * 4, y: fy + (ey - fy) / length * 4 };
  const candidates = [];
  for (let y = 1; y < game.height - 1; y++) for (let x = 1; x < game.width - 1; x++) {
    const point = { x: x + 0.5, y: y + 0.5 };
    const distanceFromFactory = Math.hypot(point.x - fx, point.y - fy);
    if (distanceFromFactory < 2.5 || distanceFromFactory > 5.5 || game.fog[y]?.[x] !== 2 ||
        !game.terrain[y]?.[x]?.walkable) continue;
    if (game.buildings.some(building => building.hp > 0 && x >= building.x - 0.2 &&
        x <= building.x + building.w && y >= building.y - 0.2 && y <= building.y + building.h)) continue;
    if (game.units.some(unit => unit.hp > 0 && !movingUnits.includes(unit) &&
        Math.hypot(unit.x - point.x, unit.y - point.y) < 1.3)) continue;
    candidates.push({ ...point, score: Math.hypot(point.x - desired.x, point.y - desired.y) });
  }
  candidates.sort((a, b) => a.score - b.score || a.y - b.y || a.x - b.x);
  return candidates[0] || null;
}

export function runGroupFieldActionPlaytest(faction = 'aegis') {
  if (!['aegis', 'vesper'].includes(faction)) throw new TypeError('Choose aegis or vesper.');
  const game = new Game({ ...ENVELOPE, faction, mode: 'skirmish', mapId: 'shard-valley',
    replayVersion: SOLO_REPLAY_VERSION });
  const initialCredits = game.credits.player;
  const initialUnitIds = new Set(game.units.map(unit => unit.id));
  const clock = new SoloClock();
  const recorder = createSoloRecorder(game, clock);
  const route = [];
  const purchases = [];
  let checkpointSerialized = null;
  let activation = null;
  let abilityId = faction === 'aegis' ? 'brace' : 'ghostRun';
  const unitDefId = faction === 'aegis' ? 'guardian' : 'stealthTank';
  let moveTarget = null;
  let combatGuardId = game.units.find(unit => unit.owner === 'player' && unit.defId === 'lightTank')?.id || null;
  let cohortIds = [];
  let replayReport = null;
  let failure = null;

  const addRoute = (step, details = {}) => route.push({ seconds: +game.time.toFixed(3), step, ...details });
  const advanceOne = () => {
    if (clock.completedTicks >= MAX_TICKS) throw new Error(`Stopped at the ${DEADLINE_SECONDS}s simulation deadline.`);
    if (game.status !== 'playing') throw new Error(`Battle ended early (${game.status}, winner ${game.winner || 'unknown'}).`);
    game.update(SOLO_STEP_SECONDS);
    clock.completedTicks++;
    if (game.status !== 'playing') throw new Error(`Battle ended early (${game.status}, winner ${game.winner || 'unknown'}).`);
  };
  const waitFor = (predicate, label) => {
    while (!predicate()) advanceOne();
    addRoute(label);
  };
  const command = (method, args, label, selection = null) => {
    if (selection) game.select(selection);
    const result = requireOk(game[method](...args), label);
    addRoute(label, { ...(result.id ? { id: result.id } : {}), ...(selection ? { ids: [...selection] } : {}) });
    return result;
  };

  try {
    if (!combatGuardId) throw new Error('Starting combat guard (Striker Tank) was not present.');
    const startingCombatGroup = game.units.filter(unit => unit.owner === 'player' && UNIT_DEFS[unit.defId]?.weapon);
    const startingFactory = game.buildings.find(building => building.owner === 'player' && building.defId === 'factory');
    if (!startingFactory) throw new Error('Starting War Factory was not present.');
    const guardAnchor = findFactoryGuardAnchor(game, startingFactory, startingCombatGroup);
    if (!guardAnchor) throw new Error('No visible, passable guard anchor near the starting War Factory was available.');
    command('issueMove', [guardAnchor.x, guardAnchor.y], 'Move starting combat group toward the factory approach',
      startingCombatGroup.map(unit => unit.id));
    let approachTicks = 0;
    while (approachTicks < 15 * 30 && !startingCombatGroup.every(unit =>
      Math.hypot(unit.x - guardAnchor.x, unit.y - guardAnchor.y) <= 2.2)) {
      advanceOne(); approachTicks++;
    }
    if (!startingCombatGroup.every(unit => Math.hypot(unit.x - guardAnchor.x, unit.y - guardAnchor.y) <= 2.2))
      throw new Error('Starting combat group could not reach the factory guard anchor within 15 seconds.');
    command('issueSetStance', ['defensive'], 'Set starting combat group to defensive stance',
      startingCombatGroup.map(unit => unit.id));
    command('issueGuard', [], 'Hold starting combat group at the factory approach',
      startingCombatGroup.map(unit => unit.id));
    const yard = game.buildings.find(building => building.owner === 'player' && building.defId === 'command');
    if (!yard) throw new Error('Starting Construction Yard was not present.');
    const barracks = game.buildings.find(building => building.owner === 'player' && building.defId === 'barracks');
    if (!barracks) throw new Error('Starting Barracks was not present.');

    for (const defId of ['power', 'turret', 'radar', 'tech']) {
      command('startConstruction', [defId], `Start paid ${BUILDING_DEFS[defId].name}`);
      waitFor(() => game.construction?.ready === true, `${BUILDING_DEFS[defId].name} production ready`);
      const anchor = defId === 'turret' ? startingFactory : yard;
      const site = findBuildSiteNearYard(game, defId, yard, anchor);
      if (!site) throw new Error(`No legal ${BUILDING_DEFS[defId].name} site within 10 tiles of its starting base anchor.`);
      const placed = command('issueBuild', [defId, site.x, site.y], `Place ${BUILDING_DEFS[defId].name}`);
      purchases.push({ type: 'building', defId, cost: BUILDING_DEFS[defId].cost,
        x: site.x, y: site.y, id: placed.id });
      if (!game.getEntity(placed.id) || game.getEntity(placed.id).progress < 1)
        waitFor(() => game.getEntity(placed.id)?.progress >= 1, `${BUILDING_DEFS[defId].name} completed`);
      if (defId === 'power') {
        const rockets = [];
        for (let index = 0; index < 2; index++) {
          command('queueUnit', ['rocket', barracks.id], `Queue Rocket Trooper ${index + 1}/2`);
          purchases.push({ type: 'unit', defId: 'rocket', cost: UNIT_DEFS.rocket.cost, queueIndex: index + 1 });
        }
        waitFor(() => {
          const created = game.units.filter(unit => unit.owner === 'player' && unit.defId === 'rocket' &&
            !initialUnitIds.has(unit.id) && !rockets.includes(unit.id));
          if (created.length) rockets.push(created[0].id);
          return rockets.length === 2;
        }, 'Two Rocket Troopers ready');
        const rocketUnits = rockets.map(id => game.getEntity(id)).filter(Boolean);
        const rocketAnchor = findFactoryGuardAnchor(game, startingFactory, rocketUnits);
        if (!rocketAnchor) throw new Error('No visible, passable Rocket Trooper guard anchor near the War Factory was available.');
        command('issueMove', [rocketAnchor.x, rocketAnchor.y], 'Move Rocket Troopers toward the factory approach', rockets);
        waitFor(() => rocketUnits.every(unit => Math.hypot(unit.x - rocketAnchor.x, unit.y - rocketAnchor.y) <= 2.2),
          'Rocket Troopers reached the factory approach');
        command('issueSetStance', ['defensive'], 'Set Rocket Troopers to defensive stance', rockets);
        command('issueGuard', [], 'Hold Rocket Troopers at the factory approach', rockets);
      }
    }

    const factory = game.buildings.find(building => building.owner === 'player' && building.defId === 'factory');
    if (!factory) throw new Error('Starting War Factory was not present.');
    const unitCost = UNIT_DEFS[unitDefId].cost;
    const newUnitIds = [];
    for (let index = 0; index < 2; index++) {
      waitFor(() => game.credits.player >= unitCost, `Credits available for ${unitDefId} ${index + 1}/2`);
      command('queueUnit', [unitDefId, factory.id], `Queue ${unitDefId} ${index + 1}/2`);
      purchases.push({ type: 'unit', defId: unitDefId, cost: unitCost, queueIndex: index + 1 });
      waitFor(() => {
        const created = game.units.filter(unit => unit.owner === 'player' && unit.defId === unitDefId &&
          !initialUnitIds.has(unit.id) && !newUnitIds.includes(unit.id));
        if (created.length) newUnitIds.push(created[0].id);
        return newUnitIds.length > index;
      }, `${unitDefId} ${index + 1}/2 ready`);
      if (index === 0) {
        const firstFieldTank = game.getEntity(newUnitIds[0]);
        const guardianAnchor = { x: startingFactory.x + startingFactory.w / 2,
          y: startingFactory.y + startingFactory.h / 2 + 1.5 };
        command('issueMove', [guardianAnchor.x, guardianAnchor.y], `Move first ${unitDefId} to guard the War Factory`,
          [firstFieldTank.id]);
        waitFor(() => Math.hypot(firstFieldTank.x - guardianAnchor.x, firstFieldTank.y - guardianAnchor.y) <= 1.5,
          `First ${unitDefId} reached the War Factory guard position`);
        command('issueGuard', [], `Set first ${unitDefId} to guard the War Factory`, [firstFieldTank.id]);
      }
    }

    const cohort = game.units.filter(unit => newUnitIds.includes(unit.id)).sort((a, b) =>
      newUnitIds.indexOf(a.id) - newUnitIds.indexOf(b.id));
    if (cohort.length !== 2) throw new Error(`Expected two newly produced ${unitDefId}s; found ${cohort.length}.`);
    cohortIds = cohort.map(unit => unit.id);
    if (abilityId === 'ghostRun') {
      const destination = findMovePoint(game, cohort);
      if (!destination) throw new Error('No visible, open nearby move destination was available for the Specter cohort.');
      moveTarget = { x: destination.x, y: destination.y };
      command('issueMove', [destination.x, destination.y], 'Move Specter cohort to arm Ghost Run', cohortIds);
    } else game.select(cohortIds);

    const ready = getFieldAbilityCohort(game);
    if (!ready || ready.abilityId !== abilityId || ready.readyIds.length !== 2)
      throw new Error(`Two-unit cohort was not ready (${ready?.readyIds?.length || 0}/2; ` +
        `${ready?.needsMoveIds?.length || 0} need move; ${ready?.coolingIds?.length || 0} cooling).`);
    checkpointSerialized = game.serialize();
    addRoute('Saved checkpoint immediately before group activation', { cohortIds: [...cohortIds] });

    activation = activateSelectedUnitAbility(game, abilityId);
    if (!activation.ok || activation.activatedIds.length !== 2)
      throw new Error(`Group activation accepted ${activation.activatedIds.length}/2 units${activation.reason ? `: ${activation.reason}` : '.'}`);
    addRoute(`Activate ${abilityId} for both selected units`, { activatedIds: [...activation.activatedIds] });
    advanceOne();
    const after = getFieldAbilityCohort(game);
    if (!after || after.activeIds.length !== 2 || after.coolingIds.length !== 0)
      throw new Error(`Activation state did not show both units active (${after?.activeIds?.length || 0}/2).`);
    recorder.dispose();

    const abilityCommands = recorder.commands.filter(entry => entry.method === 'useUnitAbility');
    if (abilityCommands.length !== 2 || abilityCommands.some(entry => entry.args[1] !== abilityId) ||
        abilityCommands.some(entry => entry.args.length !== 2))
      throw new Error(`Expected exactly two existing ${abilityId} commands in the solo log; found ${abilityCommands.length}.`);
    const envelope = { ...ENVELOPE, faction };
    const replayValid = validateSoloReplay(envelope, recorder.commands, clock.completedTicks, SOLO_REPLAY_VERSION);
    const playback = createSoloPlayback(envelope, recorder.commands, clock.completedTicks, SOLO_REPLAY_VERSION);
    playback.step(clock.completedTicks);
    const playedUnits = cohortIds.map(id => playback.game.getEntity(id));
    if (playedUnits.some(unit => !unit || (abilityId === 'brace' ? unit.braceUntil : unit.ghostRunUntil) <= 0))
      throw new Error('Ordinary v77 replay playback did not activate both produced units.');
    const comparableState = value => ({ units: value.units, buildings: value.buildings,
      credits: value.credits, terrain: value.terrain, effects: value.effects,
      time: value.time, status: value.status });
    if (JSON.stringify(comparableState(playback.game)) !== JSON.stringify(comparableState(game)))
      throw new Error('Ordinary v77 playback diverged from paid gameplay state at the same end tick.');
    replayReport = { valid: replayValid, version: SOLO_REPLAY_VERSION,
      totalCommands: recorder.commands.length, abilityCommands: abilityCommands.map(entry => ({
        method: entry.method, args: entry.args, selectedIds: entry.selectedIds,
      })), playbackActivatedIds: cohortIds };
  } catch (error) {
    failure = error?.message || String(error);
    if (recorder && !replayReport) recorder.dispose();
  }

  const finalUnits = game.units.filter(unit => unit.owner === 'player');
  const survivingCohort = cohortIds.filter(id => game.getEntity(id)?.hp > 0);
  const factory = game.buildings.find(building => building.owner === 'player' && building.defId === 'factory');
  return {
    ok: !failure,
    ...(failure ? { failure } : {}),
    faction,
    setup: { ...ENVELOPE, faction, mapId: 'shard-valley', replayVersion: SOLO_REPLAY_VERSION },
    elapsedSeconds: +game.time.toFixed(3),
    deadlineSeconds: DEADLINE_SECONDS,
    initialCredits,
    remainingCredits: game.credits.player,
    paidCost: purchases.reduce((sum, purchase) => sum + purchase.cost, 0),
    purchases,
    route,
    combatGuard: { id: combatGuardId, survived: !!game.getEntity(combatGuardId)?.hp,
      hp: game.getEntity(combatGuardId)?.hp || 0 },
    cohort: { unitType: faction === 'aegis' ? 'guardian' : 'stealthTank', abilityId,
      ids: cohortIds, activatedIds: activation?.activatedIds || [], survivingIds: survivingCohort,
      survivorCount: survivingCohort.length,
      activeUntil: cohortIds.map(id => game.getEntity(id)?.[abilityId === 'brace' ? 'braceUntil' : 'ghostRunUntil'] || 0),
      moveTarget },
    matchStatus: { status: game.status, winner: game.winner || null,
      playerAliveUnits: finalUnits.filter(unit => unit.hp > 0).length },
    production: { factoryId: factory?.id || null, factoryHp: factory?.hp || 0,
      factoryProgress: factory?.progress || 0,
      queue: (factory?.queue || []).map(item => ({ defId: item.defId, progress: item.progress })),
      producedFactionUnits: finalUnits.filter(unit => unit.defId === unitDefId)
        .map(unit => ({ id: unit.id, hp: unit.hp, x: +unit.x.toFixed(2), y: +unit.y.toFixed(2) })) },
    replay: replayReport,
    checkpointSerialized,
    checkpointLength: checkpointSerialized?.length || 0,
  };
}

if (process.argv[1]?.endsWith('/group-field-action-playtest.js')) {
  const faction = process.argv[2] || 'aegis';
  const report = runGroupFieldActionPlaytest(faction);
  const { checkpointSerialized, ...compact } = report;
  process.stdout.write(`${JSON.stringify({ ...compact, checkpointLength: checkpointSerialized?.length || 0 })}\n`);
  if (!report.ok) process.exitCode = 1;
}
