// Bounded public-order playtest for Ashes in Transit. It uses authored objective
// markers, public campaign warning events, and visible enemy contacts to choose
// orders. Threat selection uses only visible enemies' positions and HP; it never
// reads hidden enemy state.
import assert from 'node:assert/strict';
import { createCampaignGame, updateCampaign } from '../src/game/campaign.js';
import { SOLO_STEP_SECONDS } from '../src/game/soloClock.js';

const cases = ['normal', 'hard'].flatMap(difficulty => [1, 404, 167706, 481516].flatMap(seed =>
  ['north', 'south'].map(uplinkId => ({ difficulty, seed, uplinkId }))));
const extraction = { x: 48, y: 17 }; // The mission's visible eastern beacon.

for (const { difficulty, seed, uplinkId } of cases) {
  // Verify the old two-order policy cannot skip the newly authored signal stop.
  const direct = createCampaignGame(5, difficulty, seed);
  const directAnalyst = direct.units.find(unit => unit.owner === 'player' && unit.defId === 'engineer');
  const directEscorts = direct.units.filter(unit => unit.owner === 'player' && unit.id !== directAnalyst.id);
  direct.select(directEscorts.map(unit => unit.id));
  assert.equal(direct.issueMove(extraction.x, extraction.y, true).ok, true);
  direct.select(directAnalyst.id);
  assert.equal(direct.issueMove(extraction.x, extraction.y).ok, true);
  for (let tick = 0; tick < 3000 && direct.status === 'playing'; tick++) {
    direct.update(SOLO_STEP_SECONDS);
    updateCampaign(direct, 5, SOLO_STEP_SECONDS);
  }
  assert.notEqual(direct.status, 'victory', `${difficulty} seed ${seed}: direct extraction does not bypass transmission`);
  assert.equal(direct.campaignComplete, false);

  const game = createCampaignGame(5, difficulty, seed);
  const analyst = game.units.find(unit => unit.owner === 'player' && unit.defId === 'engineer');
  assert.ok(analyst, `${difficulty} seed ${seed}: starting analyst is present`);
  const escorts = game.units.filter(unit => unit.owner === 'player' && unit.id !== analyst.id);
  const uplink = game.campaignState.transmissionUplinks.find(item => item.id === uplinkId);
  assert.ok(uplink, `${difficulty}: chosen uplink is marked`);

  game.select(escorts.map(unit => unit.id));
  assert.equal(game.issueMove(uplink.x, uplink.y, true).ok, true,
    `${difficulty} seed ${seed}: escort group accepts attack-move to the ${uplinkId} route`);
  game.select(analyst.id);
  assert.equal(game.issueMove(uplink.x, uplink.y).ok, true,
    `${difficulty} seed ${seed}: analyst accepts the ${uplinkId} uplink order`);

  for (let tick = 0; tick < 3000 && game.status === 'playing' && game.campaignState.phase === 'transmit-codes'; tick++) {
    game.update(SOLO_STEP_SECONDS);
    updateCampaign(game, 5, SOLO_STEP_SECONDS);
  }
  assert.equal(game.campaignState.phase, 'extract-analyst', `${difficulty} seed ${seed}: patrol codes transmit`);
  const routeGuard = uplinkId === 'north' ? [escorts[0], escorts[3]] : [escorts[0]];
  const northStrike = uplinkId === 'north' ? [escorts[1], escorts[2]] : escorts.slice(1);
  game.select((uplinkId === 'north' ? northStrike : escorts).map(unit => unit.id));
  if (uplinkId === 'north') {
    assert.equal(game.issueMove(extraction.x, extraction.y, true).ok, true,
      `${difficulty} seed ${seed}: strike group moves to clear the warned intercept`);
    game.select(routeGuard.map(unit => unit.id));
    assert.equal(game.issueFollow(analyst.id).ok, true,
      `${difficulty} seed ${seed}: flamer follows the analyst while the strike group clears the intercept`);
  } else {
    assert.equal(game.issueMove(extraction.x, extraction.y, true).ok, true,
      `${difficulty} seed ${seed}: strike group accepts extraction attack-move`);
    game.select(routeGuard[0].id);
    assert.equal(game.issueFollow(analyst.id).ok, true,
      `${difficulty} seed ${seed}: one escort follows the analyst along the quiet route`);
  }
  game.select(analyst.id);
  let analystOrderedToExtract = uplinkId === 'south';
  if (analystOrderedToExtract) assert.equal(game.issueMove(extraction.x, extraction.y).ok, true,
    `${difficulty} seed ${seed}: analyst accepts extraction order`);
  let lastThreatId = null;
  let nextThreatCheck = 0;
  for (let tick = 0; tick < 3000 && game.status === 'playing'; tick++) {
    game.update(SOLO_STEP_SECONDS);
    updateCampaign(game, 5, SOLO_STEP_SECONDS);
    if (uplinkId === 'north' && game.time >= nextThreatCheck) {
      nextThreatCheck = game.time + 0.5;
      const responseWarned = game.events.some(event => event.type === 'campaignThreatWarning' &&
        /northern burst exposed/i.test(event.message));
      const responseVisible = game.events.some(event => event.type === 'campaignReinforcement' &&
        /Aegis intercept team reached/i.test(event.message));
      if (responseVisible) {
        const threat = game.visibleEnemies.filter(enemy => enemy.hp > 0 &&
          Math.hypot(enemy.x - extraction.x, enemy.y - extraction.y) <= 14)
          .sort((a, b) => Math.hypot(a.x - extraction.x, a.y - extraction.y) -
            Math.hypot(b.x - extraction.x, b.y - extraction.y))[0];
        if (threat && threat.id !== lastThreatId) {
          const attackers = (uplinkId === 'north' ? northStrike : escorts).filter(unit => unit.hp > 0);
          game.select(attackers.map(unit => unit.id));
          assert.equal(game.issueAttack(threat.id).ok, true,
            `${difficulty} seed ${seed}: visible interceptor accepts the escort attack order`);
          lastThreatId = threat.id;
        } else if (!threat && lastThreatId) {
          game.select((uplinkId === 'north' ? northStrike : escorts).filter(unit => unit.hp > 0).map(unit => unit.id));
          game.issueMove(extraction.x, extraction.y, true);
          lastThreatId = null;
        }
      }
      if (responseWarned && !analystOrderedToExtract) {
        game.select(analyst.id);
        assert.equal(game.issueMove(extraction.x, extraction.y).ok, true,
          `${difficulty} seed ${seed}: analyst departs on the visible warning while escort follows`);
        analystOrderedToExtract = true;
      }
    }
  }

  assert.equal(game.status, 'victory', `${difficulty} seed ${seed}: analyst reaches extraction ` +
    `(status ${game.status}, phase ${game.campaignState.phase}, t=${game.time.toFixed(2)}, ` +
    `analyst=${analyst.hp.toFixed(1)}, transmission=${game.campaignState.transmissionElapsed?.toFixed(2)}, ` +
    `intercept=${game.campaignState.extractionInterceptFired})`);
  assert.ok(analyst.hp > 0, `${difficulty} seed ${seed}: analyst survives the crossing`);
  assert.equal(game.campaignResult.mission, 'ashes-in-transit');
  if (uplinkId === 'north') assert.equal(game.campaignState.extractionInterceptFired, true,
    `${difficulty} seed ${seed}: the visible North intercept deploys once`);
  else assert.equal(game.campaignState.extractionInterceptFired, false,
    `${difficulty} seed ${seed}: the South return stays quiet`);
  console.log(`${difficulty} seed ${seed} ${uplinkId}: victory at ${game.campaignState.elapsed.toFixed(1)}s; ` +
    `analyst ${analyst.hp.toFixed(1)}/${analyst.maxHp} HP; ` +
    `${game.campaignState.extractionInterceptFired ? 'North intercept survived' : 'quiet return'}`);
}
