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

// ---------------------------------------------------------------------------
// BN254 prime (circuit field modulus)
// ---------------------------------------------------------------------------
const BN254_PRIME = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

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

  console.log('[PROOF] Computing base inputs (native Poseidon2)...');
  const baseInputs = await Mopro.computeBaseInputs(
    dg1Hash,
    sodHash,
    epochDay,
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

  console.log('[PROOF] Computing primary inputs (native Poseidon2)...');
  const primaryInputs = await Mopro.computePrimaryInputs(
    dg1Hash,
    sodHash,
    nonce,
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

/** Lazy-load the mopro native module. Throws if not available. */
function loadMoproModule(): MoproInterface {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('mopro-ffi');
    // The generated index.tsx does `export * from './generated/...'` so named
    // exports (computeBaseInputs, generateNoirProof, etc.) are at mod top-level.
    if (!mod?.computeBaseInputs) {
      throw new Error('Mopro native module not available.');
    }
    return mod as MoproInterface;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
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
    hashedAddress: string,
    passportExpiry: string,
  ): Promise<BaseInputsResult> | BaseInputsResult;

  computePrimaryInputs(
    dg1Hash: string,
    sodHash: string,
    nonce: string,
    hashedAddress: string,
    passportExpiry: string,
  ): Promise<PrimaryInputsResult> | PrimaryInputsResult;

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
