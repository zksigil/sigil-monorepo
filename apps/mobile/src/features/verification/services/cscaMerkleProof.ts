/**
 * CSCA Merkle proof generation -- runs on-device in JavaScript.
 *
 * Takes the CSCA pubkey modulus (from verifyDSCChain), looks up the matching
 * cert in tree-data.json by comparing modulus hex, and returns the precomputed
 * 9 Merkle siblings. No Poseidon2 or native modules needed.
 *
 * tree-data.json is prebuilt by certs/build-tree.ts which computes all
 * proofs ahead of time (269 certs x 9 siblings = 2,421 bigints).
 */

import treeData from "../../../../assets/circuits/tree-data.json";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const CSCA_MERKLE_ROOT = treeData.root as `0x${string}`;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CSCAMerkleProof {
  /** 9 sibling field elements as decimal strings (matching the Noir circuit). */
  siblings: string[];
  /** Leaf index in the tree (0-based). */
  leafIndex: number;
  /** The Merkle root (hex, 0x-prefixed, 32 bytes). */
  root: `0x${string}`;
}

// ---------------------------------------------------------------------------
// Lazy index: pubkey modulus hex → cert entry
// ---------------------------------------------------------------------------

let _lookupCache: Map<string, { index: number; proof: string[] }> | null = null;

function getLookupCache(): Map<string, { index: number; proof: string[] }> {
  if (!_lookupCache) {
    _lookupCache = new Map();
    const certs = treeData.certs as Array<{
      index: number;
      modulus_hex: string;
      proof: string[];
    }>;
    for (const cert of certs) {
      // Store both with and without 0x prefix for flexible matching
      const key = cert.modulus_hex.toLowerCase().replace(/^0x/, "");
      _lookupCache!.set(key, { index: cert.index, proof: cert.proof });
    }
    console.log(
      `[CSCA] Indexed ${_lookupCache.size} CSCA certificates for Merkle proof lookup`,
    );
  }
  return _lookupCache;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Find a CSCA Merkle proof for a given CSCA public key.
 *
 * Accepts either raw bytes (Uint8Array) or hex string for the modulus.
 *
 * @param cscaModulus - CSCA RSA modulus (big-endian bytes or hex string).
 * @returns Merkle proof (siblings + leaf index) or null if CSCA not found.
 */
export function findCSCAMerkleProof(
  cscaModulus: Uint8Array | string,
): CSCAMerkleProof | null {
  let modulusHex: string;
  if (typeof cscaModulus === "string") {
    modulusHex = cscaModulus.toLowerCase().replace(/^0x/, "");
  } else {
    modulusHex = Array.from(cscaModulus)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
      .toLowerCase();
  }

  const entry = getLookupCache().get(modulusHex);
  if (!entry) {
    console.warn(
      `[CSCA] CSCA pubkey not found in Merkle tree -- cert may not be from ICAO ML`,
    );
    return null;
  }

  return {
    siblings: entry.proof,
    leafIndex: entry.index,
    root: treeData.root as `0x${string}`,
  };
}

