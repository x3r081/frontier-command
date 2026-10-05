import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, STORMCALL_PULSE_DAMAGE, STORMCALL_PULSE_RADIUS } from '../src/game/engine.js';

function setup() {
  const game = new Game({ seed: 4242, mode: 'multiplayer' });
  const relay = game.relays[0];
  relay.owner = 'player';
  game.commandEnergy.player = 100;
  game.storm.phase = 'surge';
  game.storm.phaseTime = 0;
  game.storm.x = relay.x + 5;
  game.storm.y = relay.y;
  game._updateFog();
  game.fog[Math.floor(game.storm.y)][Math.floor(game.storm.x)] = 2;
  return { game, relay, x: game.storm.x, y: game.storm.y };
}

test('a called surge discharges once at its target against enemies only', () => {
  const { game, relay, x, y } = setup();
  const enemy = game._createUnit('enemy', 'rifle', x, y);
  const outside = game._createUnit('enemy', 'rifle', x + STORMCALL_PULSE_RADIUS + 0.1, y);
  const fragile = game._createUnit('enemy', 'scout', x + 1, y);
  fragile.hp = 40;
  const friendly = game._createUnit('player', 'rifle', x, y);
  assert.equal(game.useCommandAbility('stormcall', x, y).ok, true);
  game.time += 0.1;
  game._updateStorm(0.1);
  assert.equal(enemy.hp, enemy.maxHp - STORMCALL_PULSE_DAMAGE);
  assert.equal(outside.hp, outside.maxHp);
  assert.equal(friendly.hp, friendly.maxHp);
  assert.equal(fragile.hp, 0);
  assert.equal(game.kills.player, 1);
  assert.equal(game.storm.lure.pulseResolved, true);
  assert.equal(game.events.filter(event => event.type === 'stormcallPulse').length, 1);
  assert.deepEqual(game.events.find(event => event.type === 'stormcallPulse')?.relayId, relay.id);
  assert.ok(game.effects.some(effect => effect.type === 'ion' && effect.owner === 'player' &&
    effect.source === 'stormcall' &&
    effect.x === x && effect.y === y));
  game.time += 0.1;
  game._updateStorm(0.1);
  assert.equal(enemy.hp, enemy.maxHp - STORMCALL_PULSE_DAMAGE);
  assert.equal(game.events.filter(event => event.type === 'stormcallPulse').length, 1);
});

test('ordinary surges have no pulse and a contested relay cancels a pending call', () => {
  const { game, relay, x, y } = setup();
  const enemy = game._createUnit('enemy', 'rifle', x, y);
  game.time += 0.1;
  game._updateStorm(0.1);
  assert.equal(enemy.hp, enemy.maxHp);
  assert.equal(game.events.some(event => event.type === 'stormcallPulse'), false);

  game.storm.x = x + 2;
  assert.equal(game.useCommandAbility('stormcall', x, y).ok, true);
  relay.contested = true;
  game.time += 0.1;
  game._updateStorm(0.1);
  assert.equal(game.storm.lure, undefined);
  assert.equal(enemy.hp, enemy.maxHp);
  assert.equal(game.events.find(event => event.type === 'stormcallCanceled')?.reason, 'contested');
  assert.match(game.events.find(event => event.type === 'stormcallCanceled')?.message, /contested/);
  assert.equal(game.events.some(event => event.type === 'stormcallPulse'), false);

  const invaded = setup();
  invaded.game.storm.x = invaded.x + 2;
  assert.equal(invaded.game.useCommandAbility('stormcall', invaded.x, invaded.y).ok, true);
  invaded.game._createUnit('enemy', 'rifle', invaded.relay.x, invaded.relay.y);
  invaded.game.time += 0.1;
  invaded.game._updateStorm(0.1);
  assert.equal(invaded.game.storm.lure, undefined, 'an enemy alone inside the anchor radius cancels the call');
  assert.equal(invaded.game.events.find(event => event.type === 'stormcallCanceled')?.reason, 'contested');
});

test('losing the anchor cancels a pending call; save/load preserves a one-shot discharge', () => {
  const { game, relay, x, y } = setup();
  const enemy = game._createUnit('enemy', 'rifle', x, y);
  game.storm.x = x + 2;
  assert.equal(game.useCommandAbility('stormcall', x, y).ok, true);
  const loaded = Game.deserialize(game.serialize());
  for (let i = 0; i < 20; i++) {
    game.time += 0.1;
    loaded.time += 0.1;
    game._updateStorm(0.1);
    loaded._updateStorm(0.1);
  }
  assert.deepEqual(loaded.storm, game.storm);
  assert.equal(loaded.getEntity(enemy.id).hp, enemy.hp);
  assert.equal(game.events.filter(event => event.type === 'stormcallPulse').length, 1);

  const lost = setup();
  lost.game.storm.x = lost.x + 2;
  assert.equal(lost.game.useCommandAbility('stormcall', lost.x, lost.y).ok, true);
  lost.relay.owner = 'enemy';
  lost.game.time += 0.1;
  lost.game._updateStorm(0.1);
  assert.equal(lost.game.storm.lure, undefined);
  assert.equal(lost.game.events.find(event => event.type === 'stormcallCanceled')?.reason, 'lost');
});

test('skirmish AI calls a nearby surge against a visible cluster by its secure relay', () => {
  const game = new Game({ seed: 4242, mode: 'skirmish' });
  const relay = game.relays[0];
  relay.owner = 'enemy';
  game.commandEnergy.enemy = 100;
  game.storm.phase = 'surge';
  game.storm.x = relay.x + 4;
  game.storm.y = relay.y;
  game._createUnit('enemy', 'scout', relay.x + 3.5, relay.y + 1);
  game._createUnit('player', 'rifle', relay.x + 4, relay.y);
  game._createUnit('player', 'rifle', relay.x + 4.5, relay.y);
  game._aiUseCommandAbilities([]);
  assert.equal(game.storm.lure?.owner, 'enemy');
  assert.equal(game.storm.lure?.relayId, relay.id);
  assert.equal(game.commandEnergy.enemy, 45);
});
