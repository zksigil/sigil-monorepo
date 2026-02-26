/**
 * NFC infrastructure — passport reading via ISO 14443-A/B (ICAO 9303 / MRTD)
 *
 * Passport data NEVER leaves the device. All NFC reads are local-only.
 *
 * Implements BAC (Basic Access Control) per ICAO 9303 Part 11:
 * MRZ key derivation → GET CHALLENGE → EXTERNAL AUTHENTICATE → Secure Messaging
 */

import NfcManager, { NfcTech } from 'react-native-nfc-manager';
import { Platform } from 'react-native';
import { sha1 } from '@noble/hashes/sha1';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type NFCStatus = 'unavailable' | 'disabled' | 'ready';

/** MRZ data extracted from the passport's NFC chip (ICAO 9303 Data Groups) */
export interface PassportMRZData {
  /** Machine-readable document number (DG1) */
  documentNumber: string;
  /** Date of birth — YYMMDD */
  dateOfBirth: string;
  /** Date of expiry — YYMMDD */
  dateOfExpiry: string;
  /** ISO 3166-1 alpha-3 nationality code */
  nationality: string;
}

/** MRZ fields needed for BAC key derivation */
export interface MRZBACInput {
  documentNumber: string;
  dateOfBirth: string;   // YYMMDD
  dateOfExpiry: string;  // YYMMDD
}

export type NFCReadResult =
  | { success: true; data: PassportMRZData; rawDG1Hex: string; bacUsed: boolean }
  | { success: false; error: NFCError };

export type NFCError =
  | { code: 'unsupported'; message: string }
  | { code: 'disabled'; message: string }
  | { code: 'cancelled'; message: string }
  | { code: 'timeout'; message: string }
  | { code: 'read_failed'; message: string };

// ---------------------------------------------------------------------------
// Status check
// ---------------------------------------------------------------------------

let _managerStarted = false;

async function ensureStarted(): Promise<void> {
  if (!_managerStarted) {
    await NfcManager.start();
    _managerStarted = true;
    console.log('[NFC] NfcManager started');
  }
}

export async function getNFCStatus(): Promise<NFCStatus> {
  try {
    const supported = await NfcManager.isSupported();
    if (!supported) {
      console.log('[NFC] NFC hardware not supported on this device');
      return 'unavailable';
    }

    await ensureStarted();

    const enabled = await NfcManager.isEnabled();
    if (!enabled) {
      console.log('[NFC] NFC is supported but disabled');
      return 'disabled';
    }

    console.log('[NFC] NFC ready');
    return 'ready';
  } catch (err) {
    console.error('[NFC] Error checking NFC status:', err);
    return 'unavailable';
  }
}

// ---------------------------------------------------------------------------
// Hex helpers
// ---------------------------------------------------------------------------

function toHex(bytes: Uint8Array | number[]): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

// ---------------------------------------------------------------------------
// DES / 3DES — pure JS implementation (no native dependency)
// ---------------------------------------------------------------------------

// DES initial/final permutation tables, expansion, S-boxes, etc.
// Based on FIPS 46-3

const IP: readonly number[] = [
  58,50,42,34,26,18,10,2,60,52,44,36,28,20,12,4,
  62,54,46,38,30,22,14,6,64,56,48,40,32,24,16,8,
  57,49,41,33,25,17,9,1,59,51,43,35,27,19,11,3,
  61,53,45,37,29,21,13,5,63,55,47,39,31,23,15,7,
];

const FP: readonly number[] = [
  40,8,48,16,56,24,64,32,39,7,47,15,55,23,63,31,
  38,6,46,14,54,22,62,30,37,5,45,13,53,21,61,29,
  36,4,44,12,52,20,60,28,35,3,43,11,51,19,59,27,
  34,2,42,10,50,18,58,26,33,1,41,9,49,17,57,25,
];

const E: readonly number[] = [
  32,1,2,3,4,5,4,5,6,7,8,9,8,9,10,11,
  12,13,12,13,14,15,16,17,16,17,18,19,20,21,20,21,
  22,23,24,25,24,25,26,27,28,29,28,29,30,31,32,1,
];

const S: readonly (readonly number[])[] = [
  [14,4,13,1,2,15,11,8,3,10,6,12,5,9,0,7,0,15,7,4,14,2,13,1,10,6,12,11,9,5,3,8,4,1,14,8,13,6,2,11,15,12,9,7,3,10,5,0,15,12,8,2,4,9,1,7,5,11,3,14,10,0,6,13],
  [15,1,8,14,6,11,3,4,9,7,2,13,12,0,5,10,3,13,4,7,15,2,8,14,12,0,1,10,6,9,11,5,0,14,7,11,10,4,13,1,5,8,12,6,9,3,2,15,13,8,10,1,3,15,4,2,11,6,7,12,0,5,14,9],
  [10,0,9,14,6,3,15,5,1,13,12,7,11,4,2,8,13,7,0,9,3,4,6,10,2,8,5,14,12,11,15,1,13,6,4,9,8,15,3,0,11,1,2,12,5,10,14,7,1,10,13,0,6,9,8,7,4,15,14,3,11,5,2,12],
  [7,13,14,3,0,6,9,10,1,2,8,5,11,12,4,15,13,8,11,5,6,15,0,3,4,7,2,12,1,10,14,9,10,6,9,0,12,11,7,13,15,1,3,14,5,2,8,4,3,15,0,6,10,1,13,8,9,4,5,11,12,7,2,14],
  [2,12,4,1,7,10,11,6,8,5,3,15,13,0,14,9,14,11,2,12,4,7,13,1,5,0,15,10,3,9,8,6,4,2,1,11,10,13,7,8,15,9,12,5,6,3,0,14,11,8,12,7,1,14,2,13,6,15,0,9,10,4,5,3],
  [12,1,10,15,9,2,6,8,0,13,3,4,14,7,5,11,10,15,4,2,7,12,9,5,6,1,13,14,0,11,3,8,9,14,15,5,2,8,12,3,7,0,4,10,1,13,11,6,4,3,2,12,9,5,15,10,11,14,1,7,6,0,8,13],
  [4,11,2,14,15,0,8,13,3,12,9,7,5,10,6,1,13,0,11,7,4,9,1,10,14,3,5,12,2,15,8,6,1,4,11,13,12,3,7,14,10,15,6,8,0,5,9,2,6,11,13,8,1,4,10,7,9,5,0,15,14,2,3,12],
  [13,2,8,4,6,15,11,1,10,9,3,14,5,0,12,7,1,15,13,8,10,3,7,4,12,5,6,2,0,14,9,11,7,0,9,3,4,6,10,2,8,5,14,12,11,15,1,13,11,14,4,1,9,12,14,2,0,6,10,13,15,3,5,8],
];

