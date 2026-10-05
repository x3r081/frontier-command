import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, UNIT_DEFS, VETERANCY_RANKS } from '../src/game/engine.js';
import { createCampaignGame, getCampaignResult } from '../src/game/campaign.js';
import { campaignVeteranSourceIds, deriveCampaignVeteran, validateCampaignVeteran } from '../src/game/campaignVeteran.js';
import { createSoloPlayback, SOLO_REPLAY_VERSION, validateSoloEnvelope } from '../src/game/replay.js';

function completedCampaign() {
  const game = createCampaignGame(1, 'normal', 9123);
  game.status = 'victory';
  game.winner = 'player';
  game.campaignComplete = true;
  return game;
}

test('campaign veteran derives the best living armed survivor with deterministic tie breaks', () => {
  const game = completedCampaign();
  const lowRank = game._createUnit('player', 'lightTank', 10.5, 10.5);
  Object.assign(lowRank, { veterancy: 0, kills: 30, xp: 999 });
  const byKills = game._createUnit('player', 'rocket', 11.5, 10.5);
  Object.assign(byKills, { veterancy: 2, kills: 4, xp: 600, promotion: 'rangefinder' });
  const byXp = game._createUnit('player', 'rifle', 12.5, 10.5);
  Object.assign(byXp, { veterancy: 2, kills: 4, xp: 700, promotion: 'bulwark' });
  const excluded = game._createUnit('player', 'medic', 13.5, 10.5);
  Object.assign(excluded, { veterancy: 2, kills: 999, xp: 9999 });
  const dead = game._createUnit('player', 'scout', 14.5, 10.5);
  dead.hp = 0;

  assert.deepEqual(deriveCampaignVeteran(game), {
    defId: 'rifle', faction: 'aegis', veterancy: 2, promotion: 'bulwark',
  });
  assert.deepEqual(getCampaignResult(game).campaignVeteran, deriveCampaignVeteran(game));

  byXp.xp = byKills.xp;
  byXp.kills = byKills.kills;
  byXp.id = 'u900';
  byKills.id = 'u100';
  assert.equal(deriveCampaignVeteran(game).defId, 'rocket', 'stable ID breaks a complete tie');
  assert.equal(deriveCampaignVeteran({ ...game, campaignComplete: false }), null);
});

test('rookie survivors receive the Veteran survival commendation and sources follow authored branches', () => {
  const game = completedCampaign();
  const survivor = game._createUnit('player', 'scout', 10.5, 10.5);
  game.units = [survivor];
  survivor.veterancy = 0;
  assert.deepEqual(deriveCampaignVeteran(game), {
    defId: 'scout', faction: 'aegis', veterancy: 1, promotion: null,
  });
  assert.deepEqual(campaignVeteranSourceIds(0), []);
  assert.deepEqual(campaignVeteranSourceIds(4), ['ghost-channel', 'iron-current', 'black-shard']);
  assert.deepEqual(campaignVeteranSourceIds(13), ['black-shard']);
  assert.deepEqual(campaignVeteranSourceIds(14), ['black-shard']);
  assert.deepEqual(campaignVeteranSourceIds(6), ['ashes-in-transit']);
  assert.deepEqual(campaignVeteranSourceIds(12), ['dawn-of-the-free']);
  assert.deepEqual(campaignVeteranSourceIds(-1), []);
});

test('campaign veteran payload validation accepts only armed combat units and exact shape', () => {
  const veteran = { defId: 'flamer', faction: 'vesper', veterancy: 2, promotion: 'rangefinder' };
  assert.equal(validateCampaignVeteran(null), true);
  assert.equal(validateCampaignVeteran(veteran), true);
  assert.equal(validateCampaignVeteran({ ...veteran, extra: true }), false);
  assert.equal(validateCampaignVeteran({ ...veteran, faction: 'all' }), false);
  assert.equal(validateCampaignVeteran({ ...veteran, defId: 'medic' }), false);
  assert.equal(validateCampaignVeteran({ ...veteran, defId: 'guardian', faction: 'vesper' }), false);
  assert.equal(validateCampaignVeteran({ ...veteran, veterancy: 1 }), false);
  assert.equal(validateCampaignVeteran({ ...veteran, promotion: 'unknown' }), false);
});

test('campaign setup spawns a safe, deterministic veteran and preserves original faction and bonuses', () => {
  const veteran = { defId: 'flamer', faction: 'vesper', veterancy: 2, promotion: 'rangefinder' };
  const args = [6, 'normal', 128, 'reinforced', 'none', 'assault', 'vanguard', 'none', veteran];
  const game = createCampaignGame(...args);
  const restored = createCampaignGame(...args);
  const unit = game.units.find(candidate => candidate.faction === 'vesper' && candidate.defId === 'flamer');
  const restoredUnit = restored.units.find(candidate => candidate.faction === 'vesper' && candidate.defId === 'flamer');
  assert.ok(unit);
  assert.deepEqual([unit.x, unit.y], [restoredUnit.x, restoredUnit.y]);
  assert.deepEqual(game.campaignVeteran, veteran);
  assert.equal(unit.veterancy, 2);
  assert.equal(unit.xp, VETERANCY_RANKS[2].xp);
  assert.equal(unit.promotion, 'rangefinder');
  assert.equal(unit.maxHp, Math.round(UNIT_DEFS.flamer.health * 1.1 * 1.12 * 1.1));
  assert.equal(unit.hp, unit.maxHp);
  assert.equal(unit.shieldHp, unit.maxHp * 0.2);
  assert.ok(game._isPassable(Math.floor(unit.x), Math.floor(unit.y)));
  assert.equal(game.units.filter(candidate => candidate.owner === 'player' && candidate.faction === 'vesper').length, 1);
  assert.deepEqual(Game.deserialize(game.serialize()).campaignVeteran, veteran);
});

test('version 30 replay carries the veteran through creation and reset; legacy envelopes remain valid', () => {
  const veteran = { defId: 'flamer', faction: 'vesper', veterancy: 1, promotion: null };
  const envelope = { mode: 'campaign', difficulty: 'normal', faction: 'aegis', seed: 287,
    scenarioId: 'silent-switch', campaignVeteran: veteran };
  assert.equal(SOLO_REPLAY_VERSION, 57);
  assert.equal(validateSoloEnvelope(envelope), 1);
  const playback = createSoloPlayback(envelope, [], 0, 30);
  const initial = playback.game.units.find(unit => unit.defId === 'flamer' && unit.faction === 'vesper');
  assert.ok(initial);
  assert.equal(initial.veterancy, 1);
  assert.deepEqual(playback.reset().units.find(unit => unit.defId === 'flamer' && unit.faction === 'vesper'), initial);
  assert.throws(() => createSoloPlayback(envelope, [], 0, 29), /campaign veterans require replay version 30/i);

  const legacy = { mode: 'campaign', difficulty: 'normal', faction: 'aegis', seed: 287,
    scenarioId: 'silent-switch' };
  assert.equal(validateSoloEnvelope(legacy), 1);
  assert.doesNotThrow(() => createSoloPlayback(legacy, [], 0, 29));
  assert.throws(() => createCampaignGame(0, 'normal', 1, 'standard', 'none', 'none', 'none', 'none', veteran),
    /invalid campaign veteran/i);
});
