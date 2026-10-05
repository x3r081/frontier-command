// Deterministic public-order playtest. Strategic decisions use player-owned
// state, current fog, and public relay locations/last observed ownership only.
import { Game, SKIRMISH_MAPS } from '../src/game/engine.js';

const args = process.argv.slice(2);
const victoryMode = args.includes('--elimination') ? 'elimination' : undefined;
const difficulty = args.find(arg => arg.startsWith('--difficulty='))?.split('=')[1] || 'normal';
const seeds = args.find(arg => arg.startsWith('--seeds='))?.split('=')[1].split(',').map(Number) || [481516];
const compact = args.includes('--compact');
const diagnostics = args.includes('--postrun-diagnostics');
const extensionSeconds = Number(args.find(arg => arg.startsWith('--extension='))?.split('=')[1] || 0);
const factionFlags = args.filter(arg => ['--aegis', '--vesper'].includes(arg)).map(arg => arg.slice(2));
const maps = args.filter(arg => !arg.startsWith('--')).length
  ? args.filter(arg => !arg.startsWith('--')) : ['shard-valley', 'twin-passes'];
const factions = factionFlags.length ? factionFlags : ['aegis', 'vesper'];

function simulate(mapId, faction, seed) {
  const game = new Game({ seed, difficulty, mapId, faction, ...(victoryMode ? { victoryMode } : {}) });
  const lastRelayOwner = new Map(game.relays.map(r => [r.id, null]));
  const observedEnemyIntel = new Map();
  const events = [];
  game.onEvent = event => {
    if (['relayCaptured', 'relayNeutralized', 'doctrineReady', 'doctrineResearch', 'commandAbility', 'stormcallPulse', 'stormcallCanceled',
      'constructionReady', 'unitReady', 'victory', 'defeat'].includes(event.type) &&
      (!['unitReady', 'constructionReady', 'doctrineReady', 'doctrineResearch'].includes(event.type) || event.owner === 'player')) events.push(event);
  };
  let nextOrders = 0, nextBuild = 8, nextCommand = 0;
  let expansionQueued = false, powerQueued = false, radarQueued = false, techQueued = false, doctrineStarted = false;
  let techProduced = false, queuedHarvesters = 0;
  const sentToRelay = new Map();
  const ownStart = game.buildings.find(b => b.owner === 'player' && b.defId === 'command');
  const home = { x: ownStart.x + ownStart.w / 2, y: ownStart.y + ownStart.h / 2 };
  const center = { x: game.width / 2, y: game.height / 2 };
  const directionLength = Math.hypot(center.x - home.x, center.y - home.y);
  const direction = { x: (center.x - home.x) / directionLength, y: (center.y - home.y) / directionLength };
  const route = [...game.relays].filter(r => (r.x - home.x) * direction.x + (r.y - home.y) * direction.y > 4)
    .sort((a, b) => (a.x - home.x) * direction.x + (a.y - home.y) * direction.y -
      ((b.x - home.x) * direction.x + (b.y - home.y) * direction.y))
    .map(r => ({ x: r.x, y: r.y }));
  route.push(center);
  for (let step = 1; step <= 3; step++) {
    const x = center.x + direction.x * step * 8, y = center.y + direction.y * step * 8;
    if (x > 1 && x < game.width - 1 && y > 1 && y < game.height - 1) route.push({ x, y });
  }
  let assaultStarted = false, routeIndex = 0, attackOrders = 0;
  let contactEpisodes = 0, quietSeconds = 0, longestQuietSeconds = 0, lastContactAt = null, inContact = false;
  const sweep = [];
  if (extensionSeconds > 0) {
    for (let y = 4; y < game.height - 2; y += 8) for (let x = 4; x < game.width - 2; x += 8) {
      if ((x - home.x) * direction.x + (y - home.y) * direction.y < directionLength * 0.6) continue;
      sweep.push({ x, y });
    }
    sweep.sort((a, b) => Math.hypot(a.x - route.at(-1).x, a.y - route.at(-1).y) -
      Math.hypot(b.x - route.at(-1).x, b.y - route.at(-1).y));
  }
  let sweepIndex = 0;
  const sweepIntelIds = new Set();
  const place = (defId) => {
    for (let y = 1; y < game.height - 4; y++) for (let x = 1; x < game.width - 4; x++) {
      const d = game.buildingDefs[defId];
      let revealed = true;
      for (let yy = y; yy < y + d.h; yy++) for (let xx = x; xx < x + d.w; xx++)
        if (game.fog[yy][xx] !== 2) revealed = false;
      if (!revealed) continue;
      if (game.canPlaceBuilding(defId, x, y).ok) return game.issueBuild(defId, x, y);
    }
    return { ok: false, reason: 'No legal revealed connected build site.' };
  };
  const build = (id) => {
    if (!game.construction) {
      const result = game.startConstruction(id);
      if (!result.ok) return result;
    }
    if (game.construction?.defId !== id || !game.construction.ready) return { ok: true, pending: true };
    return place(id);
  };
  const move = (unit, target) => {
    game.select(unit.id); return game.issueMove(target.x, target.y, true);
  };
  while (game.status === 'playing' && game.time < 900 + extensionSeconds) {
    if (game.time >= nextOrders) {
      nextOrders = game.time + 8;
      for (const r of game.relays) if (game.fog[Math.floor(r.y)]?.[Math.floor(r.x)] === 2)
        lastRelayOwner.set(r.id, r.owner);
      const army = game.units.filter(u => u.owner === 'player' && u.hp > 0 && !u.embarkedIn &&
        ['lightTank', 'guardian', 'stealthTank', 'rifle', 'rocket', 'scout', 'flamer'].includes(u.defId));
      const ownRelay = game.relays.find(r => lastRelayOwner.get(r.id) === 'player');
      const targetFor = unit => ownRelay || [...game.relays].sort((a, b) =>
        (lastRelayOwner.get(a.id) === 'player') - (lastRelayOwner.get(b.id) === 'player') ||
        (sentToRelay.get(a.id) || 0) - (sentToRelay.get(b.id) || 0) ||
        Math.hypot(unit.x - a.x, unit.y - a.y) - Math.hypot(unit.x - b.x, unit.y - b.y))[0];
      const armored = army.filter(u => ['lightTank', 'guardian', 'stealthTank'].includes(u.defId));
      if (!assaultStarted && game.time >= 85 &&
        (armored.length >= 3 || (game.research.player.doctrine && armored.length >= 2))) assaultStarted = true;
      const visibleEnemies = game.visibleEnemies.filter(e => e.owner === 'enemy' && e.hp > 0);
      for (const e of visibleEnemies) observedEnemyIntel.set(e.id, { defId: e.defId,
        kind: e.w ? 'building' : 'unit', x: +(e.x + (e.w || 0) / 2).toFixed(1),
        y: +(e.y + (e.h || 0) / 2).toFixed(1), seenAt: +game.time.toFixed(0) });
      if (extensionSeconds > 0 && game.time >= 900) {
        const rememberedTargets = [...observedEnemyIntel.entries()].filter(([id]) => !sweepIntelIds.has(id));
        for (const [id] of rememberedTargets) sweepIntelIds.add(id);
        if (rememberedTargets.length)
          sweep.splice(sweepIndex, 0, ...rememberedTargets.map(([, seen]) => ({ x: seen.x, y: seen.y, lastSeen: true })));
      }
      if (visibleEnemies.length && army.length) {
        const target = visibleEnemies.sort((a, b) => {
          const ac = { x: a.x + (a.w || 0) / 2, y: a.y + (a.h || 0) / 2 };
          const bc = { x: b.x + (b.w || 0) / 2, y: b.y + (b.h || 0) / 2 };
          return Math.hypot(ac.x - center.x, ac.y - center.y) - Math.hypot(bc.x - center.x, bc.y - center.y);
        })[0];
        game.select(army.map(u => u.id));
        if (game.issueAttack(target.id).ok) attackOrders++;
      }
      if (!assaultStarted && army.length >= 3) {
        const explorers = army.filter(u => ['scout', 'lightTank'].includes(u.defId));
        for (const unit of explorers) if (!unit.order || unit.order.type === 'idle' || unit.order.type === 'guard') {
          const target = targetFor(unit);
          if (target && Math.hypot(unit.x - target.x, unit.y - target.y) > 2.2) {
            move(unit, target); sentToRelay.set(target.id, (sentToRelay.get(target.id) || 0) + 1);
          }
        }
      }
      if (assaultStarted && route.length) {
        const waypoint = route[Math.min(routeIndex, route.length - 1)];
        const reached = army.some(u => Math.hypot(u.x - waypoint.x, u.y - waypoint.y) < 3.2);
        if (reached && routeIndex < route.length - 1)
          routeIndex++;
        const nextWaypoint = game.time >= 900 && sweep[sweepIndex]
          ? sweep[sweepIndex] : route[Math.min(routeIndex, route.length - 1)];
        if (game.time >= 900 && sweep[sweepIndex] &&
          army.some(u => Math.hypot(u.x - sweep[sweepIndex].x, u.y - sweep[sweepIndex].y) < 3.2)) sweepIndex++;
        if (!visibleEnemies.length && army.length && Math.hypot(army[0].x - nextWaypoint.x, army[0].y - nextWaypoint.y) > 4) {
          game.select(army.map(u => u.id)); game.issueMove(nextWaypoint.x, nextWaypoint.y, true);
        }
      }
      for (const unit of assaultStarted ? [] : army) {
        if (!unit.order || unit.order.type === 'idle' || unit.order.type === 'guard') {
          const target = targetFor(unit);
          if (target && Math.hypot(unit.x - target.x, unit.y - target.y) > 2.2) {
            move(unit, target); sentToRelay.set(target.id, (sentToRelay.get(target.id) || 0) + 1);
          }
        }
      }
    }
    if (game.time >= nextBuild) {
      nextBuild = game.time + 7;
      if (game.construction?.ready) place(game.construction.defId);
      const factory = game.buildings.find(b => b.owner === 'player' && b.defId === 'factory');
      if (factory && factory.queue.length < 2) {
        const elite = faction === 'aegis' ? 'guardian' : 'stealthTank';
        techProduced ||= game.units.some(u => u.owner === 'player' && u.defId === elite);
        if (game.hasBuilding('player', 'tech') && !techProduced && game.canQueueUnit(elite).ok)
          techProduced = game.queueUnit(elite).ok;
        else if (queuedHarvesters < 2 && game.canQueueUnit('harvester').ok)
          queuedHarvesters += Number(game.queueUnit('harvester').ok);
        else if (game.research.player.doctrine && game.canQueueUnit('lightTank').ok) game.queueUnit('lightTank');
        else if (!game.hasBuilding('player', 'tech') && game.credits.player >= 2200 && game.canQueueUnit('lightTank').ok)
          game.queueUnit('lightTank');
      }
      if (!expansionQueued && game.canBuild('refinery').ok && !game.construction) {
        const result = build('refinery'); if (result.ok) expansionQueued = true;
      } else if (expansionQueued && game.hasBuilding('player', 'refinery') && !powerQueued &&
        game.canBuild('power').ok && !game.construction) {
        const result = build('power'); if (result.ok) powerQueued = true;
      } else if (powerQueued && game.hasBuilding('player', 'power') && !radarQueued &&
        game.canBuild('radar').ok && !game.construction) {
        const result = build('radar'); if (result.ok) radarQueued = true;
      } else if (radarQueued && game.hasBuilding('player', 'radar') && !techQueued &&
        game.canBuild('tech').ok && !game.construction) {
        const result = build('tech'); if (result.ok) techQueued = true;
      }
      if (game.hasBuilding('player', 'tech') && !doctrineStarted && game.credits.player >= 900) {
        const result = game.chooseDoctrine('signal'); if (result.ok) doctrineStarted = true;
      }
    }
    if (game.time >= nextCommand) {
      nextCommand = game.time + 3;
      const relay = game.relays.find(r => lastRelayOwner.get(r.id) === 'player' &&
        game.fog[Math.floor(r.y)]?.[Math.floor(r.x)] === 2);
      if (relay && (game.storm.phase === 'warning' || game.storm.phase === 'surge') &&
        game.canUseCommandAbility('stormcall', relay.x, relay.y).ok) game.useCommandAbility('stormcall', relay.x, relay.y);
      const threatened = game.units.find(u => u.owner === 'player' && u.hp > 0 &&
        ['lightTank', 'guardian', 'stealthTank'].includes(u.defId) && u.hp < u.maxHp * 0.75 &&
        game.fog[Math.floor(u.y)]?.[Math.floor(u.x)] === 2);
      if (threatened && game.canUseCommandAbility('shield', threatened.x, threatened.y).ok)
        game.useCommandAbility('shield', threatened.x, threatened.y);
      const factory = game.buildings.find(b => b.owner === 'player' && b.defId === 'factory');
      if (factory && (factory.queue.length || game.construction) &&
        game.canUseCommandAbility('overcharge', factory.x + 1.5, factory.y + 1.5).ok)
        game.useCommandAbility('overcharge', factory.x + 1.5, factory.y + 1.5);
      const scanTarget = game.time >= 900 && sweep[sweepIndex] ? sweep[sweepIndex] : route[routeIndex];
      if (assaultStarted && scanTarget && game.canUseCommandAbility('scan', scanTarget.x, scanTarget.y).ok)
        game.useCommandAbility('scan', scanTarget.x, scanTarget.y);
    }
    game.update(1);
    const contactNow = game.visibleEnemies.some(e => e.owner === 'enemy' && e.hp > 0);
    if (contactNow) {
      if (!inContact) contactEpisodes++;
      lastContactAt = game.time;
      quietSeconds = 0;
      inContact = true;
    } else {
      quietSeconds += 1;
      longestQuietSeconds = Math.max(longestQuietSeconds, quietSeconds);
      inContact = false;
    }
  }
  const visibleEnemies = game.visibleEnemies.filter(e => e.owner === 'enemy' && e.hp > 0);
  const result = { seed, difficulty, mapId, faction, victoryMode: game.victoryMode, status: game.status, time: +game.time.toFixed(0), playerUnits: game.units.filter(u => u.owner === 'player').length,
    playerCredits: Math.round(game.credits.player), buildings: game.buildings.filter(b => b.owner === 'player').map(b => b.defId),
    techUnits: game.units.filter(u => u.owner === 'player' && ['guardian', 'stealthTank'].includes(u.defId)).length,
    doctrine: game.research.player.doctrine, relays: [...lastRelayOwner.values()].filter(x => x === 'player').length,
    techUnitsProduced: events.filter(e => e.type === 'unitReady' &&
      ['guardian', 'stealthTank'].includes(e.defId)).length,
    commandEnergy: Math.round(game.commandEnergy.player), abilities: events.filter(e => e.type === 'commandAbility').length,
    assaultOrders: attackOrders, assaultStarted, routeIndex, routeLength: route.length,
    stormEvents: events.filter(e => e.type.startsWith('stormcall')).map(e => e.type),
    events: events.map(e => `${e.time.toFixed(0)}:${e.type}${e.abilityId ? ':' + e.abilityId : ''}${e.defId ? ':' + e.defId : ''}${e.id ? ':' + e.id : ''}`),
    visibleEnemyCount: visibleEnemies.length, exploredTiles: game.fog.flat().filter(v => v > 0).length,
    currentVisibleTiles: game.fog.flat().filter(v => v === 2).length,
    leadPositions: game.units.filter(u => u.owner === 'player' && ['scout', 'lightTank', 'guardian', 'stealthTank'].includes(u.defId))
      .slice(0, 5).map(u => [u.defId, +u.x.toFixed(1), +u.y.toFixed(1)]),
    sweepIndex, sweepLength: sweep.length, contactEpisodes,
    quietSinceLastContact: lastContactAt === null ? +game.time.toFixed(0) : +(game.time - lastContactAt).toFixed(0),
    longestNoContactSeconds: longestQuietSeconds,
    noContactStalemate: game.status === 'playing' && (lastContactAt === null || game.time - lastContactAt >= 120) };
  if (diagnostics) {
    const enemyAssets = [...game.units, ...game.buildings].filter(e => e.owner === 'enemy' && e.hp > 0).map(e => {
      const x = e.x + (e.w || 0) / 2, y = e.y + (e.h || 0) / 2;
      const fogState = game.fog[Math.floor(y)]?.[Math.floor(x)] ?? 0;
      return { id: e.id, kind: e.w ? 'building' : 'unit', defId: e.defId,
        operational: e.w ? ['command', 'barracks', 'factory', 'helipad', 'superweapon', 'warhead'].includes(e.defId)
          : !!game.unitDefs[e.defId]?.weapon || ['mcv', 'engineer'].includes(e.defId),
        x: +x.toFixed(1), y: +y.toFixed(1), hp: Math.round(e.hp), maxHp: e.maxHp,
        fogState, currentVisibility: fogState === 2, lastSeen: observedEnemyIntel.get(e.id) || null };
    });
    const finalRoutePoint = route.at(-1);
    result.postrunDiagnostics = { enemyAssets,
      enemyUnits: enemyAssets.filter(e => e.kind === 'unit').length,
      enemyBuildings: enemyAssets.filter(e => e.kind === 'building').length,
      operationalEnemyUnits: enemyAssets.filter(e => e.kind === 'unit' && e.operational).length,
      operationalEnemyBuildings: enemyAssets.filter(e => e.kind === 'building' && e.operational).length,
      nearestEnemyToFinalRoutePoint: enemyAssets.length ? Math.min(...enemyAssets.map(e =>
        Math.hypot(e.x - finalRoutePoint.x, e.y - finalRoutePoint.y))) : null,
      finalRoutePoint, playerCommandYardAlive: game.buildings.some(b => b.owner === 'player' && b.defId === 'command'),
      playerUnitsAlive: game.units.filter(u => u.owner === 'player').length,
      playerBuildings: game.buildings.filter(b => b.owner === 'player').map(b => b.defId),
      postrunCanQueueInfantry: ['rifle', 'rocket'].map(id => ({ id, ...game.canQueueUnit(id) })) };
  }
  return result;
}

for (const mapId of maps) {
  if (!SKIRMISH_MAPS.some(m => m.id === mapId)) { console.error(`Unknown map: ${mapId}`); process.exitCode = 1; continue; }
  for (const faction of factions) for (const seed of seeds) {
    const result = simulate(mapId, faction, seed);
    if (!compact) console.log(JSON.stringify(result));
    else console.log(JSON.stringify({ seed: result.seed, difficulty: result.difficulty, mapId: result.mapId,
      faction: result.faction, victoryMode: result.victoryMode, status: result.status, time: result.time,
      doctrine: result.doctrine, techUnits: result.techUnits, techUnitsProduced: result.techUnitsProduced,
      playerUnits: result.playerUnits,
      assaultStarted: result.assaultStarted, assaultOrders: result.assaultOrders,
      routeProgress: `${result.routeIndex}/${result.routeLength - 1}`, relays: result.relays,
      contactEpisodes: result.contactEpisodes, quietSinceLastContact: result.quietSinceLastContact,
      longestNoContactSeconds: result.longestNoContactSeconds, noContactStalemate: result.noContactStalemate }));
  }
}
