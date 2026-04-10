# Phase 3C Progress — Session Summary

> Generated at end of session. Use this as context for the next chat continuation.

## Status: Full Stack Integration Complete ✓

All layers have been updated for CSCA Merkle tree verification:
- ✅ Noir circuits (base + primary)
- ✅ Rust FFI (mopro-circuits)
- ✅ React Native (proofService.ts)
- ✅ TypeScript types (shared types)
- ✅ Solidity contracts + tests
- ✅ Circuit compilation + iOS binary rebuild
- ✅ Dev fallback for unlisted DSCs

---

## What Was Done

### 1. Noir Circuits — Merkle Verification Added
**Files:** `packages/circuits/base/src/main.nr`, `packages/circuits/primary/src/main.nr`

**New inputs:**
- `csca_merkle_siblings: [Field; 12]` — private
- `csca_leaf_index: u32` — private  
- `csca_merkle_root: pub Field` — public (4th/5th public input)

**Circuit flow after RSA verify:**
1. `pubkey: [u8; 256]` → `bytes_256_to_field()` → Field element
2. Leaf = `Poseidon2::hash([pubkey_as_field, exponent_as_field], 2)`
3. Walk up 12 levels using siblings, checking position via `leaf_index % 2`
4. Assert computed root == `csca_merkle_root`

**Helper functions added:**
- `verify_merkle_proof(leaf, siblings, leaf_index)` — `#[no_predicates]` for ACIR
- `bytes_256_to_field(bytes)` — converts big-endian pubkey to BN254 field element (~512 constraints)

**Public input order (NEW):**
- Base: `[epoch_nullifier, hashed_address, passport_expiry, csca_merkle_root]` (4 inputs)
- Primary: `[nullifier, next_commitment, hashed_address, passport_expiry, csca_merkle_root]` (5 inputs)

**Prover.toml updated** with placeholder Merkle siblings (12 zeros) + leaf_index=0.

### 2. Rust FFI — Updated `computeBaseInputs` / `computePrimaryInputs`
**File:** `packages/mopro-circuits/src/noir.rs`

**New parameters added:**
```rust
pub fn compute_base_inputs(
    // ... existing params ...
    csca_merkle_siblings: Vec<String>,  // 12 decimal strings
    csca_leaf_index: u32,
    // ... remaining params ...
    csca_merkle_root: String,           // decimal string
)
```

The siblings and root are inserted into the flat input vector at the correct position (after `exponent`, before public inputs).

### 3. React Native — Proof Service Updated
**File:** `apps/mobile/src/features/verification/services/proofService.ts`

**New flow:**
1. `findCSCAMerkleProof(pubkey, exponent)` — looks up DSC pubkey in `tree-data.json`
2. If found → returns `{ siblings, leafIndex, root }`
3. If NOT found → **dev fallback** (12 zero siblings, root from CSCA_MERKLE_ROOT constant). This allows testing with passports whose DSC isn't in the ICAO ML yet.
4. Passes siblings + leaf index + root to `Mopro.computeBaseInputs()` / `computePrimaryInputs()`

**New module:** `cscaMerkleProof.ts`
- `findCSCAMerkleProof(pubkeyModulus: Uint8Array, exponent: number)` → `CSCAMerkleProof | null`
- Pre-indexed lookup by pubkey hex → O(1) lookup

**Output types updated:**
- `BaseProofOutput` now has `cscaMerkleRoot: \`0x${string}\``
- `PrimaryProofOutput` now has `cscaMerkleRoot: \`0x${string}\``

### 4. Shared TypeScript Types Updated
**File:** `apps/mobile/src/shared/types/verification.ts`
- `BaseZKProof` + `PrimaryZKProof` both got `cscaMerkleRoot: \`0x${string}\``

### 5. Solidity Contracts
**Files created:**
- `packages/contracts/src/CSCAMerkleTree.sol` — stores root, owner-only `setRoot()`, 2-step ownership
- `packages/contracts/src/interfaces/ICSCAMerkleTree.sol` — interface
- `packages/contracts/test/CSCAMerkleTree.t.sol` — 7 tests (all passing)

