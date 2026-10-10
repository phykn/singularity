import type { Result } from '../game/types.ts';
import {
  bestRecord,
  bestBeyondRecord,
  readRecord,
  readBeyondRecord,
  recordKey,
  beyondRecordKey,
  save,
} from './storage.ts';
import type { BestRecord, BeyondRecord } from './storage.ts';

type RecordKey = typeof recordKey | typeof beyondRecordKey;

export class ResultRecords {
  best: BestRecord | null = null;
  beyond: BeyondRecord | null = null;
  private pending = new Map<RecordKey, number>();
  private storage: () => Storage;
  private report: (key: string, ok: boolean) => void;
  private changed: () => void;

  constructor(
    storage: () => Storage,
    report: (key: string, ok: boolean) => void,
    changed: () => void,
  ) {
    this.storage = storage;
    this.report = report;
    this.changed = changed;
    try {
      const store = storage();
      this.best = readRecord(store);
      this.beyond = readBeyondRecord(store);
    } catch {
      /* Browser storage access can be unavailable. */
    }
  }

  record(result: Result, wall: number): void {
    this.persist(result.endless ? beyondRecordKey : recordKey, wall, result);
  }

  retry(wall: number): void {
    for (const [key, at] of this.pending) {
      if (wall - at >= 1000) this.persist(key, wall);
    }
  }

  private persist(key: RecordKey, wall: number, result?: Result): void {
    const best = this.best,
      beyond = this.beyond;
    if (result) {
      if (key === recordKey) this.best = bestRecord(this.best, result);
      else this.beyond = bestBeyondRecord(this.beyond, result);
    }
    let ok = false;
    try {
      const store = this.storage();
      if (key === recordKey) {
        const stored = readRecord(store);
        if (stored) this.best = bestRecord(this.best, stored);
        ok = save(store, key, this.best);
      } else {
        const stored = readBeyondRecord(store);
        if (stored) this.beyond = bestBeyondRecord(this.beyond, stored);
        ok = save(store, key, this.beyond);
      }
    } catch {
      /* Keep the best in memory and retry unavailable storage. */
    }
    if (ok) this.pending.delete(key);
    else this.pending.set(key, wall);
    this.report(key, ok);
    if (this.best !== best || this.beyond !== beyond) this.changed();
  }
}
