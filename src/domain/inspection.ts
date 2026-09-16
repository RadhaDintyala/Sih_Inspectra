export type InspectionStatus =
  | "processing"
  | "pass"
  | "fail"
  | "review"
  | "invalid_evidence"
  | "incomplete";

/** Official enforcement verdict rendered from backend data only. */
export type InspectionVerdict =
  | "COMPLIANT"
  | "NON_COMPLIANT"
  | "REQUIRES_REVIEW"
  | "INVALID_EVIDENCE"
  | "INCOMPLETE"
  | "PROCESSING";
export type CheckStatus = "pass" | "fail" | "review" | "not_applicable" | "not_evaluated";

export type DeclarationField =
  | "product_name"
  | "manufacturer"
  | "net_quantity"
  | "mrp"
  | "date"
  | "consumer_care"
  | "country_of_origin"
  | "unit_sale_price"
  | "dimensions"
  | "best_before"
  | "batch_number"
  | "other";

export type ExtractionStatus =
  | "DETECTED"
  | "VERIFIED"
  | "NOT_DETECTED"
  | "UNCERTAIN"
  | "CONFLICT"
  | "NOT_APPLICABLE";

export type BoundingBox = { x: number; y: number; width: number; height: number };

export type OcrPolygon = number[][];

export type EvidenceDetection = {
  id: string;
  className: string;
  bbox: BoundingBox;
  polygon?: OcrPolygon;
  confidence: number;
  detector: string;
  modelVersion: string;
};

export type EvidenceImage = {
  id: string;
  inspectionId?: string;
  storageKey?: string;
  uri: string;
  label?: string;
  side?: "front" | "back" | "side" | "top" | "unknown";
  width: number;
  height: number;
  checksum?: string;
  capturedAt?: string;
  sourceCamera?: string;
  imageOrder?: number;
  quality?: "sufficient" | "insufficient" | "unknown";
  qualitySignal?: {
    blurDetected?: boolean;
    glareDetected?: boolean;
    cropDetected?: boolean;
    legibilityScore?: number;
  };
  processingStatus?: "UPLOADING" | "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED";
  packageDetected?: boolean;
  packageConfidence?: number | null;
  detections?: EvidenceDetection[];
  filename?: string;
};

export type ConsumerCareDetails = {
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  address?: string | null;
};

export type Declaration = {
  field: DeclarationField;
  value: string | null;
  rawValue?: string;
  status: ExtractionStatus;
  confidence: number | null;
  evidenceImageId?: string;
  evidenceImageIds?: string[];
  candidates?: Array<{ value: string; sourceImageId?: string; rawValue?: string }>;
  evidence?: { rawText: string; boundingBox?: BoundingBox; polygon?: OcrPolygon };
  boundingBox?: BoundingBox;
  polygon?: OcrPolygon;
  sourceSide?: EvidenceImage["side"];
  conflict?: boolean;
  consumerCareDetails?: ConsumerCareDetails;
  legalRules?: string[];
};

export type ValidationType =
  | "presence"
  | "format"
  | "measurement"
  | "category_scope"
  | "declaration_presence"
  | "declaration_content"
  | "declaration_format"
  | "placement"
  | "principal_display_panel"
  | "character_height"
  | "readability"
  | "contrast"
  | "quantity_unit"
  | "quantity"
  | "mrp"
  | "mrp_validation"
  | "date"
  | "date_validation"
  | "address"
  | "manufacturer_address"
  | "origin"
  | "country_of_origin"
  | "consumer_care"
  | "consumer_care_format"
  | "unit_price"
  | "unit_sale_price"
  | "product_specific"
  | "physical_verification"
  | "physical_quantity"
  | "conflict_detection"
  | "conflicting_declarations"
  | "misleading"
  | "misleading_declarations"
  | "officer_verification"
  | "manual_officer_verification";

export type PhysicalMeasurement = {
  field: string;
  declaredValue: string;
  measuredValue: string | null;
  unit: string;
  permissibleError: string | null;
  withinTolerance: boolean | null;
  measuredBy?: string;
  measuredAt?: string;
  instrumentId?: string;
};

export type ComplianceCheck = {
  ruleId: string;
  field: string;
  status: CheckStatus;
  severity?: "critical" | "major" | "minor";
  evidence?: string;
  explanation: string;
  confidence?: number | null;
  evidenceImageId?: string;
  boundingBox?: BoundingBox;
  polygon?: OcrPolygon;
  sourceDocument?: string;
  sourceUrl?: string;
  sourceSection?: string;
  validationType?: ValidationType;
  officerVerification?: "ACCEPTED" | "CORRECTED" | "MARKED_UNREADABLE" | "MARKED_UNAVAILABLE" | null;
  officerNote?: string;
};

export type InspectionProcessingStatus =
  | "CREATED"
  | "UPLOADING"
  | "QUEUED"
  | "PROCESSING"
  | "DETECTING_PACKAGE"
  | "DETECTING_DECLARATIONS"
  | "OCR_PROCESSING"
  | "EXTRACTING_FIELDS"
  | "VALIDATING"
  | "COMPLIANCE_ANALYSIS"
  | "COMPLETED"
  | "REVIEW_REQUIRED"
  | "FAILED"
  | "INVALID_EVIDENCE";

export type InspectionTimelineEvent = {
  at: string;
  stage: string;
  status: "SUCCESS" | "PENDING" | "FAILED" | "SKIPPED";
  detail?: string;
  durationMs?: number;
};

export type InspectionSource = "camera" | "upload" | "live_feed" | "ecommerce";

export type Inspection = {
  id: string;
  organizationId?: string;
  userId?: string;
  createdAt: string;
  updatedAt?: string;
  productId?: string;
  productName?: string;
  status: InspectionStatus;
  verdict?: InspectionVerdict;
  processingStatus?: InspectionProcessingStatus | "DETECTING" | "EXTRACTING";
  images: EvidenceImage[];
  declarations: Declaration[];
  checks: ComplianceCheck[];
  notes: string[];
  rawOcrText?: string;
  sourceDocumentIds?: string[];
  extractionSource?: "YOLO + Regional OCR" | string;
  score?: number | null;
  source?: InspectionSource;
  physicalMeasurements?: PhysicalMeasurement[];
  ecommerceUrl?: string;
  ecommerceProduct?: EcommerceProductData;
  processing?: {
    totalMs: number;
    extractionMs: number;
    rulesMs: number;
  };
  timeline?: InspectionTimelineEvent[];
};

export type EcommerceProductData = {
  url?: string;
  platform?: string;
  title?: string;
  description?: string;
  price?: string;
  mrp?: string;
  manufacturer?: string;
  countryOfOrigin?: string;
  netQuantity?: string;
  imageUrl?: string;
  screenshotHtml?: string;
};

export type AnalysisPhase = "image" | "text" | "declarations" | "rules" | "complete";
