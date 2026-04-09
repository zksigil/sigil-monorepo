# Phase 3C Progress — CSCA Merkle Tree

## Status: On-Chain + Circuit Integration ✓

### What's been done
- Downloaded ICAO Master List: `ICAO_ML_01April2026.ml`
- Extracted **269 unique CSCA certificates** (from 385 total, deduplicated by pubkey)
- Saved to `certs/cscas.pem` and `certs/cscas.json`
- Built Poseidon2 Merkle tree (depth 12, 4096 leaves)
- **Merkle root:** `0x06db36480878d971e22b324a7b7d941ed6f986f484059e8ae9ef3c508fa993de`
- Proofs verified for sample certs

### On-chain contracts
| Contract | Purpose |
|----------|---------|
| `CSCAMerkleTree.sol` | Stores Merkle root, owner-only `setRoot()`, 2-step ownership |
| `ICSCAMerkleTree.sol` | Interface for the registry |
| `ProofVerifier.sol` | Updated to include `cscaMerkleRoot` in public inputs |
| `VerificationRegistry.sol` | Fetches root from `CSCAMerkleTree`, passes to verifier |
| `IProofVerifier.sol` | Updated interface with `cscaMerkleRoot` param |
| `IVerificationRegistry.sol` | Added `CSCAMerkleTreeUpdated` event |

### Noir circuits (base + primary)
Both circuits updated to verify DSC pubkey is in the CSCA Merkle tree:

**New public input:**
- `csca_merkle_root: pub Field` — fetched from on-chain `CSCAMerkleTree`

**New private inputs:**
- `csca_merkle_siblings: [Field; 12]` — Merkle proof siblings
- `csca_leaf_index: u32` — index of the DSC pubkey in the tree

**Circuit flow (after RSA verify):**
1. Convert `pubkey: [u8; 256]` → `pubkey_as_field: Field` (via `bytes_256_to_field`)
2. Compute leaf = `Poseidon2::hash([pubkey_as_field, exponent_as_field], 2)`
3. Walk up Merkle tree with 12 siblings → verify `computed_root == csca_merkle_root`

### Key files
| File | Purpose |
|------|---------|
| `certs/cscas.pem` | 269 unique CSCA certs in PEM format |
| `certs/cscas.json` | Cert metadata (modulus_hex, exponent, country, etc.) |
| `certs/extract_certs.py` | Script to extract certs from ICAO ML |
| `certs/build-tree.ts` | Builds Merkle tree from cscas.json |
| `certs/tree-root.ts` | **Merkle root** + TREE_DEPTH + NUM_CERTS |
| `certs/tree-data.json` | Leaf hashes + cert metadata for proof generation |
| `certs/build-tree.ts` | Also exports `getProof()` and `verifyProof()` |

### Poseidon2 implementation
Using `@zkpassport/poseidon2` (v0.6.2) — matches Noir's `poseidon::poseidon2::Poseidon2` from `noir-lang/poseidon` v0.1.1.
- `poseidon2Hash([a, b])` = Noir's `Poseidon2::hash([a, b], 2)`
- Leaf = `poseidon2Hash([modulus, exponent])`
- Internal nodes = `poseidon2Hash([left, right])`
- Empty leaf = `poseidon2Hash([0, 0])`

### What's next
1. ~~Create `CSCAMerkleTree.sol`~~ ✓
2. ~~Add Merkle inclusion check to Noir circuits~~ ✓
3. ~~Update `ProofVerifier.sol` to validate root~~ ✓
4. **Integrate proof generation in `proofService.ts`** — generate Merkle proof + leaf computation
5. **Update mopro-circuits Rust FFI** — `computeBaseInputs` / `computePrimaryInputs` need Merkle siblings
6. **Test on Anvil** — deploy full stack, end-to-end proof generation + verification

### Root update process (when ICAO releases new Master List)
```
1. Download new ICAO_ML_*.ml file
2. Run `python3 extract_certs.py ICAO_ML_*.ml certs/` → new cscas.json
3. Run `npx tsx build-tree.ts` → new tree-root.ts
4. Multisig owner calls `setRoot(newRoot)` on CSCAMerkleTree contract
5. All new ZK proofs must use the new root (existing wallets unaffected)
```
**Impact:** Only affects NEW registrations (which need a valid proof with the current root).
Already-verified wallets are unaffected — they're permanently on the verified list.
No proof regeneration needed for existing users.

### Key technical decisions
- Tree is **off-chain**; only root goes **on-chain** (saves gas)
- Merkle proof generated off-chain during ZK proof generation
- Noir circuit recomputes root from leaf + siblings
- Contract just checks recomputed root matches stored root
- `bytes_256_to_field` converts pubkey bytes to Field (256 iterations, ~512 constraints)
- Uses `#[no_predicates]` on `verify_merkle_proof` to ensure it's compiled to ACIR (constrained)

### Test status
- `forge test`: **91 tests pass** (7 new CSCAMerkleTree + 84 existing)
- ProofVerifier.t.sol real-proof tests commented out (need proof regeneration after circuit change)
