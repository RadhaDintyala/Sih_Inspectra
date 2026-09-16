export type LiveDetectionState = {
  productName: string | null;
  manufacturer: string | null;
  netQuantity: string | null;
  mrp: string | null;
  date: string | null;
  consumerCare: string | null;
  countryOfOrigin: string | null;
  unitSalePrice: string | null;
  productNameEvidence: FieldEvidence | null;
  manufacturerEvidence: FieldEvidence | null;
  netQuantityEvidence: FieldEvidence | null;
  mrpEvidence: FieldEvidence | null;
  dateEvidence: FieldEvidence | null;
  consumerCareEvidence: FieldEvidence | null;
  countryOfOriginEvidence: FieldEvidence | null;
  unitSalePriceEvidence: FieldEvidence | null;
  timestamp: number;
};

export type FieldEvidence = {
  value: string;
  rawValue: string;
  confidence: number;
  bbox: BoundingBox;
  polygon?: number[][];
  source: string;
};

export type BoundingBox = { x: number; y: number; width: number; height: number };

export type OcrPolygon = number[][];

export interface DetectionResult {
  packageDetected: boolean;
  packageConfidence: number;
  packageBbox?: BoundingBox;
  packagePolygon?: OcrPolygon;
  declarations: LiveDeclaration[];
  rawOcrText: string;
  inferenceMs: number;
}

export interface LiveDeclaration {
  field: string;
  value: string | null;
  rawValue: string;
  status: "DETECTED" | "NOT_DETECTED";
  confidence: number | null;
  bbox?: BoundingBox;
  polygon?: OcrPolygon;
  evidence?: { rawText: string; boundingBox?: BoundingBox; polygon?: OcrPolygon };
}

export interface OcrLineResult {
  text: string;
  confidence: number;
  bbox: BoundingBox;
  polygon?: number[][];
}

export interface LiveInferenceResult {
  success: boolean;
  detection: DetectionResult | null;
  error?: string;
  elapsedMs: number;
}

export const TARGET_FIELDS = [
  "product_name", "manufacturer", "net_quantity", "mrp",
  "date", "consumer_care", "country_of_origin", "unit_sale_price",
] as const;

export const FIELD_LABELS: Record<string, string> = {
  product_name: "PRODUCT NAME",
  manufacturer: "MANUFACTURER",
  net_quantity: "NET QUANTITY",
  mrp: "MRP",
  date: "DATE",
  consumer_care: "CONSUMER CARE",
  country_of_origin: "COUNTRY OF ORIGIN",
  unit_sale_price: "UNIT SALE PRICE",
};

export function emptyDetectionState(): LiveDetectionState {
  return {
    productName: null, manufacturer: null, netQuantity: null, mrp: null,
    date: null, consumerCare: null, countryOfOrigin: null, unitSalePrice: null,
    productNameEvidence: null, manufacturerEvidence: null, netQuantityEvidence: null,
    mrpEvidence: null, dateEvidence: null, consumerCareEvidence: null,
    countryOfOriginEvidence: null, unitSalePriceEvidence: null,
    timestamp: 0,
  };
}

export function updateDetectionState(
  prev: LiveDetectionState,
  detection: DetectionResult
): LiveDetectionState {
  const state = { ...prev, timestamp: Date.now() };
  for (const decl of detection.declarations) {
    if (decl.value && decl.status === "DETECTED") {
      const evidence: FieldEvidence = {
        value: decl.value,
        rawValue: decl.rawValue ?? decl.value,
        confidence: decl.confidence ?? 0,
        bbox: decl.bbox ?? { x: 0, y: 0, width: 0, height: 0 },
        polygon: decl.polygon,
        source: decl.evidence?.rawText ?? decl.value,
      };
      switch (decl.field) {
        case "product_name": state.productName = decl.value; state.productNameEvidence = evidence; break;
        case "manufacturer": state.manufacturer = decl.value; state.manufacturerEvidence = evidence; break;
        case "net_quantity": state.netQuantity = decl.value; state.netQuantityEvidence = evidence; break;
        case "mrp": state.mrp = decl.value; state.mrpEvidence = evidence; break;
        case "date": state.date = decl.value; state.dateEvidence = evidence; break;
        case "consumer_care": state.consumerCare = decl.value; state.consumerCareEvidence = evidence; break;
        case "country_of_origin": state.countryOfOrigin = decl.value; state.countryOfOriginEvidence = evidence; break;
        case "unit_sale_price": state.unitSalePrice = decl.value; state.unitSalePriceEvidence = evidence; break;
      }
    }
  }
  return state;
}

export function stateHasAnyDetection(state: LiveDetectionState): boolean {
  return TARGET_FIELDS.some((f) => {
    const key = f as keyof LiveDetectionState;
    return state[key] != null && (state[key] as string).length > 0;
  });
}
