import { jsPDF } from "jspdf";
import type { Inspection } from "@/domain/inspection";
import { RULES } from "@/domain/rules";
import { buildReport } from "@/services/inspection";

function escapeCsvField(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

async function fetchImageDataUrl(uri: string): Promise<string | null> {
  try {
    const response = await fetch(uri);
    if (!response.ok) return null;
    const buffer = await response.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return `data:${response.headers.get("content-type") || "image/jpeg"};base64,${btoa(binary)}`;
  } catch {
    return null;
  }
}

export async function generatePdf(inspection: Inspection): Promise<Blob> {
  const report = buildReport(inspection);
  const doc = new jsPDF({ unit: "mm", format: "a4" });

  const margin = 15;
  const pageWidth = 210;
  const contentWidth = pageWidth - margin * 2;
  let y = margin;

  const addLine = () => {
    doc.setDrawColor(200);
    doc.line(margin, y, pageWidth - margin, y);
    y += 4;
  };

  // Header
  doc.setFontSize(18);
  doc.setFont("helvetica", "bold");
  doc.text("INSPECTRA - Legal Metrology", margin, y);
  y += 8;

  doc.setFontSize(11);
  doc.setFont("helvetica", "normal");
  doc.text(report.title, margin, y);
  y += 10;

  // Meta info
  doc.setFontSize(10);
  const metaItems = [
    `Inspection ID: ${report.inspectionId}`,
    `Captured: ${new Date(report.createdAt).toLocaleString("en-IN")}`,
    `Product: ${report.product}`,
    `Outcome: ${report.outcome}`,
  ];
  if (inspection.score !== undefined) {
    metaItems.push(`Score: ${inspection.score}/100`);
  }

  for (const item of metaItems) {
    doc.text(item, margin, y);
    y += 5;
  }
  y += 2;
  addLine();

  // Include a compact evidence sheet. Image fetch failures do not prevent the
  // statutory text report from being generated, but are recorded in the label.
  if (inspection.images.length > 0) {
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.text("Evidence photographs", margin, y);
    y += 7;
    let x = margin;
    for (const image of inspection.images) {
      if (x + 42 > pageWidth - margin) {
        x = margin;
        y += 38;
      }
      if (y > 250) {
        doc.addPage();
        y = margin;
        x = margin;
      }
      const dataUrl = await fetchImageDataUrl(image.uri);
      if (dataUrl) {
        doc.addImage(dataUrl, "JPEG", x, y, 40, 28, undefined, "FAST");
      } else {
        doc.setDrawColor(180);
        doc.rect(x, y, 40, 28);
        doc.setFontSize(7);
        doc.text("Image unavailable", x + 4, y + 15);
      }
      doc.setFontSize(7);
      doc.setFont("helvetica", "normal");
      doc.text(`Frame ${image.imageOrder ?? 1}`, x, y + 32);
      x += 46;
    }
    y += 40;
    addLine();
  }

  // Declarations section
  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.text("Extracted Declarations", margin, y);
  y += 7;

  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  const declarations = inspection.declarations;
  for (const decl of declarations) {
    if (y > 270) {
      doc.addPage();
      y = margin;
    }
    const field = decl.field.replace(/_/g, " ").toUpperCase();
    const value = decl.value || "Not detected";
    doc.setFont("helvetica", "bold");
    doc.text(field, margin, y);
    doc.setFont("helvetica", "normal");
    doc.text(value, margin + 50, y);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    const source = decl.evidenceImageId ? `Source: ${decl.evidenceImageId}` : "Source: not recorded";
    doc.text(`${decl.status} · ${decl.confidence === null ? "confidence unavailable" : `${Math.round((decl.confidence ?? 0) * 100)}%`} · ${source}`, margin + 50, y + 3.5);
    y += 8;
  }
  y += 2;
  addLine();

  // Findings section
  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.text("Rule-by-Rule Assessment", margin, y);
  y += 7;

  doc.setFontSize(9);
  for (const finding of report.findings) {
    if (y > 260) {
      doc.addPage();
      y = margin;
    }
    const rule = RULES.find((r) => r.id === finding.ruleId);
    const label = rule?.label || finding.ruleId;
    const status = finding.status.toUpperCase();

    doc.setFont("helvetica", "bold");
    doc.text(`[${status}] ${label}`, margin, y);
    y += 4.5;

    doc.setFont("helvetica", "normal");
    const lines = doc.splitTextToSize(finding.explanation, contentWidth);
    doc.text(lines, margin + 2, y);
    y += lines.length * 4 + 3;
  }

  // Decisions include officer-entered physical measurements (Rules 19/20)
  const physical = inspection.physicalMeasurements || [];
  if (physical.length > 0) {
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.text("Physical Verification (Rules 19/20)", margin, y);
    y += 7;

    doc.setFontSize(9);
    for (const m of physical) {
      if (y > 270) {
        doc.addPage();
        y = margin;
      }
      const status = m.withinTolerance === true ? "IN TOLERANCE" : m.withinTolerance === false ? "DEVIATION" : "PENDING";
      doc.setFont("helvetica", "bold");
      doc.text(`${m.field.replace(/_/g, " ").toUpperCase()} — ${status}`, margin, y);
      doc.setFont("helvetica", "normal");
      doc.text(`Declared ${m.declaredValue} | Measured ${m.measuredValue} ${m.unit} | Permissible ±2%`, margin + 2, y + 4.5);
      y += 10;
    }
    y += 2;
    addLine();
  }

  // Footer on last page
  if (y > 260) {
    doc.addPage();
    y = margin;
  }
  y += 4;
  addLine();
  doc.setFontSize(8);
  doc.setFont("helvetica", "italic");
  doc.text(
    `Generated by Inspectra Legal Metrology Engine v1.1 - ${new Date().toISOString()}`,
    margin,
    y,
  );

  return doc.output("blob");
}

export function generateCsv(inspection: Inspection): Blob {
  const report = buildReport(inspection);
  const rows: string[] = [];

  // Header row
  rows.push(
    [
      "Section",
      "Field",
      "Value",
      "Status",
      "Explanation",
      "Rule Reference",
    ].join(","),
  );

  // Meta rows
  rows.push(
    [
      escapeCsvField("Meta"),
      escapeCsvField("Inspection ID"),
      escapeCsvField(report.inspectionId),
      escapeCsvField(report.outcome),
      escapeCsvField(""),
      escapeCsvField(""),
    ].join(","),
  );
  rows.push(
    [
      escapeCsvField("Meta"),
      escapeCsvField("Product"),
      escapeCsvField(report.product),
      escapeCsvField(""),
      escapeCsvField(""),
      escapeCsvField(""),
    ].join(","),
  );
  rows.push(
    [
      escapeCsvField("Meta"),
      escapeCsvField("Captured"),
      escapeCsvField(new Date(report.createdAt).toLocaleString("en-IN")),
      escapeCsvField(""),
      escapeCsvField(""),
      escapeCsvField(""),
    ].join(","),
  );
  if (inspection.score !== undefined) {
    rows.push(
      [
        escapeCsvField("Meta"),
        escapeCsvField("Score"),
        escapeCsvField(`${inspection.score}/100`),
        escapeCsvField(""),
        escapeCsvField(""),
        escapeCsvField(""),
      ].join(","),
    );
  }

  // Declaration rows
  for (const decl of inspection.declarations) {
    rows.push(
      [
        escapeCsvField("Declaration"),
        escapeCsvField(decl.field.replace(/_/g, " ")),
        escapeCsvField(decl.value || "Not detected"),
        escapeCsvField(decl.status),
        escapeCsvField(""),
        escapeCsvField(""),
      ].join(","),
    );
  }

  // Finding rows
  for (const finding of report.findings) {
    const rule = RULES.find((r) => r.id === finding.ruleId);
    rows.push(
      [
        escapeCsvField("Finding"),
        escapeCsvField(rule?.label || finding.ruleId),
        escapeCsvField(finding.evidence || ""),
        escapeCsvField(finding.status),
        escapeCsvField(finding.explanation),
        escapeCsvField(finding.sourceDocument || ""),
      ].join(","),
    );
  }

  const csvContent = rows.join("\n");
  return new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
