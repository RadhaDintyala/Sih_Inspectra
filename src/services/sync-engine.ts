/**
 * Automatic Re-verification Sync Engine
 *
 * Listens for browser `online` event and runs a 60-second background heartbeat timer.
 * Synchronizes client-side IndexedDB `pending_sync` records with the official
 * server pipeline (package gate → YOLO → regional OCR → compliance engine)
 * upon network reconnection.
 *
 * Preserves original offline-provisional findings in notes/audit trail on re-verification.
 */

import { getPendingSyncRecords, updateLocalQueueRecord, type QueueRecord } from "./local-queue";
import type { Inspection } from "@/domain/inspection";

export interface SyncEngineCallbacks {
  onRecordSynced?: (syncedInspection: Inspection, originalRecord: QueueRecord) => void;
  onSyncStatusChange?: (isSyncing: boolean) => void;
}

let syncIntervalId: ReturnType<typeof setInterval> | null = null;
let isSyncing = false;

export async function processPendingSyncQueue(callbacks?: SyncEngineCallbacks): Promise<number> {
  if (isSyncing) return 0;
  if (typeof window !== "undefined" && !navigator.onLine) return 0;

  const pending = await getPendingSyncRecords();
  if (!pending.length) return 0;

  isSyncing = true;
  callbacks?.onSyncStatusChange?.(true);
  let syncedCount = 0;

  console.log(`[SyncEngine] Processing ${pending.length} pending_sync record(s) for pipeline re-verification...`);

  for (const record of pending) {
    try {
      // Re-run extraction on server
      const formData = new FormData();
      // If image URI exists or image buffer is attached
      if (record.inspection.images[0]?.uri) {
        // Fetch original blob if cached or recreate image form data
        const blob = await fetch(record.inspection.images[0].uri).then((r) => r.blob()).catch(() => null);
        if (blob) {
          formData.append("image", blob, "evidence-reverify.jpg");
          formData.append("side", record.inspection.images[0].side || "front");
        }
      }

      const res = await fetch("/api/scan", {
        method: "POST",
        body: formData,
      });

      if (res.ok) {
        const data = await res.json();
        if (data.inspection) {
          const updatedInspection: Inspection = {
            ...data.inspection,
            id: record.inspection.id, // Preserve original record ID
            notes: [
              ...(data.inspection.notes || []),
              `RE_VERIFIED_ON_RECONNECT: Official pipeline re-verification completed at ${new Date().toISOString()}.`,
              `OFFLINE_AUDIT_TRAIL: Original local OCR detected ${record.originalOfflineDeclarations?.filter((d) => d.value).length || 0} fields.`,
            ],
          };

          await updateLocalQueueRecord(record.inspection.id, updatedInspection, "final");
          syncedCount++;
          callbacks?.onRecordSynced?.(updatedInspection, record);
          console.log(`[SyncEngine] Re-verified ${record.inspection.id} successfully.`);
        }
      }
    } catch (err) {
      console.warn(`[SyncEngine] Re-verification failed for ${record.inspection.id}:`, err);
    }
  }

  isSyncing = false;
  callbacks?.onSyncStatusChange?.(false);
  return syncedCount;
}

export function startSyncEngine(callbacks?: SyncEngineCallbacks): () => void {
  if (typeof window === "undefined") return () => {};

  const handleOnline = () => {
    console.log("[SyncEngine] Browser online event detected. Triggering queue sync...");
    processPendingSyncQueue(callbacks);
  };

  window.addEventListener("online", handleOnline);

  // Periodic 60-second fallback heartbeat
  syncIntervalId = setInterval(() => {
    processPendingSyncQueue(callbacks);
  }, 60_000);

  // Initial trigger
  processPendingSyncQueue(callbacks);

  return () => {
    window.removeEventListener("online", handleOnline);
    if (syncIntervalId) {
      clearInterval(syncIntervalId);
      syncIntervalId = null;
    }
  };
}
