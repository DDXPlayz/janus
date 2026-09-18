// Sync engine for JANUS.
//
// While offline (or simulated offline) every progress/result write is also
// appended to the `syncQueue` store. When the connection returns, the queue is
// pushed to a SyncTarget. There is no server in this deployment, so the only
// target is LocalMirrorTarget, which copies records into a separate IndexedDB
// store ("synced") and records lastSyncedAt. The UI says so explicitly.

import { db } from './db.js';
import { isOnline, onConnectionChange, getConnection } from './net.js';

/**
 * SyncTarget interface:
 *   name: string                      — shown in the UI
 *   description: string               — what it actually does
 *   push(items: SyncItem[]) => Promise<{accepted: number[], rejected: {id, reason}[]}>
 *   status() => Promise<object>       — free-form info for the UI
 * A real HTTP target would POST the items and return the accepted ids.
 */
export class LocalMirrorTarget {
  constructor() {
    this.name = 'Local mirror';
    this.description = 'No server is connected in this deployment, so "sync" copies each queued record into a separate IndexedDB store called "synced" on this device. Swapping in an HTTP target would send the same records to a school server.';
  }
  async push(items) {
    const accepted = [];
    const rejected = [];
    for (const it of items) {
      try {
        await db.add('synced', { queueId: it.id, type: it.type, payload: it.payload, queuedAt: it.ts, syncedAt: Date.now() });
        accepted.push(it.id);
      } catch (e) {
        rejected.push({ id: it.id, reason: String(e && e.message || e) });
      }
    }
    return { accepted, rejected };
  }
  async status() {
    let count = 0;
    try { count = await db.count('synced'); } catch (e) { /* ignore */ }
    return { mirroredRecords: count };
  }
}

const listeners = new Set();
function emit(s) { for (const fn of listeners) { try { fn(s); } catch (e) { console.error(e); } } }

export class SyncEngine {
  constructor(target) {
    this.target = target;
    this.syncing = false;
    this.lastResult = null;
    this.lastError = null;
    this._unsub = null;
  }
  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

  async enqueue(type, payload) {
    try {
      await db.add('syncQueue', { type, payload, ts: Date.now() });
    } catch (e) { console.warn('Could not enqueue for sync', e); }
    emit(await this.status());
    // Opportunistic sync when online. Short debounce so bursts coalesce.
    if (isOnline()) { clearTimeout(this._t); this._t = setTimeout(() => this.syncNow('auto'), 800); }
  }

  async queueLength() { try { return await db.count('syncQueue'); } catch (e) { return 0; } }

  async status() {
    const [queued, lastSyncedAt, targetStatus] = await Promise.all([
      this.queueLength(), db.getMeta('lastSyncedAt', null), this.target.status(),
    ]);
    const conn = getConnection();
    return {
      queued, lastSyncedAt, targetStatus, syncing: this.syncing,
      targetName: this.target.name, targetDescription: this.target.description,
      online: conn.online, simulated: conn.simulated,
      lastResult: this.lastResult, lastError: this.lastError,
    };
  }

  async syncNow(reason = 'manual') {
    if (this.syncing) return this.status();
    if (!isOnline()) {
      this.lastError = 'Cannot sync while offline. Records stay queued on this device.';
      const s = await this.status(); emit(s); return s;
    }
    this.syncing = true; this.lastError = null; emit(await this.status());
    try {
      const items = await db.getAll('syncQueue');
      if (items.length) {
        const res = await this.target.push(items);
        if (res.accepted.length) await db.deleteMany('syncQueue', res.accepted);
        this.lastResult = { at: Date.now(), pushed: res.accepted.length, rejected: res.rejected.length, reason };
        if (res.rejected.length) this.lastError = res.rejected.length + ' record(s) were rejected by the target.';
      } else {
        this.lastResult = { at: Date.now(), pushed: 0, rejected: 0, reason };
      }
      await db.setMeta('lastSyncedAt', Date.now());
    } catch (e) {
      this.lastError = 'Sync failed: ' + (e && e.message ? e.message : e);
    } finally {
      this.syncing = false;
    }
    const s = await this.status(); emit(s); return s;
  }

  start() {
    if (this._unsub) return;
    this._unsub = onConnectionChange(async (c) => {
      if (c.online && (await this.queueLength()) > 0) this.syncNow('connection restored');
      else emit(await this.status());
    });
    // Try once at start-up in case records were left over from a previous session.
    setTimeout(async () => { if (isOnline() && (await this.queueLength()) > 0) this.syncNow('startup'); }, 1500);
  }
}

export const syncEngine = new SyncEngine(new LocalMirrorTarget());
