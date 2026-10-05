// Compact deterministic audit of the relay-first public-order policy. This
// loads that policy from relay-first-skirmish-playtest.js, adds in-memory
// instrumentation, and leaves the source playtest untouched.
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const rulesVersionArg = process.argv.slice(2).find(arg => arg.startsWith('--rules-version='));
const rulesVersion = Number(rulesVersionArg?.split('=')[1] || 38);
const verbose = process.argv.includes('--verbose');
const includeVesper = process.argv.includes('--include-vesper');
const includeVeteran = process.argv.includes('--include-veteran');
if (![38, 39, 40, 41, 44, 45].includes(rulesVersion))
  throw new Error('Use --rules-version=38, 39, 40, 41, 44, or 45.');

const sourcePath = path.resolve('scripts/relay-first-skirmish-playtest.js');
const engineUrl = pathToFileURL(path.resolve('src/game/engine.js')).href;
let source = await fs.readFile(sourcePath, 'utf8');
source = source.replace("import { Game, SKIRMISH_MAPS } from '../src/game/engine.js';",
  `import { Game, SKIRMISH_MAPS } from '${engineUrl}';`);
source = source.replace('const args = process.argv.slice(2);',
  'const args = process.argv.slice(2);\nconst rulesVersion = ' + rulesVersion + ';');
source = source.replace('  const events = [];', `  const events = [];
  const relayEpisodes = [];
  let activeRelayEpisode = null;
  let lastPlayerCapturedRelayId = null;`);
source = source.replace('  const game = new Game({ seed, difficulty, mapId, faction, ...(victoryMode ? { victoryMode } : {}) });',
  `  const game = new Game({ seed, difficulty, mapId, faction, ...(victoryMode ? { victoryMode } : {}) });
  game.replayVersion = rulesVersion;`);
source = source.replace('      events.push(event);', `      events.push(event);
      if (event.type === 'relayCaptured' && event.owner === 'player') lastPlayerCapturedRelayId = event.id;
      if (event.type === 'relayDominionStarted' && event.owner === 'player') {
        activeRelayEpisode = { startedAt: +event.time.toFixed(1), required: event.required,
          initialRelayId: lastPlayerCapturedRelayId, targetHistory: [], nearestAtStart: null,
          actualTargetHistory: [], reconTargetHistory: [],
          closest: null, assignedAtStart: null, firstAssignmentDuringCountdown: null,
          firstNewResponseTag: null, _seenAssignmentKeys: [],
          firstCaptureEntry: null, firstAnyPlayerRelayContest: null,
          brokenAt: null, relayStateAtBreak: null, completedAt: null };
        relayEpisodes.push(activeRelayEpisode);
      }
      if (event.type === 'relayDominionBroken' && event.owner === 'player' && activeRelayEpisode) {
        activeRelayEpisode.brokenAt = +event.time.toFixed(1);
        activeRelayEpisode.relayStateAtBreak = game.relays.map(relay => ({ id: relay.id,
          owner: relay.owner, contested: relay.contested }));
        const contested = activeRelayEpisode.relayStateAtBreak.find(relay => relay.contested);
        if (contested && !activeRelayEpisode.firstAnyPlayerRelayContest)
          activeRelayEpisode.firstAnyPlayerRelayContest = { at: +event.time.toFixed(1), relay: contested.id };
        activeRelayEpisode = null;
      }
      if (event.type === 'relayDominionComplete' && event.owner === 'player' && activeRelayEpisode) {
        activeRelayEpisode.completedAt = +event.time.toFixed(1);
        activeRelayEpisode = null;
      }`);
