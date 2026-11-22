'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { RecoveryStore } = require('../recovery-store.cjs');

function setup(t) {
  const base = path.resolve(__dirname, '../tmp');
  fs.mkdirSync(base, { recursive: true });
  const folder = fs.mkdtempSync(path.join(base, 'recovery-test-'));
  t.after(() => {
    const target = path.resolve(folder);
    assert(target.startsWith(base + path.sep + 'recovery-test-'));
    fs.rmSync(target, { recursive: true, force: true });
  });
  return new RecoveryStore(folder);
}
function record(sequence = 1, writerId = 'test-session') {
  return { version: 1, writerId, sequence,
    project: { id: 'project-1', name: 'Мой черновик', wide: true, dur: 7.25,
      scene: { bg: 'u:image-1' }, layers: [{ id: 'layer-1', fx: 'rain', p: { image: 'u:image-1', count: sequence } }] },
    context: { kind: 'effect', effectId: 'rain', time: 2.75, mode: 'checker' } };
}

test('empty store has no recovery and no damage warning', t => {
  assert.deepEqual(setup(t).load(), { draft: null, fromBackup: false, damaged: false });
});
test('round trip preserves nested settings, IDs, resources and playhead', t => {
  const store = setup(t), input = record();
  const saved = store.save(input);
  assert(saved.savedAt > 0);
  assert.deepEqual(store.load().draft, saved);
  assert.deepEqual(saved.project, input.project);
  assert.deepEqual(saved.context, input.context);
  assert.equal(input.savedAt, undefined);
});
test('truncated latest snapshot recovers the previous committed version', t => {
  const store = setup(t);
  store.save(record(1)); store.save(record(2));
  fs.writeFileSync(store.latest, '{"version":');
  const result = store.load();
  assert.equal(result.fromBackup, true);
  assert.equal(result.damaged, true);
  assert.equal(result.draft.sequence, 1);
  store.save(record(3));
  assert.equal(store.load().draft.sequence, 3);
  assert.equal(store.read(store.backup).sequence, 1);
});
test('invalid or oversized input leaves both valid snapshots intact', t => {
  const store = setup(t);
  store.save(record(1)); store.save(record(2));
  for (const broken of [null, { ...record(3), version: 2 }, { ...record(3), project: { layers: [] } },
    { ...record(3), context: { kind: 'effect', effectId: 'missing' } }]) {
    assert.throws(() => store.save(broken));
  }
  const huge = record(3); huge.project.name = 'x'.repeat(20 * 1024 * 1024);
  assert.throws(() => store.save(huge), /20 МБ/);
  assert.equal(store.load().draft.sequence, 2);
  assert.equal(store.read(store.backup).sequence, 1);
});
test('late asynchronous writes cannot overwrite a newer final save', t => {
  const store = setup(t);
  store.save(record(8)); store.save(record(6));
  assert.equal(store.load().draft.sequence, 8);
  store.save(record(1, 'next-launch'));
  assert.equal(store.load().draft.writerId, 'next-launch');
});
test('interrupted replacement keeps a readable committed snapshot', t => {
  const store = setup(t); store.save(record(1));
  const write = store.writeAtomic.bind(store);
  store.writeAtomic = (file, value) => { if (file === store.latest) throw Error('simulated disk failure'); write(file, value); };
  assert.throws(() => store.save(record(2)), /disk failure/);
  assert.equal(store.load().draft.sequence, 1);
});
test('unreadable snapshots report damage without deleting their contents', t => {
  const store = setup(t);
  fs.writeFileSync(store.latest, 'broken-latest');
  fs.writeFileSync(store.backup, 'broken-backup');
  assert.deepEqual(store.load(), { draft: null, fromBackup: false, damaged: true });
  assert.equal(fs.readFileSync(store.latest, 'utf8'), 'broken-latest');
});
test('clear removes only recovery files and their temporary siblings', t => {
  const store = setup(t); store.save(record(1)); store.save(record(2));
  fs.writeFileSync(store.latest + '.tmp', 'unfinished');
  fs.writeFileSync(path.join(store.folder, 'unrelated.txt'), 'keep');
  store.clear();
  assert.equal(store.load().draft, null);
  assert.equal(fs.readFileSync(path.join(store.folder, 'unrelated.txt'), 'utf8'), 'keep');
});
