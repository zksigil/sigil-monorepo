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
 */

import { sha256 } from '@noble/hashes/sha256';

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

// OID for Authority Key Identifier: 2.5.29.35
const AKI_OID = [0x55, 0x1d, 0x23];

// OID for Subject Key Identifier: 2.5.29.14
const SKI_OID = [0x55, 0x1d, 0x0e];

// Tag for extensions wrapper in TBSCertificate
const TAG_CONTEXT_3 = 0xa3;

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
  /** Authority Key Identifier (from AKI extension, OID 2.5.29.35). */
  authorityKeyId: string | null;
  /** Subject Key Identifier (from SKI extension, OID 2.5.29.14). */
  subjectKeyId: string | null;
}

export interface ChainVerificationResult {
  valid: boolean;
  dscModulusHex: string;
  cscaModulusHex: string | null;
  cscaExponent: number | null;
  cscaName: string | null;
  cscaSource: 'aki_ski_match' | 'country_trial_verify' | 'not_found';
  error: string | null;
}

function parseCertificate(derBytes: Uint8Array): ParsedCert | null {
  try {
    const cert = readTagLength(derBytes, 0);
    if (cert.tag !== TAG_SEQUENCE) return null;
    const tbs = readTagLength(derBytes, cert.contentStart);
    if (tbs.tag !== TAG_SEQUENCE) return null;
    let c = tbs.contentStart;

    // version [0] EXPLICIT (optional)
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

    // Parse optional fields after SPKI within TBS:
    //   issuerUniqueID  [1] IMPLICIT (optional)
    //   subjectUniqueID [2] IMPLICIT (optional)
    //   extensions      [3] EXPLICIT (optional)
    let authorityKeyId: string | null = null;
    let subjectKeyId: string | null = null;

    while (c < tbs.end) {
      const field = readTagLength(derBytes, c);
      if (field.tag === TAG_CONTEXT_3) {
        // extensions [3] EXPLICIT { SEQUENCE OF Extension }
        const exts = parseExtensions(derBytes, field);
        authorityKeyId = exts.authorityKeyId;
        subjectKeyId = exts.subjectKeyId;
      }
      c = field.end;
    }

    // Signature is at the cert level, after TBS ends
    // cert SEQUENCE { TBS, signatureAlgorithm, signatureValue }
    let certC = tbs.end;
    const certSigAlg = readTagLength(derBytes, certC); certC = certSigAlg.end; // skip signatureAlgorithm
    const sigTlv = readTagLength(derBytes, certC);
    const signatureBytes = sigTlv.tag === TAG_BIT_STRING
      ? derBytes.slice(sigTlv.contentStart + 1, sigTlv.end) // skip unused-bits byte
      : derBytes.slice(sigTlv.contentStart, sigTlv.end);

    return {
      raw: derBytes,
      // Full DER-encoded TBS including SEQUENCE tag + length (this is what the CSCA signs)
      tbsBytes: derBytes.slice(cert.contentStart, tbs.end),
      signatureBytes,
      sigAlgOid: sigAlgOidHex,
      modulus,
      exponent,
      subject: subjectBytes,
      issuer: issuerBytes,
      authorityKeyId,
      subjectKeyId,
    };
  } catch {
    return null;
  }
}

/**
 * Parse X.509v3 extensions from a [3] EXPLICIT wrapper.
 * Extracts AKI (2.5.29.35) and SKI (2.5.29.14).
 */
