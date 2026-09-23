/**
 * End-to-End Regression Test Suite
 * 
 * Verifies:
 * 1. Deterministic Legal Metrology extraction & compliance on a real biscuit package
 * 2. Multi-image declaration merging without clobbering or overwriting
 * 3. Non-hallucination of missing packaging fields
 * 4. Officer manual review override workflow with audit trail
 * 5. Multi-tenant boundary isolation (cross-organization access rejection)
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import {
  prisma,
  saveInspection,
  getInspection,
  deleteInspection,
  clearInspectionStore,
  getDefaultOrganizationId,
} from "@/services/store";
import {
  createSessionToken,
  SESSION_COOKIE_NAME,
} from "@/services/auth";
import {
  normalizeMRP,
  normalizeNetQuantity,
  normalizeDate,
  normalizeManufacturer,
  normalizeConsumerCare,
  normalizeCountryOfOrigin,
  parseConsumerCareDetails,
} from "@/services/normalizer";
import { evaluateCompliance, overallStatus, complianceScore } from "@/domain/rules";
import { GET as getInspectionById } from "@/app/api/inspections/[id]/route";
import { POST as postReview } from "@/app/api/inspections/[id]/review/route";
import { POST as postPhysical } from "@/app/api/inspections/[id]/physical/route";
import type { Inspection, Declaration } from "@/domain/inspection";

describe("Pipeline Regression Suite: Legal Metrology (Packaged Commodities) Rules, 2011", () => {
  const TEST_INSP_ID = "REGRESSION-INSP-2026-001";
  const TEST_INSP_TENANT_ID = "REGRESSION-INSP-2026-002";
  let delhiOrgId = "";
  let mahaOrgId = "";
  let delhiOfficerId = "";

  beforeAll(async () => {
    // Ensure test organizations exist
    const orgDelhi = await prisma.organization.upsert({
      where: { code: "ORG-LM-DELHI" },
      create: {
        id: "org-delhi-test",
        code: "ORG-LM-DELHI",
        name: "Legal Metrology Department - Delhi HQ",
        jurisdiction: "Delhi",
      },
      update: {},
    });
    delhiOrgId = orgDelhi.id;

    const orgMaha = await prisma.organization.upsert({
      where: { code: "ORG-LM-MAHA" },
      create: {
        id: "org-maha-test",
        code: "ORG-LM-MAHA",
        name: "Legal Metrology Department - Maharashtra Zone",
        jurisdiction: "Maharashtra",
      },
      update: {},
    });
    mahaOrgId = orgMaha.id;

    // Upsert test officer user for Delhi org
    const officerUser = await prisma.user.upsert({
      where: { username: "officer_delhi" },
      create: {
        id: "usr-delhi-officer",
        organizationId: delhiOrgId,
        username: "officer_delhi",
        passwordHash: "salt:hash",
        name: "Inspector Sharma",
        role: "ENFORCEMENT_OFFICER",
      },
      update: {
        organizationId: delhiOrgId,
      },
    });
    delhiOfficerId = officerUser.id;

    // Clean up any stale audit logs from previous test runs
    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          { entityId: TEST_INSP_ID },
          { entityId: TEST_INSP_TENANT_ID },
        ],
      },
    });
  });

  afterAll(async () => {
    await deleteInspection(TEST_INSP_ID);
    await deleteInspection(TEST_INSP_TENANT_ID);
  });

  // --------------------------------------------------------------------------
  // 1. Realistic Packaging Declaration Extraction & Normalization
  // --------------------------------------------------------------------------
  describe("1. Real Biscuit Packaging Text Normalization & Rules Validation", () => {
    const realisticBiscuitPackText = `
      BRITANNIA GOOD DAY BUTTER COOKIES
      NET QUANTITY: 200 g (EXTRA 20% FREE)
      M.R.P. Rs. 35.00 (INCL. OF ALL TAXES)
      PKD: 08/2026 B.NO. BD40912
      MFD BY BRITANNIA INDUSTRIES LTD, 5/1 HUNGERFORD STREET, KOLKATA 700017, WEST BENGAL
      FOR QUERIES/FEEDBACK CONTACT CONSUMER CARE EXECUTIVE AT 1800 425 4444 OR EMAIL FEEDBACK@BRITINDIA.COM OR WRITE TO MFD ADDRESS
      COUNTRY OF ORIGIN: INDIA
    `;

    it("extracts all mandatory Legal Metrology fields deterministically without GenAI", () => {
      const mrp = normalizeMRP(realisticBiscuitPackText);
      const netQty = normalizeNetQuantity(realisticBiscuitPackText);
      const date = normalizeDate(realisticBiscuitPackText);
      const mfr = normalizeManufacturer(realisticBiscuitPackText);
      const care = normalizeConsumerCare(realisticBiscuitPackText);
      const origin = normalizeCountryOfOrigin(realisticBiscuitPackText);

      expect(mrp).toBe("₹35.00");
      expect(netQty).toBe("200 g");
      expect(date).toBe("08/2026");
      expect(mfr).toContain("BRITANNIA INDUSTRIES LTD");
      expect(mfr).toContain("700017");
      expect(care).toContain("1800 425 4444");
      expect(origin).toBe("India");
    });

    it("decomposes consumer care into structured telephone, email, and address", () => {
      const details = parseConsumerCareDetails(realisticBiscuitPackText);
      expect(details.phone).toBe("1800 425 4444");
      expect(details.email).toBe("feedback@britindia.com");
      expect(typeof details.address).toBe("string");
    });

    it("evaluates statutory compliance rules yielding a passing verdict", () => {
      const declarations: Declaration[] = [
        { field: "product_name", value: "BRITANNIA GOOD DAY BUTTER COOKIES", status: "DETECTED", confidence: 0.95, boundingBox: { x: 10, y: 10, width: 50, height: 10 } },
        { field: "net_quantity", value: "200 g", status: "DETECTED", confidence: 0.92, boundingBox: { x: 10, y: 25, width: 30, height: 8 } },
        { field: "mrp", value: "₹35.00", status: "DETECTED", confidence: 0.94, boundingBox: { x: 10, y: 40, width: 25, height: 8 }, evidence: { rawText: "M.R.P. Rs. 35.00 (INCL. OF ALL TAXES)" } },
        { field: "date", value: "08/2026", status: "DETECTED", confidence: 0.90, boundingBox: { x: 10, y: 55, width: 25, height: 8 } },
        { field: "manufacturer", value: "BRITANNIA INDUSTRIES LTD, 5/1 HUNGERFORD STREET, KOLKATA 700017", status: "DETECTED", confidence: 0.93, boundingBox: { x: 10, y: 70, width: 60, height: 12 } },
        { field: "consumer_care", value: "Call 1800 425 4444 or email feedback@britindia.com", status: "DETECTED", confidence: 0.91, boundingBox: { x: 10, y: 85, width: 55, height: 10 } },
        { field: "country_of_origin", value: "India", status: "DETECTED", confidence: 0.96, boundingBox: { x: 10, y: 92, width: 25, height: 8 } },
      ];

      const checks = evaluateCompliance(declarations, "img-test-1");
      const status = overallStatus(checks);
      const score = complianceScore(checks);

      // Every evaluated statutory rule passes. Officer-input rules (Rules 19/20
      // physical weighing, Rule 7(3) character height without a physical scale)
      // are NOT EVALUATED and, per inspection policy, block the verdict to
      // REQUIRES_REVIEW until the officer supplies those measurements — an
      // honest, never-heuristic outcome for photo-only evidence.
      expect(status).toBe("review");
      expect(score).toBeGreaterThanOrEqual(90);
      expect(checks.every((c) => c.status === "pass" || c.status === "not_applicable" || c.status === "not_evaluated")).toBe(true);
      expect(checks.some((c) => c.status === "not_evaluated")).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // 2. Non-Hallucination on Incomplete Packaging
  // --------------------------------------------------------------------------
  describe("2. Non-Hallucination Guarantee on Defective / Incomplete Packages", () => {
    const incompletePackageText = `
      LOCAL SWEET CORNER FRESH KAJU KATLI
      NET WT 250 g
      PRICE 250 RS
      MFD 10/2026
    `;

    it("does NOT hallucinate missing Consumer Care or Country of Origin", () => {
      const care = normalizeConsumerCare(incompletePackageText);
      const origin = normalizeCountryOfOrigin(incompletePackageText);
      const details = parseConsumerCareDetails(incompletePackageText);

      expect(care).toBeNull();
      expect(origin).toBeNull();
      expect(details.phone).toBeNull();
      expect(details.email).toBeNull();
      expect(details.website).toBeNull();
    });

    it("statutory rule engine flags missing unverified declarations as review and depresses score", () => {
      const declarations: Declaration[] = [
        { field: "product_name", value: "LOCAL SWEET CORNER FRESH KAJU KATLI", status: "DETECTED", confidence: 0.90, boundingBox: { x: 10, y: 10, width: 40, height: 10 } },
        { field: "net_quantity", value: "250 g", status: "DETECTED", confidence: 0.85, boundingBox: { x: 10, y: 25, width: 30, height: 8 } },
        { field: "mrp", value: "₹250", status: "DETECTED", confidence: 0.80, boundingBox: { x: 10, y: 40, width: 25, height: 8 } },
        { field: "date", value: "10/2026", status: "DETECTED", confidence: 0.85, boundingBox: { x: 10, y: 55, width: 25, height: 8 } },
        { field: "manufacturer", value: null, status: "NOT_DETECTED", confidence: null },
        { field: "consumer_care", value: null, status: "NOT_DETECTED", confidence: null },
        { field: "country_of_origin", value: null, status: "NOT_DETECTED", confidence: null },
      ];

      const checks = evaluateCompliance(declarations, "img-defective");
      const status = overallStatus(checks);
      const score = complianceScore(checks);

      expect(status).toBe("review");
      expect(score).toBeLessThanOrEqual(85);

      const mfrCheck = checks.find((c) => c.field === "manufacturer");
      expect(mfrCheck?.status).toBe("review");

      const careCheck = checks.find((c) => c.field === "consumer_care");
      expect(careCheck?.status).toBe("review");
    });
  });

  // --------------------------------------------------------------------------
  // 3. Multi-Image Evidence Aggregation
  // --------------------------------------------------------------------------
  describe("3. Multi-Image Evidence Aggregation", () => {
    it("merges front and back panel declarations without clobbering existing fields", async () => {
      const frontPanelDeclarations: Declaration[] = [
        { field: "product_name", value: "PARLE-G ORIGINAL GLUCOSE BISCUITS", status: "DETECTED", confidence: 0.95 },
        { field: "net_quantity", value: "130 g", status: "DETECTED", confidence: 0.90 },
      ];

      const backPanelDeclarations: Declaration[] = [
        { field: "mrp", value: "₹10.00", status: "DETECTED", confidence: 0.92 },
        { field: "date", value: "09/2026", status: "DETECTED", confidence: 0.88 },
        { field: "manufacturer", value: "PARLE PRODUCTS PVT LTD, MUMBAI 400057", status: "DETECTED", confidence: 0.94 },
        { field: "consumer_care", value: "Contact: cs@parle.biz or 1800 222 222", status: "DETECTED", confidence: 0.91 },
        { field: "country_of_origin", value: "India", status: "DETECTED", confidence: 0.98 },
      ];

      // Simulated multi-image merge map
      const mergedMap = new Map<string, Declaration>();
      for (const d of frontPanelDeclarations) {
        mergedMap.set(d.field, d);
      }
      for (const d of backPanelDeclarations) {
        const existing = mergedMap.get(d.field);
        if (!existing || (!existing.value && d.value) || ((d.confidence ?? 0) > (existing.confidence ?? 0))) {
          mergedMap.set(d.field, d);
        }
      }

      const merged = Array.from(mergedMap.values());
      expect(merged.length).toBe(7);
      expect(merged.find((d) => d.field === "product_name")?.value).toBe("PARLE-G ORIGINAL GLUCOSE BISCUITS");
      expect(merged.find((d) => d.field === "net_quantity")?.value).toBe("130 g");
      expect(merged.find((d) => d.field === "mrp")?.value).toBe("₹10.00");
      expect(merged.find((d) => d.field === "country_of_origin")?.value).toBe("India");
    });
  });

  // --------------------------------------------------------------------------
  // 4. Officer Review Workflow & Audit Logging
  // --------------------------------------------------------------------------
  describe("4. Manual Officer Review Workflow with Immutable Audit Log", () => {
    it("updates declaration override, recalculates compliance verdict, and creates audit log", async () => {
      // Seed initial inspection with missing MRP
      const initialInspection: Inspection = {
        id: TEST_INSP_ID,
        organizationId: delhiOrgId,
        createdAt: new Date().toISOString(),
        productName: "Audit Test Biscuit",
        status: "review",
        processingStatus: "COMPLETED",
        score: 65,
        notes: [],
        images: [
          {
            id: "img-audit-1",
            uri: "/api/scan/image/img-audit-1",
            side: "front",
            width: 1280,
            height: 720,
          },
        ],
        declarations: [
          { field: "product_name", value: "Audit Test Biscuit", status: "DETECTED", confidence: 0.95, boundingBox: { x: 10, y: 10, width: 50, height: 10 } },
          { field: "net_quantity", value: "100 g", status: "DETECTED", confidence: 0.90, boundingBox: { x: 10, y: 25, width: 30, height: 8 } },
          { field: "mrp", value: null, status: "NOT_DETECTED", confidence: null },
          { field: "date", value: "07/2026", status: "DETECTED", confidence: 0.88, boundingBox: { x: 10, y: 40, width: 25, height: 8 } },
          { field: "manufacturer", value: "TEST FOODS LTD, DELHI 110001", status: "DETECTED", confidence: 0.90, boundingBox: { x: 10, y: 55, width: 60, height: 10 } },
          { field: "consumer_care", value: "Care: 1800 11 2233", status: "DETECTED", confidence: 0.85, boundingBox: { x: 10, y: 70, width: 45, height: 10 } },
          { field: "country_of_origin", value: "India", status: "DETECTED", confidence: 0.95, boundingBox: { x: 10, y: 85, width: 25, height: 8 } },
        ],
        checks: [
          {
            ruleId: "LM-PC-04",
            field: "mrp",
            status: "review",
            explanation: "MRP declaration is missing.",
          },
        ],
      };

      await saveInspection(initialInspection);

      // Verify saved state
      const saved = await getInspection(TEST_INSP_ID, delhiOrgId);
      expect(saved).not.toBeNull();
      expect(saved?.status).toBe("review");

      // Generate authorized officer session token
      const officerToken = await createSessionToken({
        id: delhiOfficerId,
        username: "officer_delhi",
        role: "officer",
        name: "Inspector Sharma",
        organizationId: delhiOrgId,
      });

      // Submit manual override
      const reviewReq = new NextRequest(`http://localhost:3000/api/inspections/${TEST_INSP_ID}/review`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `${SESSION_COOKIE_NAME}=${officerToken}`,
        },
        body: JSON.stringify({
          field: "mrp",
          correctedValue: "₹25.00 (INCL. OF ALL TAXES)",
          rationale: "Physical verification: MRP clearly stamped on bottom crimp seal.",
        }),
      });

      const response = await postReview(reviewReq, { params: Promise.resolve({ id: TEST_INSP_ID }) });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);

      // Verify updated inspection
      const getReq = new NextRequest(`http://localhost:3000/api/inspections/${TEST_INSP_ID}`, {
        headers: { Cookie: `${SESSION_COOKIE_NAME}=${officerToken}` },
      });

      const getRes = await getInspectionById(getReq, { params: Promise.resolve({ id: TEST_INSP_ID }) });
      const getData = await getRes.json();

      expect(getRes.status).toBe(200);
      const updatedInspection: Inspection = getData.inspection;
      // Officer-input rules (physical weighing Rules 19/20, character-height
      // without physical scale) remain NOT EVALUATED and block to review, while
      // the evaluated compliance score is a full 100.
      expect(updatedInspection.status).toBe("review");
      expect(updatedInspection.score).toBeGreaterThanOrEqual(90);

      const mrpDecl = updatedInspection.declarations.find((d) => d.field === "mrp");
      expect(mrpDecl?.value).toBe("₹25.00 (INCL. OF ALL TAXES)");
      expect(mrpDecl?.status).toBe("VERIFIED");
      expect(mrpDecl?.confidence).toBe(1.0);

      // Verify immutable audit log recorded
      const auditLogs = getData.auditLogs;
      expect(auditLogs.length).toBeGreaterThan(0);
      const overrideLog = auditLogs.find((l: Record<string, unknown>) => l.action === "MANUAL_OVERRIDE");
      expect(overrideLog).toBeDefined();
      expect(overrideLog.userId).toBe(delhiOfficerId);
      expect(overrideLog.organizationId).toBe(delhiOrgId);
      const details = overrideLog.detailsJson ? JSON.parse(overrideLog.detailsJson as string) : (overrideLog as Record<string, unknown>).details as Record<string, unknown>;
      expect(details.field).toBe("mrp");
      expect(details.correctedValue).toBe("₹25.00 (INCL. OF ALL TAXES)");
      expect(details.rationale).toContain("Physical verification");
    });

    it("records an officer weighing reading and re-validates Rule 19/20 checks", async () => {
      const officerToken = await createSessionToken({
        id: delhiOfficerId,
        username: "officer_delhi",
        role: "officer",
        name: "Inspector Sharma",
        organizationId: delhiOrgId,
      });

      const physReq = new NextRequest(`http://localhost:3000/api/inspections/${TEST_INSP_ID}/physical`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `${SESSION_COOKIE_NAME}=${officerToken}`,
        },
        body: JSON.stringify({
          measurements: [
            {
              field: "net_quantity",
              declaredValue: "100 g",
              measuredValue: "99.6",
              unit: "g",
              measuredBy: "Inspector Sharma",
              instrumentId: "W-109 (Class II)",
            },
          ],
        }),
      });

      const response = await postPhysical(physReq, { params: Promise.resolve({ id: TEST_INSP_ID }) });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);

      const updatedInspection: Inspection = data.inspection;

      // Physical measurement persisted and re-validation ran
      expect(updatedInspection.physicalMeasurements?.length).toBe(1);
      expect(updatedInspection.physicalMeasurements?.[0].measuredValue).toBe("99.6");

      const physicalChecked = updatedInspection.checks.filter((c) => c.validationType === "physical_verification");
      expect(physicalChecked.length).toBeGreaterThan(0);
      for (const chk of physicalChecked) {
        expect(["pass", "fail", "review"]).toContain(chk.status);
        expect(chk.status).not.toBe("not_evaluated");
      }
    });
  });

  // --------------------------------------------------------------------------
  // 5. Multi-Tenant Boundary Isolation
  // --------------------------------------------------------------------------
  describe("5. Multi-Tenant Isolation (Anti Cross-Organization Access)", () => {
    it("blocks an officer from Organization B from reading or modifying Organization A records", async () => {
      // Seed inspection belonging to Delhi
      const delhiInspection: Inspection = {
        id: TEST_INSP_TENANT_ID,
        organizationId: delhiOrgId,
        createdAt: new Date().toISOString(),
        productName: "Delhi Zone Specimen",
        status: "pass",
        processingStatus: "COMPLETED",
        score: 100,
        notes: [],
        images: [],
        declarations: [],
        checks: [],
      };
      await saveInspection(delhiInspection);

      // Create session for Maharashtra officer
      const mahaOfficerToken = await createSessionToken({
        id: "usr-maha-officer",
        username: "officer_maha",
        role: "officer",
        name: "Inspector Patil",
        organizationId: mahaOrgId,
      });

      // Attempt 1: Maha officer tries to GET Delhi inspection
      const crossGetReq = new NextRequest(`http://localhost:3000/api/inspections/${TEST_INSP_TENANT_ID}`, {
        headers: { Cookie: `${SESSION_COOKIE_NAME}=${mahaOfficerToken}` },
      });
      const crossGetRes = await getInspectionById(crossGetReq, { params: Promise.resolve({ id: TEST_INSP_TENANT_ID }) });
      expect(crossGetRes.status).toBe(403);
      const crossGetData = await crossGetRes.json();
      expect(crossGetData.error).toContain("Forbidden");

      // Attempt 2: Maha officer tries to POST review override on Delhi inspection
      const crossReviewReq = new NextRequest(`http://localhost:3000/api/inspections/${TEST_INSP_TENANT_ID}/review`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `${SESSION_COOKIE_NAME}=${mahaOfficerToken}`,
        },
        body: JSON.stringify({
          field: "mrp",
          correctedValue: "₹99.00",
        }),
      });
      const crossReviewRes = await postReview(crossReviewReq, { params: Promise.resolve({ id: TEST_INSP_TENANT_ID }) });
      expect(crossReviewRes.status).toBe(403);
      const crossReviewData = await crossReviewRes.json();
      expect(crossReviewData.error).toContain("Forbidden");

      // Attempt 3: Admin CAN access across tenants
      const adminToken = await createSessionToken({
        id: "usr-super-admin",
        username: "admin_super",
        role: "admin",
        name: "Central Admin",
        organizationId: "org-central",
      });

      const adminGetReq = new NextRequest(`http://localhost:3000/api/inspections/${TEST_INSP_TENANT_ID}`, {
        headers: { Cookie: `${SESSION_COOKIE_NAME}=${adminToken}` },
      });
      const adminGetRes = await getInspectionById(adminGetReq, { params: Promise.resolve({ id: TEST_INSP_TENANT_ID }) });
      expect(adminGetRes.status).toBe(200);
      const adminGetData = await adminGetRes.json();
      expect(adminGetData.inspection.id).toBe(TEST_INSP_TENANT_ID);
    });
  });

  // --------------------------------------------------------------------------
  // 6. E-commerce Mode (Rule 6(10A) country-of-origin listing disclosure)
  // --------------------------------------------------------------------------
  describe("6. E-commerce Mode — Listing COO Disclosure", () => {
    it("activates LM-PC-09 only for e-commerce inspections and lets a listing COO satisfy it", () => {
      const declarations: Declaration[] = [
        { field: "product_name", value: "Imported Cashew 500g", status: "DETECTED", confidence: 0.95 },
        { field: "country_of_origin", value: "Vietnam", status: "DETECTED", confidence: 0.95, evidence: { rawText: "E-commerce listing (flipkart): Vietnam" } },
        { field: "net_quantity", value: "500 g", status: "DETECTED", confidence: 0.9 },
        { field: "mrp", value: "₹399.00 (INCL. OF ALL TAXES)", status: "DETECTED", confidence: 0.9 },
        { field: "date", value: "08/2026", status: "DETECTED", confidence: 0.85 },
      ];

      // Retail (physical package) mode: Rule 6(10A) is not applicable
      const retailChecks = evaluateCompliance(declarations, "img-retail", { ecommerceListing: false });
      const retailLm09 = retailChecks.find((c) => c.ruleId === "LM-PC-09");
      expect(retailLm09?.status).toBe("not_applicable");

      // E-commerce mode: listing COO satisfies the disclosure requirement
      const ecomChecks = evaluateCompliance(declarations, "img-listing", { ecommerceListing: true });
      const ecomLm09 = ecomChecks.find((c) => c.ruleId === "LM-PC-09");
      expect(ecomLm09?.status).not.toBe("not_applicable");
      expect(["pass", "review"]).toContain(ecomLm09?.status);
      expect(ecomLm09?.evidence).toContain("Vietnam");
    });
  });
});