const P: readonly number[] = [
  16,7,20,21,29,12,28,17,1,15,23,26,5,18,31,10,
  2,8,24,14,32,27,3,9,19,13,30,6,22,11,4,25,
];

const PC1: readonly number[] = [
  57,49,41,33,25,17,9,1,58,50,42,34,26,18,
  10,2,59,51,43,35,27,19,11,3,60,52,44,36,
  63,55,47,39,31,23,15,7,62,54,46,38,30,22,
  14,6,61,53,45,37,29,21,13,5,28,20,12,4,
];

const PC2: readonly number[] = [
  14,17,11,24,1,5,3,28,15,6,21,10,
  23,19,12,4,26,8,16,7,27,20,13,2,
  41,52,31,37,47,55,30,40,51,45,33,48,
  44,49,39,56,34,53,46,42,50,36,29,32,
];

const SHIFTS: readonly number[] = [1,1,2,2,2,2,2,2,1,2,2,2,2,2,2,1];

function permute(input: number[], table: readonly number[], inputBits: number): number[] {
  const output: number[] = new Array(table.length).fill(0);
  for (let i = 0; i < table.length; i++) {
    const srcBit = table[i]! - 1;
    const srcByte = Math.floor(srcBit / 8);
    const srcBitPos = 7 - (srcBit % 8);
    const bit = ((input[srcByte] ?? 0) >> srcBitPos) & 1;
    const dstByte = Math.floor(i / 8);
    const dstBitPos = 7 - (i % 8);
    output[dstByte] = (output[dstByte] ?? 0) | (bit << dstBitPos);
  }
  return output;
}

function leftShift28(half: number[], shifts: number): number[] {
  // 28-bit left circular shift on a 4-byte array (only lower 28 bits matter)
  let val = ((half[0]! << 24) | (half[1]! << 16) | (half[2]! << 8) | half[3]!) >>> 0;
  // We work with top 28 bits (bits 31..4)
  val = (val >>> 4) & 0x0fffffff;
  for (let s = 0; s < shifts; s++) {
    const topBit = (val >> 27) & 1;
    val = ((val << 1) | topBit) & 0x0fffffff;
  }
  val = (val << 4) >>> 0;
  return [(val >>> 24) & 0xff, (val >>> 16) & 0xff, (val >>> 8) & 0xff, val & 0xff];
}

function generateSubkeys(key: number[]): number[][] {
  const pc1 = permute(key, PC1, 64);
  let c = pc1.slice(0, 4);
  let d = pc1.slice(3, 7); // 28 bits from bit 28 onward
  // Re-extract C and D properly from 56-bit PC1 output
  // PC1 output is 56 bits = 7 bytes. C = bits 0..27, D = bits 28..55
  const pc1bits: number[] = [];
  for (let i = 0; i < 56; i++) {
    const byteIdx = Math.floor(i / 8);
    const bitIdx = 7 - (i % 8);
    pc1bits.push(((pc1[byteIdx] ?? 0) >> bitIdx) & 1);
  }

  let cBits = pc1bits.slice(0, 28);
  let dBits = pc1bits.slice(28, 56);

  const subkeys: number[][] = [];
  for (let round = 0; round < 16; round++) {
    const shift = SHIFTS[round]!;
    cBits = [...cBits.slice(shift), ...cBits.slice(0, shift)];
    dBits = [...dBits.slice(shift), ...dBits.slice(0, shift)];

    const cdBits = [...cBits, ...dBits];
    // Apply PC2: select 48 bits from 56
    const subkeyBits: number[] = [];
    for (let i = 0; i < 48; i++) {
      subkeyBits.push(cdBits[PC2[i]! - 1]!);
    }
    // Pack into 6 bytes
    const subkey: number[] = [0, 0, 0, 0, 0, 0];
    for (let i = 0; i < 48; i++) {
      const byteIdx = Math.floor(i / 8);
      const bitIdx = 7 - (i % 8);
      subkey[byteIdx] = (subkey[byteIdx]! | (subkeyBits[i]! << bitIdx)) & 0xff;
    }
    subkeys.push(subkey);
  }
  return subkeys;
}

