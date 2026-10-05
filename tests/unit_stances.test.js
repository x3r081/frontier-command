import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, SKIRMISH_MAPS } from '../src/game/engine.js';
import { SoloClock, SOLO_STEP_SECONDS } from '../src/game/soloClock.js';
import { createSoloRecorder, replaySoloRun } from '../src/game/replay.js';

function arena() {
  const game = new Game({ seed: 4081 });
  game.units = [];
  game.buildings = [];
  game.relays = [];
  for (const row of game.terrain) for (const tile of row) {
    tile.type = 'sand'; tile.resource = 0; tile.walkable = true; tile.buildable = true;
  }
  for (const row of game.fog) row.fill(2);
  return game;
}

function advance(game, seconds) {
  for (let i = 0; i < seconds * 10; i++) game.update(0.1);
}

test('combat stance defaults to aggressive and save loading migrates legacy units', () => {
  const game = arena();
  const rifle = game._createUnit('player', 'rifle', 20.5, 20.5);
  const ai = game._createUnit('enemy', 'rifle', 23.5, 20.5);
  assert.equal(rifle.stance, 'aggressive');
  assert.equal(ai.stance, 'aggressive');
  rifle.cooldown = 100;
  ai.cooldown = 0;
  advance(game, 0.2);
  assert.ok(game.effects.some(effect => effect.type === 'projectile' && effect.sourceId === ai.id),
    'enemy AI retains automatic acquisition by default');
  assert.equal(Game.deserialize(game.serialize()).getEntity(rifle.id).stance, 'aggressive');
  const legacy = JSON.parse(game.serialize());
  delete legacy.units[0].stance;
  assert.equal(Game.deserialize(legacy).units[0].stance, 'aggressive');
});

test('holdFire suppresses automatic combat but explicit attack and force-fire still work', () => {
  const game = arena();
  const rifle = game._createUnit('player', 'rifle', 20.5, 20.5);
  const enemy = game._createUnit('enemy', 'engineer', 22.5, 20.5);
  rifle.cooldown = 0;
  game.select(rifle.id);
  assert.deepEqual(game.issueSetStance('holdFire'), { ok: true });
  advance(game, 1);
  assert.equal(enemy.hp, enemy.maxHp, 'idle holdFire units do not auto-acquire');
  assert.deepEqual(game.issueAttack(enemy.id), { ok: true });
  advance(game, 1);
  assert.ok(enemy.hp < enemy.maxHp, 'an explicit attack order still fires');

  rifle.order = { type: 'idle' };
  rifle.cooldown = 0;
  const before = enemy.hp;
  assert.deepEqual(game.issueForceFire(enemy.x, enemy.y), { ok: true });
  advance(game, 1);
  assert.ok(enemy.hp < before, 'an explicit force-fire order still fires');
});

test('defensive stance responds to nearby threats and bounds pursuit from first contact', () => {
  const game = arena();
  const rifle = game._createUnit('player', 'rifle', 20.5, 20.5);
  const enemy = game._createUnit('enemy', 'engineer', 25.5, 20.5);
  rifle.cooldown = 100;
  game.select(rifle.id);
  game.issueGuard();
  assert.deepEqual(game.issueSetStance('defensive'), { ok: true });
  advance(game, 2);
  assert.ok(rifle.x > 20.5, 'defensive units respond to a nearby threat');
  enemy.x = 38.5;
  advance(game, 8);
  assert.ok(Math.hypot(rifle.x - 20.5, rifle.y - 20.5) <= 5.6,
    'unit stops pursuing past its fixed local anchor');
});

test('stance command validates armed player selection and honors commandOwner', () => {
  const game = arena();
  const rifle = game._createUnit('player', 'rifle', 20.5, 20.5);
  const harvester = game._createUnit('player', 'harvester', 21.5, 20.5);
  game.select(harvester.id);
  assert.equal(game.issueSetStance('defensive').ok, false);
  assert.equal(game.issueSetStance('invalid').ok, false);
  game.select(rifle.id);
  game.commandOwner = 'enemy';
  assert.equal(game.issueSetStance('holdFire').ok, false);
  assert.equal(rifle.stance, 'aggressive');
});

test('stance command records and replays deterministically', () => {
  const envelope = { mode: 'skirmish', difficulty: 'normal', faction: 'aegis', seed: 12345,
    scenarioId: SKIRMISH_MAPS[0].id };
  const game = new Game({ mode: envelope.mode, difficulty: envelope.difficulty, faction: envelope.faction,
    seed: envelope.seed, mapId: envelope.scenarioId });
  const clock = new SoloClock();
  const recorder = createSoloRecorder(game, clock);
  const rifle = game.units.find(unit => unit.owner === 'player' && unit.defId === 'rifle');
  game.select(rifle.id);
  assert.deepEqual(game.issueSetStance('holdFire'), { ok: true });
  for (let i = 0; i < 3; i++) clock.advance(SOLO_STEP_SECONDS, dt => game.update(dt));
  recorder.dispose();
  assert.equal(recorder.commands[0].method, 'issueSetStance');
  assert.deepEqual(recorder.commands[0].args, ['holdFire']);
  const replay = replaySoloRun(envelope, recorder.commands, clock.completedTicks);
  assert.deepEqual(replay.game.units.map(({ id, stance, order }) => ({ id, stance, order })),
    game.units.map(({ id, stance, order }) => ({ id, stance, order })));
});
