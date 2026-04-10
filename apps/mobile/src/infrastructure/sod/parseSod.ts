/**
 * SOD (Security Object Document) DER parser.
 *
 * Extracts fields from the DER-encoded CMS SignedData (ICAO 9303 SOD)
 * needed for RSA signature verification inside the ZK circuit.
 *
 * SOD structure (CMS ContentInfo):
 *   SEQUENCE {
 *     OID 1.2.840.113549.1.7.2 (signedData)
 *     [0] EXPLICIT {
 *       SEQUENCE (SignedData) {
 *         INTEGER (version = 3)
 *         SET { digestAlgorithms }
 *         SEQUENCE { encapContentInfo — contains eContent with DG hashes }
 *         [0] IMPLICIT { certificates — DSC cert with RSA public key }
 *         SET { signerInfos — signature + signedAttrs }
 *       }
 *     }
 *   }
 *
 * Key gotcha (RFC 5652 Section 5.4): signedAttrs in the original encoding
 * uses IMPLICIT [0] tag (0xA0). For signature verification, this must be
 * re-encoded with EXPLICIT SET tag (0x31) before hashing.
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ParsedSOD {
  /** signedAttrs bytes with tag replaced: 0xA0 -> 0x31 (ready for SHA-256 + RSA verify). */
  signedAttrs: Uint8Array;
  /** RSA signature bytes from signerInfo (256 bytes for RSA-2048). */
  signature: Uint8Array;
  /** RSA modulus bytes from DSC certificate (256 bytes for RSA-2048). */
  pubkeyModulus: Uint8Array;
  /** RSA public exponent (usually 65537). */
  exponent: number;
  /** Raw DER bytes of all certificates found in the SOD's certificates field. */
  certificates: Uint8Array[];
}

// ---------------------------------------------------------------------------
// DER tag constants
// ---------------------------------------------------------------------------

const TAG_SEQUENCE = 0x30;
const TAG_SET = 0x31;
const TAG_INTEGER = 0x02;
const TAG_OID = 0x06;
const TAG_OCTET_STRING = 0x04;
const TAG_BIT_STRING = 0x03;
const TAG_CONTEXT_0 = 0xa0;


// OID for signedData: 1.2.840.113549.1.7.2
const SIGNED_DATA_OID = [0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x07, 0x02];

// OID for rsaEncryption: 1.2.840.113549.1.1.1
const RSA_ENCRYPTION_OID = [0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01];

// ---------------------------------------------------------------------------
// Main parser
// ---------------------------------------------------------------------------

/**
 * Parse a raw SOD (DER-encoded CMS SignedData) and extract the fields needed
 * for RSA-2048 signature verification in the ZK circuit.
 *
 * @param sodHex Hex-encoded SOD bytes (with or without 0x prefix).
 * @returns Parsed SOD fields.
 * @throws If the SOD structure is malformed or uses unsupported algorithms.
 */
