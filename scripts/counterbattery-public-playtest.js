// Rules-84 Counterbattery campaign route. The baseline is one untouched,
// zero-order run; the played route uses only player commands and visible targets.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { COUNTERBATTERY_RULES_VERSION, createCampaignGame, getCounterbatteryView, updateCampaign } from '../src/game/campaign.js';
import { createSoloPlayback, createSoloRecorder, validateSoloReplay } from '../src/game/replay.js';
import { SOLO_STEP_SECONDS } from '../src/game/soloClock.js';

const ENVELOPE = { mode: 'campaign', difficulty: 'normal', faction: 'aegis', seed: 24,
  scenarioId: 'counterbattery' };
const MAX_SECONDS = 210;
const HZ = Math.round(1 / SOLO_STEP_SECONDS);

function snapshot(game) {
  return structuredClone({ units: game.units, buildings: game.buildings, credits: game.credits,
    terrain: game.terrain, effects: game.effects, time: game.time, status: game.status,
    campaignState: game.campaignState, campaignComplete: game.campaignComplete, campaignResult: game.campaignResult });
}

function requireOk(result, action) {
  assert.equal(result?.ok, true, `${action}: ${result?.reason || 'command rejected'}`);
  return result;
}

function connectedSite(game, defId) {
  const definition = game.buildingDefs[defId];
  const candidates = [];
  for (let y = 1; y < game.height - definition.h - 1; y++) {
    for (let x = 1; x < game.width - definition.w - 1; x++) {
      if (!game.canPlaceBuilding(defId, x, y, 'player').ok) continue;
      const distance = Math.hypot(x + definition.w / 2 - 8.5, y + definition.h / 2 - 35.5);
      candidates.push({ x, y, distance });
    }
  }
  candidates.sort((a, b) => a.distance - b.distance || a.y - b.y || a.x - b.x);
  assert.ok(candidates.length, `a legal connected site should exist for ${defId}`);
  return candidates[0];
}

function makeGame() {
  const game = createCampaignGame(16, ENVELOPE.difficulty, ENVELOPE.seed,
    'standard', 'none', 'none', 'none', 'none', null, COUNTERBATTERY_RULES_VERSION);
  game.replayVersion = COUNTERBATTERY_RULES_VERSION;
  return game;
}

function tick(game, count, clock = null) {
  for (let i = 0; i < count && game.status === 'playing'; i++) {
    game.update(SOLO_STEP_SECONDS);
    updateCampaign(game, 16, SOLO_STEP_SECONDS, COUNTERBATTERY_RULES_VERSION);
    if (clock) clock.completedTicks++;
  }
}

function runZeroOrderBaseline() {
  const game = makeGame();
  const initialPlayerUnitIds = new Set(game.units.filter(unit => unit.owner === 'player').map(unit => unit.id));
  const commandId = game.buildings.find(building => building.owner === 'player' && building.defId === 'command')?.id;
  const limit = Math.round(MAX_SECONDS * HZ);
  tick(game, limit);
  return { status: game.status, seconds: +game.time.toFixed(1), kills: game.kills.player,
    commandHp: game.getEntity(commandId)?.hp ?? 0,
    startingUnits: initialPlayerUnitIds.size,
    survivingStartingUnits: game.units.filter(unit => initialPlayerUnitIds.has(unit.id)).length,
    outcome: game.campaignComplete ? 'both objective Crawlers destroyed' : 'objective incomplete' };
}

