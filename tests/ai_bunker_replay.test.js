import test from 'node:test';
import assert from 'node:assert/strict';
import { AI_BUNKER_PUBLIC_ROUTES, runAiBunkerPublicPlaytest } from '../scripts/ai-bunker-public-playtest.js';

test('rules-80 public skirmish records a paid AI bunker, crew fire, and exact replay', () => {
  const result = runAiBunkerPublicPlaytest(AI_BUNKER_PUBLIC_ROUTES[2]);

  assert.equal(result.route.seed, 24);
  assert.equal(result.route.difficulty, 'hard');
  assert.ok(result.constructionEvent, 'the AI should pay for a bunker after the public raid');
  assert.equal(result.constructionEvent.spentThisTick, 650);
  assert.ok(result.bunker && result.bunker.progress >= 1, 'the enemy bunker should complete');
  assert.equal(result.bunker.garrisonIds.length, 3, 'idle eligible AI infantry should fill the bunker');
  assert.ok(result.firstOccupancy);
  assert.ok(result.firstShotAt, 'the AI crew should fire during the public route');
  assert.ok(result.crewProjectiles >= 1);
  assert.ok(result.playerCommands.some(command => command.method === 'queueUnit' && command.args[0] === 'rocket'),
    'the reinforcement should be a normal paid player production command');
  assert.equal(result.playerCommands.some(command => command.method === 'issueGarrison'), false,
    'AI garrison orders must not be included in the player replay');
  assert.equal(result.replayMatches, true,
    'units, buildings, credits, terrain, effects, time, and status should replay exactly');
  assert.ok(result.checkpointSerialized, 'retain the firing bunker checkpoint for live UI QA');
});
