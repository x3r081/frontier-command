import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game/engine.js';

test('command-rig opening gives both sides clear deployment footprints and starting economy', () => {
  for (const mapId of ['shard-valley', 'twin-passes', 'delta-crossing', 'canyon-ring', 'storm-basin']) {
    const game = new Game({ seed: 91, mapId, skirmishOpening: 'command-rig' });
    assert.equal(game.skirmishOpening, 'command-rig');
    assert.equal(game.buildings.length, 0);
    const expectedUnits = [
      ['enemy', 'buggy'], ['enemy', 'harvester'], ['enemy', 'mcv'],
      ['player', 'buggy'], ['player', 'harvester'], ['player', 'mcv'],
    ];
    assert.equal(game.units.filter(u => u.owner === 'player').length, 3);
    assert.equal(game.units.filter(u => u.owner === 'enemy').length, 3);
    assert.deepEqual(game.units.map(u => [u.owner, u.defId]).sort(), expectedUnits.sort());
    for (const owner of ['player', 'enemy']) {
      const rig = game.units.find(u => u.owner === owner && u.defId === 'mcv');
      assert.equal(game._canDeployMCV(rig).ok, true, `${mapId} ${owner}`);
    }
    assert.ok(game.credits.player >= 3000 && game.credits.enemy >= 3000);
  }
});

test('player can deploy the starting rig and the AI deploys before its normal build order', () => {
  const game = new Game({ seed: 92, skirmishOpening: 'command-rig' });
  const playerRig = game.units.find(u => u.owner === 'player' && u.defId === 'mcv');
  assert.equal(game.issueDeploy(playerRig.id).ok, true);
  assert.ok(game.buildings.some(b => b.owner === 'player' && b.defId === 'command'));

  game._aiTick();
  assert.ok(game.buildings.some(b => b.owner === 'enemy' && b.defId === 'command'));
  assert.ok(game.buildings.some(b => b.owner === 'enemy' && b.defId === 'power' && b.progress < 1));
});

test('command-rig start develops an AI economy and round trips deterministically', () => {
  const a = new Game({ seed: 93, skirmishOpening: 'command-rig' });
  const b = new Game({ seed: 93, skirmishOpening: 'command-rig' });
  for (let i = 0; i < 100; i++) { a.update(0.5); b.update(0.5); }
  assert.ok(a.buildings.some(x => x.owner === 'enemy' && x.defId === 'refinery' && x.progress >= 1));
  assert.ok(a.units.some(x => x.owner === 'enemy' && x.defId === 'harvester'));
  assert.deepEqual(JSON.parse(a.serialize()), JSON.parse(b.serialize()));
  const loaded = Game.deserialize(a.serialize());
  assert.equal(loaded.skirmishOpening, 'command-rig');
  const resumed = Game.deserialize(a.serialize());
  for (let i = 0; i < 10; i++) { loaded.update(0.5); resumed.update(0.5); }
  assert.deepEqual(JSON.parse(loaded.serialize()), JSON.parse(resumed.serialize()));
});

test('established opening remains the default and legacy saves normalize to it', () => {
  const standard = new Game({ seed: 94 });
  const implicit = new Game({ seed: 94, skirmishOpening: 'invalid' });
  assert.equal(standard.skirmishOpening, 'established');
  assert.deepEqual(implicit.units, standard.units);
  assert.deepEqual(implicit.buildings, standard.buildings);
  const oldSave = JSON.parse(standard.serialize());
  delete oldSave.skirmishOpening;
  assert.equal(Game.deserialize(oldSave).skirmishOpening, 'established');
  assert.equal(new Game({ mode: 'campaign', skirmishOpening: 'command-rig' }).skirmishOpening, 'established');
});