export function parseSod(sodHex: string): ParsedSOD {
  const hex = sodHex.startsWith('0x') ? sodHex.slice(2) : sodHex;
  const data = hexToBytes(hex);

  // Find the start of the CMS ContentInfo (may be wrapped in 0x77 ICAO tag)
  const pos = findInnerContentInfo(data);

  // ContentInfo SEQUENCE
  const contentInfo = readTagLength(data, pos);
  assertTag(data, pos, TAG_SEQUENCE, 'ContentInfo');

  // OID (should be signedData)
  const oid = readTagLength(data, contentInfo.contentStart);
  assertTag(data, contentInfo.contentStart, TAG_OID, 'ContentInfo OID');
  const oidBytes = data.slice(oid.contentStart, oid.contentStart + oid.length);
  if (!arraysEqual(oidBytes, SIGNED_DATA_OID)) {
    throw new Error('SOD is not CMS SignedData');
  }

  // [0] EXPLICIT wrapping the SignedData SEQUENCE
  const ctx0 = readTagLength(data, oid.end);
  assertTag(data, oid.end, TAG_CONTEXT_0, 'SignedData [0] wrapper');

  // SignedData SEQUENCE
  const signedData = readTagLength(data, ctx0.contentStart);
  assertTag(data, ctx0.contentStart, TAG_SEQUENCE, 'SignedData');

  // Parse SignedData children
  let cursor = signedData.contentStart;
  const signedDataEnd = signedData.end;

  // 1. version INTEGER
  const version = readTagLength(data, cursor);
  assertTag(data, cursor, TAG_INTEGER, 'version');
  cursor = version.end;

  // 2. digestAlgorithms SET
  const digestAlgos = readTagLength(data, cursor);
  assertTag(data, cursor, TAG_SET, 'digestAlgorithms');
  cursor = digestAlgos.end;

  // 3. encapContentInfo SEQUENCE
  const encapContent = readTagLength(data, cursor);
  assertTag(data, cursor, TAG_SEQUENCE, 'encapContentInfo');
  cursor = encapContent.end;

  // 4. [0] IMPLICIT certificates (optional but expected in passport SODs)
  let certificates: { contentStart: number; length: number; end: number } | null = null;
  if (cursor < signedDataEnd && data[cursor]! === TAG_CONTEXT_0) {
    certificates = readTagLength(data, cursor);
    cursor = certificates.end;
  }

  // 5. [1] IMPLICIT crls (optional, skip if present)
  if (cursor < signedDataEnd && data[cursor]! === 0xa1) {
    const crls = readTagLength(data, cursor);
    cursor = crls.end;
  }

  // 6. signerInfos SET
  const signerInfosSet = readTagLength(data, cursor);
  assertTag(data, cursor, TAG_SET, 'signerInfos');

  // Parse first (and typically only) signerInfo
  const signerInfo = readTagLength(data, signerInfosSet.contentStart);
  assertTag(data, signerInfosSet.contentStart, TAG_SEQUENCE, 'signerInfo');

  const { signedAttrs, signature } = parseSignerInfo(data, signerInfo);

  // Extract RSA public key from the first certificate
  if (!certificates) {
    throw new Error('No certificates found in SOD');
  }
  const { modulus, exponent } = extractRSAPublicKey(data, certificates);

  // Extract all certificate DER blobs for off-circuit chain verification
  const allCerts = extractAllCertificates(data, certificates);

  return {
    signedAttrs,
    signature,
    pubkeyModulus: modulus,
    exponent,
    certificates: allCerts,
  };
}

/**
 * Extract ALL certificates from the SOD's certificates field.
 * Returns raw DER bytes for each certificate.
 */
function extractAllCertificates(
  data: Uint8Array,
  certificates: { contentStart: number; length: number; end: number },
): Uint8Array[] {
  const certs: Uint8Array[] = [];
  let cursor = certificates.contentStart;
  while (cursor < certificates.end) {
    const cert = readTagLength(data, cursor);
    assertTag(data, cursor, TAG_SEQUENCE, 'Certificate');
    certs.push(data.slice(cursor, cert.end));
    cursor = cert.end;
  }
  return certs;
}

// ---------------------------------------------------------------------------
// SignerInfo parser
// ---------------------------------------------------------------------------

interface SignerInfoFields {
  /** signedAttrs with 0xA0 tag replaced by 0x31 (for hashing). */
  signedAttrs: Uint8Array;
  /** Raw signature bytes. */
  signature: Uint8Array;
}