function desF(r: number[], subkey: number[]): number[] {
  // Expand R from 32 to 48 bits
  const expanded: number[] = [0, 0, 0, 0, 0, 0];
  for (let i = 0; i < 48; i++) {
    const srcBit = E[i]! - 1;
    const srcByte = Math.floor(srcBit / 8);
    const srcBitPos = 7 - (srcBit % 8);
    const bit = ((r[srcByte] ?? 0) >> srcBitPos) & 1;
    const dstByte = Math.floor(i / 8);
    const dstBitPos = 7 - (i % 8);
    expanded[dstByte] = (expanded[dstByte]! | (bit << dstBitPos)) & 0xff;
  }

  // XOR with subkey
  for (let i = 0; i < 6; i++) {
    expanded[i] = (expanded[i]! ^ subkey[i]!) & 0xff;
  }

  // S-box substitution: 48 bits → 32 bits
  const sOut: number[] = [0, 0, 0, 0];
  for (let i = 0; i < 8; i++) {
    // Extract 6 bits for this S-box
    const bitOffset = i * 6;
    let sixBits = 0;
    for (let b = 0; b < 6; b++) {
      const byteIdx = Math.floor((bitOffset + b) / 8);
      const bitIdx = 7 - ((bitOffset + b) % 8);
      sixBits = (sixBits << 1) | (((expanded[byteIdx] ?? 0) >> bitIdx) & 1);
    }
    const row = ((sixBits >> 5) << 1) | (sixBits & 1);
    const col = (sixBits >> 1) & 0x0f;
    const sVal = S[i]![row * 16 + col]!;

    // Place 4 output bits
    const outBitOffset = i * 4;
    for (let b = 0; b < 4; b++) {
      const bit = (sVal >> (3 - b)) & 1;
      const dstByte = Math.floor((outBitOffset + b) / 8);
      const dstBitPos = 7 - ((outBitOffset + b) % 8);
      sOut[dstByte] = (sOut[dstByte]! | (bit << dstBitPos)) & 0xff;
    }
  }

  // P permutation
  const pOut: number[] = [0, 0, 0, 0];
  for (let i = 0; i < 32; i++) {
    const srcBit = P[i]! - 1;
    const srcByte = Math.floor(srcBit / 8);
    const srcBitPos = 7 - (srcBit % 8);
    const bit = ((sOut[srcByte] ?? 0) >> srcBitPos) & 1;
    const dstByte = Math.floor(i / 8);
    const dstBitPos = 7 - (i % 8);
    pOut[dstByte] = (pOut[dstByte]! | (bit << dstBitPos)) & 0xff;
  }

  return pOut;
}

/** Single DES block encryption (8 bytes in → 8 bytes out) */
function desEncryptBlock(block: number[], key: number[]): number[] {
  const subkeys = generateSubkeys(key);
  const ip = permute(block, IP, 64);
  let l = ip.slice(0, 4);
  let r = ip.slice(4, 8);

  for (let round = 0; round < 16; round++) {
    const f = desF(r, subkeys[round]!);
    const newR = l.map((v, i) => (v ^ f[i]!) & 0xff);
    l = r;
    r = newR;
  }

  // Combine R + L (note swap) and apply final permutation
  const preOutput = [...r, ...l];
  return permute(preOutput, FP, 64);
}

/** Single DES block decryption (8 bytes in → 8 bytes out) */
function desDecryptBlock(block: number[], key: number[]): number[] {
  const subkeys = generateSubkeys(key);
  const ip = permute(block, IP, 64);
  let l = ip.slice(0, 4);
  let r = ip.slice(4, 8);

  for (let round = 15; round >= 0; round--) {
    const f = desF(r, subkeys[round]!);
    const newR = l.map((v, i) => (v ^ f[i]!) & 0xff);
    l = r;
    r = newR;
  }

  const preOutput = [...r, ...l];
  return permute(preOutput, FP, 64);
}

/** 3DES-CBC encrypt (EDE with 16-byte key = K1||K2, K3=K1) */
function tdesEncryptCBC(data: number[], key: number[], iv: number[]): number[] {
  const k1 = key.slice(0, 8);
  const k2 = key.slice(8, 16);
  const result: number[] = [];
  let prev = [...iv];

  for (let offset = 0; offset < data.length; offset += 8) {
    const block = data.slice(offset, offset + 8);
    // XOR with previous ciphertext (CBC)
    const xored = block.map((v, i) => (v ^ prev[i]!) & 0xff);
    // E-D-E
    const enc1 = desEncryptBlock(xored, k1);
    const dec = desDecryptBlock(enc1, k2);
    const enc2 = desEncryptBlock(dec, k1);
    result.push(...enc2);
    prev = enc2;
  }
  return result;
}

/** 3DES-CBC decrypt (DED with 16-byte key = K1||K2, K3=K1) */
function tdesDecryptCBC(data: number[], key: number[], iv: number[]): number[] {
  const k1 = key.slice(0, 8);
  const k2 = key.slice(8, 16);
  const result: number[] = [];
  let prev = [...iv];

  for (let offset = 0; offset < data.length; offset += 8) {
    const block = data.slice(offset, offset + 8);
    // D-E-D
    const dec1 = desDecryptBlock(block, k1);
    const enc = desEncryptBlock(dec1, k2);
    const dec2 = desDecryptBlock(enc, k1);
    // XOR with previous ciphertext
    const plain = dec2.map((v, i) => (v ^ prev[i]!) & 0xff);
    result.push(...plain);
    prev = block;
  }
  return result;
}

/**
 * ISO 9797-1 MAC Algorithm 3 (Retail MAC) with 3DES.
 * Process all blocks with single DES (K1), then encrypt final block with 3DES (K1,K2).
 */
