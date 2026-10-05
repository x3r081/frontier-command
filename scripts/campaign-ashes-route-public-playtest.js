// Deterministic public-command playtest for the v51 Ghost Channel and Iron
// Current payoffs on Ashes in Transit. The policy uses authored objective
// markers, public phase changes, visible contacts, and ordinary RTS commands.
import { createCampaignGame, updateCampaign } from '../src/game/campaign.js';

const cases = [
  { route: 'ghost-channel', seed: 51051 },
  { route: 'ghost-channel', seed: 167706 },
  { route: 'iron-current', seed: 51052 },
  { route: 'iron-current', seed: 167707 },
];
const extraction = { x: 48, y: 17 };
const armedUnits = game => game.units.filter(unit => unit.owner === 'player' && unit.hp > 0 &&
  !unit.embarkedIn && unit.defId !== 'engineer' && unit.defId !== 'harvester');

for (const { route, seed } of cases) {
  const game = createCampaignGame(5, 'normal', seed, 'standard', 'none', 'none', 'none', route);
  const state = game.campaignState;
  const analyst = game.units.find(unit => unit.owner === 'player' && unit.defId === 'engineer');
  const uplink = state.transmissionUplinks[0];
  const commands = [];
  const command = (label, units, issue) => {
    game.select(units.map(unit => unit.id));
    const result = issue();
    if (result.ok) commands.push(label);
    return result;
  };
  const escorts = armedUnits(game);
  const bodyguard = escorts.find(unit => unit.defId === 'flamer');
  const strikeGroup = escorts.filter(unit => unit !== bodyguard);
  if (bodyguard) command('flamer follow analyst', [bodyguard], () => game.issueFollow(analyst.id));
  command(`strike group attack-move ${uplink.id} uplink`, strikeGroup,
    () => game.issueMove(uplink.x, uplink.y, true));
  command(`analyst move ${uplink.id} uplink`, [analyst],
    () => game.issueMove(uplink.x, uplink.y));

  let shadowOrdered = false;
  let extractionOrdered = false;
  let cacheApproachOrdered = false;
  let recoveryOrdered = false;
  let lastAttackTarget = null;
  let lastAttackAt = -Infinity;
  const cache = state.routeCacheId ? game.wrecks.find(wreck => wreck.id === state.routeCacheId) : null;

  // At 0.2-second ticks this caps each scenario at 600 simulated seconds.
  for (let tick = 0; tick < 3000 && game.status === 'playing'; tick++) {
    if (route === 'ghost-channel' && state.phase === 'deploy-signal-shadow' && !shadowOrdered) {
      const point = state.ghostShadowPoint;
      const available = strikeGroup.filter(unit => unit.hp > 0);
      if (available.length && command('strike group move to marked signal shadow', available,
        () => game.issueMove(point.x, point.y, true)).ok) shadowOrdered = true;
    }

    if (route === 'iron-current' && state.phase === 'recover-supply-cache' && cache &&
        !cacheApproachOrdered) {
      const result = command('analyst move to marked supply cache', [analyst],
        () => game.issueMove(cache.x, cache.y));
      if (result.ok) cacheApproachOrdered = true;
    }
    if (route === 'iron-current' && state.phase === 'recover-supply-cache' && cache &&
        !recoveryOrdered && game.isVisible({ x: cache.x, y: cache.y, owner: 'enemy' }, 'player')) {
      const result = command('analyst recover visible supply cache', [analyst],
        () => game.issueRecoverWreck(cache.id));
      if (result.ok) recoveryOrdered = true;
    }

    const objectiveComplete = route === 'ghost-channel'
      ? state.ghostShadowDeployed === true
      : state.routeCacheRecovered === true;
    if (objectiveComplete && !extractionOrdered) {
      const result = command('analyst move to extraction', [analyst],
        () => game.issueMove(extraction.x, extraction.y));
      if (result.ok) extractionOrdered = true;
      const remaining = strikeGroup.filter(unit => unit.hp > 0);
      if (remaining.length) command('escorts attack-move to extraction', remaining,
        () => game.issueMove(extraction.x, extraction.y, true));
    }

    // Direct fire is ordered only on a currently visible contact in the
    // extraction corridor, such as the publicly announced interceptor.
    if (game.time - lastAttackAt >= 1) {
      const threat = game.visibleEnemies.filter(enemy => enemy.owner === 'enemy' && enemy.hp > 0 &&
        Math.hypot(enemy.x - extraction.x, enemy.y - extraction.y) <= 14)
        .sort((a, b) => Math.hypot(a.x - extraction.x, a.y - extraction.y) -
          Math.hypot(b.x - extraction.x, b.y - extraction.y))[0];
      if (threat && threat.id !== lastAttackTarget) {
        const attackers = strikeGroup.filter(unit => unit.hp > 0);
        if (attackers.length && command(`visible escorts attack ${threat.defId}`, attackers,
          () => game.issueAttack(threat.id)).ok) {
          lastAttackTarget = threat.id;
          lastAttackAt = game.time;
        }
      }
    }

    game.update(0.2);
    updateCampaign(game, 5, 0.2);
  }

  console.log(`${route} seed ${seed}: ${game.status}; elapsed ${state.elapsed.toFixed(1)}s; ` +
    `analyst ${analyst.hp.toFixed(1)}/${analyst.maxHp} HP; phase ${state.phase}; ` +
    `kills ${game.kills.player}; commands [${commands.join(' -> ')}]`);
  if (game.status !== 'victory') process.exitCode = 1;
}
