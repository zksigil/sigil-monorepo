// TD3 passport MRZ parsing (ICAO 9303-3).
//
// Line 2 is 44 characters and contains every field we need to derive the BAC
// session keys: document number, date of birth, date of expiry — plus a
// nationality field we surface for display.
//
// Layout:
//   [0-8]   Document number     — alphanumeric
//   [9]     Check digit         — over [0-8]
//   [10-12] Nationality         — alpha
//   [13-18] Date of birth       — YYMMDD
//   [19]    Check digit         — over [13-18]
//   [20]    Sex                 — M / F / <
//   [21-26] Date of expiry      — YYMMDD
//   [27]    Check digit         — over [21-26]
//   [28-41] Optional data       — alphanumeric
//   [42]    Check digit         — over [28-41] (or '<' if optional empty)
//   [43]    Composite check     — over [0-9, 13-19, 21-27, 28-42]

export interface MRZInput {
  documentNumber: string;
  dateOfBirth: string;
  dateOfExpiry: string;
  nationality: string;
}

export const TD3_LINE_LENGTH = 44 as const;

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

/**
 * Strip whitespace and characters that cannot appear in an MRZ. OCR sometimes
 * inserts dots or hyphens where the chip uses the filler `<`, so we coerce
 * those before any further parsing.
 */
export function normalizeMRZLine(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/[^A-Z0-9<.\-]/g, '')
    .replace(/\./g, '<')
    .replace(/-/g, '<');
}

/** Coerce a character that must be a digit. Common OCR confusions only. */
function toDigit(ch: string): string {
  switch (ch) {
    case 'O': return '0';
    case 'I':
    case 'L': return '1';
    case 'Z': return '2';
    case 'S': return '5';
    case 'G': return '6';
    case 'T': return '7';
    case 'B': return '8';
    default:  return ch;
  }
}

/** Coerce a character that must be alpha. Common OCR confusions only. */
function toAlpha(ch: string): string {
  switch (ch) {
    case '0': return 'O';
    case '1': return 'I';
    case '8': return 'B';
    case '6': return 'G';
    default:  return ch;
  }
}

/**
 * Apply position-aware character corrections to a 44-character TD3 line 2.
 * Each position has a known character class; if OCR returned a value from the
 * wrong class, we map it to the most likely intended character.
 */
export function applyPositionNorm(line: string): string {
  const digitPositions = new Set([9, 13, 14, 15, 16, 17, 18, 19, 21, 22, 23, 24, 25, 26, 27, 43]);
  const alphaPositions = new Set([10, 11, 12, 20]);

  return line
    .split('')
    .map((ch, i) => {
      if (digitPositions.has(i)) return toDigit(ch);
      if (alphaPositions.has(i)) return toAlpha(ch);
      return ch;
    })
    .join('');
}

// ---------------------------------------------------------------------------
// Country code dictionary
// ---------------------------------------------------------------------------

/**
 * Valid ICAO 9303 issuing-state / nationality codes. Comprises ISO 3166-1
 * alpha-3 plus MRZ specials (UTO test code, refugee/stateless codes, UN /
 * intergovernmental codes). Used to correct OCR misreads (e.g. `OSA`→`USA`).
 */
const VALID_COUNTRY_CODES: ReadonlySet<string> = new Set([
  'ABW','AFG','AGO','AIA','ALA','ALB','AND','ARE','ARG','ARM','ASM','ATA',
  'ATF','ATG','AUS','AUT','AZE','BDI','BEL','BEN','BES','BFA','BGD','BGR',
  'BHR','BHS','BIH','BLM','BLR','BLZ','BMU','BOL','BRA','BRB','BRN','BTN',
  'BVT','BWA','CAF','CAN','CCK','CHE','CHL','CHN','CIV','CMR','COD','COG',
  'COK','COL','COM','CPV','CRI','CUB','CUW','CXR','CYM','CYP','CZE','DEU',
  'DJI','DMA','DNK','DOM','DZA','ECU','EGY','ERI','ESH','ESP','EST','ETH',
  'FIN','FJI','FLK','FRA','FRO','FSM','GAB','GBR','GEO','GGY','GHA','GIB',
  'GIN','GLP','GMB','GNB','GNQ','GRC','GRD','GRL','GTM','GUF','GUM','GUY',
  'HKG','HMD','HND','HRV','HTI','HUN','IDN','IMN','IND','IOT','IRL','IRN',
  'IRQ','ISL','ISR','ITA','JAM','JEY','JOR','JPN','KAZ','KEN','KGZ','KHM',
  'KIR','KNA','KOR','KWT','LAO','LBN','LBR','LBY','LCA','LIE','LKA','LSO',
  'LTU','LUX','LVA','MAC','MAF','MAR','MCO','MDA','MDG','MDV','MEX','MHL',
  'MKD','MLI','MLT','MMR','MNE','MNG','MNP','MOZ','MRT','MSR','MTQ','MUS',
  'MWI','MYS','MYT','NAM','NCL','NER','NFK','NGA','NIC','NIU','NLD','NOR',
  'NPL','NRU','NZL','OMN','PAK','PAN','PCN','PER','PHL','PLW','PNG','POL',
  'PRI','PRK','PRT','PRY','PSE','PYF','QAT','REU','ROU','RUS','RWA','SAU',
  'SDN','SEN','SGP','SGS','SHN','SJM','SLB','SLE','SLV','SMR','SOM','SPM',
  'SRB','SSD','STP','SUR','SVK','SVN','SWE','SWZ','SXM','SYC','SYR','TCA',
  'TCD','TGO','THA','TJK','TKL','TKM','TLS','TON','TTO','TUN','TUR','TUV',
  'TWN','TZA','UGA','UKR','UMI','URY','USA','UZB','VAT','VCT','VEN','VGB',
  'VIR','VNM','VUT','WLF','WSM','YEM','ZAF','ZMB','ZWE',
  // ICAO 9303 specials
  'UTO','XXA','XXB','XXC','XBA','XPO','XOM','EUE','GBD','GBN','GBO','GBP',
  'GBS','UNO','UNA','UNK',
]);

