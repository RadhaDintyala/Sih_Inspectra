"use client";

import { useMemo } from "react";
import { CheckCircle2, XCircle, AlertTriangle, ChevronRight, Search, Filter, ShieldCheck, Eye } from "lucide-react";
import type { Inspection } from "@/domain/inspection";

interface ReviewerQueueViewProps {
  inspections: Inspection[];
  onSelectInspection: (inspection: Inspection) => void;
  isLoading?: boolean;
}

export function ReviewerQueueView({ inspections, onSelectInspection, isLoading = false }: ReviewerQueueViewProps) {
  const pendingReviewList = useMemo(() => {
    return inspections.filter(
      (i) => i.status === "review" || i.status === "processing" || (i as any).processingStatus === "REVIEW_REQUIRED"
    );
  }, [inspections]);

  const reviewedList = useMemo(() => {
    return inspections.filter((i) => i.status === "pass" || i.status === "fail");
  }, [inspections]);

  return (
    <div className="page-enter">
      <div className="eyebrow">LEGAL METROLOGY REVIEW CONSOLE / QUEUE MANAGEMENT</div>
      <div className="page-heading">
        <div>
          <h1>Reviewer Assigned Queue</h1>
          <p>Inspect pending officer scans, verify OCR raw extractions, perform inline overrides, and issue final statutory verdicts.</p>
        </div>
        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          <span className="demo-auth-badge" style={{ backgroundColor: "rgba(245, 158, 11, 0.15)", color: "#f59e0b", borderColor: "#fcd34d" }}>
            <AlertTriangle size={13} /> {pendingReviewList.length} PENDING REVIEWS
          </span>
        </div>
      </div>

      {/* KPI Cards for Reviewer Queue */}
      <div className="metric-grid" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
        <div className="metric metric-amber">
          <span>Pending Review Queue</span>
          <strong>{pendingReviewList.length}</strong>
          <small>Awaiting OCR inspection & verdict decision</small>
        </div>
        <div className="metric metric-green">
          <span>Approved / Verified</span>
          <strong>{inspections.filter((i) => i.status === "pass").length}</strong>
          <small>Passed Legal Metrology statutory rules</small>
        </div>
        <div className="metric metric-amber">
          <span>Rejected / Violations</span>
          <strong>{inspections.filter((i) => i.status === "fail").length}</strong>
          <small>Issued non-compliance notice</small>
        </div>
      </div>

      {/* Pending Review Queue List */}
      <section className="recent-panel" style={{ marginTop: "20px" }}>
        <div className="panel-title" style={{ marginBottom: "16px" }}>
          <div>
            <span className="eyebrow">ACTION REQUIRED</span>
            <h3>Inspections Awaiting Review ({pendingReviewList.length})</h3>
          </div>
          <span className="muted">Click any inspection item to open Reviewer Workspace</span>
        </div>

        <div className="history-table">
          <div className="history-header">
            <span>Inspection ID</span>
            <span>Commodity Name</span>
            <span>Score</span>
            <span>Status</span>
            <span>Submitted Date</span>
            <span>Action</span>
          </div>

          {isLoading ? (
            <div className="empty-state-box" style={{ padding: "30px" }}>
              <p>Loading reviewer queue...</p>
            </div>
          ) : pendingReviewList.length > 0 ? (
            pendingReviewList.map((item) => (
              <div
                key={item.id}
                className="history-row"
                onClick={() => onSelectInspection(item)}
                style={{ cursor: "pointer" }}
              >
                <span className="history-id">
                  <span className="history-icon">
                    <AlertTriangle size={16} style={{ color: "#f59e0b" }} />
                  </span>
                  <b>{item.id}</b>
                </span>
                <span>{item.productName || "Unnamed commodity"}</span>
                <span style={{ fontWeight: 600 }}>{item.score !== undefined ? `${item.score}/100` : "-"}</span>
                <span>
                  <span className="status-word review" style={{ backgroundColor: "#fff2df", color: "#995910", borderColor: "#fbd99d" }}>
                    PENDING REVIEW
                  </span>
                </span>
                <span>{new Date(item.createdAt).toLocaleDateString("en-IN", { month: "short", day: "2-digit" })}</span>
                <button
                  className="button primary"
                  style={{ fontSize: "11px", padding: "4px 12px", height: "30px", gap: "4px" }}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectInspection(item);
                  }}
                >
                  <Eye size={13} /> Inspect & Decide
                </button>
              </div>
            ))
          ) : (
            <div className="empty-state-box" style={{ margin: "24px 0" }}>
              <div className="empty-state-icon">
                <CheckCircle2 size={24} style={{ color: "#10b981" }} />
              </div>
              <h3>Review queue is clear</h3>
              <p>All submitted inspections have been inspected and assigned final statutory verdicts.</p>
            </div>
          )}
        </div>
      </section>

      {/* Completed / Decided Inspections Log */}
      <section className="recent-panel" style={{ marginTop: "24px" }}>
        <div className="panel-title" style={{ marginBottom: "16px" }}>
          <div>
            <span className="eyebrow">COMPLETED DECISIONS</span>
            <h3>Recently Decided Inspections ({reviewedList.length})</h3>
          </div>
        </div>

        <div className="history-table">
          <div className="history-header">
            <span>Inspection ID</span>
            <span>Commodity Name</span>
            <span>Verdict</span>
            <span>Score</span>
            <span>Date</span>
            <span>Action</span>
          </div>

          {reviewedList.length > 0 ? (
            reviewedList.slice(0, 5).map((item) => (
              <div
                key={item.id}
                className="history-row"
                onClick={() => onSelectInspection(item)}
                style={{ cursor: "pointer" }}
              >
                <span className="history-id">
                  <span className="history-icon">
                    {item.status === "pass" ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
                  </span>
                  <b>{item.id}</b>
                </span>
                <span>{item.productName || "Unnamed commodity"}</span>
                <span>
                  <span className={`status-word ${item.status}`}>
                    {item.status === "pass" ? "APPROVED" : "REJECTED"}
                  </span>
                </span>
                <span style={{ fontWeight: 600 }}>{item.score !== undefined ? `${item.score}/100` : "-"}</span>
                <span>{new Date(item.createdAt).toLocaleDateString("en-IN", { month: "short", day: "2-digit" })}</span>
                <ChevronRight size={16} />
              </div>
            ))
          ) : (
            <div className="empty-state-box" style={{ padding: "20px" }}>
              <p style={{ fontSize: "13px", color: "var(--muted)" }}>No completed verdicts recorded yet.</p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
