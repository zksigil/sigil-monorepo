# Phase 3C — ICAO PKD Verification: Architecture Comparison

## Problem

Phase 3b verifies that **a DSC signed the SOD** but trusts whatever RSA public key is provided. Phase 3c must prove the DSC belongs to a legitimate ICAO member state.

---

## Option A: Self Protocol

**Docs**: https://docs.self.xyz/technical-docs/architecture#csca-tree

### Architecture

| Component | Details |
|-----------|---------|
| **CSCA Tree** | Depth 12 (>4,096 leaves), ~500 CSCAs currently. Managed by owner account (multisig planned). |
| **DSC Tree** | Depth 21 (>2M leaves). Permissionless additions. Incremental (`@zk-kit/lean-imt`). |
| **Leaf hashing (CSCA)** | `poseidon2([csca_hash, csca_actual_length])` — certs zero-padded to 1792 bytes. |
| **Leaf hashing (DSC)** | `poseidon2([poseidon2([dsc_hash, dsc_actual_length]), poseidon2([csca_hash, csca_actual_length])])` |
| **Hash function** | Poseidon2 exclusively |
| **ZK proving** | Circom + Groth16 (38 circuits, 143k–10.6M constraints). **No Noir used** (unaudited per their docs). |
| **DSC whitelisting** | App detects unknown DSC → TEE generates ZK proof of CSCA-backed validity → relayer submits on-chain → DSC added to tree. |
| **On-chain verification** | Groth16 (cheap gas). Backend relayer abstracts gas from users. |
| **Circuit splitting** | Client: lightweight DG1 hash proof. TEE/server: heavy signature verification. |

### Pros
- ✅ Mature, production-ready, audited circuits
- ✅ Already handles the full ICAO PKD → CSCA → DSC chain
- ✅ Permissionless DSC whitelisting (anyone can add a new DSC via ZK proof)
- ✅ DSC tree is incremental — cheap additions, no full rebuild
- ✅ Depth 12 CSCA tree (~500 entries) fits our needs well
- ✅ Mobile SDK handles NFC, TEE attestation, secret storage

