import type { Declaration, EvidenceImage } from "@/domain/inspection";

export type ExtractionInput = {
  /** Uploaded image bytes (required for server-side adapters) */
  imageBuffer?: Buffer;
  /** Original filename — used to infer MIME type */
  filename?: string;
  /** Public URI to display in the UI */
  imageUri?: string;
  side?: EvidenceImage["side"];
  /** AbortSignal for request cancellation / timeout */
  signal?: AbortSignal;
};

export type ExtractionResult = {
  image: EvidenceImage;
  declarations: Declaration[];
  /** Full raw OCR/LLM text output — stored for audit trail */
  rawOcrText?: string;
};

export type MultiImageExtractionResult = {
  images: EvidenceImage[];
  declarations: Declaration[];
  rawOcrText?: string;
};

export type ExtractionSourceType =
  | "local_offline_ocr"
  | "YOLO + Regional OCR"
  | string;

export interface ExtractionAdapter {
  readonly extractionSource: ExtractionSourceType;
  extract(input: ExtractionInput): Promise<ExtractionResult>;
  extractMany?(inputs: ExtractionInput[]): Promise<MultiImageExtractionResult>;
}

export function mergeDeclarations(declarations: Declaration[]): Declaration[] {
  const grouped = new Map<Declaration["field"], Declaration[]>();
  for (const declaration of declarations) {
    const entries = grouped.get(declaration.field) ?? [];
    entries.push(declaration);
    grouped.set(declaration.field, entries);
  }

  return [...grouped.values()].map((entries) => {
    const nonEmpty = entries.filter((entry) => entry.value?.trim());
    const distinctValues = [...new Set(nonEmpty.map((entry) => entry.value!.trim().toLowerCase()))];
    
    const evidenceImageIds = [...new Set(entries.flatMap((entry) => [entry.evidenceImageId, ...(entry.evidenceImageIds ?? [])].filter(Boolean) as string[]))];

    if (distinctValues.length <= 1) {
      // Pick the non-empty entry with the highest confidence, or fallback to the first entry
      const sortedNonEmpty = [...nonEmpty].sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
      const bestEntry = sortedNonEmpty[0] ?? entries[0];
      return {
        ...bestEntry,
        status: bestEntry.value ? "DETECTED" : "NOT_DETECTED",
        evidenceImageId: bestEntry.evidenceImageId ?? evidenceImageIds[0],
        evidenceImageIds,
        conflict: false,
      };
    }

    // Check if distinct values originate from multiple genuinely DIFFERENT source images
    const distinctImages = new Set(nonEmpty.map((e) => e.evidenceImageId).filter(Boolean));

    // When all distinct candidate matches originate within a SINGLE image (or image count <= 1):
    // Resolve within-image multiple candidates by taking the highest-confidence match.
    // CONFLICT is reserved STRICTLY for genuine cross-image disagreement.
    if (distinctImages.size <= 1) {
      const sortedNonEmpty = [...nonEmpty].sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
      const bestEntry = sortedNonEmpty[0] ?? entries[0];
      return {
        ...bestEntry,
        status: bestEntry.value ? "DETECTED" : "NOT_DETECTED",
        evidenceImageId: bestEntry.evidenceImageId ?? evidenceImageIds[0],
        evidenceImageIds,
        candidates: nonEmpty.map((entry) => ({ value: entry.value!, sourceImageId: entry.evidenceImageId, rawValue: entry.rawValue })),
        conflict: false,
      };
    }

    // Genuine cross-image disagreement across 2+ distinct images
    const minConfidence = Math.min(...nonEmpty.map((entry) => entry.confidence ?? 0));
    return {
      ...entries[0],
      value: nonEmpty.map((entry) => entry.value!).join(" | "),
      rawValue: nonEmpty.map((entry) => entry.rawValue ?? entry.value).join(" | "),
      confidence: minConfidence,
      status: "CONFLICT",
      evidenceImageId: evidenceImageIds[0],
      evidenceImageIds,
      candidates: nonEmpty.map((entry) => ({ value: entry.value!, sourceImageId: entry.evidenceImageId, rawValue: entry.rawValue })),
      conflict: true,
    };
  });
}

/**
 * REMOVED: the former synthetic fixture adapter lived here. It returned
 * hardcoded declarations ("Harvest Gold…", "₹128.00") with invented bounding
 * boxes and confidence — incompatible with an enforcement platform. The
 * official pipeline (package gate → detection → regional OCR) is the only
 * extraction path; integration tests exercise it with real synthetic
 * package images instead of asserting fabricated values.
 */