function parseSignerInfo(
  data: Uint8Array,
  signerInfo: { contentStart: number; end: number },
): SignerInfoFields {
  let cursor = signerInfo.contentStart;

  // version INTEGER
  const version = readTagLength(data, cursor);
  assertTag(data, cursor, TAG_INTEGER, 'signerInfo version');
  cursor = version.end;

  // sid (issuerAndSerialNumber) SEQUENCE
  const sid = readTagLength(data, cursor);
  assertTag(data, cursor, TAG_SEQUENCE, 'signerInfo sid');
  cursor = sid.end;

  // digestAlgorithm AlgorithmIdentifier SEQUENCE
  const digestAlg = readTagLength(data, cursor);
  assertTag(data, cursor, TAG_SEQUENCE, 'signerInfo digestAlgorithm');
  cursor = digestAlg.end;

  // signedAttrs [0] IMPLICIT
  if (data[cursor]! !== TAG_CONTEXT_0) {
    throw new Error(`Expected signedAttrs [0] tag at offset ${cursor}, got 0x${data[cursor]!.toString(16)}`);
  }
  const signedAttrsRaw = readTagLength(data, cursor);
  // Re-encode: replace 0xA0 with 0x31 (SET tag) for signature verification
  const signedAttrsBytes = data.slice(cursor, signedAttrsRaw.end);
  const signedAttrs = new Uint8Array(signedAttrsBytes);
  signedAttrs[0] = TAG_SET; // 0xA0 -> 0x31
  cursor = signedAttrsRaw.end;

  // signatureAlgorithm AlgorithmIdentifier SEQUENCE
  const sigAlg = readTagLength(data, cursor);
  assertTag(data, cursor, TAG_SEQUENCE, 'signatureAlgorithm');
  cursor = sigAlg.end;

  // signature OCTET STRING
  const sigTlv = readTagLength(data, cursor);
  assertTag(data, cursor, TAG_OCTET_STRING, 'signature');
  const signature = data.slice(sigTlv.contentStart, sigTlv.end);

  return { signedAttrs, signature };
}

// ---------------------------------------------------------------------------
// Certificate / RSA public key extraction
// ---------------------------------------------------------------------------

interface RSAPublicKey {
  modulus: Uint8Array;
  exponent: number;
}

function extractRSAPublicKey(
  data: Uint8Array,
  certificates: { contentStart: number; length: number; end: number },
): RSAPublicKey {
  // certificates is [0] IMPLICIT containing one or more Certificate SEQUENCEs
  // Parse the first certificate
  const cert = readTagLength(data, certificates.contentStart);
  assertTag(data, certificates.contentStart, TAG_SEQUENCE, 'Certificate');

  // TBSCertificate SEQUENCE
  const tbs = readTagLength(data, cert.contentStart);
  assertTag(data, cert.contentStart, TAG_SEQUENCE, 'TBSCertificate');

  // Walk TBSCertificate to find SubjectPublicKeyInfo
  let cursor = tbs.contentStart;

  // [0] EXPLICIT version (optional, but usually present in v3 certs)
  if (data[cursor]! === TAG_CONTEXT_0) {
    const v = readTagLength(data, cursor);
    cursor = v.end;
  }

  // serialNumber INTEGER
  const serial = readTagLength(data, cursor);
  assertTag(data, cursor, TAG_INTEGER, 'serialNumber');
  cursor = serial.end;

  // signature AlgorithmIdentifier SEQUENCE
  const sigAlg = readTagLength(data, cursor);
  assertTag(data, cursor, TAG_SEQUENCE, 'cert signature alg');
  cursor = sigAlg.end;

  // issuer Name SEQUENCE
  const issuer = readTagLength(data, cursor);
  assertTag(data, cursor, TAG_SEQUENCE, 'issuer');
  cursor = issuer.end;

  // validity SEQUENCE
  const validity = readTagLength(data, cursor);
  assertTag(data, cursor, TAG_SEQUENCE, 'validity');
  cursor = validity.end;

  // subject Name SEQUENCE
  const subject = readTagLength(data, cursor);
  assertTag(data, cursor, TAG_SEQUENCE, 'subject');
  cursor = subject.end;

  // SubjectPublicKeyInfo SEQUENCE
  const spki = readTagLength(data, cursor);
  assertTag(data, cursor, TAG_SEQUENCE, 'SubjectPublicKeyInfo');

  return parseRSAPublicKey(data, spki);
}

