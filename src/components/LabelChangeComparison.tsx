"use client";

import { useEffect, useState } from "react";
import { formatDate } from "@/components/utils";
import type { Inspection } from "@/domain/inspection";

type DeclarationLike = {
  field?: string;
  value?: string | null;
};

type HistoryRecord = {
  id?: string;
  createdAt?: string;
  productName?: string | null;
  declarations?: DeclarationLike[];
  [key: string]: unknown;
};

type Change = {
  field: string;
  previous: string;
  current: string;
};

type StableField = {
  key: string;
  weight: number;
};

type Status = "loading" | "found" | "none" | "error";

const COMPARE_FIELDS: StableField[] = [
  { key: "mrp", weight: 1 },
  { key: "net_quantity", weight: 1 },
  { key: "date", weight: 1 },
  { key: "batch_number", weight: 1 },
  { key: "manufacturer", weight: 1 },
  { key: "consumer_care", weight: 1 },
  { key: "country_of_origin", weight: 1 },
  { key: "dimensions", weight: 1 },
];

const FIELD_LABELS: Record<string, string> = {
  mrp: "MRP",
  net_quantity: "Net Quantity",
  date: "Date of Mfg / Packing",
  batch_number: "Batch No.",
  manufacturer: "Manufacturer / Packer",
  consumer_care: "Consumer Care",
  country_of_origin: "Country of Origin",
  dimensions: "Dimensions",
};

const FIELD_ALIASES: Record<string, string[]> = {
  mrp: [
    "mrp",
    "m_r_p",
    "maximum_retail_price",
    "max_retail_price",
    "retail_price",
  ],
  net_quantity: [
    "net_quantity",
    "net_quantity_value",
    "quantity",
    "net_qty",
    "net_weight",
    "net_content",
  ],
  date: [
    "date",
    "date_of_mfg",
    "date_of_manufacture",
    "manufacturing_date",
    "mfg_date",
    "date_of_packing",
    "packing_date",
    "packed_on",
    "mfg_or_packed_date",
  ],
  batch_number: [
    "batch_number",
    "batch_no",
    "batch",
    "lot_number",
    "lot_no",
    "lot",
  ],
  manufacturer: [
    "manufacturer",
    "manufacturer_packer",
    "manufacturer_pack",
    "packer",
    "manufactured_by",
  ],
  consumer_care: [
    "consumer_care",
    "consumer_care_details",
    "consumer_care_contact",
    "customer_care",
    "customer_care_details",
  ],
  country_of_origin: [
    "country_of_origin",
    "country",
    "origin",
    "country_of_manufacture",
  ],
  dimensions: [
    "dimensions",
    "dimension",
    "size",
    "package_dimensions",
  ],
  product_name: [
    "product_name",
    "product",
    "commodity_name",
    "item_name",
  ],
};

