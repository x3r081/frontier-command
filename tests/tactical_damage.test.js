import test from 'node:test';
import assert from 'node:assert/strict';
import { createTacticalDamageMonitor } from '../src/game/tacticalDamage.js';

const unit = (id, defId, hp, owner = 'player') => ({ id, defId, hp, maxHp: 100, owner, x: 8, y: 12 });
const building = (id, defId, hp) => ({ id, defId, hp, maxHp: 100, owner: 'player', x: 4, y: 5, w: 3, h: 2 });

test('tactical damage monitor prioritizes command assets and never reports enemy damage', () => {
  const monitor = createTacticalDamageMonitor();
  const game = { time: 0, units: [unit('h', 'harvester', 100), unit('e', 'lightTank', 100, 'enemy')],
    buildings: [building('c', 'command', 100)] };
  assert.equal(monitor.observe(game), null);
  game.time = 1; game.units[0].hp = 65; game.units[1].hp = 10; game.buildings[0].hp = 90;
  const alert = monitor.observe(game);
  assert.equal(alert.id, 'c');
  assert.equal(alert.kind, 'damaged');
  assert.deepEqual([alert.x, alert.y], [5.5, 6]);
  game.time = 2;
  assert.equal(monitor.observe(game), null);
});

test('tactical damage monitor throttles repeat hits and catches a Harvester lost between snapshots', () => {
  const monitor = createTacticalDamageMonitor();
  const game = { time: 0, units: [unit('h', 'harvester', 100)], buildings: [] };
  monitor.observe(game);
  game.time = 1; game.units[0].hp = 80;
  assert.equal(monitor.observe(game)?.kind, 'damaged');
  game.time = 4; game.units[0].hp = 60;
  assert.equal(monitor.observe(game), null);
  game.time = 11; game.units = [];
  assert.equal(monitor.observe(game)?.kind, 'lost');
});

test('tactical damage monitor treats a restored earlier game time as a fresh baseline', () => {
  const monitor = createTacticalDamageMonitor();
  const game = { time: 50, units: [unit('h', 'harvester', 70)], buildings: [] };
  monitor.observe(game);
  game.time = 5; game.units[0].hp = 100;
  assert.equal(monitor.observe(game), null);
  game.time = 6; game.units[0].hp = 85;
  assert.equal(monitor.observe(game)?.id, 'h');
});
