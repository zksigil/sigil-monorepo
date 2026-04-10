/**
 * ZK proof generation service — Phase 3 real implementation.
 *
 * Uses Mopro React Native SDK (Rust + Barretenberg backend) to generate
 * UltraHonk-Keccak proofs for both base-tier and primary-tier circuits.
 *
 * Passport data NEVER leaves the device. All hashing and proving is done
 * on-device in native Rust code.
 *
 * Circuit inputs (Phase 3c):
 *   Base tier:    private=[dg1_hash, sod_hash, epoch_day, ..., exponent, csca_merkle_siblings[12], csca_leaf_index]
 *                 public=[epoch_nullifier, hashed_address, passport_expiry, csca_merkle_root]
 *   Primary tier: private=[dg1_hash, sod_hash, nonce, ..., exponent, csca_merkle_siblings[12], csca_leaf_index]
 *                 public=[nullifier, next_commitment, hashed_address, passport_expiry, csca_merkle_root]
 *
 * Requires `mopro build --platforms ios` (or android) to have been run so that
 * apps/mobile/modules/mopro is populated.
 */

import { sha256 } from '@noble/hashes/sha2';
import { keccak256, encodePacked, type Hex } from 'viem';
import type { BaseZKProof, PrimaryZKProof, ZKProof } from '../../../shared/types/verification';
import { parseSod, verifyDSCChain } from '../../../infrastructure/sod/parseSod';
import { findCSCAMerkleProof, CSCA_MERKLE_ROOT } from './cscaMerkleProof';
export { CSCA_MERKLE_ROOT };

// ---------------------------------------------------------------------------
// Circuit constants
// ---------------------------------------------------------------------------
const BN254_PRIME = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

/** Must match SIGNED_ATTRS_MAX_LEN in the Noir circuits. */
const SIGNED_ATTRS_MAX_LEN = 512;

/** Phase 3c: 1289 (Phase 3b) + 12 Merkle siblings + 1 leaf index = 1302. */
const EXPECTED_BASE_INPUTS = 1302;
const EXPECTED_PRIMARY_INPUTS = 1303;

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface ProofInput {
  rawDG1Hex: string;               // hex-encoded DG1 bytes from NFC
  rawSODHex: string;               // hex-encoded SOD signature bytes from NFC
  walletAddress: `0x${string}`;
  /** nonce for primary-tier proofs. Defaults to 1 (first registration). */
  nonce?: number;
  /** Passport expiry as unix epoch seconds (parsed from DG1 MRZ). 0 = not constrained. */
  passportExpiryUnix?: number;
}

export interface BaseProofOutput {
  type: 'base';
  zkProof: BaseZKProof;
  epochNullifier: string;
  cscaMerkleRoot: `0x${string}`;
}

export interface PrimaryProofOutput {
  type: 'primary';
  zkProof: PrimaryZKProof;
  nullifier: string;
  nextCommitment: string;
  cscaMerkleRoot: `0x${string}`;
}

export type ProofOutput = BaseProofOutput | PrimaryProofOutput;

// ---------------------------------------------------------------------------
// Circuit file paths (bundled in app assets, copied to documents dir at runtime)
// ---------------------------------------------------------------------------

/** These paths are set after the circuit JSONs are copied to the writable FS. */
let BASE_CIRCUIT_PATH: string | null = null;
let PRIMARY_CIRCUIT_PATH: string | null = null;
let SRS_PATH: string | null = null;

export function setCircuitPaths(basePath: string, primaryPath: string, srsPath?: string): void {
  BASE_CIRCUIT_PATH = basePath;
  PRIMARY_CIRCUIT_PATH = primaryPath;
  SRS_PATH = srsPath ?? null;
}

// ---------------------------------------------------------------------------
// Test function to verify native module loading
// ---------------------------------------------------------------------------

