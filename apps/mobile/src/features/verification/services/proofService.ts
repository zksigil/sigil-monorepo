/**
 * ZK proof generation service - Phase 4 single-tier implementation.
 *
 * Uses Mopro React Native SDK (Rust + Barretenberg backend) to generate
 * UltraHonk-Keccak proofs for the unified sigil circuit.
 *
 * Passport data NEVER leaves the device. All hashing and proving is done
 * on-device in native Rust code.
 *
 * Circuit inputs:
 *   private: dg1_hash, sod_hash, epoch_day,
 *            signed_attrs[512], signed_attrs_len, signature[256], pubkey[256], redc_param[257], exponent,
 *            dsc_tbs[1536], dsc_tbs_len, dsc_pubkey_offset,
 *            csca_pubkey[512], csca_redc_param[513], csca_exponent, csca_signature[512],
 *            csca_merkle_siblings[9], csca_leaf_index
 *   public:  nullifier, epoch_nullifier, hashed_address, csca_merkle_root
 *
 * The stable nullifier (Poseidon2(passport_secret, 1)) is the on-chain sigil identity.
 * The epoch_nullifier (Poseidon2(passport_secret, epoch_day)) is the daily rate-limit key.
 *
 * Requires `make ios` to have been run so that apps/mobile/modules/mopro is populated.
 */

import { sha256 } from '@noble/hashes/sha2';
import { keccak256, encodePacked, type Hex } from 'viem';
import type { SigilZKProof, ZKProof } from '../../../shared/types/verification';
import { parseSod, verifyDSCChain, extractDSCChainData } from '../../../infrastructure/sod/parseSod';
import { findCSCAMerkleProof, CSCA_MERKLE_ROOT } from './cscaMerkleProof';
export { CSCA_MERKLE_ROOT };

// ---------------------------------------------------------------------------
// Circuit constants
// ---------------------------------------------------------------------------
const BN254_PRIME = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

/** Must match SIGNED_ATTRS_MAX_LEN in the Noir circuit. */
const SIGNED_ATTRS_MAX_LEN = 512;

/** Must match DSC_TBS_MAX_LEN in the Noir circuit. */
const DSC_TBS_MAX_LEN = 1536;

/** RSA-4096 modulus = 512 bytes, redc_param = 513 bytes, signature = 512 bytes. */
const CSCA_MODULUS_LEN = 512;
const CSCA_SIGNATURE_LEN = 512;

/**
 * Sigil circuit emits 4 user public inputs:
 *   [nullifier, epoch_nullifier, hashed_address, csca_merkle_root]
 */
const USER_PUBLIC_INPUTS_COUNT = 4;

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface ProofInput {
  rawDG1Hex: string;               // hex-encoded DG1 bytes from NFC
  rawSODHex: string;               // hex-encoded SOD signature bytes from NFC
  walletAddress: `0x${string}`;
  /** Passport expiry as unix epoch seconds (parsed from DG1 MRZ). 0 = not constrained. */
  passportExpiryUnix?: number;
}

export interface SigilProofOutput {
  zkProof: SigilZKProof;
  nullifier: string;
  epochNullifier: string;
  cscaMerkleRoot: `0x${string}`;
}

// ---------------------------------------------------------------------------
// Circuit file paths (bundled in app assets, copied to documents dir at runtime)
// ---------------------------------------------------------------------------

let SIGIL_CIRCUIT_PATH: string | null = null;
let SRS_PATH: string | null = null;

/**
 * Cached UltraHonk-Keccak verification key.
 *
 * The VK is deterministic from circuit JSON + SRS — recomputing it for every
 * proof costs ~1-2s and produces the same bytes. We cache it module-locally so
 * the second sigilization in a session is faster. Cache is invalidated by
 * `setCircuitPaths` (called once at app boot from `useCircuitSetup`).
 */
let _cachedVkBuf: ArrayBuffer | null = null;

export function setCircuitPaths(sigilPath: string, srsPath?: string): void {
  SIGIL_CIRCUIT_PATH = sigilPath;
  SRS_PATH = srsPath ?? null;
  // Invalidate the VK cache whenever the circuit path changes (e.g. circuit JSON
  // hash changed and was rewritten to disk).
  _cachedVkBuf = null;
}

// ---------------------------------------------------------------------------
// Test function to verify native module loading
// ---------------------------------------------------------------------------

