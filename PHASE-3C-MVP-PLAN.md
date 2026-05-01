> **HISTORICAL — kept for archaeology.** This document is the original MVP plan for the
> CSCA Merkle tree work. The plan shipped (with depth changed from 12 → 9 in the final
> implementation). The two-tier base/primary references are obsolete: Phase 4 collapsed
> them into one `sigil/` circuit. See `HIGH-LEVEL-ARCHITECTURE.md` for the current
> architecture.

# Phase 3C — CSCA Registry + Verification (MVP Plan)

## Goal

Prove in-circuit that the DSC public key (used to verify the SOD signature) belongs to a CSCA from the ICAO PKD, by including the DSC in a Poseidon2 Merkle tree whose root is stored on-chain.

## What We're Building

**One tree only**: CSCA Merkle Tree — a registry of trusted Country Signing Certificate Authorities from ICAO PKD.

NOT building: DSC tree, user identity tracking, TEE whitelisting, or cross-chain replication.

## Verification Flow

```
User taps passport → NFC reads SOD
  → SOD parser extracts DSC RSA pubkey (modulus, exponent)
  → App looks up DSC pubkey in pre-built CSCA tree
  → Generates Merkle proof (siblings + index)
  → Circuit verifies:
      1. RSA signature on signedAttrs ✅ (already works)
      2. DSC pubkey is in CSCA Merkle tree ✅ (new)
  → On-chain verifies:
      1. Proof is valid ✅
      2. CSCA root matches on-chain registry ✅ (new)
```

## Steps

### 1. Download & Parse ICAO PKD CSCA Certificates
- Download ICAO PKD CSCA certificates (PEM/DER)
- Parse each X.509 cert → extract RSA pubkey (modulus, exponent) + metadata
- Output: JSON array of `{ modulus, exponent, country, expiry }`

### 2. Build the CSCA Merkle Tree
- Poseidon2 Merkle tree, depth 12 (4,096 leaves, ICAO has ~500)
- Leaf: `poseidon2([modulus_as_field, exponent_as_field])`
- Output: tree root + JSON with all leaves + tree structure

### 3. Deploy `CSCAMerkleTree.sol` Contract
- Minimal contract storing the Merkle root
- Owner-only `setRoot()` function (mutable for dev, can make immutable later)
- `getCSCARoot()` view function

### 4. Extend Noir Circuit with Merkle Inclusion
- New public input: `csca_merkle_root: pub Field`
- New private inputs: `csca_merkle_siblings: [Field; 12]`, `csca_leaf_index: pub Field`
- After RSA verify: compute leaf from DSC pubkey, verify merkle root matches

### 5. Update Proof Generation Flow
- `proofService.ts`: load CSCA tree, find DSC pubkey, generate Merkle proof
- Include `csca_merkle_root`, `csca_merkle_siblings`, `csca_leaf_index` in inputs

### 6. Update `ProofVerifier.sol`
- Call `CSCAMerkleTree.getCSCARoot()` and assert it matches proof's public input

### 7. Test on Anvil
- Deploy contracts with test CSCA tree
- Generate proofs with real data
- End-to-end: scan → prove → register on-chain

## Technical Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Tree depth | 12 (4,096 leaves) | ~500 CSCAs, room to grow |
| Leaf hash | `poseidon2([modulus, exponent])` | Simple, matches proven approach |
| Ownership | Single owner (deployer) | MVP simplicity |
| Immutability | Mutable (owner can update) | Allows PKD updates during dev |
| Circuit cost | ~2,400–4,800 constraints | 12 × Poseidon2 is cheap |

## Out of Scope (Future)

- DSC tree / user identity tracking
- Automatic CSCA rotation
- Multi-chain replication
- TEE-backed attestation
- Decentralized governance (multisig)
