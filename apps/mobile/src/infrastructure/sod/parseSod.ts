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

  return {
    signedAttrs,
    signature,
    pubkeyModulus: modulus,
    exponent,
  };
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