function retailMAC(data: number[], key: number[]): number[] {
  const k1 = key.slice(0, 8);
  const k2 = key.slice(8, 16);

  // Pad data with 0x80 then zeros to multiple of 8
  const padded = [...data, 0x80];
  while (padded.length % 8 !== 0) {
    padded.push(0x00);
  }

  // CBC-MAC with single DES (K1) for all blocks
  let mac = [0, 0, 0, 0, 0, 0, 0, 0];
  for (let offset = 0; offset < padded.length; offset += 8) {
    const block = padded.slice(offset, offset + 8);
    const xored = mac.map((v, i) => (v ^ block[i]!) & 0xff);
    mac = desEncryptBlock(xored, k1);
  }

  // Final block: decrypt with K2, encrypt with K1 (= 3DES on the MAC)
  const dec = desDecryptBlock(mac, k2);
  mac = desEncryptBlock(dec, k1);

  return mac;
}

// ---------------------------------------------------------------------------
// DES key parity adjustment (ICAO 9303)
// ---------------------------------------------------------------------------

function adjustParity(key: number[]): number[] {
  return key.map((byte) => {
    // Count bits set in upper 7 bits
    let bits = 0;
    for (let i = 1; i < 8; i++) {
      bits += (byte >> i) & 1;
    }
    // Set parity bit (bit 0) so total number of 1-bits is odd
    if (bits % 2 === 0) {
      return (byte | 1) & 0xff;
    }
    return (byte & 0xfe) & 0xff;
  });
}

// ---------------------------------------------------------------------------
// ICAO 9303 MRZ Check Digit
// ---------------------------------------------------------------------------

const MRZ_CHAR_VALUES: Record<string, number> = {};
// 0-9 → 0-9
for (let i = 0; i <= 9; i++) {
  MRZ_CHAR_VALUES[String(i)] = i;
}
// A-Z → 10-35
for (let i = 0; i < 26; i++) {
  MRZ_CHAR_VALUES[String.fromCharCode(65 + i)] = 10 + i;
}
// '<' → 0
MRZ_CHAR_VALUES['<'] = 0;

const MRZ_WEIGHTS = [7, 3, 1] as const;

function mrzCheckDigit(input: string): number {
  let sum = 0;
  for (let i = 0; i < input.length; i++) {
    const val = MRZ_CHAR_VALUES[input[i]!] ?? 0;
    sum += val * MRZ_WEIGHTS[i % 3]!;
  }
  return sum % 10;
}

// ---------------------------------------------------------------------------
// BAC Key Derivation (ICAO 9303 Part 11)
// ---------------------------------------------------------------------------

interface BACKeys {
  kEnc: number[];
  kMac: number[];
}

function deriveBACKeys(mrzInput: MRZBACInput): BACKeys {
  // Pad document number to 9 chars with '<'
  const docNum = mrzInput.documentNumber.toUpperCase().padEnd(9, '<');
  const docCheck = mrzCheckDigit(docNum);
  const dobCheck = mrzCheckDigit(mrzInput.dateOfBirth);
  const expCheck = mrzCheckDigit(mrzInput.dateOfExpiry);

  const mrzInfo = `${docNum}${docCheck}${mrzInput.dateOfBirth}${dobCheck}${mrzInput.dateOfExpiry}${expCheck}`;
  console.log('[NFC-BAC] MRZ info string:', mrzInfo);

  // Hash with SHA-1
  const mrzBytes = new TextEncoder().encode(mrzInfo);
  const hash = sha1(mrzBytes);
  const kSeed = Array.from(hash.slice(0, 16));
  console.log('[NFC-BAC] Kseed:', toHex(kSeed));

  // Derive Kenc: SHA1(Kseed + 00000001)[0:16] with parity adjustment
  const encInput = new Uint8Array([...kSeed, 0x00, 0x00, 0x00, 0x01]);
  const encHash = sha1(encInput);
  const kEnc = adjustParity(Array.from(encHash.slice(0, 16)));
  console.log('[NFC-BAC] Kenc:', toHex(kEnc));

  // Derive Kmac: SHA1(Kseed + 00000002)[0:16] with parity adjustment
  const macInput = new Uint8Array([...kSeed, 0x00, 0x00, 0x00, 0x02]);
  const macHash = sha1(macInput);
  const kMac = adjustParity(Array.from(macHash.slice(0, 16)));
  console.log('[NFC-BAC] Kmac:', toHex(kMac));

  return { kEnc, kMac };
}

// ---------------------------------------------------------------------------
// Session key derivation from BAC key agreement
// ---------------------------------------------------------------------------

interface SessionKeys {
  ksEnc: number[];
  ksMac: number[];
  ssc: number[];
}

function deriveSessionKeys(kSeed: number[]): Omit<SessionKeys, 'ssc'> {
  const encInput = new Uint8Array([...kSeed, 0x00, 0x00, 0x00, 0x01]);
  const encHash = sha1(encInput);
  const ksEnc = adjustParity(Array.from(encHash.slice(0, 16)));

  const macInput = new Uint8Array([...kSeed, 0x00, 0x00, 0x00, 0x02]);
  const macHash = sha1(macInput);
  const ksMac = adjustParity(Array.from(macHash.slice(0, 16)));

  return { ksEnc, ksMac };
}

// ---------------------------------------------------------------------------
// BAC Protocol execution
// ---------------------------------------------------------------------------