export function runCounterbatteryPublicPlaytest() {
  const baseline = runZeroOrderBaseline();
  assert.equal(baseline.status, 'defeat', 'an unattended operation must not complete itself');
  const game = makeGame();
  const clock = { completedTicks: 0 };
  const recorder = createSoloRecorder(game, clock);
  const initialCredits = game.credits.player;
  const objectiveView = getCounterbatteryView(game);
  assert.equal(objectiveView?.total, 2, 'the objective view should expose both fog-safe crawler sites');
  const startingPlayerUnits = game.units.filter(unit => unit.owner === 'player' && unit.hp > 0 &&
    !unit.embarkedIn && unit.defId !== 'harvester');
  const startingIds = new Set(startingPlayerUnits.map(unit => unit.id));
  const command = game.buildings.find(building => building.owner === 'player' && building.defId === 'command');
  const originalRadar = game.buildings.find(building => building.owner === 'player' && building.defId === 'radar');
  assert.ok(command && startingPlayerUnits.length >= 6, 'mission starts with its authored base and counterbattery force');
  assert.ok(originalRadar, 'mission starts with the original Radar objective');

  const guardian = startingPlayerUnits.find(unit => unit.defId === 'guardian');
  const medic = startingPlayerUnits.find(unit => unit.defId === 'medic');
  const barracks = game.buildings.find(building => building.owner === 'player' && building.defId === 'barracks');
  assert.ok(guardian && medic && barracks, 'the opening should retain its support force and Barracks');
  const step = () => {
    game.update(SOLO_STEP_SECONDS);
    updateCampaign(game, 16, SOLO_STEP_SECONDS, COUNTERBATTERY_RULES_VERSION);
    clock.completedTicks++;
  };
  requireOk(game.startConstruction('helipad'), 'pay to start a Helipad for a bypass air strike');
  let buildTicks = 0;
  while (!game.construction?.ready && buildTicks++ < Math.ceil(45 * HZ) && game.status === 'playing') step();
  assert.ok(game.construction?.ready, 'the paid Helipad should complete before the mission deadline');
  const padSite = connectedSite(game, 'helipad');
  requireOk(game.issueBuild('helipad', padSite.x, padSite.y), 'place the completed paid Helipad');
  const helipad = game.buildings.find(building => building.owner === 'player' && building.defId === 'helipad');
  assert.ok(helipad, 'the Helipad should be built through normal placement');
  const creditsAfterHelipad = game.credits.player;
  const initialIds = new Set(game.units.map(unit => unit.id));
  const creditsAfterOrcaQueues = [];
  let queuedOrcas = 0;
  game.select(medic.id);
  requireOk(game.issueFollow(guardian.id), 'keep the Medic with the Guardian through the forward assault');

  const orderedVisibleTargets = new Set();
  const orderedReinforcements = new Set();
  const directAttacks = [];
  const warnings = [];
  const unitLosses = [];
  const braceActivations = [];
  const attackMoves = [];
  const frontTarget = { north: null, south: null };
  const initialPlayerBuildingHp = new Map(game.buildings.filter(building => building.owner === 'player')
    .map(building => [building.id, building.hp]));
  let crawlerContact = false;
  let southPassIssued = false;
  const limit = Math.round(MAX_SECONDS * HZ);
  while (clock.completedTicks < limit && game.status === 'playing') {
    step();

    while (queuedOrcas < 6 && game.credits.player >= game.unitDefs.orca.cost) {
      requireOk(game.queueUnit('orca', helipad.id), `pay normal price for air strike gunship ${queuedOrcas + 1}`);
      queuedOrcas++;
      creditsAfterOrcaQueues.push(game.credits.player);
    }

    for (const orca of game.units.filter(unit => unit.owner === 'player' && unit.defId === 'orca' &&
        !initialIds.has(unit.id) && unit.hp > 0 && !orderedReinforcements.has(unit.id))) {
      const site = getCounterbatteryView(game)?.destroyed >= 1 ? { x: 42.5, y: 35.5 } : { x: 42.5, y: 18.5 };
      game.select(orca.id);
      requireOk(game.issueMove(site.x, site.y, true), 'fly the paid gunship through the active pass');
      orderedReinforcements.add(orca.id);
      attackMoves.push({ time: +game.time.toFixed(1), unitId: orca.id, destination: site });
    }

    for (const event of game.events) if (event.type === 'campaignThreatWarning' &&
        !warnings.some(item => item.message === event.message)) {
      warnings.push({ time: +event.time.toFixed(1), message: event.message, marker: event.marker });
    }
    const visibleEnemies = game.visibleEnemies.filter(enemy => enemy.hp > 0);
    const visibleCrawlers = visibleEnemies.filter(enemy => enemy.defId === 'artillery');
    if (visibleCrawlers.length) crawlerContact = true;
    const objectiveStatus = getCounterbatteryView(game);
    if (!southPassIssued && objectiveStatus?.destroyed >= 1) {
      const survivors = game.units.filter(unit => unit.owner === 'player' && unit.defId === 'orca' &&
        unit.hp > 0 && !unit.embarkedIn);
      if (survivors.length) {
        game.select(survivors.map(unit => unit.id));
        requireOk(game.issueMove(42.5, 35.5, true), 'redirect surviving gunships to the southern pass');
        southPassIssued = true;
        attackMoves.push({ time: +game.time.toFixed(1), unitIds: survivors.map(unit => unit.id),
          destination: { x: 42.5, y: 35.5 } });
      }
    }
    for (const side of ['north', 'south']) {
      if (frontTarget[side] && !visibleEnemies.some(enemy => enemy.id === frontTarget[side]))
        frontTarget[side] = null;
    }
    const visibleTargets = visibleCrawlers;
    for (const target of visibleTargets) {
      const north = target.y < 26;
      const side = north ? 'north' : 'south';
      if (frontTarget[side] || orderedVisibleTargets.has(target.id)) continue;
      const strike = game.units.filter(unit => unit.owner === 'player' && unit.defId === 'orca' &&
        unit.hp > 0 && !unit.embarkedIn);
      if (!strike.length) continue;
      game.select(strike.map(unit => unit.id));
      const result = game.issueAttack(target.id);
      if (result.ok) {
        orderedVisibleTargets.add(target.id);
        frontTarget[side] = target.id;
        directAttacks.push({ time: +game.time.toFixed(1), targetId: target.id, targetDefId: target.defId,
          targetPosition: { x: +target.x.toFixed(1), y: +target.y.toFixed(1) },
          unitIds: strike.map(unit => unit.id) });
      }
    }
    const visibleThreatNearGuardian = visibleEnemies.some(enemy =>
      Math.hypot(enemy.x + (enemy.w || 0) / 2 - guardian.x, enemy.y + (enemy.h || 0) / 2 - guardian.y) <= 6.5);
    if (guardian.hp < guardian.maxHp - 30 && visibleThreatNearGuardian && guardian.braceUntil <= game.time &&
        guardian.abilityCooldown <= 0 && game.useUnitAbility(guardian.id, 'brace').ok)
      braceActivations.push({ time: +game.time.toFixed(1), hp: +guardian.hp.toFixed(1) });
    for (const id of startingIds) if (!game.getEntity(id) && !unitLosses.some(loss => loss.id === id))
      unitLosses.push({ time: +game.time.toFixed(1), id });
  }
  recorder.dispose();

  assert.equal(game.status, 'victory', 'the played route should destroy both Crawlers before the barrage deadline');
  assert.equal(game.campaignComplete, true);
  assert.ok(game.getEntity(command.id)?.hp > 0, 'the Command Yard must survive');
  assert.ok(crawlerContact && directAttacks.some(attack => attack.targetDefId === 'artillery'),
    'the route should observe and explicitly attack at least one visible Crawler');
  validateSoloReplay(ENVELOPE, recorder.commands, clock.completedTicks, COUNTERBATTERY_RULES_VERSION);
  const playback = createSoloPlayback(ENVELOPE, recorder.commands, clock.completedTicks,
    COUNTERBATTERY_RULES_VERSION);
  playback.step(clock.completedTicks);
  assert.deepEqual(snapshot(playback.game), snapshot(game), 'the whole campaign route should replay exactly');

  const finalPlayerBuildings = game.buildings.filter(building => building.owner === 'player');
  return { baseline, played: { seconds: +game.time.toFixed(1), elapsed: +game.campaignState.elapsed.toFixed(1),
    initialCredits, creditsAfterHelipad, creditsAfterOrcaQueues, queuedOrcas,
    finalCredits: +game.credits.player.toFixed(1), commandId: command.id,
    commandHp: game.getEntity(command.id)?.hp ?? 0, startingUnits: startingPlayerUnits.map(unit => unit.id),
    originalRadarHp: game.getEntity(originalRadar.id)?.hp ?? 0,
    survivingStartingUnits: startingPlayerUnits.filter(unit => game.getEntity(unit.id)).map(unit => unit.id),
    unitLosses, playerBuildingDamage: finalPlayerBuildings.map(building => ({ id: building.id,
      defId: building.defId, startHp: initialPlayerBuildingHp.get(building.id), finalHp: +building.hp.toFixed(1) })),
    publicObjectives: objectiveView.targets.map(({ label, visible, hpPercent, x, y }) =>
      ({ label, visible, hpPercent, x, y })),
    warnings, directAttacks, attackMoves, braceActivations,
    reinforcements: [...orderedReinforcements], commands: recorder.commands, replayMatches: true } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(runCounterbatteryPublicPlaytest(), null, 2));
}
