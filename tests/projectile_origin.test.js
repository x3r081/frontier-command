import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game/engine.js';

test('projectile effects retain their launch point and source definition through save/load', () => {
  const game = new Game({ seed: 812 });
  const artillery = game._createUnit('player', 'artillery', 20.5, 20.5);
  game._fireAt(artillery, { x: 25.5, y: 24.5 }, game.unitDefs.artillery.weapon);
  const projectile = game.effects.find(effect => effect.type === 'projectile');

  assert.equal(projectile.launchX, projectile.x);
  assert.equal(projectile.launchY, projectile.y);
  assert.equal(projectile.sourceDefId, 'artillery');

  const loaded = Game.deserialize(game.serialize());
  const restored = loaded.effects.find(effect => effect.id === projectile.id);
  assert.deepEqual([restored.launchX, restored.launchY, restored.sourceDefId],
    [projectile.launchX, projectile.launchY, 'artillery']);
});