/**
 * Snap a candidate nationality to the closest valid ICAO 3-letter code if
 * exactly one such code lies within edit distance 1 (Hamming, since lengths
 * match). Common OCR confusions like U↔O are unambiguous in nearly every
 * code — `OSA` has only `USA` as a neighbour, so we correct it. If the
 * candidate is already valid, or has 0 or 2+ neighbours, we leave it alone.
 */
export function correctNationality(raw: string): string {
  if (raw.length !== 3) return raw;
  if (VALID_COUNTRY_CODES.has(raw)) return raw;

  let match: string | null = null;
  for (const code of VALID_COUNTRY_CODES) {
    let diffs = 0;
    for (let i = 0; i < 3; i++) {
      if (raw.charCodeAt(i) !== code.charCodeAt(i)) {
        diffs++;
        if (diffs > 1) break;
      }
    }
    if (diffs === 1) {
      if (match !== null) return raw; // ambiguous — refuse to guess
      match = code;
    }
  }
  return match ?? raw;
}

// ---------------------------------------------------------------------------
// Check digits (ICAO 9303-3 §4.9)
// ---------------------------------------------------------------------------

const CHECK_WEIGHTS = [7, 3, 1] as const;

/**
 * Compute the ICAO 9303 check digit for a string. Returns null if the string
 * contains a character outside the allowed alphabet ([A-Z0-9<]).
 */
export function computeCheckDigit(input: string): string | null {
  let sum = 0;
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    let value: number;
    if (code >= 48 && code <= 57) value = code - 48;       // 0–9
    else if (code >= 65 && code <= 90) value = code - 55;  // A=10..Z=35
    else if (code === 60) value = 0;                       // '<'
    else return null;
    sum += value * CHECK_WEIGHTS[i % 3]!;
  }
  return String(sum % 10);
}

// ---------------------------------------------------------------------------
// Parse
// ---------------------------------------------------------------------------

export interface ParseResult {
  fields: MRZInput;
  /** Per-field check-digit results, true == matched. */
  checks: { documentNumber: boolean; dateOfBirth: boolean; dateOfExpiry: boolean };
}

/**
 * Parse a 44-character TD3 line 2 into MRZInput plus the three check-digit
 * results we care about. Returns null only when the line is structurally
 * unparseable (wrong length, non-MRZ chars, or impossible date format) — the
 * caller decides whether check-digit failures are tolerated.
 */
export function parseMRZLine2(raw44: string): ParseResult | null {
  if (raw44.length < TD3_LINE_LENGTH) return null;
  const line = applyPositionNorm(raw44.substring(0, TD3_LINE_LENGTH));

  const docNumRaw  = line.substring(0, 9);
  const docCheck   = line[9];
  const nationalityRaw = line.substring(10, 13).replace(/</g, '');
  const nationality = correctNationality(nationalityRaw);
  const dob        = line.substring(13, 19);
  const dobCheck   = line[19];
  const expiry     = line.substring(21, 27);
  const expiryCheck = line[27];

  if (!/^\d{6}$/.test(dob) || !/^\d{6}$/.test(expiry)) return null;
  if (!/^[A-Z]{0,3}$/.test(nationality)) return null;

  const docNumStripped = docNumRaw.replace(/</g, '');
  if (!docNumStripped) return null;

  return {
    fields: {
      documentNumber: docNumStripped,
      nationality,
      dateOfBirth: dob,
      dateOfExpiry: expiry,
    },
    checks: {
      documentNumber: computeCheckDigit(docNumRaw) === docCheck,
      dateOfBirth: computeCheckDigit(dob) === dobCheck,
      dateOfExpiry: computeCheckDigit(expiry) === expiryCheck,
    },
  };
}

/** All three check digits matched — strong signal the parse is correct. */
export function allChecksPass(checks: ParseResult['checks']): boolean {
  return checks.documentNumber && checks.dateOfBirth && checks.dateOfExpiry;
}

/**
 * Find and parse MRZ data from a list of raw OCR text lines, preferring
 * candidates closest to 44 characters and those whose check digits validate.
 * Returns the best result found, or null if no line could be parsed at all.
 */
export function parseMRZFromOCRText(rawLines: string[]): ParseResult | null {
  const candidates = rawLines
    .map(normalizeMRZLine)
    .filter((l) => l.length >= 30)
    .sort((a, b) => Math.abs(TD3_LINE_LENGTH - a.length) - Math.abs(TD3_LINE_LENGTH - b.length));

  let fallback: ParseResult | null = null;
  for (const candidate of candidates) {
    const padded = candidate.padEnd(TD3_LINE_LENGTH, '<').substring(0, TD3_LINE_LENGTH);
    const result = parseMRZLine2(padded);
    if (!result) continue;
    if (allChecksPass(result.checks)) return result;
    fallback ??= result;
  }
  return fallback;
}

// ---------------------------------------------------------------------------
// Convenience
// ---------------------------------------------------------------------------

export function isMRZComplete(mrz: MRZInput): boolean {
  return (
    mrz.documentNumber.length > 0 &&
    mrz.dateOfBirth.length === 6 &&
    mrz.dateOfExpiry.length === 6 &&
    mrz.nationality.length === 3
  );
}
