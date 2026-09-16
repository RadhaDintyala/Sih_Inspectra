"use client";

import { useCallback } from "react";
import { Check, FileDown, FileText, Info, ScanLine, X } from "lucide-react";
import type { Inspection } from "@/domain/inspection";
import { RULES } from "@/domain/rules";
import { buildReport } from "@/services/inspection";
import { generatePdf, generateCsv, downloadBlob } from "@/services/export-report";
import { formatDate } from "@/components/utils";

export function ReportModal({ inspection, onClose }: { inspection: Inspection; onClose: () => void }) {
  const report = buildReport(inspection);

  const handleExportPdf = useCallback(async () => {
    const blob = await generatePdf(inspection);
    downloadBlob(blob, `inspection-${inspection.id}.pdf`);
  }, [inspection]);

  const handleExportCsv = useCallback(() => {
    const blob = generateCsv(inspection);
    downloadBlob(blob, `inspection-${inspection.id}.csv`);
  }, [inspection]);

  return (
    <div className="modal-scrim" role="dialog" aria-modal="true" aria-label="Inspection report">
      <div className="report-modal">
        <div className="report-head">
          <div>
            <span className="eyebrow">REPORT GENERATED</span>
            <h2>Inspection report</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close report"><X size={18} /></button>
        </div>
        <div className="report-paper">
          <div className="report-brand"><ScanLine size={16} /> INSPECTRA <span>LEGAL METROLOGY</span></div>
          <h1>{report.title}</h1>
          <div className="report-meta">
            <span><b>Inspection ID</b>{report.inspectionId}</span>
            <span><b>Captured</b>{formatDate(report.createdAt)}</span>
            {inspection.score !== undefined && <span><b>Score</b>{inspection.score}/100</span>}
            <span><b>Outcome</b><strong className={`status-word ${inspection.status}`}>{report.outcome}</strong></span>
          </div>
          <h3>Rule-by-rule assessment</h3>
          {report.findings.map((finding) => (
            <div className="report-finding" key={finding.ruleId}>
              <span className={`status-icon ${finding.status}`}>
                {finding.status === "pass" ? <Check size={13} /> : finding.status === "fail" ? <X size={13} /> : finding.status === "not_applicable" ? <span style={{ fontSize: 9 }}>N/A</span> : finding.status === "not_evaluated" ? <Info size={13} /> : <Info size={13} />}
              </span>
              <b>{RULES.find((rule) => rule.id === finding.ruleId)?.label}</b>
              <span>{finding.explanation}</span>
              {(finding.status === "not_applicable" || finding.status === "not_evaluated") && (
                <span className="status-word">{finding.status === "not_applicable" ? "NOT APPLICABLE" : "NOT EVALUATED"}</span>
              )}
            </div>
          ))}
          {report.declarations.length > 0 && (
            <>
              <h3>Extracted declarations</h3>
              {report.declarations.map((decl) => (
                <div className="report-finding" key={decl.field}>
                  <b>{decl.field.replace(/_/g, " ")}</b>
                  <span>{decl.value || "Not detected"}</span>
                </div>
              ))}
            </>
          )}
          {inspection.physicalMeasurements && inspection.physicalMeasurements.length > 0 && (
            <>
              <h3>Physical verification (Rules 19/20)</h3>
              {inspection.physicalMeasurements.map((m) => (
                <div className="report-finding" key={`${m.field}-${m.measuredAt}`}>
                  <span className={`status-icon ${m.withinTolerance === false ? "fail" : m.withinTolerance === true ? "pass" : "review"}`}>
                    {m.withinTolerance === false ? <X size={13} /> : <Check size={13} />}
                  </span>
                  <b>{m.field.replace(/_/g, " ")}</b>
                  <span>Declared {m.declaredValue} · Measured {m.measuredValue} {m.unit} ({m.withinTolerance === true ? "in tolerance" : m.withinTolerance === false ? "deviation" : "pending"})</span>
                </div>
              ))}
            </>
          )}
        </div>
        <div className="report-actions">
          <button className="button secondary" onClick={handleExportPdf}><FileDown size={15} /> Export PDF</button>
          <button className="button secondary" onClick={handleExportCsv}><FileText size={15} /> Export CSV</button>
          <button className="button secondary" onClick={() => window.print()}><FileDown size={15} /> Print</button>
          <button className="button primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