function parseRSAPublicKey(
  data: Uint8Array,
  spki: { contentStart: number; end: number },
): RSAPublicKey {
  let cursor = spki.contentStart;

  // algorithm AlgorithmIdentifier SEQUENCE
  const algId = readTagLength(data, cursor);
  assertTag(data, cursor, TAG_SEQUENCE, 'SPKI algorithm');

  // Check it's rsaEncryption
  const algOid = readTagLength(data, algId.contentStart);
  assertTag(data, algId.contentStart, TAG_OID, 'SPKI algorithm OID');
  const algOidBytes = data.slice(algOid.contentStart, algOid.contentStart + algOid.length);
  if (!arraysEqual(algOidBytes, RSA_ENCRYPTION_OID)) {
    throw new Error('DSC certificate does not use RSA encryption (unsupported algorithm)');
  }
  cursor = algId.end;

  // subjectPublicKey BIT STRING
  const bitString = readTagLength(data, cursor);
  assertTag(data, cursor, TAG_BIT_STRING, 'subjectPublicKey');

  // BIT STRING has a leading "unused bits" byte (should be 0)
  const unusedBits = data[bitString.contentStart]!;
  if (unusedBits !== 0) {
    throw new Error(`Unexpected unused bits in public key BIT STRING: ${unusedBits}`);
  }

  // The BIT STRING content (after unused bits byte) is a DER-encoded RSAPublicKey SEQUENCE
  const rsaPubKeyStart = bitString.contentStart + 1;
  const rsaPubKey = readTagLength(data, rsaPubKeyStart);
  assertTag(data, rsaPubKeyStart, TAG_SEQUENCE, 'RSAPublicKey');

  // modulus INTEGER
  const modInt = readTagLength(data, rsaPubKey.contentStart);
  assertTag(data, rsaPubKey.contentStart, TAG_INTEGER, 'modulus');
  let modulus = data.slice(modInt.contentStart, modInt.contentStart + modInt.length);
  // Strip leading zero byte if present (DER INTEGER encoding for positive numbers)
  if (modulus[0]! === 0x00 && modulus.length > 1) {
    modulus = modulus.slice(1);
  }

  // publicExponent INTEGER
  const expInt = readTagLength(data, modInt.end);
  assertTag(data, modInt.end, TAG_INTEGER, 'publicExponent');
  const expBytes = data.slice(expInt.contentStart, expInt.contentStart + expInt.length);
  let exponent = 0;
  for (const b of expBytes) {
    exponent = exponent * 256 + b;
  }

  return { modulus: new Uint8Array(modulus), exponent };
}

// ---------------------------------------------------------------------------
// DER TLV helpers
// ---------------------------------------------------------------------------

interface TLV {
  tag: number;
  /** Start of the content (after tag + length bytes). */
  contentStart: number;
  /** Length of the content. */
  length: number;
  /** Position right after this TLV element. */
  end: number;
}

function readTagLength(data: Uint8Array, offset: number): TLV {
  if (offset >= data.length) {
    throw new Error(`DER read past end of data at offset ${offset}`);
  }

  const tag = data[offset]!;
  let pos = offset + 1;

  if (pos >= data.length) {
    throw new Error(`DER length missing at offset ${pos}`);
  }

  let length: number;
  let indefinite = false;
  const firstLenByte = data[pos]!;
  pos++;

  if (firstLenByte < 0x80) {
    // Short form
    length = firstLenByte;
  } else if (firstLenByte === 0x80) {
    // Indefinite length (BER) — scan for end-of-contents octets (0x00 0x00).
    // Real-world passport SODs often use BER even though DER forbids it.
    length = findIndefiniteLength(data, pos);
    indefinite = true;
  } else {
    // Long form
    const numLenBytes = firstLenByte & 0x7f;
    if (numLenBytes > 4) {
      throw new Error(`DER length encoding too long: ${numLenBytes} bytes at offset ${offset}`);
    }
    length = 0;
    for (let i = 0; i < numLenBytes; i++) {
      length = length * 256 + data[pos]!;
      pos++;
    }
  }

  // For indefinite-length, end must skip past the 2-byte EOC marker (0x00 0x00)
  const end = pos + length + (indefinite ? 2 : 0);

  return {
    tag,
    contentStart: pos,
    length,
    end,
  };
}