export function testMoproModuleLoading(): boolean {
  try {
    console.log('[TEST] Testing Mopro native module loading...');
    const Mopro = loadMoproModule();
    console.log('[TEST] Mopro module loaded successfully');
    console.log('[TEST] Available functions:', Object.keys(Mopro).filter(key => typeof (Mopro as unknown as Record<string, unknown>)[key] === 'function'));
    return true;
  } catch (e) {
    console.error('[TEST] Mopro module loading failed:', e);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Real Mopro implementation
// ---------------------------------------------------------------------------

/**
 * Generate a sigil UltraHonk-Keccak proof.
 *
 * Requires mopro build to have been run so that the native module is available.
 * Throws `MoproNotAvailable` if the native module cannot be loaded.
 */
export async function generateSigilProof(input: ProofInput): Promise<SigilProofOutput> {
  if (!SIGIL_CIRCUIT_PATH) {
    throw new Error('Sigil circuit path not set. Call setCircuitPaths() first.');
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

  // Off-circuit certificate chain verification
  console.log('[PROOF] Verifying DSC->CSCA certificate chain...');
  const chainResult = await verifyDSCChain(pubkey, sod.exponent, sod.certificates);
  console.log('[PROOF-DBG] Chain verification:', chainResult.valid ? 'VALID' : 'INVALID',
    chainResult.cscaSource ? `(${chainResult.cscaSource})` : '');

  if (!chainResult.valid || !chainResult.cscaModulusHex || chainResult.cscaExponent == null) {
    throw new Error('DSC chain verification failed - cannot extract CSCA data for circuit');
  }
  const dscCertDer = sod.certificates[0];
  if (!dscCertDer) {
    throw new Error('No DSC certificate found in SOD');
  }
  const dscChain = extractDSCChainData(dscCertDer, chainResult.cscaModulusHex, chainResult.cscaExponent);
  if (!dscChain) {
    throw new Error('Failed to extract DSC chain data from certificate');
  }
  console.log('[PROOF-DBG] DSC TBS length:', dscChain.dscTbs.length, 'CSCA pubkey length:', dscChain.cscaPubkey.length);

  const dscTbs = padToLength(dscChain.dscTbs, DSC_TBS_MAX_LEN);
  const dscTbsLen = dscChain.dscTbs.length;
  const dscPubkeyOffset = dscChain.dscPubkeyOffset;
  const cscaPubkey = padToLength(dscChain.cscaPubkey, CSCA_MODULUS_LEN);
  const cscaSignature = padToLength(dscChain.dscSignature, CSCA_SIGNATURE_LEN);

  console.log('[PROOF] Computing CSCA redc_param (Barrett reduction for RSA-4096)...');
  const cscaRedcParam = await Mopro.computeRedcParam(cscaPubkey.buffer as ArrayBuffer);

  console.log('[PROOF] Finding CSCA Merkle proof (by CSCA pubkey)...');
  // Pass the modulus hex directly; avoids a Uint8Array round-trip that
  // findCSCAMerkleProof would just hex-encode again.
  let cscaMerkleProof = findCSCAMerkleProof(chainResult.cscaModulusHex);
  if (!cscaMerkleProof) {
    // Dev fallback: placeholder Merkle proof. Works only against MockUltraHonkVerifier;
    // a real verifier would reject this proof.
    console.warn('[PROOF-DBG] CSCA pubkey not in Merkle tree - using dev fallback');
    cscaMerkleProof = {
      siblings: new Array(9).fill('0'),
      leafIndex: 0,
      root: '0x0000000000000000000000000000000000000000000000000000000000000000' as `0x${string}`,
    };
  }

  console.log('[PROOF] Computing sigil inputs (native Poseidon2)...');
  const sigilInputs = await Mopro.computeSigilInputs(
    dg1Hash,
    sodHash,
    epochDay,
    signedAttrs.buffer as ArrayBuffer,
    signedAttrsLen,
    signature.buffer as ArrayBuffer,
    pubkey.buffer as ArrayBuffer,
    redcParam,
    sod.exponent,
    dscTbs.buffer as ArrayBuffer,
    dscTbsLen,
    dscPubkeyOffset,
    cscaPubkey.buffer as ArrayBuffer,
    cscaRedcParam,
    dscChain.cscaExponent,
    cscaSignature.buffer as ArrayBuffer,
    cscaMerkleProof.siblings,
    cscaMerkleProof.leafIndex,
    hashedAddr,
    cscaMerkleProof.root,
  );

  console.log('[PROOF-DBG] inputs count:', sigilInputs.inputs.length);
  console.log('[PROOF-DBG] nullifier:', sigilInputs.nullifier);
  console.log('[PROOF-DBG] epoch_nullifier:', sigilInputs.epochNullifier);

  let vkBuf: ArrayBuffer;
  if (_cachedVkBuf !== null) {
    console.log('[PROOF] Using cached sigil VK');
    vkBuf = _cachedVkBuf;
  } else {
    console.log('[PROOF] Getting sigil VK (computing for the first time this session)...');
    vkBuf = await Mopro.getNoirVerificationKey(
      SIGIL_CIRCUIT_PATH,
      SRS_PATH ?? undefined,
      true,
      false,
    );
    _cachedVkBuf = vkBuf;
  }
  console.log('[PROOF-VK] sigil VK bytes:', vkBuf.byteLength);

  console.log('[PROOF] Generating sigil proof (5-15s)...');
  const proofBuf = await Mopro.generateNoirProof(
    SIGIL_CIRCUIT_PATH,
    SRS_PATH ?? undefined,
    sigilInputs.inputs,
    true,
    vkBuf,
    false,
  );

  console.log('[PROOF] Sigil proof generated, raw size:', proofBuf.byteLength, 'bytes');

  try {
    const localValid = await Mopro.verifyNoirProof(
      SIGIL_CIRCUIT_PATH,
      proofBuf,
      true,
      vkBuf,
      false,
    );
    console.log('[PROOF] Local verification:', localValid ? 'PASSED' : 'FAILED');
  } catch (verifyErr) {
    console.error('[PROOF] Local verification error:', verifyErr);
  }

  const { proof: proofForContract } = reshapeProofForContract(proofBuf, USER_PUBLIC_INPUTS_COUNT);
  const proofHex = arrayBufferToHex(proofForContract);
  const vkHex = arrayBufferToHex(vkBuf);

  return {
    zkProof: {
      proof: proofHex,
      vk: vkHex,
      nullifier: sigilInputs.nullifier,
      epochNullifier: sigilInputs.epochNullifier,
      hashedAddress: hashedAddr,
      passportExpiry,
      cscaMerkleRoot: cscaMerkleProof.root,
    },
    nullifier: sigilInputs.nullifier,
    epochNullifier: sigilInputs.epochNullifier,
    cscaMerkleRoot: cscaMerkleProof.root,
  };
}

// ---------------------------------------------------------------------------
// Stub (no native module required - dev fallback)
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
 * a real ZK proof - a real on-chain verifier will reject it.
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

  return {
    zkProof: {
      proof: zkProofBytes,
      passportNullifier,
      publicSignals: [passportNullifierBigInt, walletAddressBigInt] as const,
    },
    passportNullifierHex: passportNullifier,
  };
}

/**
 * Derive the on-chain sigil nullifier for a passport WITHOUT generating a
 * proof or running off-circuit RSA verification. Used by the wallet-discovery
 * flow: tap passport → compute nullifier → call `getWallets(nullifier)`.
 *
 * The nullifier output of `compute_sigil_inputs` depends only on `dg1Hash` and
 * `sodHash` (it's `Poseidon2([Poseidon2([dg1, sod]), 1])`). All the other
 * inputs are packaged into the proof-input vector but don't affect the
 * returned `.nullifier` — so we pass zero-filled buffers for them. The
 * returned `inputs` array is malformed but we discard it.
 */
export async function computeNullifierOnly(rawDG1Hex: string, rawSODHex: string): Promise<string> {
  const Mopro = loadMoproModule();
  const dg1Hash = sha256ToField(stripHexPrefix(rawDG1Hex));
  const sodHash = sha256ToField(stripHexPrefix(rawSODHex));

  // Zero-filled stand-ins — required by the function signature, but the
  // nullifier doesn't read them.
  const zeros = (n: number): ArrayBuffer => new Uint8Array(n).buffer as ArrayBuffer;

  const result = await Mopro.computeSigilInputs(
    dg1Hash,
    sodHash,
    '0',                              // epoch_day
    zeros(SIGNED_ATTRS_MAX_LEN), 0,   // signed_attrs, signed_attrs_len
    zeros(256),                        // signature
    zeros(256),                        // pubkey
    zeros(257),                        // redc_param
    65537,                             // exponent
    zeros(DSC_TBS_MAX_LEN), 0, 0,     // dsc_tbs, dsc_tbs_len, dsc_pubkey_offset
    zeros(CSCA_MODULUS_LEN),          // csca_pubkey
    zeros(513),                        // csca_redc_param
    65537,                             // csca_exponent
    zeros(CSCA_SIGNATURE_LEN),        // csca_signature
    new Array(9).fill('0'),            // csca_merkle_siblings
    0,                                 // csca_leaf_index
    '0',                               // hashed_address
    '0',                               // csca_merkle_root
  );
  return result.nullifier;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function padToLength(bytes: Uint8Array, targetLen: number): Uint8Array {
  if (bytes.length > targetLen) {
    throw new Error(`Input is ${bytes.length} bytes, exceeds max ${targetLen}`);
  }
  if (bytes.length === targetLen) return bytes;
  const padded = new Uint8Array(targetLen);
  padded.set(bytes);
  return padded;
}

function ensureLength(bytes: Uint8Array, expected: number, label: string): Uint8Array {
  if (bytes.length !== expected) {
    throw new Error(`${label} is ${bytes.length} bytes, expected ${expected} (RSA-2048)`);
  }
  return bytes;
}

function loadMoproModule(): MoproInterface {
  console.log('[MOPRO] Attempting to load mopro-ffi native module...');
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('mopro-ffi');
    if (!mod?.computeSigilInputs) {
      console.error('[MOPRO] ERROR: computeSigilInputs function not found in module');
      throw new Error('Mopro native module not available.');
    }
    console.log('[MOPRO] Mopro native module loaded successfully');
    return mod as MoproInterface;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[MOPRO] Failed to load mopro-ffi:', msg);
    throw new Error(`Mopro native module not available: ${msg}`);
  }
}

function sha256ToField(hexBytes: string): string {
  const bytes = hexStringToUint8Array(hexBytes);
  const hashBytes = sha256(bytes);
  return bytesToFieldDecimal(hashBytes);
}

function walletAddressToField(address: `0x${string}`): string {
  const hash = keccak256(address);
  const bytes = hexStringToUint8Array(hash.slice(2));
  return bytesToFieldDecimal(bytes);
}

function bytesToFieldDecimal(bytes: Uint8Array): string {
  let val = 0n;
  for (const b of bytes) {
    val = val * 256n + BigInt(b);
  }
  return (val % BN254_PRIME).toString(10);
}

/**
 * Day index since the Unix epoch (UTC). Matches the contract's calculation:
 *   `floor(block.timestamp / 1 days)`
 * since `Date.now()` returns ms-since-epoch in UTC.
 */
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

/**
 * Convert a raw noir-rs proof buffer into the byte string the Solidity verifier expects.
 *
 * noir-rs (barretenberg-rs 4.2.0-aztecnr-rc.2) returns:
 *   [4 bytes BE num_pub][num_pub * 32-byte user public inputs][PAIRING_POINTS_SIZE Frs][proof body bytes]
 *
 * The bb-generated Solidity `verify(bytes proof, bytes32[] publicInputs)` expects:
 *   - `publicInputs` = the N user public inputs only
 *   - `proof`        = [PAIRING_POINTS_SIZE Frs][rest of proof body]
 */
function reshapeProofForContract(
  rawProof: ArrayBuffer,
  userPubInputsCount: number,
): { proof: ArrayBuffer; publicInputs: ArrayBuffer } {
  const ELEMENT_SIZE = 32;
  const PREFIX_SIZE = 4;
  const view = new DataView(rawProof);
  const numPub = view.getUint32(0, false);
  if (numPub !== userPubInputsCount) {
    throw new Error(
      `proof prefix says ${numPub} public inputs, expected ${userPubInputsCount}`,
    );
  }
  const userEnd = PREFIX_SIZE + userPubInputsCount * ELEMENT_SIZE;
  const userInputs = rawProof.slice(PREFIX_SIZE, userEnd);
  const proof = rawProof.slice(userEnd);
  return { proof, publicInputs: userInputs };
}

// ---------------------------------------------------------------------------
// Type stub for the mopro native module
// ---------------------------------------------------------------------------

interface SigilInputsResult {
  inputs: string[];
  nullifier: string;
  epochNullifier: string;
}

interface MoproInterface {
  computeSigilInputs(
    dg1Hash: string,
    sodHash: string,
    epochDay: string,
    signedAttrs: ArrayBuffer,
    signedAttrsLen: number,
    signature: ArrayBuffer,
    pubkey: ArrayBuffer,
    redcParam: ArrayBuffer,
    exponent: number,
    dscTbs: ArrayBuffer,
    dscTbsLen: number,
    dscPubkeyOffset: number,
    cscaPubkey: ArrayBuffer,
    cscaRedcParam: ArrayBuffer,
    cscaExponent: number,
    cscaSignature: ArrayBuffer,
    cscaMerkleSiblings: string[],
    cscaLeafIndex: number,
    hashedAddress: string,
    cscaMerkleRoot: string,
  ): Promise<SigilInputsResult> | SigilInputsResult;

  computeRedcParam(
    modulusBytes: ArrayBuffer,
  ): Promise<ArrayBuffer> | ArrayBuffer;

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
