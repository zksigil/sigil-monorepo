---
name: DSC Registry Integration (Phase 3b)
description: How we use Rarimo/ZKPassport's DSC Merkle registry instead of our own oracle
type: project
---

Decided to couple directly to Rarimo's on-chain DSC registry rather than running our own oracle.

**Why:** Rarimo maintains the DSC Merkle tree (Document Signing Certificates for all ICAO passports). Reading from their contract directly is simpler, always up-to-date, and removes a trusted oracle role from our contract.

**Design:**
- `s_oracleUpdater` and `s_dscMerkleRoot` removed from VerificationRegistry (Phase 3a cleanup, 2026-03-24)
- In Phase 3b, `ProofVerifier.sol` reads the DSC root directly from Rarimo's state contract at proof verification time:
  ```solidity
  bytes32 dscRoot = IRarimoStateV2(RARIMO_STATE).getRoot();
  ```
- The ZK circuit includes `dscRoot` as a public input and proves the passport's DSC is in the tree
- If Rarimo changes their interface, the governor deploys a new ProofVerifier (already swappable via `setVerifier`)

**Reference:** https://docs.rarimo.com/zk-passport/ — check for current contract addresses and Merkle tree structure before writing Phase 3b circuit (tree depth, hash function, leaf encoding must match exactly)

**Why:** Keeps our registry contract minimal; Rarimo is actively maintained; swappable verifier mitigates coupling risk.
**How to apply:** When writing Phase 3b ProofVerifier.sol, read Rarimo's state contract for the DSC root rather than any storage on our registry.
