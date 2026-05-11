# Sigil Circuit (Phase 4 — single-tier)

Noir circuit (`sigil/`) that proves a passport is signed up the ICAO trust chain
and derives both a stable per-passport nullifier and a daily epoch nullifier.

The circuit lives at [`sigil/src/main.nr`](sigil/src/main.nr). Source of truth
for the public-input order, witness layout, and constants — all other packages
(Mopro Rust FFI, mobile `proofService.ts`, Solidity `ProofVerifier.sol`) must
mirror it.

## What the circuit proves

1. **SOD signature** — DSC public key (RSA-2048 / SHA-256 / PKCS#1 v1.5) signed the SOD's `signedAttrs`
2. **DSC pubkey binding** — the DSC pubkey embedded in the proof matches the bytes inside the CSCA-signed TBS certificate (anti-substitution)
3. **CSCA signature** — CSCA pubkey (RSA-4096) signed the DSC's TBS certificate
4. **CSCA inclusion** — CSCA pubkey is a leaf in the on-chain CSCA Merkle tree (depth 9, ICAO Master List)
5. **Stable nullifier** — `nullifier == Poseidon2([passport_secret, 1], 2)` where `passport_secret = Poseidon2([dg1_hash, sod_hash], 2)`
6. **Epoch nullifier** — `epoch_nullifier == Poseidon2([passport_secret, epoch_day], 2)` (daily rate-limit key)

Passport expiry is NOT a circuit input — it's enforced on-chain at the `register` / `renew` entrypoints.

## Public inputs (declaration order)

The Solidity verifier marshals these in this exact order — see `packages/contracts/src/ProofVerifier.sol`:

| Index | Name               | Description                                           |
|-------|--------------------|-------------------------------------------------------|
| 0     | `nullifier`        | Stable per-passport sybil identifier                  |
| 1     | `epoch_nullifier`  | Daily rate-limit key                                  |
| 2     | `hashed_address`   | `keccak256(wallet) mod p` (binds proof to caller)     |
| 3     | `csca_merkle_root` | Current CSCA Merkle root from on-chain `CSCAMerkleTree` |

## Private inputs (witness)

```
dg1_hash, sod_hash, epoch_day
signed_attrs[512], signed_attrs_len
signature[256], pubkey[256], redc_param[257], exponent
dsc_tbs[1536], dsc_tbs_len, dsc_pubkey_offset
csca_pubkey[512], csca_redc_param[513], csca_exponent, csca_signature[512]
csca_merkle_siblings[9], csca_leaf_index
```

`dg1_hash` and `sod_hash` are SHA-256 outputs reduced mod the BN254 prime (the Mopro
prover does the reduction; the on-chain verifier mirrors it for `hashed_address`).

## Trust model

- **In circuit:** SOD ← DSC (RSA-2048), DSC ← CSCA (RSA-4096), CSCA ∈ Merkle tree.
  No need to trust the device for the cryptographic chain.
- **Off circuit (mobile):** the app reads DG1 + SOD over NFC after BAC, parses out
  signedAttrs / DSC TBS / CSCA pubkey, looks up the CSCA Merkle proof, and feeds
  everything into the prover. The CSCA Merkle root is fetched from the on-chain
  `CSCAMerkleTree` so the proof can only succeed against the deployed registry's
  current root.
- **On chain:** `SigilRegistry.register` enforces `passport_expiry > now`
  before calling the verifier; `hashed_address == keccak256(msg.sender)` is the
  binding that prevents cross-wallet proof replay.

## Build & test

Requires nargo at the version pinned in `Nargo.toml`.

```bash
make circuits         # nargo compile + copy passport_sigil.json + tree-data.json to apps/mobile/assets/circuits/
make bb-verifier      # regenerate packages/contracts/src/verifiers/SigilUltraHonkVerifier.sol from the VK
make circuits-test    # nargo test --workspace
make bb-prove         # local proof generation (requires witness file)
make bb-verify        # local proof verification
```

The `bb` CLI version must match `barretenberg-rs` (Mopro pins `4.2.0-aztecnr-rc.2`).
Run `make install-bb` once to install the matching binary at `~/.bb-4.2/bb`.
Mismatch → `ProofLengthWrong` revert from `PAIRING_POINTS_SIZE` differences.

## Constants

| Constant | Value | Notes |
|----------|-------|-------|
| `SIGNED_ATTRS_MAX_LEN` | 512 | DER-encoded signedAttributes, zero-padded |
| `DSC_TBS_MAX_LEN`      | 1536 | DSC TBS bytes, zero-padded |
| `MERKLE_DEPTH`         | 9    | 512 leaves; ~269 CSCAs in current tree |