export function testMoproModuleLoading(): boolean {
  try {
    console.log('[TEST] Testing Mopro native module loading...');
    const Mopro = loadMoproModule();
    console.log('[TEST] ✅ Mopro module loaded successfully');
    console.log('[TEST] Available functions:', Object.keys(Mopro).filter(key => typeof (Mopro as unknown as Record<string, unknown>)[key] === 'function'));
    return true;
  } catch (e) {
    console.error('[TEST] ❌ Mopro module loading failed:', e);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Real Mopro implementation
// ---------------------------------------------------------------------------

/**
 * Generate a base-tier UltraHonk-Keccak proof.
 *
 * Requires mopro build to have been run so that the native module is available.
 * Throws `MoproNotAvailable` if the native module cannot be loaded.
 */
export async function generateBaseProof(input: ProofInput): Promise<BaseProofOutput> {
  if (!BASE_CIRCUIT_PATH) {
    throw new Error('Base circuit path not set. Call setCircuitPaths() first.');
  }

  const Mopro = loadMoproModule();

  const dg1Hash = sha256ToField(stripHexPrefix(input.rawDG1Hex));
  const sodHash = sha256ToField(stripHexPrefix(input.rawSODHex));
  const epochDay = currentEpochDay().toString();
  const hashedAddr = walletAddressToField(input.walletAddress);
  const passportExpiry = (input.passportExpiryUnix ?? 0).toString();

  // Parse SOD to extract RSA fields
  console.log('[PROOF] Parsing SOD for RSA verification...');
  const sod = parseSod(input.rawSODHex);
  console.log('[PROOF-DBG] Parsed SOD exponent:', sod.exponent);
  console.log('[PROOF-DBG] Parsed SOD signedAttrs length:', sod.signedAttrs.length);
  console.log('[DEBUG-SIG] signature:', JSON.stringify(Array.from(sod.signature)));
  console.log('[DEBUG-PUBKEY] pubkey:', JSON.stringify(Array.from(sod.pubkeyModulus)));
  const signedAttrs = padToLength(sod.signedAttrs, SIGNED_ATTRS_MAX_LEN);
  const signedAttrsLen = sod.signedAttrs.length;
  const signature = ensureLength(sod.signature, 256, 'signature');
  const pubkey = ensureLength(sod.pubkeyModulus, 256, 'pubkey');

  // JS-side RSA verification sanity check (before sending to circuit)
  console.log('[PROOF-DBG] Verifying RSA signature in JS...');
  const jsRsaResult = verifyRSASignatureJS(sod.signedAttrs, signature, pubkey, sod.exponent);
  console.log('[PROOF-DBG] JS RSA verify:', jsRsaResult.valid ? '✅ VALID' : '❌ INVALID');
  console.log('[PROOF-DBG] JS signedAttrs SHA-256:', jsRsaResult.signedAttrsHash);
  console.log('[PROOF-DBG] JS recovered hash from sig:', jsRsaResult.recoveredHash);
  if (jsRsaResult.paddingInfo) {
    console.log('[PROOF-DBG] PKCS#1 padding:', jsRsaResult.paddingInfo);
  }

  // Off-circuit certificate chain verification
  // Verifies that the DSC cert was issued by a known CSCA
  console.log('[PROOF] Verifying DSC→CSCA certificate chain...');
  const chainResult = await verifyDSCChain(pubkey, sod.exponent, sod.certificates);
  console.log('[PROOF-DBG] Chain verification:', chainResult.valid ? '✅ VALID' : '❌ INVALID',
    chainResult.cscaSource ? `(${chainResult.cscaSource})` : '');
  if (chainResult.cscaName) {
    console.log('[PROOF-DBG] CSCA:', chainResult.cscaName);
  }

  console.log('[PROOF] Computing redc_param (Barrett reduction)...');
  const redcParam = await Mopro.computeRedcParam(pubkey.buffer as ArrayBuffer);
  console.log('[PROOF-DBG] redcParam byteLength:', redcParam.byteLength);
  console.log('[PROOF-DBG] First 10 bytes of signature:', Array.from(new Uint8Array(signature.buffer)).slice(0, 10));
  console.log('[PROOF-DBG] First 10 bytes of pubkey:', Array.from(new Uint8Array(pubkey.buffer)).slice(0, 10));
  console.log('[PROOF-DBG] First 10 bytes of redcParam:', Array.from(new Uint8Array(redcParam)).slice(0, 10));

  console.log('[PROOF] Finding CSCA Merkle proof...');
  let cscaMerkleProof = findCSCAMerkleProof(pubkey, sod.exponent);
  if (!cscaMerkleProof) {
    // Dev fallback: use placeholder Merkle proof.
    // This works because MockProofVerifier accepts any proof.
    // In production (real verifier), this path would throw.
    console.warn('[PROOF-DBG] DSC pubkey not in CSCA tree — using dev fallback (placeholder Merkle proof)');
    cscaMerkleProof = {
      siblings: new Array(12).fill('0'),
      leafIndex: 0,
      root: '0x0000000000000000000000000000000000000000000000000000000000000000' as `0x${string}`,
    };
  }
  console.log('[PROOF-DBG] CSCA Merkle proof: leafIndex=', cscaMerkleProof.leafIndex, 'root=', cscaMerkleProof.root);

  console.log('[PROOF] Computing base inputs (native Poseidon2)...');
  const baseInputs = await Mopro.computeBaseInputs(
    dg1Hash,
    sodHash,
    epochDay,
    signedAttrs.buffer as ArrayBuffer,
    signedAttrsLen,
    signature.buffer as ArrayBuffer,
    pubkey.buffer as ArrayBuffer,
    redcParam,
    sod.exponent,
    cscaMerkleProof.siblings,
    cscaMerkleProof.leafIndex,
    hashedAddr,
    passportExpiry,
    cscaMerkleProof.root,
  );

  console.log('[PROOF-DBG] baseInputs count:', baseInputs.inputs.length, `(expected ${EXPECTED_BASE_INPUTS})`);
  console.log('[PROOF-DBG] epochNullifier:', baseInputs.epochNullifier);
  console.log('[PROOF-DBG] first 5 inputs (dg1,sod,day,sa[0],sa[1]):', baseInputs.inputs.slice(0, 5));
  console.log('[PROOF-DBG] inputs[3..11] (signedAttrs[0..7]):', baseInputs.inputs.slice(3, 11));
  console.log('[PROOF-DBG] last 5 inputs:', baseInputs.inputs.slice(-5));
  console.log('[PROOF-DBG] input[515] (signed_attrs_len):', baseInputs.inputs[515]);
  console.log('[PROOF-DBG] input[1285] (exponent):', baseInputs.inputs[1285]);
  console.log('[PROOF-DBG] input[1286..1297] (csca_merkle_siblings[0..1]):', baseInputs.inputs[1286], baseInputs.inputs[1287]);
  console.log('[PROOF-DBG] input[1298] (csca_leaf_index):', baseInputs.inputs[1298]);
  console.log('[PROOF-DBG] input[1301] (csca_merkle_root):', baseInputs.inputs[1301]);

  console.log('[PROOF] Getting base VK...');
  const vkBuf = await Mopro.getNoirVerificationKey(
    BASE_CIRCUIT_PATH,
    SRS_PATH ?? undefined,
    true,
    false,
  );

  console.log('[PROOF] Generating base proof (5-15s)...');
  try {
    const proofBuf = await Mopro.generateNoirProof(
      BASE_CIRCUIT_PATH,
      SRS_PATH ?? undefined,
      baseInputs.inputs,
      true,
      vkBuf,
      false,
    );

    const proofHex = arrayBufferToHex(proofBuf);
    const vkHex = arrayBufferToHex(vkBuf);

    console.log('[PROOF] Base proof generated, size:', proofBuf.byteLength, 'bytes');

    return {
      type: 'base',
      zkProof: {
        proof: proofHex,
        vk: vkHex,
        epochNullifier: baseInputs.epochNullifier,
        hashedAddress: hashedAddr,
        passportExpiry,
        cscaMerkleRoot: cscaMerkleProof.root,
      },
      epochNullifier: baseInputs.epochNullifier,
      cscaMerkleRoot: cscaMerkleProof.root,
    };
  } catch (error) {
    console.error('[PROOF] Generation error:', error);
    if (error instanceof Error) {
      console.error('[PROOF] Error name:', error.name);
      console.error('[PROOF] Error message:', error.message);
      console.error('[PROOF] Error stack:', error.stack);
    }
    throw error;
  }
}

/**
 * Generate a primary-tier UltraHonk-Keccak proof.
 *
 * Requires mopro build to have been run so that the native module is available.
 */
export async function generatePrimaryProof(input: ProofInput): Promise<PrimaryProofOutput> {
  if (!PRIMARY_CIRCUIT_PATH) {
    throw new Error('Primary circuit path not set. Call setCircuitPaths() first.');
  }

  const Mopro = loadMoproModule();

  const dg1Hash = sha256ToField(stripHexPrefix(input.rawDG1Hex));
  const sodHash = sha256ToField(stripHexPrefix(input.rawSODHex));
  const nonce = (input.nonce ?? 1).toString();
  const hashedAddr = walletAddressToField(input.walletAddress);
  const passportExpiry = (input.passportExpiryUnix ?? 0).toString();

  // Parse SOD to extract RSA fields
  console.log('[PROOF] Parsing SOD for RSA verification...');
  const sod = parseSod(input.rawSODHex);
  const signedAttrs = padToLength(sod.signedAttrs, SIGNED_ATTRS_MAX_LEN);
  const signedAttrsLen = sod.signedAttrs.length;
  const signature = ensureLength(sod.signature, 256, 'signature');
  const pubkey = ensureLength(sod.pubkeyModulus, 256, 'pubkey');

  console.log('[PROOF] Computing redc_param (Barrett reduction)...');
  const redcParam = await Mopro.computeRedcParam(pubkey.buffer as ArrayBuffer);

  console.log('[PROOF] Finding CSCA Merkle proof...');
  let cscaMerkleProof = findCSCAMerkleProof(pubkey, sod.exponent);
  if (!cscaMerkleProof) {
    console.warn('[PROOF-DBG] DSC pubkey not in CSCA tree — using dev fallback (placeholder Merkle proof)');
    cscaMerkleProof = {
      siblings: new Array(12).fill('0'),
      leafIndex: 0,
      root: '0x0000000000000000000000000000000000000000000000000000000000000000' as `0x${string}`,
    };
  }

  console.log('[PROOF] Computing primary inputs (native Poseidon2)...');
  const primaryInputs = await Mopro.computePrimaryInputs(
    dg1Hash,
    sodHash,
    nonce,
    signedAttrs.buffer as ArrayBuffer,
    signedAttrsLen,
    signature.buffer as ArrayBuffer,
    pubkey.buffer as ArrayBuffer,
    redcParam,
    sod.exponent,
    cscaMerkleProof.siblings,
    cscaMerkleProof.leafIndex,
    hashedAddr,
    passportExpiry,
    cscaMerkleProof.root,
  );

  console.log('[PROOF] Getting primary VK...');
  const vkBuf = await Mopro.getNoirVerificationKey(
    PRIMARY_CIRCUIT_PATH,
    SRS_PATH ?? undefined,
    true,
    false,
  );

  console.log('[PROOF] Generating primary proof (5-15s)...');
  const proofBuf = await Mopro.generateNoirProof(
    PRIMARY_CIRCUIT_PATH,
    SRS_PATH ?? undefined,
    primaryInputs.inputs,
    true,
    vkBuf,
    false,
  );

  const proofHex = arrayBufferToHex(proofBuf);
  const vkHex = arrayBufferToHex(vkBuf);

  console.log('[PROOF] Primary proof generated, size:', proofBuf.byteLength, 'bytes');

  return {
    type: 'primary',
    zkProof: {
      proof: proofHex,
      vk: vkHex,
      nullifier: primaryInputs.nullifier,
      nextCommitment: primaryInputs.nextCommitment,
      hashedAddress: hashedAddr,
      passportExpiry,
      cscaMerkleRoot: cscaMerkleProof.root,
    },
    nullifier: primaryInputs.nullifier,
    nextCommitment: primaryInputs.nextCommitment,
    cscaMerkleRoot: cscaMerkleProof.root,
  };
}

// ---------------------------------------------------------------------------
// Nonce recovery — stateless primary-tier nonce discovery from passport data
// ---------------------------------------------------------------------------

export interface NonceRecoveryResult {
  /** The current nonce (the one whose nullifier has an active slot on-chain). */
  nonce: number;
  /** The nullifier for the current nonce. */
  nullifier: string;
  /** The nextCommitment stored on-chain for this slot. */
  nextCommitment: string;
}

/**
 * Recover the current primary-tier nonce by scanning on-chain primarySlots.
 *
 * Iterates nonces 1..maxNonce, computes the nullifier for each using Mopro's
 * native Poseidon2, and checks if `s_primarySlots[nullifier]` exists on-chain.
 * Returns the nonce whose slot is active, or null if no primary registration found.
 *
 * This enables fully stateless recovery after phone loss — the passport + chain
 * data is sufficient to reconstruct all state.
 */
export async function recoverPrimaryNonce(
  rawDG1Hex: string,
  rawSODHex: string,
  readSlot: (nullifier: string) => Promise<{ hashedAddress: string; nextCommitment: string }>,
  maxNonce = 20,
): Promise<NonceRecoveryResult | null> {
  const Mopro = loadMoproModule();

  const dg1Hash = sha256ToField(stripHexPrefix(rawDG1Hex));
  const sodHash = sha256ToField(stripHexPrefix(rawSODHex));

  for (let n = 1; n <= maxNonce; n++) {
    const nullifierStr = await Mopro.computeNullifier(
      dg1Hash,
      sodHash,
      n.toString(),
    );

    const slot = await readSlot(nullifierStr);

    // hashedAddress == bytes32(0) means empty slot
    if (slot.hashedAddress !== '0x' + '00'.repeat(32)) {
      console.log(`[RECOVERY] Found active primary slot at nonce ${n}`);
      return {
        nonce: n,
        nullifier: nullifierStr,
        nextCommitment: slot.nextCommitment,
      };
    }
  }

  console.log(`[RECOVERY] No active primary slot found (checked nonces 1..${maxNonce})`);
  return null;
}

// ---------------------------------------------------------------------------
// Stub (Phase 2 backward compat — no native module required)
// ---------------------------------------------------------------------------

export interface StubProofInput {
  rawDG1Hex: string;
  rawSODHex: string;
  walletAddress: `0x${string}`;
}

export interface StubProofOutput {
  zkProof: ZKProof;
  passportNullifierHex: `0x${string}`;
}

/**
 * Generate a stub ZK proof (no native module required).
 * The passportNullifier is deterministic (keccak256(DG1 || SOD)) but is NOT
 * a real ZK proof — a real on-chain verifier will reject it.
 */
export function generateStubProof(input: StubProofInput): StubProofOutput {
  const dg1Hex = (input.rawDG1Hex.startsWith('0x') ? input.rawDG1Hex : `0x${input.rawDG1Hex}`) as Hex;
  const sodHex = (input.rawSODHex.startsWith('0x') ? input.rawSODHex : `0x${input.rawSODHex}`) as Hex;

  const passportNullifier = keccak256(
    encodePacked(['bytes', 'bytes'], [dg1Hex, sodHex]),
  );

  const walletAddressBigInt = BigInt(input.walletAddress);
  const passportNullifierBigInt = BigInt(passportNullifier);
  const zkProofBytes = ('0x' + '00'.repeat(320)) as `0x${string}`;

  console.log('[PROOF] === Stub ZK Proof (Phase 2) ===');
  console.log('[PROOF] Wallet Address:', input.walletAddress);
  console.log('[PROOF] Passport Nullifier:', passportNullifier);

  return {
    zkProof: {
      proof: zkProofBytes,
      passportNullifier,
      publicSignals: [passportNullifierBigInt, walletAddressBigInt] as const,
    },
    passportNullifierHex: passportNullifier,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Verify an RSA signature (PKCS#1 v1.5) on signedAttrs and return diagnostic info.
 * 
 * This is a JS-side sanity check to validate the RSA signature before sending
 * to the ZK circuit.
 */
interface RSASignatureCheckResult {
  valid: boolean;
  signedAttrsHash: string;
  recoveredHash: string;
  paddingInfo?: string;
}

function verifyRSASignatureJS(
  signedAttrs: Uint8Array,
  signature: Uint8Array,
  pubkeyModulus: Uint8Array,
  exponent: number,
): RSASignatureCheckResult {
  try {
    // Compute SHA-256 hash of signedAttrs
    const signedAttrsHash = sha256(signedAttrs);
    const signedAttrsHashHex = Array.from(signedAttrsHash)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    // RSA public key operation: decrypt signature using pubkey
    // signature^exponent mod pubkeyModulus
    const sigBigInt = BigInt('0x' + Array.from(signature).map(b => b.toString(16).padStart(2, '0')).join(''));
    const modulusBigInt = BigInt('0x' + Array.from(pubkeyModulus).map(b => b.toString(16).padStart(2, '0')).join(''));
    const exponentBigInt = BigInt(exponent);

    // Modular exponentiation: sig^exponent mod modulus
    const decryptedBigInt = modPow(sigBigInt, exponentBigInt, modulusBigInt);

    // Convert decrypted value back to bytes
    const decryptedBytes = bigIntToBytes(decryptedBigInt, 256);

    // Parse PKCS#1 v1.5 padding: 0x00 || 0x01 || PS || 0x00 || DigestInfo
    // DigestInfo for SHA-256: 30 31 30 0d 06 09 60 86 48 01 65 03 04 02 01 05 00 04 20 || hash
    const digestInfoPrefix = '3031300d060960864801650304020105000420';
    const decryptedHex = Array.from(decryptedBytes)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    // Find the recovered hash from the decrypted signature
    const digestInfoIndex = decryptedHex.indexOf(digestInfoPrefix);
    let recoveredHash = '';
    let paddingInfo = '';

    if (digestInfoIndex !== -1) {
      // Found proper PKCS#1 DigestInfo structure
      const hashStart = digestInfoIndex + digestInfoPrefix.length;
      const hashEnd = hashStart + 64; // SHA-256 hash is 32 bytes = 64 hex chars
      recoveredHash = decryptedHex.slice(hashStart, hashEnd);
      paddingInfo = `PKCS#1 v1.5 DigestInfo found at byte offset ${digestInfoIndex / 2}`;
    } else {
      // Fallback: try to extract last 32 bytes as hash
      recoveredHash = decryptedHex.slice(-64);
      paddingInfo = 'PKCS#1 DigestInfo not found, using raw decrypted bytes';
    }

    const valid = signedAttrsHashHex === recoveredHash;

    return {
      valid,
      signedAttrsHash: signedAttrsHashHex,
      recoveredHash,
      paddingInfo,
    };
  } catch (error) {
    console.error('[PROOF-DBG] RSA verification error:', error);
    return {
      valid: false,
      signedAttrsHash: '',
      recoveredHash: '',
      paddingInfo: `Error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/** Modular exponentiation: base^exp mod mod */
function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
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

/** Convert a bigint to big-endian bytes of specified length */
function bigIntToBytes(value: bigint, length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  for (let i = length - 1; i >= 0; i--) {
    bytes[i] = Number(value & 0xffn);
    value = value >> 8n;
  }
  return bytes;
}

/** Zero-pad a byte array to the target length. */
function padToLength(bytes: Uint8Array, targetLen: number): Uint8Array {
  if (bytes.length > targetLen) {
    throw new Error(`signedAttrs is ${bytes.length} bytes, exceeds max ${targetLen}`);
  }
  if (bytes.length === targetLen) return bytes;
  const padded = new Uint8Array(targetLen);
  padded.set(bytes);
  return padded;
}

/** Ensure a byte array is exactly the expected length. */
function ensureLength(bytes: Uint8Array, expected: number, label: string): Uint8Array {
  if (bytes.length !== expected) {
    throw new Error(`${label} is ${bytes.length} bytes, expected ${expected} (RSA-2048)`);
  }
  return bytes;
}

/** Lazy-load the mopro native module. Throws if not available. */
function loadMoproModule(): MoproInterface {
  console.log('[MOPRO] Attempting to load mopro-ffi native module...');
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('mopro-ffi');
    console.log('[MOPRO] Successfully loaded mopro-ffi module:', typeof mod);

    // The generated index.tsx does `export * from './generated/...'` so named
    // exports (computeBaseInputs, generateNoirProof, etc.) are at mod top-level.
    if (!mod?.computeBaseInputs) {
      console.error('[MOPRO] ERROR: computeBaseInputs function not found in module');
      throw new Error('Mopro native module not available.');
    }
    console.log('[MOPRO] ✅ Mopro native module loaded successfully');
    return mod as MoproInterface;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[MOPRO] ❌ Failed to load mopro-ffi:', msg);
    throw new Error(`Mopro native module not available: ${msg}`);
  }
}

/** Convert a hex string (no 0x prefix) of raw bytes to a BN254 field decimal string. */
function sha256ToField(hexBytes: string): string {
  const bytes = hexStringToUint8Array(hexBytes);
  const hashBytes = sha256(bytes);
  return bytesToFieldDecimal(hashBytes);
}

/** Convert keccak256(wallet_address) to a BN254 field decimal string. */
function walletAddressToField(address: `0x${string}`): string {
  const hash = keccak256(address);
  const bytes = hexStringToUint8Array(hash.slice(2));
  return bytesToFieldDecimal(bytes);
}

/** Convert big-endian bytes to a BN254 field element decimal string (mod prime). */
function bytesToFieldDecimal(bytes: Uint8Array): string {
  let val = 0n;
  for (const b of bytes) {
    val = val * 256n + BigInt(b);
  }
  return (val % BN254_PRIME).toString(10);
}

/** Return the number of whole days since unix epoch (used as epoch_day in base circuit). */
function currentEpochDay(): number {
  return Math.floor(Date.now() / 1000 / 86400);
}

function stripHexPrefix(hex: string): string {
  return hex.startsWith('0x') ? hex.slice(2) : hex;
}

function hexStringToUint8Array(hex: string): Uint8Array {
  const clean = hex.length % 2 === 0 ? hex : '0' + hex;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): `0x${string}` {
  return ('0x' + Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')) as `0x${string}`;
}

function arrayBufferToHex(buf: ArrayBuffer): `0x${string}` {
  return bytesToHex(new Uint8Array(buf));
}

// ---------------------------------------------------------------------------
// Type stub for the mopro native module (generated at build time by uniffi-bindgen-react-native)
// ---------------------------------------------------------------------------

interface BaseInputsResult {
  inputs: string[];
  epochNullifier: string;
}

interface PrimaryInputsResult {
  inputs: string[];
  nullifier: string;
  nextCommitment: string;
}

interface MoproInterface {
  computeBaseInputs(
    dg1Hash: string,
    sodHash: string,
    epochDay: string,
    signedAttrs: ArrayBuffer,
    signedAttrsLen: number,
    signature: ArrayBuffer,
    pubkey: ArrayBuffer,
    redcParam: ArrayBuffer,
    exponent: number,
    cscaMerkleSiblings: string[],
    cscaLeafIndex: number,
    hashedAddress: string,
    passportExpiry: string,
    cscaMerkleRoot: string,
  ): Promise<BaseInputsResult> | BaseInputsResult;

  computePrimaryInputs(
    dg1Hash: string,
    sodHash: string,
    nonce: string,
    signedAttrs: ArrayBuffer,
    signedAttrsLen: number,
    signature: ArrayBuffer,
    pubkey: ArrayBuffer,
    redcParam: ArrayBuffer,
    exponent: number,
    cscaMerkleSiblings: string[],
    cscaLeafIndex: number,
    hashedAddress: string,
    passportExpiry: string,
    cscaMerkleRoot: string,
  ): Promise<PrimaryInputsResult> | PrimaryInputsResult;

  computeRedcParam(
    modulusBytes: ArrayBuffer,
  ): Promise<ArrayBuffer> | ArrayBuffer;

  computeNullifier(
    dg1Hash: string,
    sodHash: string,
    nonce: string,
  ): Promise<string> | string;

  getNoirVerificationKey(
    circuitPath: string,
    srsPath: string | undefined,
    onChain: boolean,
    lowMemoryMode: boolean,
  ): Promise<ArrayBuffer> | ArrayBuffer;

  generateNoirProof(
    circuitPath: string,
    srsPath: string | undefined,
    inputs: string[],
    onChain: boolean,
    vk: ArrayBuffer,
    lowMemoryMode: boolean,
  ): Promise<ArrayBuffer> | ArrayBuffer;

  verifyNoirProof(
    circuitPath: string,
    proof: ArrayBuffer,
    onChain: boolean,
    vk: ArrayBuffer,
    lowMemoryMode: boolean,
  ): Promise<boolean> | boolean;
}
