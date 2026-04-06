/**
 * ZK proof generation service — Phase 3 real implementation.
 *
 * Uses Mopro React Native SDK (Rust + Barretenberg backend) to generate
 * UltraHonk-Keccak proofs for both base-tier and primary-tier circuits.
 *
 * Passport data NEVER leaves the device. All hashing and proving is done
 * on-device in native Rust code.
 *
 * Circuit inputs:
 *   Base tier:    private=[dg1_hash, sod_hash, epoch_day]  public=[epoch_nullifier, hashed_address, passport_expiry]
 *   Primary tier: private=[dg1_hash, sod_hash, nonce]      public=[nullifier, next_commitment, hashed_address, passport_expiry]
 *
 * Requires `mopro build --platforms ios` (or android) to have been run so that
 * apps/mobile/modules/mopro is populated. Until then, generateStubProof can be
 * used for development without the native module.
 */

import { sha256 } from '@noble/hashes/sha2';
import { keccak256, encodePacked, type Hex } from 'viem';
import type { BaseZKProof, PrimaryZKProof, ZKProof } from '../../../shared/types/verification';
import { parseSod } from '../../../infrastructure/sod/parseSod';

// ---------------------------------------------------------------------------
// Circuit constants
// ---------------------------------------------------------------------------
const BN254_PRIME = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

/** Must match SIGNED_ATTRS_MAX_LEN in the Noir circuits. */
const SIGNED_ATTRS_MAX_LEN = 512;

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
}

export interface PrimaryProofOutput {
  type: 'primary';
  zkProof: PrimaryZKProof;
  nullifier: string;
  nextCommitment: string;
}

export type ProofOutput = BaseProofOutput | PrimaryProofOutput;

// ---------------------------------------------------------------------------
// Circuit file paths (bundled in app assets, copied to documents dir at runtime)
// ---------------------------------------------------------------------------

/** These paths are set after the circuit JSONs are copied to the writable FS. */
let BASE_CIRCUIT_PATH: string | null = null;
let PRIMARY_CIRCUIT_PATH: string | null = null;

export function setCircuitPaths(basePath: string, primaryPath: string): void {
  BASE_CIRCUIT_PATH = basePath;
  PRIMARY_CIRCUIT_PATH = primaryPath;
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
  const signedAttrs = padToLength(sod.signedAttrs, SIGNED_ATTRS_MAX_LEN);
  const signedAttrsLen = sod.signedAttrs.length;
  const signature = ensureLength(sod.signature, 256, 'signature');
  const pubkey = ensureLength(sod.pubkeyModulus, 256, 'pubkey');

  console.log('[PROOF] Computing redc_param (Barrett reduction)...');
  const redcParam = await Mopro.computeRedcParam(pubkey.buffer as ArrayBuffer);

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
    hashedAddr,
    passportExpiry,
  );

  console.log('[PROOF] Getting base VK...');
  const vkBuf = await Mopro.getNoirVerificationKey(
    BASE_CIRCUIT_PATH,
    undefined,
    true,
    false,
  );

  console.log('[PROOF] Generating base proof (5-15s)...');
  const proofBuf = await Mopro.generateNoirProof(
    BASE_CIRCUIT_PATH,
    undefined,
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
    },
    epochNullifier: baseInputs.epochNullifier,
  };
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
    hashedAddr,
    passportExpiry,
  );

  console.log('[PROOF] Getting primary VK...');
  const vkBuf = await Mopro.getNoirVerificationKey(
    PRIMARY_CIRCUIT_PATH,
    undefined,
    true,
    false,
  );

  console.log('[PROOF] Generating primary proof (5-15s)...');
  const proofBuf = await Mopro.generateNoirProof(
    PRIMARY_CIRCUIT_PATH,
    undefined,
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
    },
    nullifier: primaryInputs.nullifier,
    nextCommitment: primaryInputs.nextCommitment,
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
    hashedAddress: string,
    passportExpiry: string,
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
    hashedAddress: string,
    passportExpiry: string,
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