**Files modified:**
- `ProofVerifier.sol` — now takes `CSCAMerkleTree` in constructor, includes root in public inputs array
- `IProofVerifier.sol` — added `cscaMerkleRoot` param to both `verifyBaseProof` and `verifyPrimaryProof`
- `VerificationRegistry.sol` — stores `CSCAMerkleTree` ref, passes root to verifier on every proof check, added `setCSCAMerkleTree()` governance setter
- `IVerificationRegistry.sol` — added `CSCAMerkleTreeUpdated` event
- Deploy scripts updated (`Deploy.s.sol`, `DeployDev.s.sol`)
- Test mocks updated (`MockProofVerifier.sol`)

**Test results:** 91 tests pass (7 new + 84 existing)

### 6. Build Artifacts Rebuilt
- Circuit JSON recompiled (`nargo compile --workspace`) → copied to `apps/mobile/assets/circuits/`
- iOS xcframework rebuilt (`uniffi-bindgen-react-native build ios`) → copied to both `apps/mobile/modules/mopro/` and `packages/mopro-circuits/MoproReactNativeBindings/`
- `tree-data.json` regenerated with precomputed Merkle proofs + `modulus_hex` for each cert

### 7. Git Cleanup
- `packages/mopro-circuits/target/` was accidentally tracked — restored to gitignore
- `packages/contracts/broadcast/` added to `.gitignore`

---

## Key Design Decisions

### Dev Fallback for Unlisted DSCs
When `findCSCAMerkleProof()` returns `null` (DSC pubkey not in `tree-data.json`), the proofService falls back to:
```typescript
cscaMerkleProof = {
  siblings: new Array(12).fill('0'),
  leafIndex: 0,
  root: CSCA_MERKLE_ROOT,
}
```
This works with `MockProofVerifier` (accepts any proof) but would fail with the real on-chain verifier. This is intentional — allows dev testing while the DSC database grows.

### Precomputed Merkle Proofs in `tree-data.json`
Instead of computing Merkle proofs in JavaScript (which would require Poseidon2 in the mobile app), all proofs are precomputed at build time by `certs/build-tree.ts`. The JS code just does a simple pubkey hex lookup.

### Poseidon2 NOT Needed in Mobile App
The `@zkpassport/poseidon2` dependency was removed from the mobile app. All hashing is done:
- Off-device: `build-tree.ts` precomputes proofs
- In-circuit: Noir circuit verifies the proof
- The mobile app just passes precomputed values through

---

## Current Blocker / Known Gap

**DSC Coverage:** The ICAO Master List only contains CSCA root certs (269 unique), not individual DSCs. A passport's SOD is signed by a DSC which chains to a CSCA. The DSC itself is not in the tree.

**Current workaround:** Dev fallback (zero siblings) works with MockVerifier.

**To fix properly:** Need to add DSC certs to the tree. Sources:
1. Extract DSCs from passport SODs during scans (build database over time)
2. Country PKI pages (US State Dept, German BSI, etc.)
3. Crowdsourced databases (Open ePassport project)

---

## Next Steps for New Session

1. **Address the DSC coverage gap** — decide on approach to get DSCs into the tree
2. **Regenerate proof fixtures** for `ProofVerifier.t.sol` once real proofs work
3. **Anvil end-to-end testing** — deploy full stack and test
4. **Remove dev fallback** once DSC coverage is adequate
5. **Production deploy** — migrate to Sepolia/mainnet

---

## Files Changed Summary

```
Modified (19):
  Makefile
  .gitignore
  PHASE-3C-PROGRESS.md
  packages/circuits/base/Prover.toml
  packages/circuits/primary/Prover.toml
  packages/circuits/base/src/main.nr
  packages/circuits/primary/src/main.nr
  packages/circuits/target/passport_base.json
  packages/circuits/target/passport_primary.json
  packages/mopro-circuits/src/noir.rs
  packages/mopro-circuits/MoproReactNativeBindings/MoproFfiFramework.xcframework/* (3 files)
  apps/mobile/assets/circuits/passport_base.json
  apps/mobile/assets/circuits/passport_primary.json
  apps/mobile/modules/mopro/MoproFfiFramework.xcframework/* (3 files)
  apps/mobile/src/features/verification/services/proofService.ts
  apps/mobile/src/shared/types/verification.ts
  apps/mobile/src/infrastructure/blockchain/contractAbis.ts
  apps/mobile/src/infrastructure/blockchain/contracts.ts
  certs/build-tree.ts
  certs/tree-data.json

New (2):
  apps/mobile/src/features/verification/services/cscaMerkleProof.ts
  apps/mobile/assets/circuits/tree-data.json
```
