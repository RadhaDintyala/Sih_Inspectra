/**
 * Normalizer — cleans raw OCR/LLM-extracted strings into structured values
 * before they are fed into the deterministic rule engine.
 *
 * Every function returns the cleaned string, or null if the value
 * is clearly absent / unreadable.
 */

/** Strip surrounding whitespace, collapsed internal whitespace */
export function cleanText(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

/**
 * Checks for tax-inclusive language near MRP declaration.
 * Accepts common real-world phrasings per Rule 6(1)(e):
 * "incl. of all taxes", "inclusive of all taxes", "(incl. of taxes)", "MRP incl of taxes", etc.
 */
export function hasTaxInclusiveDeclaration(raw: string): boolean {
  if (!raw) return false;
  const pattern = /(?:inc[l.]*|inclusive)\s*(?:of\s*)?(?:all\s*)?tax(?:es)?/i;
  const reversePattern = /tax(?:es)?\s*(?:incl?\.?|included|inclusive)/i;
  return pattern.test(raw) || reversePattern.test(raw);
}

/**
 * Normalize MRP string.
 * Accepts:  "Rs. 120", "₹120.00", "MRP: Rs 120/-", "Rs120", "120 rupees"
 * Returns:  "₹120.00" or null if no numeric price found.
 */
export function normalizeMRP(raw: string): string | null {
  const cleaned = cleanText(raw);

  // Reject strings that are primarily FSSAI license numbers or batch numbers without explicit MRP marker
  if (/fssai|lic\.?\s*no|license|licence|batch|b\.?no|lot\s*no/i.test(cleaned) && !/mrp|₹|rs\.?|inr/i.test(cleaned)) {
    return null;
  }

  // Extract numeric value — allow commas for thousands
  const match = cleaned.match(/(?:rs\.?|₹|inr)\s*([\d,]+(?:\.\d{1,2})?)/i)
    || cleaned.match(/([\d,]+(?:\.\d{1,2})?)\s*(?:rupees?|rs\.?|₹)/i)
    || cleaned.match(/mrp\s*[:/-]?\s*(?:rs\.?|₹)?\s*([\d,]+(?:\.\d{1,2})?)/i);
  if (!match) return null;
  const num = parseFloat(match[1].replace(/,/g, ""));
  if (isNaN(num) || num <= 0) return null;
  return `₹${num.toFixed(2)}`;
}

/**
 * Normalize net quantity.
 * Accepts:  "500 gms", "500g", "1 Kg", "200ml", "1 L", "6 pcs", "6 nos"
 * Returns:  "500 g" / "1 kg" / "200 ml" / "1 l" / "6 pcs" or null
 */
export function normalizeNetQuantity(raw: string): string | null {
  const cleaned = cleanText(raw);
  const match = cleaned.match(
    /([\d.,]+)\s*(kg|g|gm|gms|gram|grams|l|ltr|litre|liter|ml|millilitre|milliliter|pcs?|pieces?|nos?|numbers?|unit|units|pack|packs|tabs?|tablets?|capsules?|caps?)/i
  );
  if (!match) return null;
  const num = parseFloat(match[1].replace(/,/g, ""));
  if (isNaN(num) || num <= 0) return null;
  const unitRaw = match[2].toLowerCase();
  const unitMap: Record<string, string> = {
    kg: "kg", g: "g", gm: "g", gms: "g", gram: "g", grams: "g",
    l: "l", ltr: "l", litre: "l", liter: "l",
    ml: "ml", millilitre: "ml", milliliter: "ml",
    pc: "pcs", pcs: "pcs", piece: "pcs", pieces: "pcs",
    no: "pcs", nos: "pcs", number: "pcs", numbers: "pcs",
    unit: "pcs", units: "pcs", pack: "pcs", packs: "pcs",
    tab: "tabs", tabs: "tabs", tablet: "tabs", tablets: "tabs",
    capsule: "caps", capsules: "caps", cap: "caps", caps: "caps",
  };
  const unit = unitMap[unitRaw] ?? unitRaw;
  return `${num} ${unit}`;
}

/**
 * Checks whether a date string includes both a month and a year indicator.
 * Disallows bare years like "2025".
 */
export function hasMonthAndYear(text: string): boolean {
  if (!text) return false;
  // Disallow bare year alone (e.g. "2025" or "2026")
  if (/^\s*(?:20\d{2}|\d{2})\s*$/.test(text)) return false;

  // Check for numeric month + year: MM/YYYY, MM-YYYY, MM.YYYY, DD/MM/YYYY, etc.
  const numericMatch = text.match(/\b(0?[1-9]|1[0-2])[/.-](\d{4}|\d{2})\b/);
  if (numericMatch) return true;

  // Check for YYYY/MM, YYYY-MM
  const isoMatch = text.match(/\b(\d{4})[/.-](0?[1-9]|1[0-2])\b/);
  if (isoMatch) return true;

  // Check for month name + year: "Jun 2025", "June 2025", "JUN-25", etc.
  const monthNameMatch = text.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*[-/']?\s*(\d{4}|\d{2})\b/i);
  if (monthNameMatch) return true;

  // Check for day + month name + year: "15 Jun 2025"
  const dayMonthMatch = text.match(/\b\d{1,2}\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{4}|\d{2})\b/i);
  if (dayMonthMatch) return true;

  return false;
}

/**
 * Parse a month and year from text into "MM/YYYY" format if valid.
 */
function parseMonthYear(text: string): string | null {
  // MM/YYYY or MM.YYYY or MM-YYYY
  let match = text.match(/\b(0?[1-9]|1[0-2])[/.-](\d{4})\b/);
  if (match) return `${match[1].padStart(2, "0")}/${match[2]}`;

  // Month name + 4-digit year: "Jun 2025", "June 2025"
  match = text.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*[-/']?\s*(\d{4})\b/i);
  if (match) {
    const monthNames: Record<string, string> = {
      jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
      jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
    };
    const m = monthNames[match[1].toLowerCase().slice(0, 3)];
    return `${m}/${match[2]}`;
  }

  // Month name + 2-digit year: "Jun'25", "Jun 25"
  match = text.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*[-/']?\s*(\d{2})\b/i);
  if (match) {
    const monthNames: Record<string, string> = {
      jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
      jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
    };
    const m = monthNames[match[1].toLowerCase().slice(0, 3)];
    const year = parseInt(match[2], 10) > 50 ? `19${match[2]}` : `20${match[2]}`;
    return `${m}/${year}`;
  }

  // YYYY-MM or YYYY/MM
  match = text.match(/\b(\d{4})[/.-](0?[1-9]|1[0-2])\b/);
  if (match) return `${match[2].padStart(2, "0")}/${match[1]}`;

  // DD/MM/YYYY or DD/MM/YY (Indian packaged-commodity convention: day first)
  match = text.match(/\b(\d{1,2})[/.-](0?[1-9]|1[0-2])[/.-](\d{2,4})\b/);
  if (match) {
    const day = parseInt(match[1], 10);
    if (day >= 1 && day <= 31) {
      const year = parseInt(match[3], 10) <= 99
        ? (parseInt(match[3], 10) > 50 ? `19${match[3]}` : `20${match[3]}`)
        : match[3];
      return `${match[2].padStart(2, "0")}/${year}`;
    }
  }

  // MM/YY — must not be the first two segments of a dd/mm/yy date
  match = text.match(/\b(0?[1-9]|1[0-2])[/.-](\d{2})\b(?![/.-]\d)/);
  if (match) {
    const year = parseInt(match[2], 10) > 50 ? `19${match[2]}` : `20${match[2]}`;
    return `${match[1].padStart(2, "0")}/${year}`;
  }

  return null;
}

export type DateExtraction = {
  mfgDate: string | null;
  expiryDate: string | null;
  rawDate: string | null;
};

/**
 * Distinguishes manufacture/packing date from expiry/best-before dates.
 */
export function extractDateDeclarations(raw: string): DateExtraction {
  const cleaned = cleanText(raw);
  if (!cleaned) return { mfgDate: null, expiryDate: null, rawDate: null };

  if (/fssai|lic\.?\s*no|license|licence/i.test(cleaned) || /^\d{12,14}$/.test(cleaned.replace(/\s+/g, ""))) {
    return { mfgDate: null, expiryDate: null, rawDate: null };
  }

  // Look for distinct Mfg/PKD section and Best Before/Expiry section
  const mfgMatch = cleaned.match(/(?:mfg|mfd|pkd|packed|pack(?:ing)?|manufactur(?:ed|e)?|imported?)\s*[:.-]?\s*([A-Za-z0-9/.' -]+)/i);
  const expMatch = cleaned.match(/(?:best\s*before|exp(?:iry)?|use\s*by)\s*[:.-]?\s*([A-Za-z0-9/.' -]+)/i);

  const mfgDate = mfgMatch ? parseMonthYear(mfgMatch[1]) : null;
  const expiryDate = expMatch ? parseMonthYear(expMatch[1]) : null;
  const generalDate = parseMonthYear(cleaned);

  return {
    mfgDate: mfgDate ?? (!expMatch ? generalDate : null),
    expiryDate,
    rawDate: cleaned,
  };
}

/**
 * Normalize manufacture/pack/import date.
 * Prioritizes manufacture/packing date over expiry.
 * Returns: "MM/YYYY" string, bare year (for engine gating), or null.
 */
export function normalizeDate(raw: string): string | null {
  const cleaned = cleanText(raw);

  // Reject strings that are FSSAI license numbers or standalone 14-digit codes
  if (/fssai|lic\.?\s*no|license|licence/i.test(cleaned) || /^\d{12,14}$/.test(cleaned.replace(/\s+/g, ""))) {
    return null;
  }

  // Prioritize manufacture/packing date if multiple dates are present
  const extracted = extractDateDeclarations(cleaned);
  if (extracted.mfgDate) return extracted.mfgDate;

  const parsed = parseMonthYear(cleaned);
  if (parsed) return parsed;

  // Retain bare year if present so rule engine can report explicit "missing month" failure reason
  const bareYearMatch = cleaned.match(/(?:mfg|pkd|pack|date|exp|best\s*before)?\s*\b(20\d{2})\b/i);
  if (bareYearMatch) return bareYearMatch[1];

  // Do NOT return unparseable OCR fragments like "/ ju ; AN"
  return null;
}

export interface ConsumerCareStructured {
  phone: string | null;
  email: string | null;
  website: string | null;
  address: string | null;
  summary: string;
}

/**
 * Normalize product dimensions.
 * Accepts: "12 cm x 8 cm x 2 cm", "300mm X 200mm", "10x8x2 cm"
 * Returns cleaned string or null.
 */
export function normalizeDimensions(raw: string): string | null {
  const cleaned = cleanText(raw);
  if (!cleaned) return null;
  const pattern = /\b(\d+(?:\.\d+)?)\s*(?:cm|mm|m|inch|in|ft)?\s*[x×]\s*(\d+(?:\.\d+)?)(?:\s*(?:cm|mm|m|inch|in|ft))?(?:\s*[x×]\s*(\d+(?:\.\d+)?))?\b/i;
  const m = cleaned.match(pattern);
  if (!m) return null;
  const parts = [m[1], m[2], m[3]].filter(Boolean);
  return parts.join(" x ") + (cleaned.match(/cm|mm|m\b/i) ? ` ${cleaned.match(/cm|mm|m\b/i)![0]}` : "");
}

/**
 * Normalize best-before / use-by date.
 * Returns "MM/YYYY" string, bare year, or null.
 */
export function normalizeBestBefore(raw: string): string | null {
  const cleaned = cleanText(raw);
  if (!cleaned) return null;
  const parsed = parseMonthYear(cleaned);
  if (parsed) return parsed;
  const bareYear = cleaned.match(/\b(20\d{2})\b/);
  if (bareYear) return bareYear[1];
  return null;
}

/**
 * Extract structured consumer care contact components (phone, email, website, address).
 */
export function parseConsumerCareDetails(raw: string): ConsumerCareStructured {
  const cleaned = cleanText(raw);
  if (!cleaned) {
    return { phone: null, email: null, website: null, address: null, summary: "" };
  }

  // Extract Phone (Toll-free 1800, landline, or 10-digit mobile)
  const phoneMatch = cleaned.match(/(?:(?:ph|phone|tel|call|toll\s*free|care|help(?:line)?)\s*[:.-]?\s*)?(1800[\s-]?\d{3}[\s-]?\d{3,4}|\+?91[\s-]?\d{10}|\b\d{3,5}[\s-]?\d{6,8}\b)/i);
  const phone = phoneMatch ? phoneMatch[1].replace(/[\s-]+/g, " ").trim() : null;

  // Extract Email
  const emailMatch = cleaned.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
  const email = emailMatch ? emailMatch[1].trim().toLowerCase() : null;

  // Extract Website
  const webMatch = cleaned.match(/(https?:\/\/[^\s]+|www\.[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}|[a-zA-Z0-9.-]+\.(?:com|in|co\.in|org|net)(?:\/[^\s]*)?)/i);
  const website = webMatch ? webMatch[1].trim() : null;

  // Extract Address (text excluding phone, email, website)
  let addressText = cleaned;
  if (phone) addressText = addressText.replace(phone, "");
  if (email) addressText = addressText.replace(email, "");
  if (website) addressText = addressText.replace(website, "");
  addressText = addressText
    .replace(/(?:for\s*(?:complaints|queries|feedback)|call|write\s*to|contact|consumer\s*care\s*cell|executive|manager|ph|tel|email|web)\s*[:.-]?/gi, "")
    .replace(/[;,\s-]{2,}/g, ", ")
    .replace(/^[;,\s-]+|[;,\s-]+$/g, "")
    .trim();
  const address = addressText.length >= 8 ? addressText : null;

  const parts = [
    phone ? `Phone: ${phone}` : null,
    email ? `Email: ${email}` : null,
    website ? `Web: ${website}` : null,
    address ? `Address: ${address}` : null,
  ].filter(Boolean);

  const summary = parts.length > 0 ? parts.join(" · ") : cleaned;

  return { phone, email, website, address, summary };
}

/**
 * Normalize consumer care.
 * Requires actual verifiable contact signals (phone, email, website, or structured care address).
 */
export function normalizeConsumerCare(raw: string): string | null {
  const cleaned = cleanText(raw);
  if (!cleaned) return null;

  const structured = parseConsumerCareDetails(cleaned);
  if (structured.phone || structured.email || structured.website) {
    // Even with contact signals, reject if the whole string is garbled
    const alphaTokens = cleaned.split(/\s+/).map((t) => t.replace(/[^a-zA-Z]/g, "").toLowerCase()).filter((t) => t.length >= 1);
    const longTokens = alphaTokens.filter((t) => t.length >= 3);
    if (longTokens.length === 0) return null;
    return structured.summary;
  }

  // If contains explicit consumer care keywords and a plausible address
  if (/(?:consumer\s*care|customer\s*care|care\s*cell|toll\s*free|help\s*line)/i.test(cleaned) && cleaned.length >= 10 && cleaned.length <= 150) {
    const alphaTokens = cleaned.split(/\s+/).map((t) => t.replace(/[^a-zA-Z]/g, "").toLowerCase()).filter((t) => t.length >= 1);
    const longTokens = alphaTokens.filter((t) => t.length >= 3);
    if (longTokens.length === 0) return null;
    return cleaned;
  }

  return null;
}

/**
 * Checks for address structural signals required under Rule 6(1)(a):
 * PIN code, recognized Indian states/cities, corporate designations, address keywords, multi-part structure.
 */
export function hasAddressStructure(raw: string): {
  ok: boolean;
  hasPin: boolean;
  hasStateOrCity: boolean;
  hasEntity: boolean;
  hasAddressKeyword: boolean;
  isMultiPart: boolean;
} {
  const text = cleanText(raw);
  if (!text) {
    return { ok: false, hasPin: false, hasStateOrCity: false, hasEntity: false, hasAddressKeyword: false, isMultiPart: false };
  }

  // 6-digit Indian PIN code (optionally with space like "400 057" or "110001")
  const hasPin = /\b[1-9]\d{5}\b/.test(text) || /\b[1-9]\d{2}\s+\d{3}\b/.test(text);

  // Recognizable Indian states, UTs, and major production hubs/cities
  const hasStateOrCity = /\b(?:andhra\s*pradesh|arunachal\s*pradesh|assam|bihar|chhattisgarh|goa|gujarat|haryana|himachal\s*pradesh|jharkhand|karnataka|kerala|madhya\s*pradesh|maharashtra|manipur|meghalaya|mizoram|nagaland|odisha|punjab|rajasthan|sikkim|tamil\s*nadu|telangana|tripura|uttar\s*pradesh|uttarakhand|west\s*bengal|delhi|new\s*delhi|chandigarh|puducherry|jammu|kashmir|ladakh|mumbai|bengaluru|bangalore|kolkata|calcutta|chennai|madras|hyderabad|pune|ahmedabad|surat|jaipur|lucknow|kanpur|nagpur|indore|bhopal|patna|vadodara|ghaziabad|ludhiana|agra|nashik|faridabad|meerut|rajkot|varanasi|srinagar|aurangabad|dhanbad|amritsar|navi\s*mumbai|allahabad|prayagraj|ranchi|howrah|coimbatore|jabalpur|gwalior|vijayawada|jodhpur|madurai|raipur|kota|guwahati|solan|noida|gurgaon|gurugram|anand|haridwar|baddi|rudrapur|u\.?p\.?|m\.?p\.?|h\.?p\.?|a\.?p\.?)\b/i.test(text);

  // Corporate entity or manufacturer role markers
  const hasEntity = /\b(?:ltd|limited|pvt|private|llp|inc|corp|corporation|enterprises|foods|industries|products|works|mfg|manufactured|marketed|packed|imported|mfd|mfr)\b/i.test(text);

  // Physical address keywords
  const hasAddressKeyword = /\b(?:road|rd|marg|street|st|lane|nagar|plot|sector|sec|phase|industrial\s*area|ind\.?\s*area|midc|gidc|riico|village|vill|taluk|dist|district|city|complex|floor|flr|building|bldg|post|p\.?o\.?|opp|opposite|near|behind|india)\b/i.test(text);

  // Multi-part comma-separated structure (at least 2 components, e.g. "Name, City")
  const parts = text.split(",").map((s) => s.trim()).filter(Boolean);
  const isMultiPart = parts.length >= 2;

  // A complete manufacturer address requires either a PIN code, a state/city with address signals, or multi-part structure
  const ok = (hasPin && (hasEntity || hasAddressKeyword || isMultiPart)) ||
             (hasStateOrCity && (hasEntity || hasAddressKeyword || isMultiPart)) ||
             (isMultiPart && (hasEntity || hasAddressKeyword) && text.length >= 12) ||
             (hasPin && hasStateOrCity);

  return { ok, hasPin, hasStateOrCity, hasEntity, hasAddressKeyword, isMultiPart };
}

/**
 * Normalize manufacturer/packer/importer address.
 * Allows valid entities through so rule engine can evaluate structural address signals.
 * Requires at least one real word (≥3 alpha chars) to reject garbled OCR.
 */
export function normalizeManufacturer(raw: string): string | null {
  const cleaned = cleanText(raw);
  if (!cleaned || cleaned.length < 3) return null;
  // Reject pure numbers or FSSAI license numbers
  if (/^\d+$/.test(cleaned) || /^lic(?:ence)?\s*no/i.test(cleaned)) return null;
  // Extract alphabetic tokens
  const alphaTokens = cleaned
    .split(/\s+/)
    .map((t) => t.replace(/[^a-zA-Z]/g, "").toLowerCase())
    .filter((t) => t.length >= 1);
  if (alphaTokens.length === 0) return null;
  // Need at least one word with ≥3 alpha chars
  const longTokens = alphaTokens.filter((t) => t.length >= 3);
  if (longTokens.length === 0) return null;
  return cleaned;
}

/**
 * Normalize product name.
 * Rejects corrupt non-lexical fragments or strings lacking alphabetic substance.
 *
 * Acceptance criteria (any one is sufficient):
 *   A. Has a token ≥4 letters that is in the PRODUCT_NAME_WORDS dictionary, OR
 *   B. Has a purely alphabetic token ≥5 letters (captures brand-names like JIMJAM,
 *      Kurkure, Horlicks that are not in generic dictionary lists).
 */
export function normalizeProductName(raw: string): string | null {
  const cleaned = cleanText(raw);
  if (!cleaned || cleaned.length < 2) return null;

  // Check that string contains alphabetic characters
  const letters = cleaned.replace(/[^a-zA-Z]/g, "");
  if (letters.length < 3) return null;

  // Reject strings dominated by noise/symbols (> 40% non-alphanumeric)
  const alphaNum = cleaned.replace(/[^a-zA-Z0-9\s]/g, "");
  if (alphaNum.length / cleaned.length < 0.6) return null;

  // Reject obvious date / license fragments
  if (/^(?:\d{1,2}[/.-]\d{2,4}|lic|batch|b\.?no|lot)/i.test(cleaned)) return null;

  // Extract alphabetic word tokens
  const alphaTokens = cleaned
    .split(/\s+/)
    .map((t) => t.replace(/[^a-zA-Z]/g, "").toLowerCase())
    .filter((t) => t.length >= 1);

  // Need at least one alphabetic token
  if (alphaTokens.length === 0) return null;

  // Path A: has a token from the known-words dictionary (≥4 letters)
  const hasRealWord = alphaTokens.some((t) => t.length >= 4 && PRODUCT_NAME_WORDS.has(t));

  // Path B: has a long purely-alphabetic token (≥4 letters) — captures brand names
  // like "OREO", "MILO", "DANO", "JIMJAM", "Kurkure" that aren't in a generic word list.
  // The 4-char minimum excludes 3-letter noise (OCR artifacts) while allowing
  // 4-char brand names. The field-extraction relativeHeight gate provides the
  // geometric evidence that this is actually a brand name and not body-text noise.
  const hasBrandToken = alphaTokens.some((t) => t.length >= 4);

  if (!hasRealWord && !hasBrandToken) return null;

  return cleaned;
}

/**
 * Common English words and Indian FMCG brand tokens found on packaged commodities.
 * Used ONLY for product_name plausibility — missing a word means
 * safe fallback to NOT_DETECTED, never a false DETECTED.
 */
const PRODUCT_NAME_WORDS = new Set([
  "good", "day", "cream", "butter", "milk", "tea", "coffee", "sugar", "salt",
  "noodles", "rice", "wheat", "atta", "flour", "oil", "ghee", "spice", "masala",
  "biscuit", "cookie", "chips", "namkeen", "snack", "mix", "sev", "bhujia",
  "juice", "water", "drink", "cold", "fresh", "pure", "gold", "premium",
  "classic", "original", "special", "magic", "king", "queen", "royal",
  "green", "red", "blue", "white", "black", "yellow", "orange",
  "apple", "mango", "banana", "lemon", "ginger", "garlic", "onion", "tomato",
  "chicken", "fish", "meat", "egg", "paneer", "cheese", "yogurt", "curd",
  "sweet", "hot", "mild", "tasty", "delicious", "healthy",
  "baby", "kids", "family", "happy", "joy", "love", "care", "life",
  "power", "energy", "active", "strong", "smart", "fast", "lite", "light",
  "super", "mega", "ultra", "pro", "max", "plus", "extra", "select",
  "pack", "packets", "mini", "jumbo", "regular", "small", "large",
  "new", "old", "traditional", "homestyle", "homemade", "authentic",
  "india", "indian", "punjabi", "bengali", "gujarati", "south", "north",
  "kitchen", "home", "farm", "garden", "harvest", "field", "nature",
  "tata", "nestle", "amul", "parle", "britannia", "haldiram",
  "noodle", "pasta", "soup", "sauce", "ketchup", "pickle", "chutney",
  "bread", "toast", "rusk", "cake", "pastry", "chocolate", "candy", "toffee",
  "soap", "shampoo", "powder", "lotion", "gel", "spray",
  "tablet", "capsule", "syrup", "drops",
  "pen", "pencil", "paper", "book", "bag", "box", "tin", "can", "bottle",
  "big", "top", "one", "two", "plus", "zero", "five", "ten",
  "net", "wt", "qty", "volume", "size", "weight", "count", "pieces",
  "price", "mrp", "incl", "tax", "taxes",
  "made", "product", "from", "origin", "country",
  "consumer", "care", "helpline", "toll", "free", "phone", "email",
  "website", "address", "contact", "service", "support", "help",
  "ltd", "limited", "pvt", "private", "enterprises", "foods", "industries",
  "products", "works", "company", "corp", "inc",
  // Indian FMCG brand tokens — explicitly added so brand names are
  // accepted even when they don't match the common English word list.
  "jimjam", "bikis", "nutrichoice", "tiger", "bourbon", "marie",
  "kurkure", "horlicks", "bournvita", "complan", "protinex",
  "glucond", "electral", "hajmola", "chyawanprash", "ashirvaad",
  "yippee", "sunfeast", "maggi", "kissan", "knorr", "haldirams",
  "saffola", "parachute", "vatika", "himalaya", "dabur", "zandu",
  "volini", "iodex", "vicks", "pepsodent", "closeup", "colgate",
  "dettol", "lifebuoy", "nixoderm", "rexona", "clinic", "pantene",
  "garnier", "nivea", "vaseline", "johnson", "pampers", "huggies",
  "whisper", "stayfree", "tropicana", "frooti", "appy", "sprite",
  "fanta", "pepsi", "thums", "bisleri", "kinley", "aquafina",
  "revital", "supradyn", "becosules", "crocin", "paracetamol",
  "glucose", "marie", "oreo", "bourbon", "bourbon", "parleg",
  "milkmaid", "nandini", "epigamia", "weikfield", "bagrrys", "kelloggs",
  "munch", "kitkat", "alpenliebe", "eclairs", "melody", "pulse",
  "bikano", "muncho", "tooyumm", "popcorn", "lays", "kurkure",
]);


/**
 * Normalize country of origin.
 * Cleans prefix phrases while preserving the declared country.
 */
export function normalizeCountryOfOrigin(raw: string): string | null {
  const cleaned = cleanText(raw);
  if (!cleaned || cleaned.length < 2) return null;

  // Reject generic non-country text or FSSAI
  if (/fssai|lic\.?\s*no|batch|mrp|₹/i.test(cleaned)) return null;

  // Reject if garbled: no real word of ≥3 alpha chars
  if (!/[a-zA-Z]{3,}/.test(cleaned)) return null;

  // Check if text explicitly matches country of origin patterns
  const match = cleaned.match(/(?:country\s*of\s*origin|origin|made\s*in|product\s*of|manufactured\s*in|imported\s*from)\s*[:.-]?\s*([a-zA-Z\s]{2,25})/i);
  if (match) {
    const candidate = match[1].trim();
    if (candidate.length < 2 || !/[a-zA-Z]{3,}/.test(candidate)) return null;
    return candidate.charAt(0).toUpperCase() + candidate.slice(1).toLowerCase();
  }

  // If text is already a recognized country name (e.g. from region crop)
  const knownCountries = ["india", "bharat", "china", "usa", "germany", "japan", "bangladesh", "sri lanka", "nepal", "vietnam", "thailand", "indonesia", "malaysia", "italy", "france", "united kingdom", "uk"];
  const lower = cleaned.toLowerCase().trim();
  for (const c of knownCountries) {
    if (lower === c || lower.startsWith(`${c} `) || lower.endsWith(` ${c}`)) {
      return c.charAt(0).toUpperCase() + c.slice(1);
    }
  }

  return null;
}
