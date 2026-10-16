import test from 'node:test';
import assert from 'node:assert/strict';
import { createTacticalFronts } from '../src/game/tacticalFronts.js';

const alert = (id, x, y, overrides = {}) => ({
  id, kind: 'damaged', defId: 'lightTank', priority: 1, x, y, ...overrides,
});

test('far alerts stay in separate simultaneous fronts', () => {
  const fronts = createTacticalFronts();
  const active = fronts.ingest([alert('a', 0, 0), alert('b', 20, 0)], 1);
  assert.equal(active.length, 2);
  assert.deepEqual(active.map(({ id }) => id), ['a', 'b']);
});

test('near alerts coalesce and count distinct entities rather than repeated hits', () => {
  const fronts = createTacticalFronts();
  fronts.ingest([alert('unit-a', 0, 0), alert('unit-a', 1, 0), alert('unit-b', 3, 0)], 1);
  const [front] = fronts.active(1);
  assert.equal(front.count, 2);
  assert.equal(front.id, 'unit-b');
});

test('a lost own asset upgrades its damage front', () => {
  const fronts = createTacticalFronts();
  fronts.ingest([alert('yard', 0, 0, { defId: 'command', priority: 5 })], 1);
  const [front] = fronts.ingest([alert('yard', 0, 0, { kind: 'lost', defId: 'command', priority: 5 })], 2);
  assert.equal(front.kind, 'lost');
  assert.equal(front.count, 1);
  assert.equal(front.until, 18);
});

test('same-priority nearby damage cannot overwrite a lost representative', () => {
  const fronts = createTacticalFronts();
  fronts.ingest([alert('dead-harvester', 0, 0, { defId: 'harvester', priority: 4 })], 1);
  fronts.ingest([alert('dead-harvester', 0, 0, { kind: 'lost', defId: 'harvester', priority: 4 })], 2);
  const [front] = fronts.ingest([alert('nearby-harvester', 1, 0,
    { defId: 'harvester', priority: 4 })], 3);
  assert.equal(front.kind, 'lost');
  assert.equal(front.id, 'dead-harvester');
});

test('expired high-priority loss clears while ongoing nearby damage keeps the front and live count', () => {
  const fronts = createTacticalFronts();
  fronts.ingest([alert('dead-yard', 0, 0,
    { kind: 'lost', defId: 'command', priority: 5 })], 1);
  fronts.ingest([alert('troop-a', 1, 0)], 2);
  const key = fronts.active(2)[0].key;
  fronts.ingest([alert('troop-b', 2, 0)], 13);
  const [front] = fronts.active(18);
  assert.equal(front.key, key);
  assert.equal(front.id, 'troop-b');
  assert.equal(front.kind, 'damaged');
  assert.equal(front.count, 1);
  assert.equal(front.until, 25);
});

test('near engineer sightings remain separate from own-force fronts', () => {
  const fronts = createTacticalFronts();
  const active = fronts.ingest([
    alert('damaged-unit', 0, 0),
    { id: 'engineer-sighting-1', kind: 'engineer', priority: 4,
      defId: 'engineer', x: 1, y: 0 },
  ], 1);
  assert.equal(active.length, 2);
  assert.deepEqual(active.map(({ kind }) => kind), ['engineer', 'damaged']);
});

test('distinct entity count is capped at the bounded id tracking limit', () => {
  const fronts = createTacticalFronts();
  const alerts = Array.from({ length: 65 }, (_, index) => alert(`unit-${index}`, 0, 0));
  alerts.push(alert('unit-64', 0, 0));
  const [front] = fronts.ingest(alerts, 1);
  assert.equal(front.count, 64);
});

test('a crowded front still prioritizes a newly damaged command yard', () => {
  const fronts=createTacticalFronts();
  fronts.ingest(Array.from({length:64},(_,i)=>alert(`troop-${i}`,0,0)),1);
  const [front]=fronts.ingest([alert('yard',1,0,{defId:'command',priority:5})],2);
  assert.equal(front.count,64);
  assert.equal(front.id,'yard');
});

test('engineer sightings are accepted and expiry does not move during active reads', () => {
  const fronts = createTacticalFronts();
  fronts.ingest([{ id: 'engineer-sighting-1', kind: 'engineer', priority: 4,
    defId: 'engineer', x: 8, y: 9 }], 2);
  assert.equal(fronts.active(13).length, 1);
  assert.equal(fronts.active(14).length, 0);
});

test('reset and reversed time clear prior fronts', () => {
  const fronts = createTacticalFronts();
  fronts.ingest([alert('old', 0, 0)], 10);
  assert.equal(fronts.ingest([alert('new', 20, 0)], 3).length, 1);
  assert.equal(fronts.active(3)[0].id, 'new');
  fronts.reset();
  assert.deepEqual(fronts.active(3), []);
});

test('focusNext cycles stable front keys and state remains bounded to four fronts', () => {
  const fronts = createTacticalFronts();
  fronts.ingest([alert('a', 0, 0, { priority: 5 }), alert('b', 20, 0, { priority: 4 }),
    alert('c', 40, 0, { priority: 3 }), alert('d', 60, 0, { priority: 2 }),
    alert('e', 80, 0, { priority: 1 })], 1);
  const entries = fronts.active(1);
  assert.equal(entries.length, 4);
  assert.deepEqual(entries.map(({ id }) => id), ['a', 'b', 'c', 'd']);
  const first = fronts.focusNext(1);
  const second = fronts.focusNext(1);
  assert.equal(first.id, 'a');
  assert.equal(second.id, 'b');
  assert.equal(fronts.focusNext(1).key, entries[2].key);
  assert.equal(fronts.focusNext(1).key, entries[3].key);
  assert.equal(fronts.focusNext(1).key, first.key);
});
