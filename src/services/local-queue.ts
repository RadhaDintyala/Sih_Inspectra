/**
 * Client-Side IndexedDB Queue Service for Local-First Inspection Capture
 *
 * Persists all inspection records locally first before server sync.
 * Records are marked with syncStatus: "final" (cloud extraction completed)
 * or "pending_sync" (local OCR provisional capture awaiting network re-verification).
 */

import type { Inspection } from "@/domain/inspection";

export type SyncStatus = "final" | "pending_sync";

export interface QueueRecord {
  inspection: Inspection;
  syncStatus: SyncStatus;
  capturedAt: string;
  originalOfflineDeclarations?: Inspection["declarations"];
}

const DB_NAME = "InspectraLocalQueueDB";
const STORE_NAME = "inspections";
const DB_VERSION = 1;

function openQueueDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined" || !window.indexedDB) {
      reject(new Error("IndexedDB is not available in this environment."));
      return;
    }

    const req = window.indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "inspection.id" });
        store.createIndex("syncStatus", "syncStatus", { unique: false });
        store.createIndex("capturedAt", "capturedAt", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveToLocalQueue(
  inspection: Inspection,
  syncStatus: SyncStatus = "final",
): Promise<QueueRecord> {
  const record: QueueRecord = {
    inspection,
    syncStatus,
    capturedAt: new Date().toISOString(),
    originalOfflineDeclarations: syncStatus === "pending_sync" ? inspection.declarations : undefined,
  };

  try {
    const db = await openQueueDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(record);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn("[LocalQueue] IndexedDB write fallback warning:", err);
  }

  return record;
}

export async function getPendingSyncRecords(): Promise<QueueRecord[]> {
  try {
    const db = await openQueueDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => {
        const records = (req.result as QueueRecord[]) || [];
        resolve(records.filter((r) => r.syncStatus === "pending_sync"));
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}

export async function getAllLocalQueueRecords(): Promise<QueueRecord[]> {
  try {
    const db = await openQueueDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => resolve((req.result as QueueRecord[]) || []);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}

export async function updateLocalQueueRecord(
  inspectionId: string,
  updatedInspection: Inspection,
  newSyncStatus: SyncStatus = "final",
): Promise<void> {
  try {
    const db = await openQueueDB();
    const existing = await new Promise<QueueRecord | null>((resolve) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(inspectionId);
      req.onsuccess = () => resolve((req.result as QueueRecord) || null);
      req.onerror = () => resolve(null);
    });

    const record: QueueRecord = {
      inspection: updatedInspection,
      syncStatus: newSyncStatus,
      capturedAt: existing?.capturedAt ?? new Date().toISOString(),
      originalOfflineDeclarations: existing?.originalOfflineDeclarations ?? existing?.inspection.declarations,
    };

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(record);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn("[LocalQueue] IndexedDB update warning:", err);
  }
}
