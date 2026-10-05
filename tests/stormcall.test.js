import test from 'node:test';
import assert from 'node:assert/strict';
import { COMMAND_ABILITIES, Game } from '../src/game/engine.js';
import { SoloClock, SOLO_STEP_SECONDS } from '../src/game/soloClock.js';
import { createSoloRecorder, replaySoloRun } from '../src/game/replay.js';

function readyGame() {
  const game = new Game({ seed: 12345, mode: 'multiplayer' });
  game.storm.phase = 'warning';
  game.storm.phaseTime = 0;
  game.commandEnergy.player = 100;
  game.relays[0].owner = 'player';
  game._updateFog();
  return game;
}

test('Relay Stormcall validates phase, energy, cooldown, relay ownership, and visible point', () => {
  const game = readyGame();
  const relay = game.relays[0];
  assert.deepEqual({ name: COMMAND_ABILITIES.stormcall.name, cost: COMMAND_ABILITIES.stormcall.cost,
    cooldown: COMMAND_ABILITIES.stormcall.cooldown, radius: COMMAND_ABILITIES.stormcall.radius },
  { name: 'Relay Stormcall', cost: 55, cooldown: 95, radius: 6 });
  game.storm.phase = 'calm';
  assert.match(game.canUseCommandAbility('stormcall', relay.x, relay.y).reason, /warning or surge/);
  game.storm.phase = 'warning';
  game.commandEnergy.player = 54;
  assert.match(game.canUseCommandAbility('stormcall', relay.x, relay.y).reason, /energy/);
  game.commandEnergy.player = 100;
  assert.match(game.canUseCommandAbility('stormcall', -1, relay.y).reason, /outside/);
  assert.match(game.canUseCommandAbility('stormcall', relay.x + 6.01, relay.y).reason, /controlled relay/);
  game.fog[Math.floor(relay.y)][Math.floor(relay.x)] = 1;
  assert.match(game.canUseCommandAbility('stormcall', relay.x, relay.y).reason, /visible/);
  game._updateFog();
  game.relays[0].owner = 'enemy';
  assert.match(game.canUseCommandAbility('stormcall', relay.x, relay.y).reason, /controlled relay/);
  game.relays[0].owner = 'player';
  assert.deepEqual(game.useCommandAbility('stormcall', relay.x, relay.y), { ok: true });
  assert.deepEqual(game.storm.lure, { owner: 'player', x: relay.x, y: relay.y, until: 35,
    relayId: relay.id, pulseResolved: false });
  assert.equal(game.commandEnergy.player, 45);
  assert.equal(game.commandCooldowns.player.stormcall, 95);
  game.commandEnergy.player = 100;
  assert.match(game.useCommandAbility('stormcall', relay.x, relay.y).reason, /cooling/);
});

test('command owner and enemy sight are checked independently of player fog', () => {
  const game = readyGame();
  const relay = game.relays[0];
  game.commandOwner = 'enemy';
  game.commandEnergy.enemy = 100;
  game.relays[0].owner = 'enemy';
  game.fog[Math.floor(relay.y)][Math.floor(relay.x)] = 0;
  assert.deepEqual(game.useCommandAbility('stormcall', relay.x, relay.y), { ok: true });
  assert.equal(game.storm.lure.owner, 'enemy');
  game.commandCooldowns.enemy.stormcall = 0;
  game.commandEnergy.enemy = 100;
  game.storm.phase = 'surge';
  game.storm.x = relay.x;
  game.storm.y = relay.y;
  const hidden = { x: relay.x + 5, y: relay.y };
  assert.match(game.canUseCommandAbility('stormcall', hidden.x, hidden.y, 'enemy').reason, /visible/);
  assert.match(game.canUseCommandAbility('stormcall', relay.x, relay.y, 'intruder').reason, /owner/);
});

