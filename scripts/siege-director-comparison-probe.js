// Reproducible public-order comparison for versioned Siege Director policies.
// Player decisions use owned state, revealed terrain, public relay locations,
// and currently visible enemies. Hidden enemy state is read only for the
// post-run diagnostics that measure AI behavior.
import { Game, AI_COMMANDER_PROFILES, BUILDING_DEFS, UNIT_DEFS } from '../src/game/engine.js';

const option = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const MAPS = option('maps')?.split(',') || ['shard-valley', 'twin-passes'];
const SEEDS = option('seeds')?.split(',').map(Number) || [1207, 80218];
const DURATION = Number(option('duration') || 600);
const PROFILES = option('commanders')?.split(',') || AI_COMMANDER_PROFILES.map(profile => profile.id);
const VERSIONS = option('versions')?.split(',').map(Number) || [53, 54];

function simulate(mapId, seed, profileId, version) {
  const game = new Game({ seed, mapId, difficulty: 'normal', faction: 'aegis',
    aiCommanderProfileId: profileId, victoryMode: 'elimination' });
  game.replayVersion = version;
  const start = game.buildings.find(building => building.owner === 'player' && building.defId === 'command');
  const home = { x: start.x + start.w / 2, y: start.y + start.h / 2 };
  const center = { x: game.width / 2, y: game.height / 2 };
  const relays = [...game.relays].sort((a, b) => Math.hypot(a.x - home.x, a.y - home.y) -
    Math.hypot(b.x - home.x, b.y - home.y));
  let nextOrders = 0, nextBuild = 5, nextProduction = 6;
  let firstOutpostAt = null, firstExpansionPlanAt = null, firstArtilleryAt = null, firstDefenseTargetAt = null;
  let firstDefenseSeenByAI = null, firstDefenseOrderAny = null;
  let firstMcvQueueAt = null, firstMcvReadyAt = null;
  let firstMcvLostAt = null, closestMcvToSite = null, lastMcvPosition = null;
  let contacts = 0, contactSeconds = 0, inContact = false;
  const playerTurrets = new Set();
  const buildOrder = ['refinery', 'power', 'radar', 'tech'];
  let buildIndex = 0, defenseStarted = false;

  const placeRevealed = defId => {
    const def = BUILDING_DEFS[defId];
    const candidates = [];
    for (let y = 1; y < game.height - def.h - 1; y++) for (let x = 1; x < game.width - def.w - 1; x++) {
      let revealed = true;
      for (let yy = y; yy < y + def.h; yy++) for (let xx = x; xx < x + def.w; xx++)
        if (game.fog[yy][xx] !== 2) revealed = false;
      if (revealed && game.canPlaceBuilding(defId, x, y).ok) {
        // Place defenses on the forward, map-center side of the base.
        const px = x + def.w / 2, py = y + def.h / 2;
        const forward = (px - home.x) * (center.x - home.x) + (py - home.y) * (center.y - home.y);
        candidates.push({ x, y, forward, distance: Math.hypot(px - home.x, py - home.y) });
      }
    }
    candidates.sort((a, b) => b.forward - a.forward || a.distance - b.distance || a.y - b.y || a.x - b.x);
    const site = candidates[0];
    return site ? game.issueBuild(defId, site.x, site.y) : { ok: false };
  };
  const finishConstruction = () => {
    if (!game.construction) return false;
    if (!game.construction.ready) return true;
    const id = game.construction.defId;
    const result = placeRevealed(id);
    if (result.ok && id === 'turret') {
      const turret = game.buildings.find(building => building.owner === 'player' && building.defId === id &&
        !playerTurrets.has(building.id));
      if (turret) playerTurrets.add(turret.id);
    }
    return result.ok;
  };
  const startBuild = defId => {
    if (!game.construction) game.startConstruction(defId);
    if (game.construction?.defId === defId) finishConstruction();
  };
  const order = (units, target, attackMove = false) => {
    if (!units.length || !target) return;
    game.select(units.map(unit => unit.id));
    game.issueMove(target.x, target.y, attackMove);
  };

  while (game.status === 'playing' && game.time < DURATION) {
    if (game.time >= nextOrders) {
      nextOrders = game.time + 6;
      const army = game.units.filter(unit => unit.owner === 'player' && unit.hp > 0 && !unit.embarkedIn &&
        UNIT_DEFS[unit.defId]?.weapon);
      const visible = game.visibleEnemies.filter(entity => entity.owner === 'enemy' && entity.hp > 0);
      const contact = visible.length > 0;
      if (contact) {
        if (!inContact) contacts++;
        inContact = true; contactSeconds += 6;
        const target = visible.sort((a, b) => Math.hypot(a.x - center.x, a.y - center.y) -
          Math.hypot(b.x - center.x, b.y - center.y))[0];
        game.select(army.map(unit => unit.id));
        game.issueAttack(target.id);
      } else inContact = false;

      if (game.time < 150) {
        const neutralOrEnemy = relays.find(relay => {
          const x = Math.floor(relay.x), y = Math.floor(relay.y);
          return game.fog[y]?.[x] === 2 && relay.owner !== 'player';
        });
        if (neutralOrEnemy) {
          const scouts = army.filter(unit => ['scout', 'lightTank', 'rifle'].includes(unit.defId) &&
            (!unit.order || unit.order.type === 'idle' || unit.order.type === 'guard'));
          order(scouts.slice(0, 3), neutralOrEnemy);
        }
      } else if (!visible.length && army.length) {
        // Continue from the public central objective; do not target an unseen base.
        const target = relays.find(relay => Math.hypot(army[0].x - relay.x, army[0].y - relay.y) > 4) || center;
        if (Math.hypot(army[0].x - target.x, army[0].y - target.y) > 5) order(army, target, true);
      }
    }

    if (game.time >= nextBuild) {
      nextBuild = game.time + 6;
      if (game.construction?.ready) finishConstruction();
      if (buildIndex < buildOrder.length && game.canBuild(buildOrder[buildIndex]).ok && !game.construction) {
        const id = buildOrder[buildIndex];
        const result = game.startConstruction(id);
        if (result.ok) buildIndex++;
      } else if (game.time > 150 && !defenseStarted && game.canBuild('turret').ok && !game.construction) {
        defenseStarted = game.startConstruction('turret').ok;
      }
    }
    if (game.time >= nextProduction) {
      nextProduction = game.time + 5;
      const factory = game.buildings.find(building => building.owner === 'player' && building.defId === 'factory');
      if (factory && factory.queue.length < 2) {
        if (game.units.filter(unit => unit.owner === 'player' && unit.defId === 'harvester').length < 2 &&
            game.canQueueUnit('harvester').ok) game.queueUnit('harvester');
        else if (game.canQueueUnit('lightTank').ok) game.queueUnit('lightTank');
      }
      const barracks = game.buildings.find(building => building.owner === 'player' && building.defId === 'barracks');
      if (barracks && barracks.queue.length < 2 && game.canQueueUnit('rocket').ok) game.queueUnit('rocket');
    }

    game.update(0.1);
    if (firstExpansionPlanAt == null && game._aiExpansionTarget) firstExpansionPlanAt = +game.time.toFixed(1);
    const enemyYards = game.buildings.filter(building => building.owner === 'enemy' &&
      building.defId === 'command' && building.hp > 0);
    const liveRigs = game.units.filter(unit => unit.owner === 'enemy' && unit.defId === 'mcv' && unit.hp > 0);
    if (liveRigs.length && game._aiExpansionTarget && Number.isFinite(game._aiExpansionTarget.x)) {
      const rig = liveRigs[0];
      const distance = Math.hypot(rig.x - (game._aiExpansionTarget.x + 1.5),
        rig.y - (game._aiExpansionTarget.y + 1.5));
      closestMcvToSite = closestMcvToSite == null ? distance : Math.min(closestMcvToSite, distance);
      lastMcvPosition = { x: +rig.x.toFixed(1), y: +rig.y.toFixed(1), order: rig.order?.type || 'idle' };
    } else if (firstMcvReadyAt != null && firstMcvLostAt == null && enemyYards.length <= 1 && !liveRigs.length) {
      firstMcvLostAt = +game.time.toFixed(1);
    }
    if (firstOutpostAt == null && enemyYards.length > 1) firstOutpostAt = +game.time.toFixed(1);
    if (firstMcvQueueAt == null && game.buildings.some(building => building.owner === 'enemy' &&
      building.queue?.some(item => item.defId === 'mcv'))) firstMcvQueueAt = +game.time.toFixed(1);
    if (firstMcvReadyAt == null && game.units.some(unit => unit.owner === 'enemy' && unit.defId === 'mcv'))
      firstMcvReadyAt = +game.time.toFixed(1);
    if (firstArtilleryAt == null && game.units.some(unit => unit.owner === 'enemy' && unit.defId === 'artillery'))
      firstArtilleryAt = +game.time.toFixed(1);
    const visibleTurret = game.buildings.find(building => building.owner === 'player' &&
      playerTurrets.has(building.id) && building.hp > 0 && game.isVisible(building, 'enemy'));
    if (visibleTurret && firstDefenseSeenByAI == null) firstDefenseSeenByAI = +game.time.toFixed(1);
    if (firstDefenseTargetAt == null) {
      const targeted = game.units.find(unit => unit.owner === 'enemy' && unit.order?.type === 'attack' &&
        playerTurrets.has(unit.order.targetId));
      const target = targeted && game.getEntity(targeted.order.targetId);
      if (target && firstDefenseOrderAny == null) firstDefenseOrderAny = +game.time.toFixed(1);
      if (target && game.isVisible(target, 'enemy')) firstDefenseTargetAt = +game.time.toFixed(1);
    }
  }

  const outpost = game.buildings.find(building => building.owner === 'enemy' && building.defId === 'command' &&
    building.id !== game.buildings.find(item => item.owner === 'enemy' && item.defId === 'command')?.id);
  const completedArtillery = game.units.filter(unit => unit.owner === 'enemy' && unit.defId === 'artillery').length;
  return {
    map: mapId, seed, version, commander: profileId, simulatedSeconds: +game.time.toFixed(1),
    outcome: game.status === 'playing' ? 'ongoing' : `${game.status}:${game.winner}`,
    firstOutpostAt, firstExpansionPlanAt, firstMcvQueueAt, firstMcvReadyAt, firstMcvLostAt,
    closestMcvToSite: closestMcvToSite == null ? null : +closestMcvToSite.toFixed(1), lastMcvPosition,
    expansionPlanAtEnd: game._aiExpansionTarget, outpostAliveAtEnd: Boolean(outpost), firstArtilleryAt,
    artilleryAliveAtEnd: completedArtillery, firstDefenseSeenByAI, firstDefenseOrderAny,
    firstVisibleDefenseTargetAt: firstDefenseTargetAt,
    publicContactEpisodes: contacts, publicContactSeconds: contactSeconds,
    playerDefenseCountAtEnd: playerTurrets.size,
    currentConstructionAtEnd: game.construction?.defId || null,
    enemyRefineriesAtEnd: game.buildings.filter(building => building.owner === 'enemy' && building.defId === 'refinery').length,
    enemyHasTechAtEnd: game.buildings.some(building => building.owner === 'enemy' && building.defId === 'tech'),
    enemyExpansionMcvQueuedAtEnd: game.buildings.some(building => building.owner === 'enemy' &&
      building.queue?.some(item => item.defId === 'mcv')),
    enemyCreditsAtEnd: Math.round(game.credits.enemy),
    playerRelayCountAtEnd: game.relays.filter(relay => relay.owner === 'player').length,
    enemyRelayCountAtEnd: game.relays.filter(relay => relay.owner === 'enemy').length,
  };
}

const results = [];
for (const map of MAPS) for (const seed of SEEDS) for (const profile of PROFILES) for (const version of VERSIONS)
  results.push(simulate(map, seed, profile, version));

console.log(JSON.stringify({ label: 'diagnostic scripted-policy sample; not a balance or human-win-rate estimate',
  durationSeconds: DURATION, maps: MAPS, seeds: SEEDS, versions: VERSIONS, commanders: PROFILES, results }, null, 2));
