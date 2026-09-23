"use client";

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Clock,
  Edit3,
  FileDown,
  FileText,
  Globe,
  Layers,
  Mail,
  MapPin,
  Phone,
  ShieldCheck,
  X,
  XCircle,
  Eye,
  Camera,
} from "lucide-react";
import type { ComplianceCheck, Declaration, Inspection, EvidenceImage, DeclarationField } from "@/domain/inspection";
import { RULES } from "@/domain/rules";
import { formatDate } from "@/components/utils";
import { ReportModal } from "@/components/ReportModal";
import type { UserRole } from "@/context/RoleContext";
import { LabelChangeComparison } from "@/components/LabelChangeComparison";


interface ResultViewProps {
  role?: UserRole;
  inspection: Inspection;
  counts: { pass: number; fail: number; review: number };
  selectedCheck: ComplianceCheck | null;
  onSelect: (check: ComplianceCheck) => void;
  onReport: () => void;
  reportOpen: boolean;
  onCloseReport: () => void;
  onInspectionUpdated?: (updated: Inspection) => void;
}

const FIELD_LABELS: Record<string, string> = {
  product_name: "",
  mrp: "MRP",
  net_quantity: "Net Quantity",
  date: "Date of Mfg / Packing",
  manufacturer: "Manufacturer / Packer",
  consumer_care: "Consumer Care",
  country_of_origin: "Country of Origin",
  unit_sale_price: "Unit Sale Price",
  dimensions: "Dimensions",
  best_before: "Best Before",
  batch_number: "Batch No.",
  wholesale: "Wholesale Declarations",
  quantity_inspection: "Physical Weighing",
};

function VerdictPill({ status }: { status: string }) {
  if (status === "pass") return <span className="rv-pill rv-pill-pass"><ShieldCheck size={14} /> Compliant</span>;
  if (status === "fail") return <span className="rv-pill rv-pill-fail"><XCircle size={14} /> Non-Compliant</span>;
  if (status === "invalid_evidence") return <span className="rv-pill rv-pill-invalid">Invalid Evidence</span>;
  return <span className="rv-pill rv-pill-review"><AlertTriangle size={14} /> Needs Review</span>;
}

function ComplianceBadge({ status }: { status: string }) {
  if (status === "pass") return <span className="rv-badge rv-badge-pass">Pass</span>;
  if (status === "fail") return <span className="rv-badge rv-badge-fail">Fail</span>;
  if (status === "review") return <span className="rv-badge rv-badge-review">Review</span>;
  if (status === "not_applicable") return <span className="rv-badge rv-badge-applicable">N/A</span>;
  if (status === "not_evaluated") return <span className="rv-badge rv-badge-evaluated">Not Evaluated</span>;
  return null;
}

function FieldCard({
  decl,
  images,
  check,
  isSelected,
  onSelect,
  onImageSelect,
  onVerify,
}: {
  decl: Declaration;
  images: EvidenceImage[];
  check?: ComplianceCheck;
  isSelected?: boolean;
  onSelect: (decl: Declaration) => void;
  onImageSelect: (idx: number) => void;
  onVerify: (decl: Declaration) => void;
}) {
  const srcIdx = images.findIndex((img) => img.id === decl.evidenceImageId || decl.evidenceImageId?.includes(img.id));
  const srcImg = srcIdx >= 0 ? images[srcIdx] : undefined;
  const hasValue = !!decl.value;
  const label = FIELD_LABELS[decl.field] || decl.field.replace(/_/g, " ");

  return (
    <div
      className={`rv-card ${hasValue ? "" : "rv-card-empty"} ${isSelected ? "rv-card-selected" : ""}`}
      onClick={() => onSelect(decl)}
      style={{
        cursor: "pointer",
        transition: "all 0.2s ease",
        borderColor: isSelected ? "var(--accent, #2563eb)" : undefined,
        boxShadow: isSelected ? "0 0 0 2px rgba(37, 99, 235, 0.3)" : undefined,
      }}
    >
      <div className="rv-card-top">
        <span className="rv-card-label" style={{ fontWeight: 600 }}>{label}</span>
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          {decl.confidence !== null && (
            <span style={{ fontSize: "0.72rem", color: "var(--text-muted, #64748b)", background: "rgba(0,0,0,0.05)", padding: "2px 6px", borderRadius: "4px" }}>
              {Math.round((decl.confidence > 1 ? decl.confidence / 100 : decl.confidence) * 100)}% conf
            </span>
          )}
          {check && <ComplianceBadge status={check.status} />}
        </div>
      </div>
      <div className="rv-card-value" style={{ margin: "10px 0" }}>
        {decl.field === "consumer_care" && decl.consumerCareDetails ? (
          <div className="rv-cc-grid" style={{ fontSize: "0.85rem", lineHeight: 1.4 }}>
            {decl.consumerCareDetails.phone && <div className="rv-cc-row"><Phone size={13} /> {decl.consumerCareDetails.phone}</div>}
            {decl.consumerCareDetails.email && <div className="rv-cc-row"><Mail size={13} /> {decl.consumerCareDetails.email}</div>}
            {decl.consumerCareDetails.website && <div className="rv-cc-row"><Globe size={13} /> {decl.consumerCareDetails.website}</div>}
            {decl.consumerCareDetails.address && <div className="rv-cc-row"><MapPin size={13} /> {decl.consumerCareDetails.address}</div>}
          </div>
        ) : hasValue ? (
          <span className="rv-card-val" style={{ fontSize: "0.95rem", fontWeight: 500 }}>{decl.value}</span>
        ) : (
          <span className="rv-card-na" style={{ color: "var(--text-muted, #94a3b8)", fontStyle: "italic" }}>Not detected on packaging</span>
        )}
      </div>
      <div className="rv-card-footer" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "8px" }}>
        {decl.conflict ? (
          <span className="rv-conflict-tag"><AlertTriangle size={10} /> Conflict across photos</span>
        ) : srcImg ? (
          <button
            type="button"
            className="rv-link-btn"
            onClick={(e) => {
              e.stopPropagation();
              onImageSelect(srcIdx);
              onSelect(decl);
            }}
            style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "0.75rem", background: "none", border: "none", color: "var(--accent, #2563eb)", cursor: "pointer" }}
          >
            <Camera size={12} /> Photo {srcIdx + 1} ({srcImg.side || "evidence"})
          </button>
        ) : <span />}

        <div className="rv-card-actions">
          <button
            type="button"
            className="rv-link-btn"
            onClick={(e) => {
              e.stopPropagation();
              onVerify(decl);
            }}
          >
            <Edit3 size={11} /> Verify
          </button>
        </div>
      </div>
    </div>
  );
}