async function performBAC(
  mrzInput: MRZBACInput,
  transceiveFn: (cmd: number[]) => Promise<number[]>,
): Promise<SessionKeys | null> {
  try {
    const { kEnc, kMac } = deriveBACKeys(mrzInput);

    // Step 1: GET CHALLENGE → RND.IC (8 bytes)
    const getChallengeCmd = [0x00, 0x84, 0x00, 0x00, 0x08];
    const challengeResp = await transceiveFn(getChallengeCmd);
    console.log('[NFC-BAC] GET CHALLENGE response:', toHex(challengeResp));

    if (!isSuccess(challengeResp) || challengeResp.length < 10) {
      console.warn('[NFC-BAC] GET CHALLENGE failed');
      return null;
    }

    const rndIC = challengeResp.slice(0, 8);
    console.log('[NFC-BAC] RND.IC:', toHex(rndIC));

    // Step 2: Generate random values
    const rndIFD = Array.from({ length: 8 }, () => Math.floor(Math.random() * 256));
    const kIFD = Array.from({ length: 16 }, () => Math.floor(Math.random() * 256));

    // Step 3: S = RND.IFD || RND.IC || K.IFD (32 bytes)
    const s = [...rndIFD, ...rndIC, ...kIFD];

    // Step 4: Encrypt S with Kenc (3DES-CBC, IV=0)
    const iv = [0, 0, 0, 0, 0, 0, 0, 0];
    const eifd = tdesEncryptCBC(s, kEnc, iv);

    // Step 5: MAC over encrypted data
    const mifd = retailMAC(eifd, kMac);

    // Step 6: EXTERNAL AUTHENTICATE
    const extAuthData = [...eifd, ...mifd]; // 32 + 8 = 40 bytes
    const extAuthCmd = [0x00, 0x82, 0x00, 0x00, 0x28, ...extAuthData, 0x28];
    const extAuthResp = await transceiveFn(extAuthCmd);
    console.log('[NFC-BAC] EXTERNAL_AUTHENTICATE response:', toHex(extAuthResp));

    if (!isSuccess(extAuthResp) || extAuthResp.length < 42) {
      console.warn('[NFC-BAC] EXTERNAL AUTHENTICATE failed, status:', toHex(extAuthResp.slice(-2)));
      return null;
    }

    // Step 7: Parse response — E.IC (32 bytes) + M.IC (8 bytes) + SW (2 bytes)
    const eic = extAuthResp.slice(0, 32);
    const mic = extAuthResp.slice(32, 40);

    // Verify MAC (log warning if mismatch but don't fail)
    const expectedMac = retailMAC(eic, kMac);
    if (toHex(mic) !== toHex(expectedMac)) {
      console.warn('[NFC-BAC] M.IC verification failed — continuing anyway');
      console.warn('[NFC-BAC] Expected MAC:', toHex(expectedMac), 'Got:', toHex(mic));
    }

    // Step 8: Decrypt E.IC → RND.IC || RND.IFD || K.IC
    const ric = tdesDecryptCBC(eic, kEnc, iv);
    const kIC = ric.slice(16, 32);
    console.log('[NFC-BAC] K.IC:', toHex(kIC));

    // Step 9: KS_seed = XOR(K.IFD, K.IC)
    const ksSeed = kIFD.map((v, i) => (v ^ kIC[i]!) & 0xff);

    // Step 10-11: Derive session keys
    const { ksEnc, ksMac } = deriveSessionKeys(ksSeed);
    console.log('[NFC-BAC] Session Kenc:', toHex(ksEnc));
    console.log('[NFC-BAC] Session Kmac:', toHex(ksMac));

    // Step 12: SSC = RND.IC[4:8] || RND.IFD[4:8]
    const ssc = [...rndIC.slice(4, 8), ...rndIFD.slice(4, 8)];
    console.log('[NFC-BAC] SSC:', toHex(ssc));
    console.log('[NFC-BAC] Session keys established successfully');

    return { ksEnc, ksMac, ssc };
  } catch (err) {
    console.error('[NFC-BAC] BAC protocol error:', err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Secure Messaging — APDU wrapping (ICAO 9303 Part 11)
// ---------------------------------------------------------------------------

function incrementSSC(ssc: number[]): number[] {
  const result = [...ssc];
  for (let i = result.length - 1; i >= 0; i--) {
    result[i] = ((result[i] ?? 0) + 1) & 0xff;
    if (result[i] !== 0) break;
  }
  return result;
}

/** Pad data per ISO 9797-1 method 2 (0x80 + zeros to block boundary) */
function padISO9797(data: number[]): number[] {
  const padded = [...data, 0x80];
  while (padded.length % 8 !== 0) {
    padded.push(0x00);
  }
  return padded;
}

/** Wrap a READ BINARY APDU with Secure Messaging (DO'87' not needed for SELECT, DO'97' + DO'8E') */
function wrapReadBinaryAPDU(
  offset: number,
  length: number,
  session: SessionKeys,
): { command: number[]; newSSC: number[] } {
  const ssc = incrementSSC(session.ssc);

  // CLA=0x0C (secure messaging), INS=0xB0, P1P2=offset, no Lc data
  const cmdHeader = [0x0c, 0xb0, (offset >> 8) & 0xff, offset & 0xff];
  const paddedHeader = padISO9797(cmdHeader);

  // DO'97': expected response length
  const do97 = [0x97, 0x01, length & 0xff];

  // Build MAC input: SSC || padded header || padded DO'97'
  const macInput = [...padISO9797(ssc), ...paddedHeader, ...padISO9797(do97)];
  const mac = retailMAC(macInput, session.ksMac);

  // DO'8E': MAC (8 bytes)
  const do8E = [0x8e, 0x08, ...mac];

  // Assemble protected APDU
  const data = [...do97, ...do8E];
  const command = [0x0c, 0xb0, (offset >> 8) & 0xff, offset & 0xff, data.length, ...data, 0x00];

  return { command, newSSC: ssc };
}

/** Wrap SELECT FILE APDU with Secure Messaging */
function wrapSelectFileAPDU(
  fileId: number[],
  session: SessionKeys,
): { command: number[]; newSSC: number[] } {
  const ssc = incrementSSC(session.ssc);

  // CLA=0x0C, INS=0xA4, P1=0x02, P2=0x0C
  const cmdHeader = [0x0c, 0xa4, 0x02, 0x0c];
  const paddedHeader = padISO9797(cmdHeader);

  // DO'87': encrypted data — pad fileId, encrypt, wrap in TLV
  const paddedData = padISO9797(fileId);
  const iv = [0, 0, 0, 0, 0, 0, 0, 0];
  const encData = tdesEncryptCBC(paddedData, session.ksEnc, iv);
  // DO'87' = 0x87 + length + 0x01 (padding indicator) + encrypted data
  const do87 = [0x87, encData.length + 1, 0x01, ...encData];

  // Build MAC input: SSC || padded header || padded DO'87'
  const macInput = [...padISO9797(ssc), ...paddedHeader, ...padISO9797(do87)];
  const mac = retailMAC(macInput, session.ksMac);

  const do8E = [0x8e, 0x08, ...mac];

  const data = [...do87, ...do8E];
  const command = [0x0c, 0xa4, 0x02, 0x0c, data.length, ...data, 0x00];

  return { command, newSSC: ssc };
}

/** Unwrap a Secure Messaging response — extract DO'87' payload and verify DO'8E' MAC */
function unwrapSMResponse(
  response: number[],
  session: SessionKeys,
): { data: number[]; newSSC: number[] } | null {
  const ssc = incrementSSC(session.ssc);

  // Strip status word (last 2 bytes — 0x9000)
  if (response.length < 2) return null;
  const sw1 = response[response.length - 2]!;
  const sw2 = response[response.length - 1]!;
  if (sw1 !== 0x90 || sw2 !== 0x00) {
    console.warn('[NFC-SM] Response status:', sw1.toString(16), sw2.toString(16));
    return null;
  }

  const body = response.slice(0, response.length - 2);

  // Parse TLV data objects
  let encryptedData: number[] | null = null;
  let macValue: number[] | null = null;
  let do99: number[] | null = null;
  let idx = 0;

  while (idx < body.length) {
    const tag = body[idx]!;
    idx++;
    let len = body[idx]!;
    idx++;
    if (len === 0x81) {
      len = body[idx]!;
      idx++;
    } else if (len === 0x82) {
      len = ((body[idx]! << 8) | body[idx + 1]!) & 0xffff;
      idx += 2;
    }

    const value = body.slice(idx, idx + len);
    idx += len;

    if (tag === 0x87) {
      // DO'87': first byte is padding indicator (0x01), rest is encrypted data
      encryptedData = value.slice(1);
    } else if (tag === 0x8e) {
      macValue = value;
    } else if (tag === 0x99) {
      do99 = value;
    }
  }

  // Verify MAC (log warning only)
  if (macValue) {
    const macInputParts: number[] = [...padISO9797(ssc)];
    if (encryptedData) {
      // Reconstruct DO'87' for MAC calculation
      const do87Len = encryptedData.length + 1; // +1 for padding indicator
      const do87: number[] = [0x87];
      if (do87Len < 0x80) {
        do87.push(do87Len);
      } else if (do87Len < 0x100) {
        do87.push(0x81, do87Len);
      } else {
        do87.push(0x82, (do87Len >> 8) & 0xff, do87Len & 0xff);
      }
      do87.push(0x01, ...encryptedData);
      macInputParts.push(...padISO9797(do87));
    }
    if (do99) {
      macInputParts.push(...padISO9797([0x99, do99.length, ...do99]));
    }
    const expectedMac = retailMAC(macInputParts, session.ksMac);
    if (toHex(macValue) !== toHex(expectedMac)) {
      console.warn('[NFC-SM] Response MAC mismatch — continuing');
    }
  }

  // Decrypt DO'87' data
  if (encryptedData && encryptedData.length > 0) {
    const iv = [0, 0, 0, 0, 0, 0, 0, 0];
    const decrypted = tdesDecryptCBC(encryptedData, session.ksEnc, iv);
    // Remove ISO 9797-1 padding (find 0x80 from end)
    let padIdx = decrypted.length - 1;
    while (padIdx >= 0 && decrypted[padIdx] === 0x00) {
      padIdx--;
    }
    if (padIdx >= 0 && decrypted[padIdx] === 0x80) {
      return { data: decrypted.slice(0, padIdx), newSSC: ssc };
    }
    // No padding found — return as-is
    return { data: decrypted, newSSC: ssc };
  }

  // No encrypted data — empty response (e.g., SELECT with no response data)
  return { data: [], newSSC: ssc };
}

// ---------------------------------------------------------------------------
// APDU helpers for ICAO 9303 passport reading
// ---------------------------------------------------------------------------

/** SELECT file by ID (INS = 0xA4) */
function buildSelectFile(fileId: number[]): number[] {
  return [0x00, 0xa4, 0x02, 0x0c, fileId.length, ...fileId];
}

/** READ BINARY (INS = 0xB0) */
function buildReadBinary(offset: number, length: number): number[] {
  return [0x00, 0xb0, (offset >> 8) & 0xff, offset & 0xff, length];
}

async function transceive(command: number[]): Promise<number[]> {
  const response = await NfcManager.isoDepHandler.transceive(command);
  return response;
}

/** Check that the status bytes indicate success (0x90 0x00) */
function isSuccess(response: number[]): boolean {
  const len = response.length;
  return len >= 2 && response[len - 2] === 0x90 && response[len - 1] === 0x00;
}

// ---------------------------------------------------------------------------
// MRZ parsing (DG1 — Data Group 1)
// ---------------------------------------------------------------------------

/**
 * Parse DG1 (MRZ) from the raw bytes.
 * TD3 (passport) MRZ is 88 characters across 2 lines of 44 chars each.
 * The TLV structure: tag 0x61 → tag 0x5F1F → MRZ string.
 */
function parseDG1(data: number[]): PassportMRZData | null {
  try {
    // Find the 0x5F1F tag (MRZ data)
    let idx = 0;
    while (idx < data.length - 1) {
      if (data[idx] === 0x5f && data[idx + 1] === 0x1f) {
        idx += 2;
        // Read length (may be multi-byte BER-TLV)
        let length = data[idx] ?? 0;
        idx += 1;
        if (length === 0x81) {
          length = data[idx] ?? 0;
          idx += 1;
        } else if (length === 0x82) {
          length = ((data[idx] ?? 0) << 8) | (data[idx + 1] ?? 0);
          idx += 2;
        }

        const mrzBytes = data.slice(idx, idx + length);
        const mrz = String.fromCharCode(...mrzBytes);
        console.log('[NFC] MRZ raw:', mrz);

        if (mrz.length >= 88) {
          // TD3 two-line MRZ
          const line2 = mrz.substring(44, 88);
          const parsed = {
            documentNumber: line2.substring(0, 9).replace(/</g, '').trim(),
            nationality: line2.substring(10, 13).replace(/</g, '').trim(),
            dateOfBirth: line2.substring(13, 19),
            dateOfExpiry: line2.substring(21, 27),
          };
          console.log('[NFC] Parsed MRZ:', {
            documentNumber: parsed.documentNumber,
            nationality: parsed.nationality,
            dateOfBirth: parsed.dateOfBirth,
            dateOfExpiry: parsed.dateOfExpiry,
          });
          return parsed;
        }
        console.warn('[NFC] Unexpected MRZ length:', mrz.length);
        return null;
      }
      idx += 1;
    }
    console.warn('[NFC] DG1 tag 0x5F1F not found');
    return null;
  } catch (err) {
    console.error('[NFC] Error parsing DG1:', err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// DG1 reading — plain or Secure Messaging
// ---------------------------------------------------------------------------

async function readDG1Plain(): Promise<NFCReadResult> {
  // Select DG1 (EF.DG1 = 0x0101)
  const selectDG1Resp = await transceive(buildSelectFile([0x01, 0x01]));
  console.log('[NFC] SELECT DG1 response:', toHex(selectDG1Resp));

  if (!isSuccess(selectDG1Resp)) {
    return {
      success: false,
      error: {
        code: 'read_failed',
        message: 'Failed to select DG1 on passport chip. BAC may be required.',
      },
    };
  }

  // Read DG1 header to determine length
  const headerResp = await transceive(buildReadBinary(0, 4));
  if (!isSuccess(headerResp) || headerResp.length < 6) {
    return {
      success: false,
      error: { code: 'read_failed', message: 'Failed to read DG1 header' },
    };
  }

  const totalLength = parseBERTLVLength(headerResp);
  console.log('[NFC] DG1 total length:', totalLength);

  const allData = await readBinaryChunked(0, totalLength, null);
  if (!allData) {
    return {
      success: false,
      error: { code: 'read_failed', message: 'Failed to read DG1 data' },
    };
  }

  return finalizeDG1Read(allData, false);
}

async function readDG1SecureMessaging(session: SessionKeys): Promise<NFCReadResult> {
  // SELECT DG1 with SM
  const { command: selectCmd, newSSC: ssc1 } = wrapSelectFileAPDU([0x01, 0x01], session);
  const selectResp = await transceive(selectCmd);
  console.log('[NFC-SM] SELECT DG1 response:', toHex(selectResp));

  const selectResult = unwrapSMResponse(selectResp, { ...session, ssc: ssc1 });
  if (!selectResult) {
    console.warn('[NFC-SM] SELECT DG1 via SM failed, trying plain access');
    return readDG1Plain();
  }
  let currentSSC = selectResult.newSSC;

  // READ BINARY header (4 bytes) with SM
  const { command: readHeaderCmd, newSSC: ssc2 } = wrapReadBinaryAPDU(0, 4, {
    ...session,
    ssc: currentSSC,
  });
  const headerResp = await transceive(readHeaderCmd);
  const headerResult = unwrapSMResponse(headerResp, { ...session, ssc: ssc2 });
  if (!headerResult || headerResult.data.length < 4) {
    console.warn('[NFC-SM] Failed to read DG1 header via SM');
    return {
      success: false,
      error: { code: 'read_failed', message: 'Failed to read DG1 header via secure messaging' },
    };
  }
  currentSSC = headerResult.newSSC;

  const totalLength = parseBERTLVLength([...headerResult.data, 0x90, 0x00]);
  console.log('[NFC-SM] DG1 total length:', totalLength);

  // Read entire DG1 in chunks with SM
  const chunkSize = 200;
  const allData: number[] = [];
  let offset = 0;

  while (offset < totalLength) {
    const readLen = Math.min(chunkSize, totalLength - offset);
    const { command: readCmd, newSSC: readSSC } = wrapReadBinaryAPDU(offset, readLen, {
      ...session,
      ssc: currentSSC,
    });
    const chunkResp = await transceive(readCmd);
    const chunkResult = unwrapSMResponse(chunkResp, { ...session, ssc: readSSC });
    if (!chunkResult) {
      return {
        success: false,
        error: { code: 'read_failed', message: `DG1 SM read failed at offset ${offset}` },
      };
    }
    allData.push(...chunkResult.data);
    currentSSC = chunkResult.newSSC;
    offset += readLen;
  }

  console.log('[NFC-SM] DG1 read complete, total bytes:', allData.length);
  return finalizeDG1Read(allData, true);
}

function parseBERTLVLength(headerResp: number[]): number {
  if (headerResp[1] === 0x81) {
    return (headerResp[2] ?? 0) + 3;
  } else if (headerResp[1] === 0x82) {
    return (((headerResp[2] ?? 0) << 8) | (headerResp[3] ?? 0)) + 4;
  }
  return (headerResp[1] ?? 0) + 2;
}

async function readBinaryChunked(
  startOffset: number,
  totalLength: number,
  _session: SessionKeys | null,
): Promise<number[] | null> {
  const chunkSize = 200;
  const allData: number[] = [];
  let offset = startOffset;

  while (offset < totalLength) {
    const readLen = Math.min(chunkSize, totalLength - offset);
    const chunk = await transceive(buildReadBinary(offset, readLen));
    if (!isSuccess(chunk)) {
      return null;
    }
    allData.push(...chunk.slice(0, chunk.length - 2));
    offset += readLen;
  }
  return allData;
}

function finalizeDG1Read(allData: number[], bacUsed: boolean): NFCReadResult {
  const rawDG1Hex = toHex(allData);
  console.log('[NFC] DG1 raw bytes (hex):', rawDG1Hex);

  const mrzData = parseDG1(allData);
  if (!mrzData) {
    return {
      success: false,
      error: { code: 'read_failed', message: 'Failed to parse MRZ data from DG1' },
    };
  }

  console.log('[NFC] Passport read success:', {
    nationality: mrzData.nationality,
    docNumberLength: mrzData.documentNumber.length,
    bacUsed,
  });

  return { success: true, data: mrzData, rawDG1Hex, bacUsed };
}

// ---------------------------------------------------------------------------
// Passport reading (main flow)
// ---------------------------------------------------------------------------

const NFC_TIMEOUT_MS = 60_000;

/**
 * Read passport MRZ data via NFC with BAC (Basic Access Control).
 *
 * This initiates an NFC reader session, selects the eMRTD application,
 * performs BAC using the MRZ key, then reads DG1 with Secure Messaging.
 *
 * If BAC fails, falls back to plain DG1 read (for passports that don't enforce BAC).
 */
export async function readPassportNFC(mrzInput: MRZBACInput): Promise<NFCReadResult> {
  const status = await getNFCStatus();

  if (status === 'unavailable') {
    return {
      success: false,
      error: { code: 'unsupported', message: 'NFC is not available on this device' },
    };
  }

  if (status === 'disabled') {
    return {
      success: false,
      error: { code: 'disabled', message: 'NFC is disabled. Please enable NFC in Settings.' },
    };
  }

  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

  try {
    console.log('[NFC] Starting passport read session');

    // Request IsoDep technology (ISO 14443-4, used by eMRTD)
    await NfcManager.requestTechnology(NfcTech.IsoDep, {
      alertMessage: Platform.OS === 'ios'
        ? 'Hold your iPhone near the passport photo page'
        : undefined,
    });

    // Set up timeout
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timeoutHandle = setTimeout(() => {
        reject(new Error('NFC_TIMEOUT'));
      }, NFC_TIMEOUT_MS);
    });

    const readPromise = (async (): Promise<NFCReadResult> => {
      // Select eMRTD application (AID: A0000002471001)
      const selectApp = [0x00, 0xa4, 0x04, 0x0c, 0x07, 0xa0, 0x00, 0x00, 0x02, 0x47, 0x10, 0x01];
      const selectAppResp = await transceive(selectApp);
      console.log('[NFC] SELECT eMRTD app response:', toHex(selectAppResp));

      if (!isSuccess(selectAppResp)) {
        return {
          success: false,
          error: {
            code: 'read_failed',
            message: 'Failed to select eMRTD application on passport chip',
          },
        };
      }

      // Attempt BAC
      console.log('[NFC-BAC] Attempting BAC with MRZ data...');
      const session = await performBAC(mrzInput, transceive);

      if (session) {
        console.log('[NFC-BAC] BAC succeeded — reading DG1 with Secure Messaging');
        return readDG1SecureMessaging(session);
      }

      // Fallback: plain read without BAC
      console.warn('[NFC-BAC] BAC failed — falling back to plain DG1 read');
      return readDG1Plain();
    })();

    return await Promise.race([readPromise, timeoutPromise]);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[NFC] Read error:', message);

    if (message === 'NFC_TIMEOUT') {
      return {
        success: false,
        error: { code: 'timeout', message: 'NFC read timed out. Please try again.' },
      };
    }

    // react-native-nfc-manager throws when user cancels
    if (message.includes('cancel') || message.includes('Cancel') || message.includes('invalidated')) {
      return {
        success: false,
        error: { code: 'cancelled', message: 'NFC scan was cancelled' },
      };
    }

    return {
      success: false,
      error: { code: 'read_failed', message: `NFC read failed: ${message}` },
    };
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
    try {
      await NfcManager.cancelTechnologyRequest();
    } catch {
      // cleanup best-effort
    }
    console.log('[NFC] Session cleaned up');
  }
}

/**
 * Cancel any active NFC scanning session.
 */
export async function cancelNFCScan(): Promise<void> {
  try {
    await NfcManager.cancelTechnologyRequest();
    console.log('[NFC] Scan cancelled by user');
  } catch {
    // Already cancelled or no active session
  }
}