### Cons
- ❌ Uses Circom + Groth16 — not compatible with our Noir + UltraHonk-Keccak stack
- ❌ Centralized CSCA tree management (owner account, not multisig yet)
- ❌ Requires TEE for DSC whitelisting (adds infrastructure dependency)
- ❌ Backend relayer required (users don't pay gas)
- ❌ Integrating their circuits would mean either: (a) rewriting in Noir, or (b) running a separate proving stack
- ❌ 143k–10.6M constraints is heavy for mobile

---

## Option B: Rarimo / ZK Passport

**Docs**: https://docs.rarimo.com/zk-passport/
**Contracts**: https://github.com/rarimo/passport-zk-circuits
**Noir**: https://github.com/rarimo/passport-zk-circuits-noir

### Architecture

| Component | Details |
|-----------|---------|
| **StateKeeper** | Manages two SMTs: `CertificatesSMT` (ICAo certs) and `RegistrationSMT` (user identities). |
| **CertificatesSMT** | Poseidon SMT, depth 80. Leaf = `poseidon([modulus, exponent])` of certificate public key. |
| **Hash function** | Poseidon (PoseidonSMT contract). |
| **ZK proving** | Both Circom + Groth16 **and Noir + UltraPlonk**. Actively migrating to Noir. |
| **Registration** | `registerViaNoir()` accepts `bytes memory zkPoints_` for Noir proofs. |
| **Certificate verification** | `CRSADispatcher` routes to `CRSASigner`/`CRSAPSSSigner` for on-chain RSA verification of ICAO member signatures on X.509 certs. |
| **Cross-chain** | `RegistrationSMTReplicator` syncs roots across chains via oracles. |

### Pros
- ✅ **Noir support** — directly compatible with our stack
- ✅ Dedicated Noir circuit repo (`passport-zk-circuits-noir`)
- ✅ UltraPlonk on BN254 (same curve we use)
- ✅ `registerViaNoir()` already exists in contracts
- ✅ Decentralized governance planned (multisig/oracle)

### Cons
- ❌ Depth 80 is overkill (supports 2^80 certs) — adds ~80 Poseidon hashes in-circuit
- ❌ Less mature Noir implementation (still in migration from Circom)
- ❌ Fewer audits on the Noir circuits vs Circom
- ❌ More complex contract architecture (Dispatchers, Signers, Authenticators)

---

## Option C: Build Our Own Minimal CertificatesSMT

Given both Rarimo and Self are complex systems with features we don't need, a minimal approach:

### Design

```
CertificatesSMT (Poseidon SMT)
├── Depth: 16 (65,536 leaves — covers all active DSCs worldwide)
├── Leaf key:   poseidon2([pubkey_modulus_field, pubkey_exponent_field])
├── Leaf value: same as key (it's a set)
├── Empty node: poseidon2([0, 0, 1])
├── Owner: multisig (or immutable after population)
└── Function: registerCertificate(pubkey, siblings[]) → adds leaf, updates root
```

### Circuit Changes (minimal)

```noir
// New public input
certificates_root: pub Field,

// New private inputs
cert_merkle_siblings: [Field; 16],  // 16 siblings for depth-16
cert_index: Field,                   // poseidon2([pubkey_mod, pubkey_exp])
```

Add after RSA verify in `main()`:

```noir
// Compute cert index from the pubkey used for RSA verify
let cert_index = poseidon2::hash([pubkey_mod_field, pubkey_exp_field], 2);

// Verify merkle inclusion
let computed_root = compute_merkle_root(cert_index, cert_merkle_siblings, cert_index);
assert(computed_root == certificates_root, "DSC not in certificate tree");
```

### Constraint Cost

| Operation | Constraints (approx) |
|-----------|---------------------|
| 16 × Poseidon2 (depth 16) | ~3,200–6,400 |
| RSA verify (existing) | ~27,000 |
| **Total addition** | ~3,200–6,400 |
| **New total** | ~30,000–33,000 |

Compare to depth 80 (Rarimo): ~16,000–32,000 additional constraints.

### Population

1. Download ICAO PKD (PEM/DER certificates from ICAO's public directory)
2. Parse each cert → extract RSA public key (modulus, exponent)
3. Compute leaf = `poseidon2([modulus_as_field, exponent_as_field])`
4. Insert into SMT
5. Deploy contract with final root

### Pros
- ✅ Minimal code — just PoseidonSMT + admin functions
- ✅ Full control, no external dependencies
- ✅ Depth 16 is sufficient (thousands of DSCs, not billions)
- ✅ ~3,200–6,400 extra constraints is manageable
- ✅ Compatible with our Noir + UltraHonk-Keccak stack
- ✅ Can be immutable after population (no governance needed)

### Cons
- ❌ Need to populate the tree ourselves (ICAO PKD parsing)
- ❌ No automatic DSC rotation/updates (would need a new deployment)
- ❌ No TEE-backed DSC whitelisting (but we don't need it if we pre-populate all known DSCs)

---

## Recommendation

**Phase 3C Approach: Option C** (minimal own implementation), but **study Self's DSC whitelisting flow** for Phase 4.

### Why Option C?

1. **Compatible** — uses Poseidon2 + Noir, same stack we already have
2. **Simple** — ~200 lines of Solidity, no complex dispatcher/signer architecture
3. **Cheap** — depth 16 adds minimal constraints vs depth 80
4. **Self-sufficient** — no dependency on external protocol governance
5. **Upgradable** — if Self or Rarimo mature their Noir support, we can swap the root source

### When to Switch to Self/Rarimo

| Trigger | Action |
|---------|--------|
| Self opens their Noir circuits | Evaluate migrating to their full stack |
| Rarimo's Noir circuits are audited | Consider using their `registerViaNoir()` flow |
| DSC rotation becomes a frequent need | Adopt Self's TEE-backed permissionless whitelisting |
| Multi-chain deployment at scale | Use Rarimo's cross-chain replicator |

### Next Steps

1. ✅ Deploy minimal `CertificatesSMT.sol` (Poseidon SMT, depth 16)
2. ✅ Write ICAO PKD → SMT population script (TypeScript)
3. ✅ Extend Noir circuit with merkle inclusion check
4. ✅ Add `certificatesRoot` public input to proof generation
5. ✅ Update `ProofVerifier.sol` to validate root matches on-chain
6. ✅ Off-chain merkle proof generation in app (TypeScript Poseidon2)
7. ✅ End-to-end integration testing