source = source.replace('    game.update(1);', `    game.update(1);
    if (activeRelayEpisode && game.relayDominion?.owner === 'player') {
      const recordAiTarget = (history, id) => {
        if (history.at(-1)?.id === (id || null)) return;
        const relay = game.relays.find(item => item.id === id);
        history.push({ at: +game.time.toFixed(1), id: id || null,
          owner: relay?.owner || null, visibleToEnemy: relay ? game.isVisible({ ...relay, owner: 'player' }, 'enemy') : false });
      };
      recordAiTarget(activeRelayEpisode.actualTargetHistory, game._aiRelayTarget);
      recordAiTarget(activeRelayEpisode.reconTargetHistory, game._aiRelayReconTarget);
      const aiTarget = game.relays.find(relay => relay.id === game._aiRelayTarget && relay.owner === 'player');
      const fallbackTarget = game.relays.find(relay => relay.id === activeRelayEpisode.initialRelayId && relay.owner === 'player');
      const target = aiTarget || fallbackTarget || game.relays.find(relay => relay.owner === 'player');
      if (target && activeRelayEpisode.targetHistory.at(-1)?.id !== target.id)
        activeRelayEpisode.targetHistory.push({ id: target.id, at: +game.time.toFixed(1) });
      const ground = game.units.filter(unit => unit.owner === 'enemy' && unit.hp > 0 && !unit.embarkedIn &&
        !game.unitDefs[unit.defId]?.flying);
      const nearest = target ? ground.map(unit => ({ id: unit.id, defId: unit.defId,
        distance: Math.hypot(unit.x - target.x, unit.y - target.y),
        relayAssigned: unit._relayAssignment === target.id,
        responseTagged: unit._aiRelayResponseRelayId === target.id }))
        .sort((a, b) => a.distance - b.distance)[0] : null;
      const assigned = ground.filter(unit => unit._relayAssignment === target?.id);
      if (!activeRelayEpisode.nearestAtStart && nearest)
        activeRelayEpisode.nearestAtStart = { at: +game.time.toFixed(1), unit: nearest.id,
          defId: nearest.defId, distance: +nearest.distance.toFixed(1), target: target.id };
      if (nearest && (!activeRelayEpisode.closest || nearest.distance < activeRelayEpisode.closest.distance))
        activeRelayEpisode.closest = { at: +game.time.toFixed(1), unit: nearest.id,
          defId: nearest.defId, distance: +nearest.distance.toFixed(1), withinCaptureRadius: nearest.distance <= 2.3,
          target: target.id };
      if (!activeRelayEpisode.assignedAtStart && assigned.length)
        activeRelayEpisode.assignedAtStart = { at: +game.time.toFixed(1), count: assigned.length,
          responseTagged: assigned.filter(unit => unit._aiRelayResponseRelayId === target.id).length,
          nearestDistance: nearest ? +nearest.distance.toFixed(1) : null, target: target.id };
      const assignmentKeys = assigned.map(unit => target.id + ':' + unit.id);
      if (activeRelayEpisode._seenAssignmentKeys.length) {
        const added = assigned.filter(unit => !activeRelayEpisode._seenAssignmentKeys.includes(target.id + ':' + unit.id));
        if (added.length && !activeRelayEpisode.firstAssignmentDuringCountdown)
          activeRelayEpisode.firstAssignmentDuringCountdown = { at: +game.time.toFixed(1), count: added.length,
            responseTagged: added.filter(unit => unit._aiRelayResponseRelayId === target.id).length,
            units: added.map(unit => unit.defId), nearestDistance: nearest ? +nearest.distance.toFixed(1) : null,
            target: target.id };
      }
      activeRelayEpisode._seenAssignmentKeys = assignmentKeys;
      const newResponders = assigned.filter(unit => unit._aiRelayResponseRelayId === target.id);
      if (!activeRelayEpisode.firstNewResponseTag && newResponders.length)
        activeRelayEpisode.firstNewResponseTag = { at: +game.time.toFixed(1), count: newResponders.length,
          nearestDistance: nearest ? +nearest.distance.toFixed(1) : null, target: target.id };
      const inCaptureRadius = ground.filter(unit => Math.hypot(unit.x - target.x, unit.y - target.y) <= 2.3);
      if (!activeRelayEpisode.firstCaptureEntry && inCaptureRadius.length)
        activeRelayEpisode.firstCaptureEntry = { at: +game.time.toFixed(1), units: inCaptureRadius.length,
          target: target.id, dominionElapsed: +game.relayDominion.elapsed.toFixed(1) };
      const contestedRelay = game.relays.find(relay => relay.owner === 'player' &&
        ground.some(unit => Math.hypot(unit.x - relay.x, unit.y - relay.y) <= 2.3));
      if (!activeRelayEpisode.firstAnyPlayerRelayContest && contestedRelay)
        activeRelayEpisode.firstAnyPlayerRelayContest = { at: +game.time.toFixed(1),
          relay: contestedRelay.id, dominionElapsed: +game.relayDominion.elapsed.toFixed(1) };
    }`);
source = source.replace('    playerRelayCaptureTimes, firstEnemyMajorityAt, dominionStarts, peakPlayerRelays,',
  '    playerRelayCaptureTimes, firstEnemyMajorityAt, dominionStarts, peakPlayerRelays, relayEpisodes,');
source = source.replace('    if (!compact) console.log(JSON.stringify(result));',
  '    if (!compact) console.log(JSON.stringify(result));');
source = source.replace('      longestNoContactSeconds: result.longestNoContactSeconds, noContactStalemate: result.noContactStalemate }));',
  '      longestNoContactSeconds: result.longestNoContactSeconds, noContactStalemate: result.noContactStalemate, relayEpisodes: result.relayEpisodes }));');

const cases = [
  { mapId: 'shard-valley', faction: 'aegis', difficulty: 'normal', seed: 481516 },
  { mapId: 'twin-passes', faction: 'aegis', difficulty: 'normal', seed: 481517 },
];
if (includeVesper) cases.push({ mapId: 'shard-valley', faction: 'vesper', difficulty: 'normal', seed: 481516 });
if (includeVeteran) cases.push({ mapId: 'twin-passes', faction: 'vesper', difficulty: 'veteran', seed: 481518 });
const reports = [];
for (const item of cases) {
  process.argv = ['node', sourcePath, item.mapId, `--${item.faction}`, `--difficulty=${item.difficulty}`,
    `--seeds=${item.seed}`, '--compact'];
  const lines = [];
  const originalLog = console.log;
  console.log = (...values) => lines.push(values.join(' '));
  try {
    await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}#${item.mapId}-${item.faction}-${item.seed}-${rulesVersion}`);
  } finally {
    console.log = originalLog;
  }
  const result = JSON.parse(lines.at(-1));
  const episodes = verbose ? result.relayEpisodes.map(({ _seenAssignmentKeys, ...episode }) => episode) :
    result.relayEpisodes.map(episode => ({
      start: episode.startedAt,
      targets: episode.targetHistory.map(target => target.id).join('>'),
      switches: Math.max(0, episode.targetHistory.length - 1),
      tagged: episode.firstNewResponseTag?.at ?? null,
      entry: episode.firstCaptureEntry?.at ?? null,
      contest: episode.firstAnyPlayerRelayContest?.at ?? null,
      break: episode.brokenAt,
      complete: episode.completedAt,
    }));
  reports.push({ rulesVersion, case: `${item.mapId}/${item.faction}/${item.difficulty}/${item.seed}`,
    result: `${result.status} at ${result.time}s`, dominionEpisodes: episodes });
}
console.log(JSON.stringify({ diagnostic: 'relay-response', policy: 'relay-first-skirmish-playtest.js', reports }));
