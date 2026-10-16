import { dailyFrontForDate } from './dailyFront.js';

const SETUP_KEYS = ['mode', 'difficulty', 'faction', 'seed', 'scenarioId',
  'skirmishOpening', 'victoryMode', 'aiCommanderProfileId'];

/** Reject mismatched local or network metadata before presenting a shared setup. */
export function canonicalDailyFront(challenge, rulesVersion) {
  try {
    if (challenge?.rulesVersion !== rulesVersion) return null;
    const expected = dailyFrontForDate(challenge.date, rulesVersion);
    return challenge.id === expected.id && challenge.opensAt === expected.opensAt &&
      challenge.expiresAt === expected.expiresAt &&
      SETUP_KEYS.every(key => challenge.setup?.[key] === expected.setup[key]) ? expected : null;
  } catch { return null; }
}

export function dailyFrontTicketMatches(challenge, ticket) {
  return ticket?.rulesVersion === challenge.rulesVersion &&
    ticket.dailyChallengeId === challenge.id && ticket.dailyChallengeDate === challenge.date &&
    SETUP_KEYS.every(key => ticket[key] === challenge.setup[key]);
}

/** Daily labels survive replay export without consulting today's clock. */
export function dailyFrontFromEnvelope(envelope, rulesVersion) {
  try {
    const challenge = dailyFrontForDate(envelope?.dailyChallengeDate, rulesVersion);
    if (envelope.dailyChallengeId !== challenge.id) return null;
    // The AI commander is already determined by the seed in older envelopes.
    return SETUP_KEYS.filter(key => key !== 'aiCommanderProfileId')
      .every(key => envelope[key] === challenge.setup[key]) ? challenge : null;
  } catch { return null; }
}

/** A recovered checkpoint is practice; a ranked run always starts at tick zero. */
export function dailyFrontFromCheckpoint(data, game, rulesVersion) {
  const savedVersion=data?.dailyFront?.rulesVersion;
  if(!Number.isSafeInteger(savedVersion)||savedVersion<0||savedVersion>rulesVersion)return null;
  const challenge = canonicalDailyFront(data.dailyFront, savedVersion);
  if (!challenge || game?.mode !== 'skirmish') return null;
  if(Number.isInteger(game.replayVersion)&&game.replayVersion!==savedVersion)return null;
  const setup = challenge.setup;
  return game.seed === setup.seed && game.mapId === setup.scenarioId &&
    game.faction === setup.faction && game.difficulty === setup.difficulty &&
    game.skirmishOpening === setup.skirmishOpening && game.victoryMode === setup.victoryMode
    ? { challenge, practice: true } : null;
}
