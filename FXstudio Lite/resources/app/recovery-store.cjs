'use strict';

const fs = require('node:fs');
const path = require('node:path');
const MAX_BYTES = 20 * 1024 * 1024;

function validate(record) {
  if (!record || record.version !== 1 || !record.project || !record.context ||
      !['effect', 'project'].includes(record.context.kind) ||
      typeof record.writerId !== 'string' || record.writerId.length > 100 ||
      !Number.isSafeInteger(record.sequence) || record.sequence < 1) {
    throw new Error('Неверный формат черновика');
  }
  const pr = record.project;
  if (typeof pr.id !== 'string' || !pr.id || !Array.isArray(pr.layers) || pr.layers.length > 4096 ||
      !pr.layers.every(layer => layer && typeof layer.fx === 'string' && layer.p && typeof layer.p === 'object') ||
      (record.context.kind === 'effect' && (!pr.layers.length || record.context.effectId !== pr.layers[0].fx))) {
    throw new Error('Неверный проект в черновике');
  }
  if (Buffer.byteLength(JSON.stringify(record), 'utf8') > MAX_BYTES) {
    throw new Error('Черновик превышает 20 МБ');
  }
  return record;
}

class RecoveryStore {
  constructor(folder) {
    this.folder = folder;
    this.latest = path.join(folder, 'draft.json');
    this.backup = path.join(folder, 'draft.previous.json');
  }

  read(file) {
    if (fs.statSync(file).size > MAX_BYTES) throw new Error('Слишком большой файл черновика');
    return validate(JSON.parse(fs.readFileSync(file, 'utf8')));
  }

  load() {
    let damaged = false;
    for (const [file, fromBackup] of [[this.latest, false], [this.backup, true]]) {
      try { return { draft: this.read(file), fromBackup, damaged }; }
      catch (error) { if (error.code !== 'ENOENT') damaged = true; }
    }
    return { draft: null, fromBackup: false, damaged };
  }

  writeAtomic(file, value) {
    const temporary = file + '.tmp';
    const fd = fs.openSync(temporary, 'w');
    try {
      fs.writeFileSync(fd, JSON.stringify(value));
      fs.fsyncSync(fd);
    } finally { fs.closeSync(fd); }
    fs.renameSync(temporary, file);
  }

  save(input) {
    validate(input);
    const previous = this.load().draft;
    // A late asynchronous save must never replace the final close-time snapshot.
    if (previous?.writerId === input.writerId && previous.sequence >= input.sequence) return previous;
    const record = { ...input, savedAt: Date.now() };
    validate(record);
    fs.mkdirSync(this.folder, { recursive: true });
    if (previous) this.writeAtomic(this.backup, previous);
    this.writeAtomic(this.latest, record);
    return record;
  }

  clear() {
    for (const file of [this.latest, this.backup, this.latest + '.tmp', this.backup + '.tmp']) {
      try { fs.unlinkSync(file); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  }
}

module.exports = { RecoveryStore, validate };
