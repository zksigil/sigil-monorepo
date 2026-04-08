# Phase 3C Progress — CSCA Merkle Tree

## Status: Tree Built ✓

### What's been done
- Downloaded ICAO Master List: `ICAO_ML_01April2026.ml`
- Extracted **269 unique CSCA certificates** (from 385 total, deduplicated by pubkey)
- Saved to `certs/cscas.pem` and `certs/cscas.json`
- Built Poseidon2 Merkle tree (depth 12, 4096 leaves)
- **Merkle root:** `0x6db36480878d971e22b324a7b7d941ed6f986f484059e8ae9ef3c508fa993de`
- Proofs verified for sample certs

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
1. Create `CSCAMerkleTree.sol` — stores root, has `setRoot()` + `getRoot()`
2. Add Merkle inclusion check to Noir circuit (base + primary)
   - New public input: `csca_merkle_root`
   - New private inputs: `csca_merkle_siblings: [Field; 12]`
   - Verify: `Poseidon2::hash(merkle_root) == csca_merkle_root`
3. Update `ProofVerifier.sol` to validate root against on-chain contract
4. Integrate proof generation in `proofService.ts`
5. Test on Anvil

### Root update process (when ICAO releases new Master List)
```
1. Download new ICAO_ML_*.ml file
2. Run `python3 extract_certs.py ICAO_ML_*.ml certs/` → new cscas.json
3. Run `npx tsx build-tree.ts` → new tree-root.ts
4. Multisig owner calls `setRoot(newRoot)` on CSCAMerkleTree contract
```
**Impact:** Only affects NEW registrations (which need a valid proof with the current root).
Already-verified wallets are unaffected — they're permanently on the verified list.
No proof regeneration needed for existing users.

### Key technical decisions
- Tree is **off-chain**; only root goes **on-chain** (saves gas)
- Merkle proof generated off-chain during ZK proof generation
- Noir circuit recomputes root from leaf + siblings
- Contract just checks recomputed root matches stored root