test('lure steers and holds the surge while exposed forces take damage and relay shelter protects', () => {
  const game = readyGame();
  const relay = game.relays[0];
  game.storm.phase = 'surge';
  game.storm.phaseTime = 0;
  game.storm.x = relay.x + 8;
  game.storm.y = relay.y;
  const sheltered = game._createUnit('player', 'rifle', relay.x, relay.y);
  const exposed = game._createUnit('player', 'rifle', relay.x + 3.5, relay.y);
  assert.equal(game.useCommandAbility('stormcall', relay.x, relay.y).ok, true);
  const initialDistance = Math.hypot(game.storm.x - relay.x, game.storm.y - relay.y);
  for (let i = 0; i < 100; i++) { game.time += 0.1; game._updateStorm(0.1); }
  const heldDistance = Math.hypot(game.storm.x - relay.x, game.storm.y - relay.y);
  assert.ok(heldDistance <= 0.6000001 && heldDistance < initialDistance);
  assert.equal(sheltered.hp, sheltered.maxHp);
  assert.ok(exposed.hp < exposed.maxHp);
  const heldX = game.storm.x;
  for (let i = 0; i < 10; i++) { game.time += 0.1; game._updateStorm(0.1); }
  assert.equal(game.storm.x, heldX);
});

test('lure expires and recovery resumes the normal route; save/load keeps fixed-step state', () => {
  const game = readyGame();
  const relay = game.relays[0];
  assert.equal(game.useCommandAbility('stormcall', relay.x, relay.y).ok, true);
  for (let i = 0; i < 20; i++) game.update(0.1);
  const loaded = Game.deserialize(game.serialize());
  assert.deepEqual(loaded.storm, game.storm);
  assert.deepEqual(loaded.commandCooldowns, game.commandCooldowns);
  for (let i = 0; i < 40; i++) { game.update(0.1); loaded.update(0.1); }
  assert.deepEqual(loaded.storm, game.storm);
  assert.equal(loaded.randomState, game.randomState);
  game.time = game.storm.lure.until;
  game._updateStorm(0.1);
  assert.equal(game.storm.lure, undefined);
  const resumedX = game.storm.x;
  game._updateStorm(0.1);
  assert.notEqual(game.storm.x, resumedX);
  loaded.storm.phase = 'recovery';
  loaded._updateStorm(0.1);
  assert.equal(loaded.storm.lure, undefined);
  const legacy = JSON.parse(game.serialize());
  delete legacy.storm.lure;
  delete legacy.commandCooldowns.player.stormcall;
  assert.equal(Game.deserialize(legacy).commandCooldowns.player.stormcall, 0);
  assert.equal(Game.deserialize(legacy).storm.lure, undefined);
});

test('Stormcall is recorded and replays at the same fixed tick', () => {
  const envelope = { mode: 'skirmish', difficulty: 'normal', faction: 'aegis', seed: 12346,
    scenarioId: 'shard-valley' };
  const game = new Game({ seed: envelope.seed, mode: envelope.mode, difficulty: envelope.difficulty,
    faction: envelope.faction, mapId: envelope.scenarioId });
  const clock = new SoloClock();
  const recorder = createSoloRecorder(game, clock);
  for (const unit of game.units.filter(u => u.owner === 'player' && ['scout', 'lightTank'].includes(u.defId))) {
    game.select(unit.id);
    assert.equal(game.issueMove(22.5, 27.5).ok, true);
  }
  for (let i = 0; i < 1530; i++) clock.advance(SOLO_STEP_SECONDS, dt => game.update(dt));
  assert.equal(game.storm.phase, 'surge');
  assert.equal(game.relays[0].owner, 'player');
  assert.equal(game.useCommandAbility('stormcall', 22.5, 27.5).ok, true);
  for (let i = 0; i < 35; i++) clock.advance(SOLO_STEP_SECONDS, dt => game.update(dt));
  recorder.dispose();
  assert.ok(recorder.commands.some(command => command.method === 'useCommandAbility' &&
    command.tick === 1530 && command.args[0] === 'stormcall'));
  const replay = replaySoloRun(envelope, recorder.commands, clock.completedTicks).game;
  assert.deepEqual(replay.storm, game.storm);
  assert.deepEqual(replay.commandEnergy, game.commandEnergy);
  assert.deepEqual(replay.commandCooldowns, game.commandCooldowns);
  assert.deepEqual(replay.units, game.units);
});
