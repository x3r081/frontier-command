import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, TARGET_PRIORITY_OPTIONS, TARGET_PRIORITY_RULES_VERSION } from '../src/game/engine.js';
import { createSoloPlayback, createSoloRecorder, validateSoloReplay, SOLO_REPLAY_VERSION } from '../src/game/replay.js';
import { SOLO_STEP_SECONDS } from '../src/game/soloClock.js';
import { TARGET_PRIORITY_PUBLIC_ROUTES, runTargetPriorityPublicPlaytest } from '../scripts/target-priority-public-playtest.js';

const envelope = { mode: 'skirmish', difficulty: 'easy', faction: 'aegis', seed: 24,
  scenarioId: 'shard-valley', victoryMode: 'elimination' };

function makeRecordedPreference(priority) {
  const game = new Game({ ...envelope, mapId: envelope.scenarioId, replayVersion: TARGET_PRIORITY_RULES_VERSION });
  const clock = { completedTicks: 0 };
  const recorder = createSoloRecorder(game, clock);
  const rifle = game.units.find(unit => unit.owner === 'player' && unit.defId === 'rifle' &&
    !unit.embarkedIn && unit.hp > 0);
  assert.ok(rifle, 'ordinary seed-24 opening has a living unembarked Rifle');
  game.select(rifle.id);
  assert.equal(game.issueSetTargetPriority(priority).ok, true);
  for (let tick = 0; tick < 12; tick++) {
    game.update(SOLO_STEP_SECONDS);
    clock.completedTicks++;
  }
  recorder.dispose();
  return { game, clock, commands: recorder.commands };
}

test('target-priority command has strict enum replay schema and rules-82 gate', () => {
  assert.equal(TARGET_PRIORITY_RULES_VERSION, 82);
  assert.equal(SOLO_REPLAY_VERSION, 82);
  const valid = { tick: 0, sequence: 0, method: 'issueSetTargetPriority', args: ['vehicles'], selectedIds: ['u1'] };
  assert.equal(validateSoloReplay(envelope, [valid], 12, SOLO_REPLAY_VERSION), true);
  assert.throws(() => createSoloPlayback(envelope, [valid], 12, SOLO_REPLAY_VERSION - 1),
    /target priorities require replay version 82/i);
  for (const args of [[], ['auto', 'infantry'], [null], ['Infantry'], ['all'], [{ vehicles: true }]]) {
    assert.throws(() => validateSoloReplay(envelope, [{ ...valid, args }], 12, SOLO_REPLAY_VERSION),
      /invalid solo command/i);
  }
  for (const priority of TARGET_PRIORITY_OPTIONS) {
    assert.equal(validateSoloReplay(envelope, [{ ...valid, args: [priority] }], 12, SOLO_REPLAY_VERSION), true);
  }
});

test('selected-unit target priority records and reproduces in exact playback', () => {
  const { game, clock, commands } = makeRecordedPreference('structures');
  assert.deepEqual(commands.map(command => command.method), ['issueSetTargetPriority'],
    'the preference is a public command, not an implicit selection mutation');
  assert.equal(game.units.find(unit => unit.id === commands[0].selectedIds[0]).targetPriority, 'structures');
  const playback = createSoloPlayback(envelope, commands, clock.completedTicks, SOLO_REPLAY_VERSION);
  playback.step(clock.completedTicks);
  assert.deepEqual(JSON.parse(playback.game.serialize()), JSON.parse(game.serialize()));
});

test('ordinary paid seed-24 Rockets apply vehicle priority and replay preferred and fallback shots exactly', t => {
  const route = TARGET_PRIORITY_PUBLIC_ROUTES[1];
  const result = runTargetPriorityPublicPlaytest(route);
  assert.equal(result.route.difficulty, 'normal');
  assert.equal(result.startingCredits - result.creditsAfterQueue, 600,
    'both Rocket Troopers should be inserted at their regular 300-credit price');
  assert.equal(result.rocketsOrdered.length, 2);
  assert.ok(result.preferredShots.length > 0,
    'a paid priority Rocket should fire at an enemy vehicle during ordinary combat');
  assert.ok(result.fallbackShots.length > 0,
    'priority should yield ordinary acquisition when no preferred-class target is shootable');
  assert.ok(result.commands.filter(command => command.method === 'issueSetTargetPriority')
    .every(command => command.args[0] === 'vehicles' && command.selectedIds.length === 1));
  assert.equal(result.replayMatches, true);
  t.diagnostic(`paid seed-24 Normal/Aegis route: ${result.seconds}s; preferred vehicle shot at ` +
    `${result.preferredShots[0].time}s; ordinary fallback at ${result.fallbackShots[0].time}s; exact replay`);
});