/**
 * Find the content length for an indefinite-length BER element.
 * Scans forward from `contentStart`, walking nested TLVs, until it finds
 * the end-of-contents octets (0x00 0x00). Returns the number of content
 * bytes (excluding the EOC marker).
 */
function findIndefiniteLength(data: Uint8Array, contentStart: number): number {
  let pos = contentStart;
  while (pos < data.length - 1) {
    // End-of-contents marker
    if (data[pos]! === 0x00 && data[pos + 1]! === 0x00) {
      return pos - contentStart;
    }
    // Skip over a nested TLV element
    const nested = readTagLength(data, pos);
    pos = nested.end;
  }
  throw new Error(`No end-of-contents found for indefinite-length element starting at ${contentStart}`);
}

// ---------------------------------------------------------------------------
// EF.SOD wrapper handling
// ---------------------------------------------------------------------------

/**
 * Find the start of the CMS ContentInfo SEQUENCE inside an EF.SOD file.
 * EF.SOD may be wrapped in a 0x77 tag (ICAO), or start directly with 0x30.
 */
function findInnerContentInfo(data: Uint8Array): number {
  if (data[0]! === TAG_SEQUENCE) {
    return 0; // Already a bare ContentInfo
  }

  if (data[0]! === 0x77) {
    // ICAO EF.SOD wrapper: 0x77 <len> <ContentInfo>
    const wrapper = readTagLength(data, 0);
    return wrapper.contentStart;
  }

  throw new Error(`Unexpected SOD outer tag: 0x${data[0]!.toString(16)}`);
}

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

function assertTag(data: Uint8Array, offset: number, expected: number, label: string): void {
  const actual = data[offset];
  if (actual !== expected) {
    throw new Error(
      `Expected ${label} tag 0x${expected.toString(16)} at offset ${offset}, ` +
      `got 0x${(actual ?? 0).toString(16)}`,
    );
  }
}

