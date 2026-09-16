import type { Declaration } from "@/domain/inspection";

/** Synthetic TEST DATA only. These are not official package images or OCR. */
export const clearPackageDeclarations: Declaration[] = [
  { field: "product_name", value: "Test Tea", status: "DETECTED", confidence: 0.98, evidenceImageId: "test-front" },
  { field: "manufacturer", value: "Test Foods Pvt Ltd, 1 Test Road, Delhi", status: "DETECTED", confidence: 0.95, evidenceImageId: "test-back" },
  { field: "net_quantity", value: "500 g", status: "DETECTED", confidence: 0.97, evidenceImageId: "test-front" },
  { field: "mrp", value: "₹120.00", status: "DETECTED", confidence: 0.97, evidenceImageId: "test-front", evidence: { rawText: "M.R.P. ₹120.00 (INCL. OF ALL TAXES)" } },
  { field: "date", value: "06/2026", status: "DETECTED", confidence: 0.96, evidenceImageId: "test-back" },
  { field: "consumer_care", value: "1800 111 2222", status: "DETECTED", confidence: 0.95, evidenceImageId: "test-back" },
];

export const blurryPackageDeclarations: Declaration[] = [
  { field: "mrp", value: null, status: "UNCERTAIN", confidence: null, evidenceImageId: "test-blurry" },
];