function parseExtensions(
  data: Uint8Array,
  ctx3: TLV,
): { authorityKeyId: string | null; subjectKeyId: string | null } {
  let authorityKeyId: string | null = null;
  let subjectKeyId: string | null = null;

  // [3] EXPLICIT wraps a SEQUENCE of Extension
  const extSeq = readTagLength(data, ctx3.contentStart);
  if (extSeq.tag !== TAG_SEQUENCE) return { authorityKeyId, subjectKeyId };

  let c = extSeq.contentStart;
  while (c < extSeq.end) {
    // Each Extension is SEQUENCE { OID, BOOLEAN (optional critical), OCTET STRING (value) }
    const ext = readTagLength(data, c);
    if (ext.tag !== TAG_SEQUENCE) { c = ext.end; continue; }

    const oid = readTagLength(data, ext.contentStart);
    if (oid.tag !== TAG_OID) { c = ext.end; continue; }
    const oidBytes = data.slice(oid.contentStart, oid.contentStart + oid.length);

    // Find the OCTET STRING value (skip optional BOOLEAN critical flag)
    let vc = oid.end;
    if (vc < ext.end && data[vc]! === 0x01) {
      // BOOLEAN critical — skip it
      const boolTlv = readTagLength(data, vc); vc = boolTlv.end;
    }
    if (vc >= ext.end) { c = ext.end; continue; }
    const valueTlv = readTagLength(data, vc);
    if (valueTlv.tag !== TAG_OCTET_STRING) { c = ext.end; continue; }

    if (arraysEqual(Array.from(oidBytes), SKI_OID)) {
      // SKI value is OCTET STRING { OCTET STRING { keyIdentifier } }
      // The outer OCTET STRING is the extension value wrapper.
      // Inside is another OCTET STRING containing the raw key ID bytes.
      const inner = readTagLength(data, valueTlv.contentStart);
      if (inner.tag === TAG_OCTET_STRING) {
        subjectKeyId = bytesToHex(data.slice(inner.contentStart, inner.contentStart + inner.length));
      }
    } else if (arraysEqual(Array.from(oidBytes), AKI_OID)) {
      // AKI value is OCTET STRING { SEQUENCE { [0] IMPLICIT keyIdentifier } }
      const inner = readTagLength(data, valueTlv.contentStart);
      if (inner.tag === TAG_SEQUENCE) {
        // Look for [0] IMPLICIT (tag 0x80) — the keyIdentifier field
        let ac = inner.contentStart;
        while (ac < inner.end) {
          const field = readTagLength(data, ac);
          if (field.tag === 0x80) {
            authorityKeyId = bytesToHex(data.slice(field.contentStart, field.contentStart + field.length));
            break;
          }
          ac = field.end;
        }
      }
    }

    c = ext.end;
  }

  return { authorityKeyId, subjectKeyId };
}

interface CSCAEntry {
  modulus_hex: string;
  exponent: number;
  common_name: string | null;
  country: string | null;
  ski: string | null;
}

let _cscaByModulus: Map<string, CSCAEntry> | null = null;
let _cscaBySKI: Map<string, CSCAEntry> | null = null;
let _cscasByCountry: Map<string, CSCAEntry[]> | null = null;
let _cachedCscaEntries: CSCAEntry[] | null = null;

function loadCscaEntries(): CSCAEntry[] {
  if (_cachedCscaEntries) return _cachedCscaEntries;
  _cachedCscaEntries = require('../../../assets/certs/cscas.json') as CSCAEntry[];
  return _cachedCscaEntries;
}

function getCscaByModulus(): Map<string, CSCAEntry> {
  if (!_cscaByModulus) {
    _cscaByModulus = new Map();
    for (const e of loadCscaEntries()) {
      _cscaByModulus!.set(e.modulus_hex.toLowerCase(), e);
    }
  }
  return _cscaByModulus;
}

/**
 * Get CSCAs indexed by Subject Key Identifier (SKI).
 * Used for O(1) lookup when matching DSC's AKI to CSCA's SKI.
 */
function getCscaBySKI(): Map<string, CSCAEntry> {
  if (!_cscaBySKI) {
    _cscaBySKI = new Map();
    for (const e of loadCscaEntries()) {
      if (e.ski) {
        _cscaBySKI!.set(e.ski.toLowerCase(), e);
      }
    }
    console.log(`[CHAIN] Indexed ${_cscaBySKI.size} CSCAs by SKI`);
  }
  return _cscaBySKI;
}

/**
 * Get CSCAs grouped by country code. Used as fallback when AKI/SKI
 * matching fails (much faster than trying all 269).
 */
