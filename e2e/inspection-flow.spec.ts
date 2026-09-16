/**
 * E2E: LOGIN → NEW INSPECTION → UPLOAD REAL PACKAGE EVIDENCE → ANALYSIS →
 * RESULT (verdict + evidence + declarations + compliance) → REPORT.
 *
 * The fixture is a REAL synthetic package image (printed declarations),
 * generated with sharp at setup — the pipeline must genuinely detect,
 * OCR, and evaluate it. No mock adapters on this path.
 */

import { test, expect } from "@playwright/test";
import fs from "fs";
import path from "path";
import sharp from "sharp";

const FIXTURE_PATH = path.join(process.cwd(), "test-fixture-package.png");

async function createRealPackageFixture(): Promise<void> {
  const svg =
    `<svg width="800" height="600">` +
    `<rect width="800" height="600" fill="#f5f0e1"/>` +
    `<rect x="24" y="24" width="752" height="552" fill="none" stroke="#333" stroke-width="6"/>` +
    `<text x="60" y="150" font-size="88" font-family="sans-serif" font-weight="bold" fill="black">Good Day Biscuits</text>` +
    `<text x="60" y="270" font-size="52" font-family="sans-serif" fill="black">MRP Rs 35.00 Inclusive of all taxes</text>` +
    `<text x="60" y="370" font-size="52" font-family="sans-serif" fill="black">Net Qty 200 g</text>` +
    `<text x="60" y="470" font-size="52" font-family="sans-serif" fill="black">MFD 08/2026</text></svg>`;
  await sharp(Buffer.from(svg)).png().toFile(FIXTURE_PATH);
}

test.describe.configure({ timeout: 300_000 });

test.describe("Full inspection workflow E2E", () => {
  test.beforeAll(async () => {
    await createRealPackageFixture();
  });

  test.afterAll(() => {
    if (fs.existsSync(FIXTURE_PATH)) fs.unlinkSync(FIXTURE_PATH);
  });

  test("login → capture → analysis → verdict → declarations → compliance → report", async ({ page }) => {
    // 1. Login as enforcement officer (seeded RBAC user).
    await page.goto("/");
    const usernameInput = page.locator("input[placeholder*='officer']");
    await expect(usernameInput).toBeVisible({ timeout: 15000 });
    await usernameInput.fill("officer");
    await page.locator("input[type='password']").fill("officer123");
    await page.locator("button", { hasText: "Sign In to Console" }).click();

    // 2. Officer login lands directly in the scan workspace
    // (or via "Start inspection" from the home workbench).
    const startBtn = page.locator("button", { hasText: "Start inspection" });
    if (await startBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await startBtn.click();
    }
    await expect(page.locator("h1")).toContainText("Evidence Capture Console", { timeout: 15000 });

    // 3. Upload the real package fixture.
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(FIXTURE_PATH);
    await expect(page.locator("text=locked")).toBeVisible({ timeout: 10000 });

    // 4. Run the statutory analysis (async worker path in production).
    await page.locator("button", { hasText: "Run Statutory Compliance Analysis" }).click();

    // 5. Official verdict renders from backend data.
    await expect(page.locator("text=OFFICIAL VERDICT")).toBeVisible({ timeout: 180000 });

    // 6. Evidence gallery shows the captured photo.
    await expect(page.locator("text=EVIDENCE GALLERY")).toBeVisible();
    await expect(page.locator("text=Captured Photo").first()).toBeVisible();

    // 7. Extracted declarations render as cards (MRP honestly read).
    await expect(page.locator("text=MANDATORY DECLARATIONS")).toBeVisible();
    await expect(page.locator("text=₹35.00").first()).toBeVisible({ timeout: 10000 });

    // 8. Rule-by-rule compliance checks render.
    await expect(page.locator("text=Rule-by-Rule Compliance Checks")).toBeVisible();

    // 9. Statutory report modal with PDF + CSV export.
    await page.locator("button", { hasText: /Export Inspection Report|Generate Statutory Report/ }).click();
    await expect(page.locator('[role="dialog"]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator("button", { hasText: "Export PDF" })).toBeVisible();
    await expect(page.locator("button", { hasText: "Export CSV" })).toBeVisible();
  });
});