function arraysEqual(a: Uint8Array | number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.length % 2 === 0 ? hex : '0' + hex;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ---------------------------------------------------------------------------
// Certificate chain verification (off-circuit)
// ---------------------------------------------------------------------------

export interface ParsedCert {
  raw: Uint8Array;
  /** DER-encoded TBSCertificate (the signed portion). */
  tbsBytes: Uint8Array | null;
  /** RSA signature bytes from the cert's signature field. */
  signatureBytes: Uint8Array | null;
  /** Signature algorithm OID (e.g. '1.2.840.113549.1.1.11' = sha256WithRSAEncryption). */
  sigAlgOid: string | null;
  modulus: Uint8Array | null;
  exponent: number | null;
  subject: Uint8Array | null;
  issuer: Uint8Array | null;
}

export interface ChainVerificationResult {
  valid: boolean;
  dscModulusHex: string;
  cscaModulusHex: string | null;
  cscaName: string | null;
  cscaSource: 'in_sod_chain' | 'issuer_dn_match' | 'not_found';
  error: string | null;
}

function parseCertificate(derBytes: Uint8Array): ParsedCert | null {
  try {
    const cert = readTagLength(derBytes, 0);
    if (cert.tag !== TAG_SEQUENCE) return null;
    const tbs = readTagLength(derBytes, cert.contentStart);
    if (tbs.tag !== TAG_SEQUENCE) return null;
    let c = tbs.contentStart;
    if (derBytes[c]! === TAG_CONTEXT_0) { const v = readTagLength(derBytes, c); c = v.end; }
    const serial = readTagLength(derBytes, c); c = serial.end;
    const sigAlg = readTagLength(derBytes, c);
    // Extract signature algorithm OID
    const algOid = readTagLength(derBytes, sigAlg.contentStart);
    const sigAlgOidHex = bytesToHex(derBytes.slice(algOid.contentStart, algOid.contentStart + algOid.length));
    c = sigAlg.end;
    const issuer = readTagLength(derBytes, c);
    const issuerBytes = derBytes.slice(issuer.contentStart, issuer.end);
    c = issuer.end;
    const validity = readTagLength(derBytes, c); c = validity.end;
    const subject = readTagLength(derBytes, c);
    const subjectBytes = derBytes.slice(subject.contentStart, subject.end);
    c = subject.end;
    const spki = readTagLength(derBytes, c);
    c = spki.end;

    let modulus: Uint8Array | null = null;
    let exponent: number | null = null;
    try {
      const pubkey = parseRSAPublicKey(derBytes, spki);
      modulus = pubkey.modulus;
      exponent = pubkey.exponent;
    } catch { /* not RSA */ }

    // Extract the signature value from after the SPKI
    const sigTlv = readTagLength(derBytes, c);
    const signatureBytes = sigTlv.tag === TAG_BIT_STRING
      ? derBytes.slice(sigTlv.contentStart + 1, sigTlv.end) // skip unused-bits byte
      : derBytes.slice(sigTlv.contentStart, sigTlv.end);

    return {
      raw: derBytes,
      tbsBytes: derBytes.slice(tbs.contentStart, tbs.end),
      signatureBytes,
      sigAlgOid: sigAlgOidHex,
      modulus,
      exponent,
      subject: subjectBytes,
      issuer: issuerBytes,
    };
  } catch {
    return null;
  }
}

interface CSCAEntry {
  modulus_hex: string;
  exponent: number;
  common_name: string | null;
  country: string | null;
}

let _cscaByModulus: Map<string, CSCAEntry> | null = null;
let _cscasByCountry: Map<string, CSCAEntry[]> | null = null;

function getCscaByModulus(): Map<string, CSCAEntry> {
  if (!_cscaByModulus) {
    _cscaByModulus = new Map();
    const raw = require('../../../../../certs/cscas.json');
    for (const e of (raw as CSCAEntry[])) {
      _cscaByModulus!.set(e.modulus_hex.toLowerCase(), e);
    }
  }
  return _cscaByModulus;
}

/**
 * Get CSCAs grouped by country code. Used to filter candidates
 * when verifying DSC signatures (much faster than trying all 269).
 */
function getCscasByCountry(): Map<string, CSCAEntry[]> {
  if (!_cscasByCountry) {
    _cscasByCountry = new Map();
    const raw = require('../../../../../certs/cscas.json');
    for (const e of (raw as CSCAEntry[])) {
      const cc = e.country || '??';
      if (!_cscasByCountry!.has(cc)) _cscasByCountry!.set(cc, []);
      _cscasByCountry!.get(cc)!.push(e);
    }
  }
  return _cscasByCountry;
}

/**
 * Extract country code (C=XX) from a DER-encoded DN.
 * OID for countryName: 2.5.4.6 = 55 04 06
 */
function extractCountryCodeFromDN(derBytes: Uint8Array): string | null {
  try {
    const outer = readTagLength(derBytes, 0);
    if (outer.tag !== 0x30) return null;
    let c = outer.contentStart;
    while (c < outer.end) {
      const rdn = readTagLength(derBytes, c);
      if (rdn.tag !== 0x31) { c = rdn.end; continue; }
      const attr = readTagLength(derBytes, rdn.contentStart);
      if (attr.tag !== 0x30) { c = rdn.end; continue; }
      const oid = readTagLength(derBytes, attr.contentStart);
      if (oid.tag !== 0x06) { c = rdn.end; continue; }
      const oidHex = bytesToHex(derBytes.slice(oid.contentStart, oid.contentStart + oid.length));
      if (oidHex === '550406') {
        // Country code is PrintableString (0x13) or UTF8String (0x0c)
        const val = readTagLength(derBytes, oid.end);
        return new TextDecoder().decode(derBytes.slice(val.contentStart, val.contentStart + val.length));
      }
      c = rdn.end;
    }
  } catch { /* skip */ }
  return null;
}

/**
 * Build a DER-encoded SubjectPublicKeyInfo for an RSA public key.
 * Needed to import the key into Web Crypto for signature verification.
 */
function buildSPKIForRSA(modulus: Uint8Array, exponent: number): ArrayBuffer {
  // OID: 1.2.840.113549.1.1.1 (rsaEncryption)
  const rsaOid = new Uint8Array([0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01]);
  const nullParam = new Uint8Array([0x05, 0x00]);
  const algId = concatUint8Arrays([rsaOid, nullParam]);
  const algIdTlv = new Uint8Array([TAG_SEQUENCE, algId.length, ...algId]);

  // RSAPublicKey SEQUENCE: SEQUENCE { INTEGER modulus, INTEGER exponent }
  let modBytes = modulus;
  if (modBytes[0]! >= 0x80) modBytes = concatUint8Arrays([new Uint8Array([0x00]), modBytes]);
  const modInt = new Uint8Array([TAG_INTEGER, modBytes.length, ...modBytes]);

  let expVal = exponent;
  const expBytesArr: number[] = [];
  do { expBytesArr.unshift(expVal & 0xff); expVal = expVal >> 8; } while (expVal > 0);
  if (expBytesArr[0]! >= 0x80) expBytesArr.unshift(0);
  const expInt = new Uint8Array([TAG_INTEGER, expBytesArr.length, ...expBytesArr]);

  const rsaPubKey = concatUint8Arrays([modInt, expInt]);
  const rsaPubKeyTlv = new Uint8Array([TAG_SEQUENCE, rsaPubKey.length, ...rsaPubKey]);

  // BIT STRING wrapping the RSAPublicKey
  const bitString = new Uint8Array([TAG_BIT_STRING, rsaPubKeyTlv.length + 1, 0x00, ...rsaPubKeyTlv]);

  const spkiBytes = concatUint8Arrays([algIdTlv, bitString]);
  const spkiTlv = new Uint8Array([TAG_SEQUENCE, spkiBytes.length, ...spkiBytes]);
  return spkiTlv.buffer as ArrayBuffer;
}

function concatUint8Arrays(arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((s, a) => s + a.length, 0);
  const result = new Uint8Array(total);
  let off = 0;
  for (const a of arrays) { result.set(a, off); off += a.length; }
  return result;
}

/**
 * Verify the DSC cert chains to a known CSCA using actual RSA signature verification.
 *
 * 1. Check all certs in SOD chain — is any a known CSCA (exact pubkey match)?
 * 2. Parse DSC issuer DN to extract country code
 * 3. Filter CSCAs by country (usually 1-10 candidates instead of 269)
 * 4. Verify DSC signature against each candidate CSCA pubkey
 * 5. The one that verifies is the correct issuing CSCA
 */
export async function verifyDSCChain(
  dscPubkeyModulus: Uint8Array,
  _dscExponent: number,
  sodCerts: Uint8Array[],
): Promise<ChainVerificationResult> {
  const dscHex = bytesToHex(dscPubkeyModulus);

  // Step 1: Check all certs in SOD chain — is any a known CSCA (exact pubkey match)?
  for (const certDer of sodCerts) {
    const parsed = parseCertificate(certDer);
    if (parsed?.modulus) {
      const modHex = bytesToHex(parsed.modulus);
      const entry = getCscaByModulus().get(modHex);
      if (entry) {
        console.log('[CHAIN] Found CSCA in SOD chain:', entry.common_name);
        return { valid: true, dscModulusHex: dscHex, cscaModulusHex: modHex, cscaName: entry.common_name, cscaSource: 'in_sod_chain', error: null };
      }
    }
  }

  // Step 2: Parse DSC cert and verify its signature against candidate CSCAs
  const dscParsed = sodCerts.length > 0 ? parseCertificate(sodCerts[0]!) : null;
  if (!dscParsed?.tbsBytes || !dscParsed.signatureBytes || !dscParsed.sigAlgOid) {
    return { valid: false, dscModulusHex: dscHex, cscaModulusHex: null, cscaName: null, cscaSource: 'not_found', error: 'Could not parse DSC cert fields' };
  }

  // Map signature algorithm OID to Web Crypto algorithm
  const sigAlg = oidToHashAlgo(dscParsed.sigAlgOid);
  if (!sigAlg) {
    return { valid: false, dscModulusHex: dscHex, cscaModulusHex: null, cscaName: null, cscaSource: 'not_found', error: `Unsupported DSC sig alg: ${dscParsed.sigAlgOid}` };
  }

  // Step 3: Extract country code from DSC issuer DN and filter CSCAs
  const countryCode = dscParsed.issuer ? extractCountryCodeFromDN(dscParsed.issuer) : null;
  const candidates = countryCode ? (getCscasByCountry().get(countryCode) || []) : [];
  const toTry = candidates.length > 0 ? candidates : Array.from(getCscaByModulus().values());

  console.log(`[CHAIN] DSC issuer country: ${countryCode || 'unknown'}, candidates: ${toTry.length}`);

  // Step 4: Try verifying DSC signature against each candidate CSCA
  const sig = dscParsed.signatureBytes.buffer.slice(
    dscParsed.signatureBytes.byteOffset,
    dscParsed.signatureBytes.byteOffset + dscParsed.signatureBytes.byteLength,
  ) as ArrayBuffer;
  const tbs = dscParsed.tbsBytes.buffer.slice(
    dscParsed.tbsBytes.byteOffset,
    dscParsed.tbsBytes.byteOffset + dscParsed.tbsBytes.byteLength,
  ) as ArrayBuffer;

  for (const entry of toTry) {
    try {
      const spki = buildSPKIForRSA(hexToBytes(entry.modulus_hex), entry.exponent);
      const cryptoKey = await crypto.subtle.importKey(
        'spki', spki, { name: 'RSASSA-PKCS1-v1_5', hash: sigAlg }, false, ['verify'],
      );
      const valid = await crypto.subtle.verify(
        'RSASSA-PKCS1-v1_5', cryptoKey, sig, tbs,
      );
      if (valid) {
        console.log('[CHAIN] DSC signature verified with CSCA:', entry.common_name);
        return { valid: true, dscModulusHex: dscHex, cscaModulusHex: entry.modulus_hex, cscaName: entry.common_name, cscaSource: 'issuer_dn_match', error: null };
      }
    } catch { /* not this CSCA */ }
  }

  console.log('[CHAIN] No CSCA verified DSC signature. DSC:', dscHex.slice(0, 16), '...');
  return { valid: false, dscModulusHex: dscHex, cscaModulusHex: null, cscaName: null, cscaSource: 'not_found', error: 'DSC signature not verified by any known CSCA' };
}

/**
 * Map a DER-encoded OID hex to a Web Crypto hash algorithm name.
 */
function oidToHashAlgo(oidHex: string): string | null {
  // sha256WithRSAEncryption: 1.2.840.113549.1.1.11
  if (oidHex === '2a864886f70d01010b') return 'SHA-256';
  // sha384WithRSAEncryption: 1.2.840.113549.1.1.12
  if (oidHex === '2a864886f70d01010c') return 'SHA-384';
  // sha512WithRSAEncryption: 1.2.840.113549.1.1.13
  if (oidHex === '2a864886f70d01010d') return 'SHA-512';
  // sha1WithRSAEncryption: 1.2.840.113549.1.1.5 (deprecated but still used)
  if (oidHex === '2a864886f70d010105') return 'SHA-1';
  return null;
}