function getCscasByCountry(): Map<string, CSCAEntry[]> {
  if (!_cscasByCountry) {
    _cscasByCountry = new Map();
    for (const e of loadCscaEntries()) {
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
/** Encode a DER length (handles lengths > 127 with multi-byte encoding). */
function derEncodeLength(length: number): Uint8Array {
  if (length < 0x80) return new Uint8Array([length]);
  if (length < 0x100) return new Uint8Array([0x81, length]);
  return new Uint8Array([0x82, (length >> 8) & 0xff, length & 0xff]);
}

/** Wrap content bytes in a DER TLV (tag + length + content). */
function derWrap(tag: number, content: Uint8Array): Uint8Array {
  const len = derEncodeLength(content.length);
  return concatUint8Arrays([new Uint8Array([tag]), len, content]);
}

function buildSPKIForRSA(modulus: Uint8Array, exponent: number): ArrayBuffer {
  // OID: 1.2.840.113549.1.1.1 (rsaEncryption)
  const rsaOid = new Uint8Array([0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01]);
  const nullParam = new Uint8Array([0x05, 0x00]);
  const algIdTlv = derWrap(TAG_SEQUENCE, concatUint8Arrays([rsaOid, nullParam]));

  // RSAPublicKey SEQUENCE: SEQUENCE { INTEGER modulus, INTEGER exponent }
  let modBytes = modulus;
  if (modBytes[0]! >= 0x80) modBytes = concatUint8Arrays([new Uint8Array([0x00]), modBytes]);
  const modInt = derWrap(TAG_INTEGER, modBytes);

  let expVal = exponent;
  const expBytesArr: number[] = [];
  do { expBytesArr.unshift(expVal & 0xff); expVal = expVal >> 8; } while (expVal > 0);
  if (expBytesArr[0]! >= 0x80) expBytesArr.unshift(0);
  const expInt = derWrap(TAG_INTEGER, new Uint8Array(expBytesArr));

  const rsaPubKeyTlv = derWrap(TAG_SEQUENCE, concatUint8Arrays([modInt, expInt]));

  // BIT STRING wrapping the RSAPublicKey (0x00 unused-bits prefix)
  const bitString = derWrap(TAG_BIT_STRING, concatUint8Arrays([new Uint8Array([0x00]), rsaPubKeyTlv]));

  const spkiTlv = derWrap(TAG_SEQUENCE, concatUint8Arrays([algIdTlv, bitString]));
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
 * Verify the DSC cert chains to a known CSCA.
 *
 * 1. Parse DSC cert and extract its Authority Key Identifier (AKI)
 * 2. Look up the CSCA by matching AKI to Subject Key Identifier (SKI) — O(1)
 * 3. Verify the DSC signature against the matched CSCA (confirmation, not search)
 * 4. Fallback: if AKI/SKI not available, filter by country code and trial-verify
 */
export async function verifyDSCChain(
  dscPubkeyModulus: Uint8Array,
  _dscExponent: number,
  sodCerts: Uint8Array[],
): Promise<ChainVerificationResult> {
  const dscHex = bytesToHex(dscPubkeyModulus);

  // Step 1: Parse the DSC certificate
  const dscParsed = sodCerts.length > 0 ? parseCertificate(sodCerts[0]!) : null;
  if (!dscParsed?.tbsBytes || !dscParsed.signatureBytes || !dscParsed.sigAlgOid) {
    return { valid: false, dscModulusHex: dscHex, cscaModulusHex: null, cscaExponent: null, cscaName: null, cscaSource: 'not_found', error: 'Could not parse DSC cert fields' };
  }

  const sigAlg = oidToHashAlgo(dscParsed.sigAlgOid);
  if (!sigAlg) {
    return { valid: false, dscModulusHex: dscHex, cscaModulusHex: null, cscaExponent: null, cscaName: null, cscaSource: 'not_found', error: `Unsupported DSC sig alg: ${dscParsed.sigAlgOid}` };
  }

  const sig = toArrayBuffer(dscParsed.signatureBytes);
  const tbs = toArrayBuffer(dscParsed.tbsBytes);

  // Step 2: AKI -> SKI lookup (primary path, O(1))
  if (dscParsed.authorityKeyId) {
    console.log(`[CHAIN-DBG] DSC AKI: ${dscParsed.authorityKeyId}`);
    console.log(`[CHAIN-DBG] sigAlg: ${sigAlg}`);
    const entry = getCscaBySKI().get(dscParsed.authorityKeyId.toLowerCase());
    if (entry) {
      console.log(`[CHAIN] AKI->SKI match: ${entry.common_name || '(null)'}`);
      console.log(`[CHAIN-DBG] CSCA modulus_hex (first 16): ${entry.modulus_hex.slice(0, 16)}`);
      console.log(`[CHAIN-DBG] CSCA exponent: ${entry.exponent}`);
      // Step 3: Confirm with RSA signature verification
      const verified = await verifyDSCSignatureWithCSCA(sig, tbs, sigAlg, entry);
      if (verified) {
        console.log('[CHAIN] DSC signature verified with AKI-matched CSCA');
        return { valid: true, dscModulusHex: dscHex, cscaModulusHex: entry.modulus_hex, cscaExponent: entry.exponent, cscaName: entry.common_name, cscaSource: 'aki_ski_match', error: null };
      }
      console.warn('[CHAIN-DBG] AKI->SKI matched but signature verification FAILED');
      console.warn('[CHAIN] AKI->SKI matched but signature verification failed — falling back to trial verify');
    } else {
      console.log(`[CHAIN] DSC AKI ${dscParsed.authorityKeyId.slice(0, 16)}... not found in CSCA SKI index`);
    }
  } else {
    console.log('[CHAIN] DSC has no AKI extension — falling back to country-based trial verify');
  }

  // Step 4: Fallback — filter by country code and trial-verify
  const countryCode = dscParsed.issuer ? extractCountryCodeFromDN(dscParsed.issuer) : null;
  const candidates = countryCode ? (getCscasByCountry().get(countryCode) || []) : [];
  const toTry = candidates.length > 0 ? candidates : Array.from(getCscaByModulus().values());

  console.log(`[CHAIN] Fallback: DSC issuer country: ${countryCode || 'unknown'}, candidates: ${toTry.length}`);

  for (const entry of toTry) {
    const verified = await verifyDSCSignatureWithCSCA(sig, tbs, sigAlg, entry);
    if (verified) {
      console.log('[CHAIN] DSC signature verified with CSCA (trial):', entry.common_name);
      return { valid: true, dscModulusHex: dscHex, cscaModulusHex: entry.modulus_hex, cscaExponent: entry.exponent, cscaName: entry.common_name, cscaSource: 'country_trial_verify', error: null };
    }
  }

  console.log('[CHAIN] No CSCA verified DSC signature. DSC:', dscHex.slice(0, 16), '...');
  return { valid: false, dscModulusHex: dscHex, cscaModulusHex: null, cscaExponent: null, cscaName: null, cscaSource: 'not_found', error: 'DSC signature not verified by any known CSCA' };
}

/** Verify a DSC's signature against a single CSCA candidate using BigInt RSA. */
async function verifyDSCSignatureWithCSCA(
  sig: ArrayBuffer,
  tbs: ArrayBuffer,
  hashAlg: string,
  csca: CSCAEntry,
): Promise<boolean> {
  try {
    if (hashAlg !== 'SHA-256') {
      console.warn(`[CHAIN-DBG] Unsupported hash alg: ${hashAlg}`);
      return false;
    }
    // Compute SHA-256 of TBS
    const tbsHash = sha256(new Uint8Array(tbs));
    const tbsHashHex = Array.from(tbsHash).map(b => b.toString(16).padStart(2, '0')).join('');
    console.log(`[CHAIN-DBG] TBS SHA-256: ${tbsHashHex}`);

    // RSA verify: sig^exponent mod modulus
    const sigHex = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
    const sigBigInt = BigInt('0x' + sigHex);
    const modulusBigInt = BigInt('0x' + csca.modulus_hex);
    const exponentBigInt = BigInt(csca.exponent);
    const decryptedBigInt = modPowBigInt(sigBigInt, exponentBigInt, modulusBigInt);
    const decryptedHex = bigIntToHex(decryptedBigInt, 256);
    console.log(`[CHAIN-DBG] Decrypted sig (first 32): ${decryptedHex.slice(0, 32)}`);

    // Parse PKCS#1 v1.5 DigestInfo
    const digestInfoPrefix = '3031300d060960864801650304020105000420';
    const digestInfoIndex = decryptedHex.indexOf(digestInfoPrefix);
    if (digestInfoIndex === -1) {
      console.warn(`[CHAIN-DBG] No PKCS#1 DigestInfo found in decrypted sig`);
      return false;
    }
    const hashStart = digestInfoIndex + digestInfoPrefix.length;
    const recoveredHash = decryptedHex.slice(hashStart, hashStart + 64);
    console.log(`[CHAIN-DBG] Recovered hash: ${recoveredHash}`);
    console.log(`[CHAIN-DBG] Match: ${recoveredHash === tbsHashHex ? 'YES' : 'NO'}`);
    return recoveredHash === tbsHashHex;
  } catch (e) {
    console.warn(`[CHAIN-DBG] verifyDSCSignatureWithCSCA error: ${e instanceof Error ? e.message : String(e)}`);
    return false;
  }
}

/** Modular exponentiation: base^exp mod mod */
function modPowBigInt(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = 1n;
  base = base % mod;
  while (exp > 0n) {
    if (exp % 2n === 1n) {
      result = (result * base) % mod;
    }
    exp = exp / 2n;
    base = (base * base) % mod;
  }
  return result;
}

/** Convert a bigint to big-endian hex string of specified byte length */
function bigIntToHex(value: bigint, length: number): string {
  const hex = value.toString(16).padStart(length * 2, '0');
  return hex.slice(-length * 2);
}

/** Convert a Uint8Array slice to a standalone ArrayBuffer. */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

// ---------------------------------------------------------------------------
// DSC chain data extraction (for ZK circuit inputs)
// ---------------------------------------------------------------------------

/**
 * Data needed by the ZK circuit for CSCA->DSC chain verification.
 */
export interface DSCChainData {
  /** Full DER-encoded TBSCertificate (including SEQUENCE tag + length). */
  dscTbs: Uint8Array;
  /** CSCA's RSA signature over the DSC TBS (raw bytes, no BIT STRING wrapper). */
  dscSignature: Uint8Array;
  /** Byte offset of the DSC RSA modulus within dscTbs. */
  dscPubkeyOffset: number;
  /** CSCA RSA modulus (up to 512 bytes for RSA-4096). */
  cscaPubkey: Uint8Array;
  /** CSCA RSA exponent. */
  cscaExponent: number;
}

/**
 * Extract the raw certificate chain data needed for the ZK circuit's
 * in-circuit CSCA->DSC verification.
 *
 * @param dscCertDer Full DER-encoded DSC certificate bytes.
 * @param cscaModulusHex CSCA RSA modulus as hex string (from verifyDSCChain result).
 * @param cscaExponent CSCA RSA exponent.
 * @returns DSCChainData or null if parsing fails.
 */
export function extractDSCChainData(
  dscCertDer: Uint8Array,
  cscaModulusHex: string,
  cscaExponent: number,
): DSCChainData | null {
  try {
    const cert = readTagLength(dscCertDer, 0);
    if (cert.tag !== TAG_SEQUENCE) return null;

    // TBS is the first element inside the cert SEQUENCE
    const tbsTagOffset = cert.contentStart;
    const tbs = readTagLength(dscCertDer, tbsTagOffset);
    if (tbs.tag !== TAG_SEQUENCE) return null;

    // Full TBS DER encoding = from the SEQUENCE tag to end of content
    const dscTbs = dscCertDer.slice(tbsTagOffset, tbs.end);

    // Navigate through TBS fields to find SubjectPublicKeyInfo
    let c = tbs.contentStart;
    // version [0] EXPLICIT (optional)
    if (dscCertDer[c] === TAG_CONTEXT_0) { const v = readTagLength(dscCertDer, c); c = v.end; }
    const serial = readTagLength(dscCertDer, c); c = serial.end;   // serialNumber
    const sigAlgInner = readTagLength(dscCertDer, c); c = sigAlgInner.end; // signature
    const issuer = readTagLength(dscCertDer, c); c = issuer.end;   // issuer
    const validity = readTagLength(dscCertDer, c); c = validity.end; // validity
    const subject = readTagLength(dscCertDer, c); c = subject.end; // subject
    const spki = readTagLength(dscCertDer, c);                     // subjectPublicKeyInfo

    // Drill into SPKI to find the modulus byte offset
    const algId = readTagLength(dscCertDer, spki.contentStart);
    const bitString = readTagLength(dscCertDer, algId.end);
    if (bitString.tag !== TAG_BIT_STRING) return null;
    // BIT STRING: skip unused-bits byte (0x00)
    const rsaPubKeyStart = bitString.contentStart + 1;
    const rsaPubKey = readTagLength(dscCertDer, rsaPubKeyStart);
    const modInt = readTagLength(dscCertDer, rsaPubKey.contentStart);
    if (modInt.tag !== TAG_INTEGER) return null;

    // Modulus INTEGER may have a leading zero byte (DER encoding for positive numbers)
    let modulusStart = modInt.contentStart;
    if (dscCertDer[modulusStart] === 0x00 && modInt.length > 1) {
      modulusStart += 1;
    }

    // Offset relative to start of TBS DER
    const dscPubkeyOffset = modulusStart - tbsTagOffset;

    // Extract the cert's signature (= CSCA's signature over this TBS)
    // After TBS comes: signatureAlgorithm SEQUENCE, then signatureValue BIT STRING
    const sigAlgAfterTbs = readTagLength(dscCertDer, tbs.end);
    const sigValue = readTagLength(dscCertDer, sigAlgAfterTbs.end);
    let dscSignature: Uint8Array;
    if (sigValue.tag === TAG_BIT_STRING) {
      // Skip the unused-bits byte
      dscSignature = dscCertDer.slice(sigValue.contentStart + 1, sigValue.end);
    } else {
      dscSignature = dscCertDer.slice(sigValue.contentStart, sigValue.end);
    }

    const cscaPubkey = hexToBytes(cscaModulusHex);

    return {
      dscTbs,
      dscSignature,
      dscPubkeyOffset,
      cscaPubkey,
      cscaExponent,
    };
  } catch (e) {
    console.error('[CHAIN] extractDSCChainData failed:', e);
    return null;
  }
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