export function ResultView({
  role = "officer",
  inspection,
  counts,
  selectedCheck,
  onSelect,
  onReport,
  reportOpen,
  onCloseReport,
  onInspectionUpdated,
}: ResultViewProps) {
  const [activeImageIndex, setActiveImageIndex] = useState<number>(0);
  const [showBoundingBoxes, setShowBoundingBoxes] = useState<boolean>(true);
  const [selectedField, setSelectedField] = useState<DeclarationField | null>(null);
  const [showTimeline, setShowTimeline] = useState<boolean>(false);
  const [showHistoryTimeline, setShowHistoryTimeline] = useState<boolean>(false);
  const [reviewModalField, setReviewModalField] = useState<Declaration | null>(null);
  const [overrideValue, setOverrideValue] = useState<string>("");
  const [overrideRationale, setOverrideRationale] = useState<string>("");
  const [isSubmittingReview, setIsSubmittingReview] = useState<boolean>(false);
  const [expandedChecks, setExpandedChecks] = useState<Set<string>>(new Set());
  const [physicalModalOpen, setPhysicalModalOpen] = useState<boolean>(false);
  const [measuredValue, setMeasuredValue] = useState<string>("");
  const [measuredUnit, setMeasuredUnit] = useState<string>("g");
  const [instrumentId, setInstrumentId] = useState<string>("");

  const images = inspection.images || [];
  const currentImage: EvidenceImage | undefined = images[activeImageIndex] || images[0];

  const checksByStatus = useMemo(() => {
    const pass: ComplianceCheck[] = [];
    const fail: ComplianceCheck[] = [];
    const review: ComplianceCheck[] = [];
    const notApplicable: ComplianceCheck[] = [];
    const notEvaluated: ComplianceCheck[] = [];
    for (const c of inspection.checks) {
      if (c.status === "pass") pass.push(c);
      else if (c.status === "fail") fail.push(c);
      else if (c.status === "not_applicable") notApplicable.push(c);
      else if (c.status === "not_evaluated") notEvaluated.push(c);
      else review.push(c);
    }
    return { fail, review, pass, notApplicable, notEvaluated };
  }, [inspection.checks]);

  function toggleCheck(ruleId: string) {
    setExpandedChecks((prev) => {
      const next = new Set(prev);
      if (next.has(ruleId)) next.delete(ruleId);
      else next.add(ruleId);
      return next;
    });
  }

  function handleSelectDeclaration(decl: Declaration) {
    setSelectedField(decl.field);
    if (decl.evidenceImageId) {
      const imgIdx = images.findIndex((img) => img.id === decl.evidenceImageId || decl.evidenceImageId?.includes(img.id));
      if (imgIdx >= 0 && imgIdx !== activeImageIndex) {
        setActiveImageIndex(imgIdx);
      }
    }
  }

  async function handleManualOverride() {
    if (!reviewModalField || !overrideValue.trim()) return;
    setIsSubmittingReview(true);
    try {
      const res = await fetch(`/api/inspections/${inspection.id}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          field: reviewModalField.field,
          correctedValue: overrideValue.trim(),
          rationale: overrideRationale.trim() || "Officer manual verification",
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.inspection && onInspectionUpdated) onInspectionUpdated(data.inspection);
        setReviewModalField(null);
      }
    } catch { /* noop */ } finally {
      setIsSubmittingReview(false);
    }
  }

  async function handlePhysicalSubmit() {
    if (!measuredValue.trim()) return;
    const quantityDecl = inspection.declarations.find((d) => d.field === "net_quantity");
    setIsSubmittingReview(true);
    try {
      const res = await fetch(`/api/inspections/${inspection.id}/physical`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          measurements: [
            {
              field: "net_quantity",
              declaredValue: quantityDecl?.value || "Not declared",
              measuredValue: measuredValue.trim(),
              unit: measuredUnit,
              measuredBy: "Officer",
              instrumentId: instrumentId.trim() || undefined,
            },
          ],
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.inspection && onInspectionUpdated) onInspectionUpdated(data.inspection);
        setPhysicalModalOpen(false);
      }
    } catch { /* noop */ } finally {
      setIsSubmittingReview(false);
    }
  }

  const isInvalidEvidence = inspection.status === "invalid_evidence" || inspection.verdict === "INVALID_EVIDENCE";
  const productName = inspection.productName || "Not detected";

  const detectedDeclarations = useMemo(() => {
    const map = new Map<string, Declaration>();
    for (const decl of inspection.declarations || []) {
      if (decl.status === "DETECTED" && decl.value && decl.value.trim().length > 0) {
        const existing = map.get(decl.field);
        if (!existing || (decl.confidence ?? 0) > (existing.confidence ?? 0)) {
          map.set(decl.field, decl);
        }
      }
    }
    return Array.from(map.values());
  }, [inspection.declarations]);

  return (
    <div className="rv-root">
      {/* ── Verdict strip ─────────────────────────────────────────── */}
      <div className={`rv-verdict-bar rv-vb-${inspection.status}`}>
        <div className="rv-vb-left">
          <div className="rv-vb-icon">
            {inspection.status === "pass" ? <ShieldCheck size={22} /> : inspection.status === "fail" ? <XCircle size={22} /> : <AlertTriangle size={22} />}
          </div>
          <div>
            <span className="eyebrow" style={{ display: "block", fontSize: "0.7rem", letterSpacing: "0.08em", fontWeight: 700, opacity: 0.8, textTransform: "uppercase" }}>OFFICIAL VERDICT</span>
            <VerdictPill status={inspection.status} />
          </div>
        </div>
        <div className="rv-vb-score">
          <span className="rv-vb-score-label">Score</span>
          <span className="rv-vb-score-val">{typeof inspection.score === "number" ? inspection.score : "--"}</span>
          <span className="rv-vb-score-of">/100</span>
        </div>
        <div className="rv-vb-counts">
          <span className="rv-vb-c rv-vb-c-pass">{counts.pass} Pass</span>
          <span className="rv-vb-c rv-vb-c-review">{counts.review} Review</span>
          <span className="rv-vb-c rv-vb-c-fail">{counts.fail} Fail</span>
          {checksByStatus.notApplicable.length > 0 && (
            <span className="rv-vb-c rv-vb-c-na">{checksByStatus.notApplicable.length} N/A</span>
          )}
          {checksByStatus.notEvaluated.length > 0 && (
            <span className="rv-vb-c rv-vb-c-ne">{checksByStatus.notEvaluated.length} Not Evaluated</span>
          )}
        </div>
      </div>

      {/* ── Reviewer Verdict Action Bar (Approve / Reject) & Officer Submit ─────── */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          backgroundColor: role === "reviewer" ? "rgba(245, 158, 11, 0.08)" : "rgba(37, 99, 235, 0.06)",
          border: role === "reviewer" ? "1px solid rgba(245, 158, 11, 0.3)" : "1px solid rgba(37, 99, 235, 0.2)",
          padding: "12px 18px",
          borderRadius: "8px",
          margin: "14px 0",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <ShieldCheck size={20} style={{ color: role === "reviewer" ? "#f59e0b" : "#2563eb" }} />
          <div>
            <strong style={{ fontSize: "14px", display: "block" }}>
              {role === "reviewer"
                ? "Reviewer Decision Console"
                : role === "admin"
                  ? "Administrator Verdict Override"
                  : "Officer Inspection Workflow"}
            </strong>
            <small style={{ fontSize: "11px", color: "var(--muted)" }}>
              {role === "reviewer"
                ? "Inspect OCR outputs and issue official statutory verdict (Approve / Reject)."
                : role === "admin"
                  ? "Admin oversight console to review and finalize verdicts."
                  : "Complete scan details and submit for reviewer verification."}
            </small>
          </div>
        </div>

        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          {/* Officer Submit Button */}
          {(role === "officer" || role === "ENFORCEMENT_OFFICER") && (
            <button
              type="button"
              className="button primary"
              style={{ fontSize: "12px", padding: "8px 16px", backgroundColor: "#2563eb", color: "#fff", border: "none", borderRadius: "6px", cursor: "pointer", fontWeight: 600 }}
              onClick={async () => {
                try {
                  const res = await fetch(`/api/inspections/${inspection.id}/submit`, { method: "POST" });
                  if (res.ok) {
                    const data = await res.json();
                    if (data.inspection && onInspectionUpdated) onInspectionUpdated(data.inspection);
                    alert(`Inspection "${inspection.id}" successfully submitted to Reviewer queue!`);
                  }
                } catch {
                  alert("Failed to submit inspection for review.");
                }
              }}
            >
              Submit Inspection for Review
            </button>
          )}

          {/* Reviewer / Admin Approve & Reject Buttons */}
          {(role === "reviewer" || role === "admin") && (
            <>
              <button
                type="button"
                className="button primary"
                style={{ fontSize: "12px", padding: "8px 16px", backgroundColor: "#10b981", color: "#fff", border: "none", borderRadius: "6px", cursor: "pointer", fontWeight: 700 }}
                onClick={async () => {
                  const rationale = prompt("Enter official approval notes / rationale:", "Statutory declarations verified & compliant with Legal Metrology Rules, 2011.");
                  if (!rationale) return;
                  try {
                    const res = await fetch(`/api/inspections/${inspection.id}/verdict`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ decision: "APPROVE", rationale }),
                    });
                    if (res.ok) {
                      const data = await res.json();
                      if (data.inspection && onInspectionUpdated) onInspectionUpdated(data.inspection);
                      alert(`Verdict APPROVED for inspection ${inspection.id}.`);
                    }
                  } catch {
                    alert("Failed to record verdict decision.");
                  }
                }}
              >
                Approve Inspection
              </button>

              <button
                type="button"
                className="button secondary"
                style={{ fontSize: "12px", padding: "8px 16px", backgroundColor: "#ef4444", color: "#fff", border: "none", borderRadius: "6px", cursor: "pointer", fontWeight: 700 }}
                onClick={async () => {
                  const rationale = prompt("Enter non-compliance violation grounds for rejection:", "Non-compliance detected under Legal Metrology Rules 2011.");
                  if (!rationale) return;
                  try {
                    const res = await fetch(`/api/inspections/${inspection.id}/verdict`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ decision: "REJECT", rationale }),
                    });
                    if (res.ok) {
                      const data = await res.json();
                      if (data.inspection && onInspectionUpdated) onInspectionUpdated(data.inspection);
                      alert(`Verdict REJECTED for inspection ${inspection.id}. Violation logged.`);
                    }
                  } catch {
                    alert("Failed to record verdict decision.");
                  }
                }}
              >
                Reject Item (Issue Violation)
              </button>
            </>
          )}
        </div>
      </div>

      {/* ── Product name hero ─────────────────────────────────────── */}
      <div className="rv-hero" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h1 className="rv-hero-name">{productName}</h1>
          <p className="rv-hero-meta">
            Captured {formatDate(inspection.createdAt)} &middot; {images.length} evidence photo{images.length !== 1 ? "s" : ""} &middot; Engine: {inspection.extractionSource || "YOLO + PaddleOCR"}
          </p>
        </div>
        <button
          type="button"
          className="rv-report-btn"
          onClick={onReport}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            padding: "8px 16px",
            background: "#0f172a",
            color: "#fff",
            borderRadius: "6px",
            border: "none",
            cursor: "pointer",
            fontWeight: 500,
          }}
        >
          <FileDown size={15} /> Export Inspection Report
        </button>
      </div>

      {/* ── Invalid evidence banner ──────────────────────────────── */}
      {isInvalidEvidence && (
        <div className="rv-alert rv-alert-warn">
          <AlertTriangle size={18} />
          <div>
            <strong>Packaging not detected</strong>
            <p>{inspection.notes[0] || "Point the camera at the product package."}</p>
          </div>
        </div>
      )}

      {/* ── Evidence viewer & Bounding Box Overlay ────────────────── */}
      <section className="rv-section">
        <div className="rv-sec-head" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
          <div>
            <span className="eyebrow" style={{ display: "block", fontSize: "0.7rem", letterSpacing: "0.08em", fontWeight: 700, color: "var(--text-muted, #64748b)", textTransform: "uppercase" }}>EVIDENCE GALLERY</span>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <h2>Captured Photo Evidence</h2>
              {currentImage && (
                <span style={{ fontSize: "0.82rem", color: "var(--text-muted)", background: "rgba(0,0,0,0.06)", padding: "2px 8px", borderRadius: "12px" }}>
                  Captured Photo {activeImageIndex + 1} of {images.length} ({currentImage.side || "evidence"})
                </span>
              )}
            </div>
          </div>
          <button
            type="button"
            className="rv-toggle-btn"
            onClick={() => setShowBoundingBoxes(!showBoundingBoxes)}
            style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer", padding: "6px 12px", borderRadius: "6px", border: "1px solid #cbd5e1", background: "#fff" }}
          >
            <Layers size={14} /> {showBoundingBoxes ? "Hide" : "Show"} OCR Bounding Boxes
          </button>
        </div>

        <div
          className="rv-viewport"
          style={{
            position: "relative",
            width: "100%",
            minHeight: "420px",
            maxHeight: "620px",
            overflow: "hidden",
            borderRadius: "10px",
            background: "#080c14",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            padding: "12px",
          }}
        >
          {currentImage ? (
            <div
              className="rv-img-frame"
              style={{
                position: "relative",
                display: "inline-block",
                lineHeight: 0,
                maxWidth: "100%",
                maxHeight: "580px",
                borderRadius: "6px",
                overflow: "hidden",
                boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
              }}
            >
              <img
                src={currentImage.uri}
                alt={`Evidence photo ${activeImageIndex + 1}`}
                style={{
                  display: "block",
                  maxWidth: "100%",
                  maxHeight: "580px",
                  width: "auto",
                  height: "auto",
                  objectFit: "contain",
                  userSelect: "none",
                }}
              />
              <svg
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  height: "100%",
                  pointerEvents: "none",
                  zIndex: 10,
                }}
              >
                {showBoundingBoxes && currentImage.detections
                  // Render-time display guard: only draw boxes for detections that
                  // are reasonably confident AND have a plausible bbox size.
                  // This is a second defence layer — it catches stale DB detections
                  // produced before the Python-side display_detections filter was
                  // added (confidence ≥ 0.40, both bbox sides ≥ 0.3% of image).
                  ?.filter((d) =>
                    d.confidence >= 0.40 &&
                    d.bbox.width >= 0.3 &&
                    d.bbox.height >= 0.3
                  )
                  .map((d) => {
                    const isSelected = selectedField && (
                      d.className === selectedField ||
                      (inspection.declarations.find((decl) => decl.field === selectedField)?.evidenceImageId === currentImage.id)
                    );
                    const polyPoints = d.polygon && d.polygon.length >= 3
                      ? d.polygon.map((p) => `${p[0]},${p[1]}`).join(" ")
                      : `${d.bbox.x},${d.bbox.y} ${d.bbox.x + d.bbox.width},${d.bbox.y} ${d.bbox.x + d.bbox.width},${d.bbox.y + d.bbox.height} ${d.bbox.x},${d.bbox.y + d.bbox.height}`;

                    return (
                      <polygon
                        key={`det-${d.id}`}
                        points={polyPoints}
                        fill={isSelected ? "rgba(37, 99, 235, 0.2)" : "rgba(16, 185, 129, 0.08)"}
                        stroke={isSelected ? "#2563eb" : "rgba(16, 185, 129, 0.65)"}
                        strokeWidth={isSelected ? "0.7" : "0.35"}
                        vectorEffect="non-scaling-stroke"
                      />
                    );
                  })}

                {/* Render Selected & Matched Declarations */}
                {inspection.declarations
                  .filter((d) => d.status === "DETECTED" && Boolean(d.value && d.value.trim()) && (d.polygon || d.boundingBox) && (!d.evidenceImageId || d.evidenceImageId === currentImage.id || currentImage.id.includes(d.evidenceImageId) || d.evidenceImageId.includes(currentImage.id)))
                  .map((decl) => {
                    const isSelected = selectedField === decl.field;
                    const strokeColor = isSelected ? "#2563eb" : "#10b981";
                    const fillColor = isSelected ? "rgba(37, 99, 235, 0.35)" : "rgba(16, 185, 129, 0.15)";
                    const strokeWidth = isSelected ? "0.9" : "0.45";

                    const polyPoints = decl.polygon && decl.polygon.length >= 3
                      ? decl.polygon.map((p) => `${p[0]},${p[1]}`).join(" ")
                      : decl.boundingBox
                        ? `${decl.boundingBox.x},${decl.boundingBox.y} ${decl.boundingBox.x + decl.boundingBox.width},${decl.boundingBox.y} ${decl.boundingBox.x + decl.boundingBox.width},${decl.boundingBox.y + decl.boundingBox.height} ${decl.boundingBox.x},${decl.boundingBox.y + decl.boundingBox.height}`
                        : "";

                    if (!polyPoints) return null;

                    const labelX = decl.boundingBox ? Math.max(1, Math.min(80, decl.boundingBox.x)) : 10;
                    const labelY = decl.boundingBox ? Math.max(3, decl.boundingBox.y) : 10;
                    const labelText = FIELD_LABELS[decl.field] || decl.field;

                    return (
                      <g key={`decl-highlight-${decl.field}`}>
                        {/* Main tight character polygon */}
                        <polygon
                          points={polyPoints}
                          fill={fillColor}
                          stroke={strokeColor}
                          strokeWidth={strokeWidth}
                          vectorEffect="non-scaling-stroke"
                          strokeLinejoin="round"
                        />
                        {/* Animated/Glowing halo if selected */}
                        {isSelected && (
                          <polygon
                            points={polyPoints}
                            fill="none"
                            stroke="#60a5fa"
                            strokeWidth="1.8"
                            strokeDasharray="2, 1"
                            vectorEffect="non-scaling-stroke"
                            opacity="0.9"
                          />
                        )}
                        {/* Crisp SVG badge label */}
                        <g transform={`translate(${labelX}, ${labelY})`}>
                          <rect
                            x="0"
                            y="-2.4"
                            width={Math.min(30, labelText.length * 1.3 + 1.6)}
                            height="2.6"
                            rx="0.5"
                            fill={strokeColor}
                          />
                          <text
                            x="0.8"
                            y="-0.6"
                            fill="#ffffff"
                            fontSize="1.6"
                            fontWeight="bold"
                            fontFamily="sans-serif"
                          >
                            {labelText}
                          </text>
                        </g>
                      </g>
                    );
                  })}
              </svg>
            </div>
          ) : (
            <div className="rv-no-img" style={{ color: "#94a3b8", padding: "40px" }}>No evidence image available</div>
          )}
        </div>

        {/* Image Thumbnail Selector */}
        {images.length > 1 && (
          <div className="rv-thumbs" style={{ display: "flex", gap: "10px", marginTop: "12px", overflowX: "auto", paddingBottom: "6px" }}>
            {images.map((img, idx) => (
              <button
                key={img.id || idx}
                type="button"
                className={`rv-thumb ${idx === activeImageIndex ? "active" : ""}`}
                onClick={() => setActiveImageIndex(idx)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  padding: "6px 12px",
                  borderRadius: "6px",
                  border: idx === activeImageIndex ? "2px solid #2563eb" : "1px solid #cbd5e1",
                  background: idx === activeImageIndex ? "rgba(37, 99, 235, 0.08)" : "#fff",
                  cursor: "pointer",
                }}
              >
                <div className="rv-thumb-img" style={{ width: "32px", height: "32px", borderRadius: "4px", backgroundImage: `url(${img.uri})`, backgroundSize: "cover" }} />
                <span style={{ fontSize: "0.82rem", fontWeight: 500 }}>Photo {idx + 1} ({img.side || "Side"})</span>
              </button>
            ))}
          </div>
        )}
      </section>

      {/* ── Extracted Declarations Grid (8 Statutory Fields) ─────── */}
      {!isInvalidEvidence && inspection.declarations.length > 0 && (
        <section className="rv-section" style={{ marginTop: "24px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
            <div>
              <span className="eyebrow" style={{ display: "block", fontSize: "0.7rem", letterSpacing: "0.08em", fontWeight: 700, color: "var(--text-muted, #64748b)", textTransform: "uppercase" }}>MANDATORY DECLARATIONS</span>
              <h2>Statutory Declarations (Legal Metrology Rules 2011)</h2>
            </div>
            <span style={{ fontSize: "0.82rem", color: "var(--text-muted)" }}>
              Click any card to inspect its exact evidence bounding box on the photograph.
            </span>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
              gap: "14px",
              margin: "18px 0",
            }}
          >
            {/* Smart Risk Triage */}
            <div
              style={{
                border: "1px solid #e5e7eb",
                borderRadius: "12px",
                padding: "16px",
                background: "#fff",
              }}
            >
              <div style={{ fontSize: "11px", fontWeight: 700, color: "#64748b" }}>
                SMART RISK TRIAGE
              </div>

              <div
                style={{
                  marginTop: "8px",
                  fontSize: "26px",
                  fontWeight: 800,
                  color: counts.fail >= 2 ? "#b91c1c" : "#b45309",
                }}
              >
                {counts.fail >= 2 ? "HIGH" : counts.fail >= 1 ? "MEDIUM" : "LOW"}
              </div>

              <div style={{ marginTop: "6px", fontSize: "13px", color: "#64748b" }}>
                {counts.fail} potential fails · {counts.review} reviews
              </div>
            </div>

            {/* Evidence Confidence */}
            <div
              style={{
                border: "1px solid #e5e7eb",
                borderRadius: "12px",
                padding: "16px",
                background: "#fff",
              }}
            >
              <div style={{ fontSize: "11px", fontWeight: 700, color: "#64748b" }}>
                EVIDENCE CONFIDENCE
              </div>

              <div
                style={{
                  marginTop: "8px",
                  fontSize: "26px",
                  fontWeight: 800,
                }}
              >
                {typeof inspection.score === "number"
                  ? `${inspection.score}%`
                  : "N/A"}
              </div>

              <div style={{ marginTop: "6px", fontSize: "13px", color: "#64748b" }}>
                Inspection evidence signal
              </div>
            </div>

            {/* Historical Label Change */}
            <div
              style={{
                border: "1px solid #e5e7eb",
                borderRadius: "12px",
                padding: "16px",
                background: "#fff",
              }}
            >
              <div style={{ fontSize: "11px", fontWeight: 700, color: "#64748b" }}>
                LABEL CHANGE MONITOR
              </div>

              <div
                style={{
                  marginTop: "8px",
                  fontSize: "17px",
                  fontWeight: 700,
                }}
              >
                Historical comparison
              </div>

              <div style={{ marginTop: "6px", fontSize: "13px", color: "#64748b" }}>
                Compare previous inspection records.
              </div>

              <button
                type="button"
                onClick={() => setShowHistoryTimeline(true)}
                style={{
                  marginTop: "12px",
                  border: "1px solid #cbd5e1",
                  borderRadius: "7px",
                  padding: "7px 11px",
                  background: "#f8fafc",
                  cursor: "pointer",
                  fontSize: "12px",
                  fontWeight: 600,
                }}
              >
                Open Timeline
              </button>
            </div>
          </div>
          {detectedDeclarations.length > 0 ? (
            <div className="rv-cards-grid">
              {detectedDeclarations.map((decl) => {
                const check = inspection.checks.find((c) => c.field === decl.field);
                return (
                  <FieldCard
                    key={decl.field}
                    decl={decl}
                    images={images}
                    check={check}
                    isSelected={selectedField === decl.field}
                    onSelect={handleSelectDeclaration}
                    onImageSelect={(idx) => setActiveImageIndex(idx)}
                    onVerify={(d) => {
                      setReviewModalField(d);
                      setOverrideValue(d.value || "");
                      setOverrideRationale("");
                    }}
                  />
                );
              })}
            </div>
          ) : (
            <p style={{ color: "var(--text-muted)", padding: "16px", fontStyle: "italic" }}>
              No statutory declarations detected with verified OCR evidence on the captured frames.
            </p>
          )}
        </section>
      )}



      {/* ── Compliance Results (Rule Checklist) ───────────────────── */}
      {!isInvalidEvidence && inspection.checks.length > 0 && (
        <section className="rv-section" style={{ marginTop: "24px" }}>
          <span className="eyebrow" style={{ display: "block", fontSize: "0.7rem", letterSpacing: "0.08em", fontWeight: 700, color: "var(--text-muted, #64748b)", textTransform: "uppercase" }}>STATUTORY AUDIT</span>
          <h2>Rule-by-Rule Compliance Checks</h2>
          <div className="rv-checks">
            {[...checksByStatus.fail, ...checksByStatus.review, ...checksByStatus.notEvaluated, ...checksByStatus.notApplicable, ...checksByStatus.pass].map((chk) => {
              const ruleDef = RULES.find((r) => r.id === chk.ruleId);
              const isExpanded = expandedChecks.has(chk.ruleId);
              const isSelected = selectedCheck?.ruleId === chk.ruleId;
              const plainLabel = ruleDef?.label || FIELD_LABELS[chk.field] || chk.field.replace(/_/g, " ");
              return (
                <div key={chk.ruleId} className={`rv-check ${isSelected ? "rv-check-sel" : ""}`}>
                  <button
                    type="button"
                    className="rv-check-row"
                    onClick={() => {
                      onSelect(chk);
                      toggleCheck(chk.ruleId);
                      if (chk.field) {
                        setSelectedField(chk.field as DeclarationField);
                      }
                    }}
                  >
                    <ComplianceBadge status={chk.status} />
                    <span className="rv-check-label">{plainLabel}</span>
                    <span className="rv-check-explain">{chk.explanation}</span>
                    <ChevronRight size={14} className={`rv-chevron ${isExpanded ? "open" : ""}`} />
                  </button>
                  {isExpanded && (
                    <div className="rv-check-detail">
                      <div className="rv-detail-row">
                        <span className="rv-dlabel">Statutory Requirement</span>
                        <span className="rv-dval">{ruleDef?.requirement}</span>
                      </div>
                      <div className="rv-detail-row">
                        <span className="rv-dlabel">Evidence Detected</span>
                        <span className="rv-dval">{chk.evidence || "None detected on packaging"}</span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ── Physical Measurement Entry (Rules 19/20) ───────────────── */}
      {!isInvalidEvidence && (
        <section className="rv-section" style={{ marginTop: "24px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
            <div>
              <span className="eyebrow" style={{ display: "block", fontSize: "0.7rem", letterSpacing: "0.08em", fontWeight: 700, color: "var(--text-muted, #64748b)", textTransform: "uppercase" }}>PHYSICAL VERIFICATION (RULES 19/20)</span>
              <h2>Officer Weighing Entry</h2>
            </div>
            <button
              type="button"
              className="rv-report-btn"
              onClick={() => {
                setMeasuredValue("");
                setInstrumentId("");
                setPhysicalModalOpen(true);
              }}
              style={{ display: "flex", alignItems: "center", gap: "6px", padding: "6px 12px", background: "#0f172a", color: "#fff", borderRadius: "6px", border: "none", cursor: "pointer", fontWeight: 500 }}
            >
              <Edit3 size={13} /> Enter Weighing Reading
            </button>
          </div>
          {inspection.physicalMeasurements && inspection.physicalMeasurements.length > 0 ? (
            <div className="rv-pm-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "10px" }}>
              {inspection.physicalMeasurements.map((m, idx) => (
                <div key={idx} className="rv-pm-card" style={{ border: "1px solid var(--line)", borderRadius: "8px", padding: "12px", background: "#fff" }}>
                  <div className="rv-pm-row" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                    <span style={{ fontWeight: 700, fontSize: "0.8rem", textTransform: "uppercase", letterSpacing: "0.04em" }}>{FIELD_LABELS[m.field] || m.field}</span>
                    <span
                      className="rv-badge"
                      style={{
                        color: m.withinTolerance === true ? "var(--green)" : m.withinTolerance === false ? "var(--red)" : "var(--amber)",
                        background: m.withinTolerance === true ? "var(--green-pale)" : m.withinTolerance === false ? "var(--red-pale)" : "var(--amber-pale)",
                      }}
                    >
                      {m.withinTolerance === true ? "In Tolerance" : m.withinTolerance === false ? "Deviation" : "Pending"}
                    </span>
                  </div>
                  <div className="rv-pm-value" style={{ fontSize: "1.05rem", fontWeight: 600 }}>
                    Declared {m.declaredValue} · Measured {m.measuredValue} {m.unit}
                  </div>
                  <div style={{ fontSize: "0.76rem", color: "var(--text-muted, #64748b)", marginTop: "4px" }}>
                    Permissible deviation ±2% · Logged {m.measuredAt ? new Date(m.measuredAt).toLocaleString() : ""} {m.measuredBy ? `by ${m.measuredBy}` : ""}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p style={{ color: "var(--text-muted)", padding: "14px", fontStyle: "italic", background: "rgba(124, 58, 237, 0.06)", borderRadius: "8px", fontSize: "0.86rem" }}>
              No weighing reading recorded yet. Rule 19 (net quantity inspection) and Rule 20 (standard packages) remain <strong>Not Evaluated</strong> until an officer enters the measured weight from a calibrated scale.
            </p>
          )}
        </section>
      )}

      {/* ── Processing Details / Timeline ─────────────────────────── */}
      {inspection.timeline && inspection.timeline.length > 0 && (
        <section className="rv-section" style={{ marginTop: "20px" }}>
          <button type="button" className="rv-collapse-toggle" onClick={() => setShowTimeline(!showTimeline)}>
            <Clock size={13} />
            <span>Processing Details & Audit Pipeline</span>
            <ChevronDown size={14} className={showTimeline ? "open" : ""} />
          </button>
          {showTimeline && (
            <div className="rv-timeline" style={{ marginTop: "10px" }}>
              {inspection.timeline.map((evt, idx) => (
                <div key={idx} className="rv-tl-row">
                  <span className="rv-tl-time">{evt.at.slice(11, 19)}</span>
                  <span className={`rv-tl-status rv-tls-${evt.status.toLowerCase()}`}>{evt.status}</span>
                  <span className="rv-tl-stage">{evt.stage}</span>
                  {evt.detail && <span className="rv-tl-detail">{evt.detail}</span>}
                  {evt.durationMs !== undefined && <span className="rv-tl-dur">{evt.durationMs}ms</span>}
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* ── Officer Manual Review / Correction Modal ──────────────── */}
      {reviewModalField && (
        <div className="rv-modal-backdrop" onClick={() => setReviewModalField(null)}>
          <div className="rv-modal" onClick={(e) => e.stopPropagation()}>
            <div className="rv-modal-head">
              <h3>Verify & Override Declaration</h3>
              <button type="button" className="rv-modal-close" onClick={() => setReviewModalField(null)}>
                <X size={16} />
              </button>
            </div>
            <div className="rv-modal-body">
              <div className="rv-modal-field">
                <label>Field</label>
                <div className="rv-modal-field-name">{FIELD_LABELS[reviewModalField.field] || reviewModalField.field}</div>
              </div>
              <div className="rv-modal-field">
                <label>Detected Value</label>
                <input
                  type="text"
                  value={overrideValue}
                  onChange={(e) => setOverrideValue(e.target.value)}
                  placeholder="Enter verified declaration value..."
                />
              </div>
              <div className="rv-modal-field">
                <label>Verification Rationale</label>
                <textarea
                  value={overrideRationale}
                  onChange={(e) => setOverrideRationale(e.target.value)}
                  placeholder="Reason for manual verification or correction..."
                  rows={3}
                />
              </div>
            </div>
            <div className="rv-modal-foot">
              <button type="button" className="rv-btn-secondary" onClick={() => setReviewModalField(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="rv-btn-primary"
                disabled={isSubmittingReview || !overrideValue.trim()}
                onClick={handleManualOverride}
              >
                {isSubmittingReview ? "Saving..." : "Confirm Verification"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Officer Physical Measurement Modal ─────────────────────── */}
      {physicalModalOpen && (
        <div className="rv-modal-backdrop" onClick={() => setPhysicalModalOpen(false)}>
          <div className="rv-modal" onClick={(e) => e.stopPropagation()}>
            <div className="rv-modal-head">
              <h3>Enter Weighing Reading (Rule 19/20)</h3>
              <button type="button" className="rv-modal-close" onClick={() => setPhysicalModalOpen(false)}>
                <X size={16} />
              </button>
            </div>
            <div className="rv-modal-body">
              <div className="rv-modal-field">
                <label>Declared Net Quantity</label>
                <div className="rv-modal-field-name">
                  {inspection.declarations.find((d) => d.field === "net_quantity")?.value || "Not declared on packaging"}
                </div>
              </div>
              <div className="rv-modal-field">
                <label>Measured Weight (calibrated scale)</label>
                <div style={{ display: "flex", gap: "8px" }}>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={measuredValue}
                    onChange={(e) => setMeasuredValue(e.target.value)}
                    placeholder="e.g. 98.5"
                    style={{ flex: 1 }}
                  />
                  <select value={measuredUnit} onChange={(e) => setMeasuredUnit(e.target.value)} style={{ width: "90px" }}>
                    <option value="g">g</option>
                    <option value="kg">kg</option>
                    <option value="ml">ml</option>
                    <option value="l">L</option>
                    <option value="count">count</option>
                  </select>
                </div>
              </div>
              <div className="rv-modal-field">
                <label>Scale / Instrument ID</label>
                <input
                  type="text"
                  value={instrumentId}
                  onChange={(e) => setInstrumentId(e.target.value)}
                  placeholder="e.g. W-109 (Class II calibrated)"
                />
              </div>
              <p style={{ fontSize: "0.76rem", color: "var(--text-muted)", lineHeight: 1.5 }}>
                Deviation beyond ±2% from the declared net quantity is a violation of Rule 19(2). The reading is stamped with your officer identity in the audit trail.
              </p>
            </div>
            <div className="rv-modal-foot">
              <button type="button" className="rv-btn-secondary" onClick={() => setPhysicalModalOpen(false)}>Cancel</button>
              <button
                type="button"
                className="rv-btn-primary"
                disabled={isSubmittingReview || !measuredValue.trim()}
                onClick={handlePhysicalSubmit}
              >
                {isSubmittingReview ? "Recording..." : "Record & Re-validate"}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* ── Historical Inspection Timeline Modal ───────────────────── */}
      {showHistoryTimeline && (
        <div
          onClick={() => setShowHistoryTimeline(false)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 99999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "24px",
            background: "rgba(15, 23, 42, 0.55)",
          }}
        >
          <div
            className="rv-modal"
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "780px",
              maxWidth: "90vw",
              maxHeight: "85vh",
              overflowY: "auto",
              boxSizing: "border-box",
            }}
          >
            <div className="rv-modal-head">
              <div>
                <span
                  className="eyebrow"
                  style={{
                    display: "block",
                    fontSize: "0.68rem",
                    letterSpacing: "0.08em",
                  }}
                >
                  LABEL CHANGE MONITOR
                </span>

                <h3 style={{ marginTop: "5px" }}>
                  Inspection History
                </h3>
              </div>

              <button
                type="button"
                className="rv-modal-close"
                onClick={() => setShowHistoryTimeline(false)}
              >
                <X size={16} />
              </button>
            </div>

            <div className="rv-modal-body">
              <div
                style={{
                  borderLeft: "3px solid #2563eb",
                  paddingLeft: "14px",
                }}
              >
                <div
                  style={{
                    fontSize: "0.72rem",
                    fontWeight: 700,
                    color: "#2563eb",
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                  }}
                >
                  Current Inspection
                </div>

                <div
                  style={{
                    fontSize: "1.05rem",
                    fontWeight: 700,
                    marginTop: "6px",
                  }}
                >
                  {productName}
                </div>

                <div
                  style={{
                    fontSize: "0.82rem",
                    color: "var(--text-muted, #64748b)",
                    marginTop: "6px",
                    lineHeight: 1.6,
                  }}
                >
                  <div>
                    Inspection date: {formatDate(inspection.createdAt)}
                  </div>

                  <div>
                    Verdict: {inspection.status}
                  </div>

                  <div>
                    Score:{" "}
                    {typeof inspection.score === "number"
                      ? `${inspection.score}/100`
                      : "Unavailable"}
                  </div>
                </div>
              </div>

              <div
                style={{
                  marginTop: "18px",
                  padding: "14px",
                  borderRadius: "8px",
                  background: "rgba(37, 99, 235, 0.06)",
                  border: "1px solid rgba(37, 99, 235, 0.15)",
                }}
              >
                <div
                  style={{
                    fontWeight: 700,
                    fontSize: "0.86rem",
                  }}
                >
                  Historical comparison
                </div>

                <p
                  style={{
                    margin: "6px 0 0",
                    fontSize: "0.8rem",
                    color: "var(--text-muted, #64748b)",
                    lineHeight: 1.5,
                  }}
                >
                  Previous inspection records can be reviewed from the
                  System Archive and compared against this inspection for
                  declaration changes.
                </p>
              </div>
              <LabelChangeComparison inspection={inspection} />

              {inspection.timeline && inspection.timeline.length > 0 && (
                <div style={{ marginTop: "18px" }}>
                  <div
                    style={{
                      fontSize: "0.72rem",
                      fontWeight: 700,
                      color: "var(--text-muted, #64748b)",
                      textTransform: "uppercase",
                      marginBottom: "8px",
                    }}
                  >
                    Current Processing Timeline
                  </div>

                  <div className="rv-timeline">
                    {inspection.timeline.map((evt, idx) => (
                      <div key={idx} className="rv-tl-row">
                        <span className="rv-tl-time">
                          {evt.at.slice(11, 19)}
                        </span>

                        <span
                          className={`rv-tl-status rv-tls-${evt.status.toLowerCase()}`}
                        >
                          {evt.status}
                        </span>

                        <span className="rv-tl-stage">
                          {evt.stage}
                        </span>

                        {evt.detail && (
                          <span className="rv-tl-detail">
                            {evt.detail}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="rv-modal-foot">
              <button
                type="button"
                className="rv-btn-secondary"
                onClick={() => setShowHistoryTimeline(false)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Inspection Report Modal ───────────────────────────────── */}
      {reportOpen && (
        <ReportModal
          inspection={inspection}
          onClose={onCloseReport}
        />
      )}
    </div>
  );
}