function normalize(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function normalizeKey(value: unknown): string {
  return normalize(value).replace(/[^a-z0-9]/g, "");
}

function normalizeComparisonValue(
  field: string,
  value: unknown,
): string {
  let text = normalize(value);

  if (!text) return "";

  if (field === "mrp") {
    const match = text.match(/\d+(?:\.\d{1,2})?/g);
    return match ? match[match.length - 1] : text;
  }

  if (field === "net_quantity") {
    text = text.replace(/\s+/g, "");
    return text;
  }

  if (field === "date") {
    return text.replace(/[.-]/g, "/");
  }

  return text.replace(/[|]/g, " ").replace(/\s+/g, " ");
}

function tokens(value: unknown): string[] {
  return normalize(value)
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function tokenSimilarity(a: unknown, b: unknown): number {
  const aTokens = new Set(tokens(a));
  const bTokens = new Set(tokens(b));

  if (aTokens.size === 0 || bTokens.size === 0) {
    return 0;
  }

  let common = 0;

  for (const token of aTokens) {
    if (bTokens.has(token)) {
      common += 1;
    }
  }

  return common / Math.max(aTokens.size, bTokens.size);
}

function isPriceLike(value: unknown): boolean {
  const text = String(value ?? "");

  return (
    /\d+(?:\.\d{1,2})?/.test(text) &&
    /(mrp|m\.r\.p|incl|inclusive|tax|₹|rs\.?\b)/i.test(text)
  );
}

function cleanMRP(value: unknown): string {
  const text = String(value ?? "")
    .trim()
    .replace(/\|/g, " ");

  const matches = text.match(/\d+(?:\.\d{1,2})?/g);

  if (!matches || matches.length === 0) {
    return text;
  }

  return `₹${matches[matches.length - 1]}`;
}

function getDeclarations(
  inspection: HistoryRecord | Inspection | null | undefined,
): DeclarationLike[] {
  const declarations = (inspection as any)?.declarations;

  return Array.isArray(declarations) ? declarations : [];
}

function getDeclaration(
  inspection: HistoryRecord | Inspection | null | undefined,
  field: string,
): string {
  const declarations = getDeclarations(inspection);
  const aliases = FIELD_ALIASES[field] || [field];
  const aliasSet = new Set(aliases.map(normalizeKey));

  for (const item of declarations) {
    if (!item?.field) continue;

    const normalizedField = normalizeKey(item.field);

    if (!aliasSet.has(normalizedField)) continue;

    const value = String(item.value ?? "").trim();

    if (value) {
      if (field === "mrp") {
        return isPriceLike(value) ? cleanMRP(value) : value;
      }

      return value;
    }
  }

  // Important OCR fallback:
  // In this project MRP can be stored inside product_name.
  if (field === "mrp") {
    for (const item of declarations) {
      const normalizedField = normalizeKey(item?.field);

      if (
        FIELD_ALIASES.product_name.some(
          (alias) => normalizeKey(alias) === normalizedField,
        ) &&
        isPriceLike(item?.value)
      ) {
        return cleanMRP(item?.value);
      }
    }
  }

  return "";
}

function getProductIdentity(
  inspection: HistoryRecord | Inspection | null | undefined,
): string {
  const directProductName = String(
    (inspection as any)?.productName ?? "",
  ).trim();

  // Ignore generic/default product names.
  if (
    directProductName &&
    normalize(directProductName) !== "packaged commodity" &&
    !isPriceLike(directProductName)
  ) {
    return directProductName;
  }

  const declarations = getDeclarations(inspection);

  for (const item of declarations) {
    const normalizedField = normalizeKey(item?.field);

    const isProductField = FIELD_ALIASES.product_name.some(
      (alias) => normalizeKey(alias) === normalizedField,
    );

    if (!isProductField) continue;

    const value = String(item?.value ?? "").trim();

    if (
      value &&
      !isPriceLike(value) &&
      normalize(value) !== "packaged commodity"
    ) {
      return value;
    }
  }

  return "";
}

function getStableIdentityMatch(
  current: Inspection,
  previous: HistoryRecord,
): boolean {
  const currentManufacturer = getDeclaration(
    current,
    "manufacturer",
  );
  const previousManufacturer = getDeclaration(
    previous,
    "manufacturer",
  );

  // Manufacturer is required to avoid comparing unrelated products.
  if (!currentManufacturer || !previousManufacturer) {
    return false;
  }

  const manufacturerSimilarity = tokenSimilarity(
    currentManufacturer,
    previousManufacturer,
  );

  if (manufacturerSimilarity < 0.65) {
    return false;
  }

  const currentProduct = getProductIdentity(current);
  const previousProduct = getProductIdentity(previous);

  // Best case: manufacturer + product identity.
  if (currentProduct && previousProduct) {
    const productSimilarity = tokenSimilarity(
      currentProduct,
      previousProduct,
    );

    if (
      manufacturerSimilarity >= 0.65 &&
      productSimilarity >= 0.55
    ) {
      return true;
    }
  }

  // When product name OCR is unavailable, use stable package
  // declarations. MRP, quantity, date and batch are deliberately
  // NOT used for identity because those are the fields we want
  // to detect changes in.
  const stableCandidates = [
    "consumer_care",
    "dimensions",
  ];

  let stableMatches = 0;

  for (const field of stableCandidates) {
    const currentValue = getDeclaration(current, field);
    const previousValue = getDeclaration(previous, field);

    if (!currentValue || !previousValue) continue;

    const similarity = tokenSimilarity(
      currentValue,
      previousValue,
    );

    if (similarity >= 0.55) {
      stableMatches += 1;
    }
  }

  // Country alone is weak, so it is only supporting evidence.
  const currentCountry = getDeclaration(
    current,
    "country_of_origin",
  );
  const previousCountry = getDeclaration(
    previous,
    "country_of_origin",
  );

  const countryMatches =
    currentCountry &&
    previousCountry &&
    normalizeComparisonValue("country_of_origin", currentCountry) ===
      normalizeComparisonValue(
        "country_of_origin",
        previousCountry,
      );

  return (
    manufacturerSimilarity >= 0.75 &&
    (stableMatches >= 1 || Boolean(countryMatches))
  );
}
function cleanText(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[~|]/g, " ")
    .replace(/[;,]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeManufacturer(value: unknown): string {
  return cleanText(value)
    .replace(/[^a-z0-9\s.-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeDate(value: unknown): string {
  return String(value ?? "")
    .trim()
    .replace(/[.-]/g, "/")
    .replace(/\s+/g, "");
}

function isReliableDate(value: unknown): boolean {
  const text = normalizeDate(value);

  return (
    /^(0?[1-9]|1[0-2])\/\d{4}$/.test(text) ||
    /^(0?[1-9]|[12]\d|3[01])\/(0?[1-9]|1[0-2])\/\d{4}$/.test(text)
  );
}

function isReliableQuantity(value: unknown): boolean {
  const text = String(value ?? "")
    .trim()
    .toLowerCase();

  return /^\d+(?:\.\d+)?\s*(g|kg|mg|ml|l|pcs?|piece|cm|mm)$/.test(
    text,
  );
}

function isReliableMRP(value: unknown): boolean {
  const text = String(value ?? "").trim();

  return (
    /(?:₹|rs\.?|inr)?\s*\d+(?:\.\d{1,2})?/i.test(text) &&
    /\d/.test(text)
  );
}

function isReliableBatch(value: unknown): boolean {
  const text = String(value ?? "")
    .trim()
    .replace(/\s+/g, "");

  // Batch numbers normally contain a compact alphanumeric code.
  // Reject obvious OCR sentence fragments.
  if (!text || text.length < 3 || text.length > 30) {
    return false;
  }

  if (/[,:;.!?]/.test(text)) {
    return false;
  }

  if (/\b(axes|salt|incl|taxes|consumer|customer|executive)\b/i.test(text)) {
    return false;
  }

  return /^[A-Z0-9/_-]+$/i.test(text);
}

function isReliableValue(
  field: string,
  value: unknown,
): boolean {
  if (!String(value ?? "").trim()) {
    return false;
  }

  switch (field) {
    case "mrp":
      return isReliableMRP(value);

    case "net_quantity":
      return isReliableQuantity(value);

    case "date":
      return isReliableDate(value);

    case "batch_number":
      return isReliableBatch(value);

    default:
      return true;
  }
}

function compareDeclarations(
  previous: HistoryRecord,
  current: Inspection,
): Change[] {
  const changes: Change[] = [];

  for (const { key: field } of COMPARE_FIELDS) {
    const previousValue = getDeclaration(previous, field);
    const currentValue = getDeclaration(current, field);

    if (!previousValue || !currentValue) {
      continue;
    }

    // Do not report changes caused by obviously bad OCR.
    if (!isReliableValue(field, previousValue)) {
      continue;
    }

    if (!isReliableValue(field, currentValue)) {
      continue;
    }

    if (field === "manufacturer") {
      const oldManufacturer =
        normalizeManufacturer(previousValue);

      const newManufacturer =
        normalizeManufacturer(currentValue);

      // Ignore punctuation / OCR formatting differences.
      if (oldManufacturer === newManufacturer) {
        continue;
      }

      const similarity = tokenSimilarity(
        oldManufacturer,
        newManufacturer,
      );

      // Treat minor OCR differences as unchanged.
      if (similarity >= 0.88) {
        continue;
      }
    } else {
      const previousNormalized =
        normalizeComparisonValue(
          field,
          previousValue,
        );

      const currentNormalized =
        normalizeComparisonValue(
          field,
          currentValue,
        );

      if (
        previousNormalized === currentNormalized
      ) {
        continue;
      }
    }

    changes.push({
      field,
      previous: previousValue,
      current: currentValue,
    });
  }

  return changes;
}

function getUnchangedFields(
  previous: HistoryRecord,
  current: Inspection,
): string[] {
  const unchanged: string[] = [];

  for (const { key: field } of COMPARE_FIELDS) {
    const previousValue = getDeclaration(previous, field);
    const currentValue = getDeclaration(current, field);

    if (!previousValue || !currentValue) {
      continue;
    }

    if (!isReliableValue(field, previousValue)) {
      continue;
    }

    if (!isReliableValue(field, currentValue)) {
      continue;
    }

    if (field === "manufacturer") {
      const oldManufacturer =
        normalizeManufacturer(previousValue);

      const newManufacturer =
        normalizeManufacturer(currentValue);

      if (
        oldManufacturer === newManufacturer ||
        tokenSimilarity(
          oldManufacturer,
          newManufacturer,
        ) >= 0.88
      ) {
        unchanged.push(field);
      }

      continue;
    }

    const oldValue = normalizeComparisonValue(
      field,
      previousValue,
    );

    const newValue = normalizeComparisonValue(
      field,
      currentValue,
    );

    if (oldValue === newValue) {
      unchanged.push(field);
    }
  }

  return unchanged;
}

function extractInspection(data: any): HistoryRecord | null {
  if (!data) return null;

  if (data.inspection) return data.inspection;
  if (data.data?.inspection) return data.data.inspection;
  if (data.data) return data.data;
  if (data.result?.inspection) return data.result.inspection;
  if (data.result) return data.result;

  return data;
}

export function LabelChangeComparison({
  inspection,
}: {
  inspection: Inspection;
}) {
  const [status, setStatus] = useState<Status>("loading");
  const [previous, setPrevious] =
    useState<HistoryRecord | null>(null);
  const [changes, setChanges] = useState<Change[]>([]);
  const [unchanged, setUnchanged] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function loadComparison() {
      try {
        setStatus("loading");
        setPrevious(null);
        setChanges([]);
        setUnchanged([]);

        const historyResponse = await fetch("/api/scan", {
          cache: "no-store",
        });

        if (!historyResponse.ok) {
          throw new Error("Unable to load inspection history");
        }

        const historyData = await historyResponse.json();

        const records: HistoryRecord[] = Array.isArray(historyData)
          ? historyData
          : historyData?.inspections ||
            historyData?.items ||
            historyData?.data ||
            [];

        const previousRecords = records
          .filter(
            (record) =>
              record?.id &&
              record.id !== inspection.id,
          )
          .sort((a, b) => {
            const aTime = new Date(
              a.createdAt || 0,
            ).getTime();

            const bTime = new Date(
              b.createdAt || 0,
            ).getTime();

            return bTime - aTime;
          });

        if (previousRecords.length === 0) {
          if (!cancelled) {
            setStatus("none");
          }
          return;
        }

        let matchedPrevious: HistoryRecord | null = null;

        // Search newest -> oldest for the SAME package.
        for (const record of previousRecords) {
          try {
            const response = await fetch(
              `/api/scan/${encodeURIComponent(
                String(record.id),
              )}`,
              { cache: "no-store" },
            );

            if (!response.ok) continue;

            const data = await response.json();
            const detailed = extractInspection(data);

            if (!detailed) continue;

            if (
              getStableIdentityMatch(
                inspection,
                detailed,
              )
            ) {
              matchedPrevious = detailed;
              break;
            }
          } catch {
            // Continue with older records.
          }
        }

        if (!matchedPrevious) {
          if (!cancelled) {
            setStatus("none");
          }
          return;
        }

        const detectedChanges =
          compareDeclarations(
            matchedPrevious,
            inspection,
          );

        const unchangedFields =
          getUnchangedFields(
            matchedPrevious,
            inspection,
          );

        if (!cancelled) {
          setPrevious(matchedPrevious);
          setChanges(detectedChanges);
          setUnchanged(unchangedFields);
          setStatus("found");
        }
      } catch (error) {
        console.error(
          "Label change comparison error:",
          error,
        );

        if (!cancelled) {
          setPrevious(null);
          setChanges([]);
          setUnchanged([]);
          setStatus("error");
        }
      }
    }

    loadComparison();

    return () => {
      cancelled = true;
    };
  }, [inspection]);

  if (status === "loading") {
    return (
      <div
        style={{
          marginTop: "12px",
          padding: "12px",
          borderRadius: "8px",
          background: "#f8fafc",
          color: "#64748b",
          fontSize: "0.82rem",
        }}
      >
        Checking previous inspection for declaration changes...
      </div>
    );
  }

  if (status === "none") {
    return (
      <div
        style={{
          marginTop: "12px",
          padding: "12px",
          borderRadius: "8px",
          background: "#fffbeb",
          color: "#a16207",
          fontSize: "0.82rem",
        }}
      >
        No previous inspection for the same package was found.
      </div>
    );
  }

  if (status === "error") {
    return (
      <div
        style={{
          marginTop: "12px",
          padding: "12px",
          borderRadius: "8px",
          background: "#fef2f2",
          color: "#b91c1c",
          fontSize: "0.82rem",
        }}
      >
        Previous inspection data could not be compared.
      </div>
    );
  }

  return (
    <div style={{ marginTop: "12px" }}>
      <div
        style={{
          fontSize: "0.78rem",
          color: "#64748b",
          marginBottom: "10px",
        }}
      >
        Previous inspection:{" "}
        {previous?.createdAt
          ? formatDate(previous.createdAt)
          : "Unavailable"}
      </div>

      {changes.length === 0 ? (
        <div
          style={{
            padding: "12px",
            borderRadius: "8px",
            background: "#ecfdf5",
            border: "1px solid #bbf7d0",
            color: "#166534",
            fontSize: "0.84rem",
            fontWeight: 600,
          }}
        >
          ✓ No declaration changes detected.
        </div>
      ) : (
        <>
          <div
            style={{
              padding: "12px",
              borderRadius: "8px",
              background: "#fff7ed",
              border: "1px solid #fed7aa",
              color: "#c2410c",
              fontSize: "0.84rem",
              fontWeight: 700,
              marginBottom: "10px",
            }}
          >
            ⚠ CHANGES DETECTED
          </div>

          <div
            style={{
              display: "grid",
              gap: "8px",
            }}
          >
            {changes.map((change) => (
              <div
                key={change.field}
                style={{
                  padding: "10px",
                  borderRadius: "8px",
                  border: "1px solid #e2e8f0",
                  background: "#ffffff",
                }}
              >
                <div
                  style={{
                    fontSize: "0.8rem",
                    fontWeight: 700,
                    marginBottom: "6px",
                  }}
                >
                  {FIELD_LABELS[change.field] ||
                    change.field}
                </div>

                <div
                  style={{
                    fontSize: "0.78rem",
                    color: "#64748b",
                    lineHeight: 1.6,
                  }}
                >
                  <div>
                    <strong>Previous:</strong>{" "}
                    {change.previous}
                  </div>

                  <div
                    style={{
                      color: "#b91c1c",
                    }}
                  >
                    <strong>Current:</strong>{" "}
                    {change.current}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {unchanged.length > 0 && (
        <div
          style={{
            marginTop: "10px",
            padding: "10px",
            borderRadius: "8px",
            background: "#f8fafc",
            border: "1px solid #e2e8f0",
          }}
        >
          <div
            style={{
              fontSize: "0.78rem",
              fontWeight: 700,
              color: "#475569",
              marginBottom: "6px",
            }}
          >
            UNCHANGED DECLARATIONS
          </div>

          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "6px",
            }}
          >
            {unchanged.map((field) => (
              <span
                key={field}
                style={{
                  padding: "4px 7px",
                  borderRadius: "999px",
                  background: "#ffffff",
                  border: "1px solid #cbd5e1",
                  color: "#475569",
                  fontSize: "0.72rem",
                }}
              >
                {FIELD_LABELS[field] || field}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}