import { NextResponse } from "next/server";
import { RULES } from "@/domain/rules";
import { LEGAL_RULE_REGISTRY } from "@/legal/registry";
import { LEGAL_DOCUMENTS, OFFICIAL_LEGAL_METROLOGY_PAGE } from "@/legal/documents";

export async function GET() {
  const enrichedRules = RULES.map((r) => {
    const registryEntry = LEGAL_RULE_REGISTRY.find((e) => e.ruleId === r.id);
    return {
      id: r.id,
      field: r.field,
      label: r.label,
      citation: r.reference,
      requirement: r.requirement,
      severity: r.severity,
      status: registryEntry?.status ?? "active",
      sourceDocument: registryEntry?.sourceDocument ?? "LM-PC-2011-CONSOLIDATED",
      sourceUrl: registryEntry?.sourceUrl ?? OFFICIAL_LEGAL_METROLOGY_PAGE,
      sourceSection: registryEntry?.sourceSection ?? r.reference,
    };
  });

  return NextResponse.json({
    version: "v1.1",
    totalRules: enrichedRules.length,
    officialPortalUrl: OFFICIAL_LEGAL_METROLOGY_PAGE,
    totalStatutoryDocuments: LEGAL_DOCUMENTS.length,
    rules: enrichedRules,
  });
}
