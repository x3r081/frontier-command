/** Only live sight confirms a rival relay's current state. Own relays remain known. */
export function relayIntel(relay, fogLevel) {
  const known = relay?.owner === 'player' || fogLevel === 2;
  return {
    known,
    owner: known ? relay?.owner ?? null : null,
    protocol: known ? relay?.protocol || 'shelter' : null,
  };
}
