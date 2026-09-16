import type { Inspection } from "@/domain/inspection";

const STORAGE_KEY = "sih-26034-inspections";

export interface InspectionRepository {
  list(): Inspection[];
  save(inspection: Inspection): void;
}

export class LocalInspectionRepository implements InspectionRepository {
  list() {
    if (typeof window === "undefined") return [];
    try {
      return JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "[]") as Inspection[];
    } catch {
      return [];
    }
  }

  save(inspection: Inspection) {
    if (typeof window === "undefined") return;
    const inspections = [inspection, ...this.list().filter((item) => item.id !== inspection.id)].slice(0, 20);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(inspections));
  }
}

export function buildReport(inspection: Inspection) {
  return {
    title: "Packaged Commodities Inspection Report",
    inspectionId: inspection.id,
    createdAt: inspection.createdAt,
    product: inspection.productName || "Unnamed commodity",
    outcome: inspection.status.toUpperCase(),
    findings: inspection.checks,
    declarations: inspection.declarations,
    evidence: inspection.images,
  };
}