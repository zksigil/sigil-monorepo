# Sigil

Mobile app for verifying Ethereum wallets with government-issued passports using NFC + ZK proofs. Passport data never leaves the device.

## What it does

You tap your passport to your phone, the app reads it over NFC, generates a ZK proof locally, and registers your wallet on-chain. Protocols can then do a single mapping lookup to check if a wallet is verified — no passport data on-chain, no way to link a wallet back to a person.

Single-tier sigil model: one stable nullifier per passport. A user can sigilize multiple wallets — they share that nullifier on-chain and are publicly linkable as belonging to one passport. Wallets the user does NOT sigilize stay anonymous. Protocols read `isVerified(wallet)` for personhood and `nullifierOf(wallet)` for per-protocol sybil dedup.

## Stack

- **Mobile**: React Native 0.81.5 / Expo SDK 54 (bare workflow), TypeScript strict
- **Contracts**: Foundry / Solidity 0.8.28, deployed on Base Sepolia (84532) → Base mainnet (8453)
- **Web3**: Reown AppKit + wagmi v2 + viem v2
- **ZK**: Noir circuits, Mopro prover (runs on-device, ~5–15s)

## Monorepo layout

```
apps/mobile/          React Native app
packages/contracts/   Foundry smart contracts
packages/circuits/    Noir ZK circuits
packages/mopro-circuits/ Mopro Rust FFI bindings
```

## Key dependencies

The proof pipeline depends on a small set of upstream libraries. Each is pinned
(by tag, rev, or version) so dormancy of any one upstream doesn't break the
current build. The map:

### Inside the circuit (Noir libs, `packages/circuits/sigil/Nargo.toml`)

| Dep | Org | Tag/Version | Why |
|---|---|---|---|
| `poseidon` | `noir-lang` | v0.2.6 | ZK-friendly hash. Powers nullifiers (`Poseidon2(passport_secret, 1)`), epoch nullifiers, and the CSCA Merkle tree. |
| `bignum` | `noir-lang` | v0.9.2 | Large-integer arithmetic primitives that RSA verification depends on. |
| `sha256` | `noir-lang` | v0.3.0 | Hashing for the signed-attributes blob and the DSC TBS certificate. |
| `rsa` (a.k.a. `noir_rsa`) | `zkpassport` | v0.10.0 | PKCS#1 v1.5 verification of the SOD signature (RSA-2048) and the DSC→CSCA signature (RSA-4096). `noir-lang` doesn't publish an RSA library, so this is the only mature option in the Noir ecosystem. |

### Rust-side prover (`packages/mopro-circuits/Cargo.toml`)

| Dep | Org | Pinned to | Why |
|---|---|---|---|
| `noir` (a.k.a. `noir_rs`) | `zkmopro` | rev `0e4fdc9f…` | Rust wrapper around Barretenberg that does the actual proving on-device. Chosen over `zkpassport/noir_rs` because Mopro pins `barretenberg-rs = =4.2.0-aztecnr-rc.2`, and `zkmopro/noir-rs` tracks that exact version — mismatch causes on-chain `ProofLengthWrong` reverts. |
| `mopro-ffi` | `zkmopro` | 0.3.5 | React Native FFI bridge (Rust ↔ Hermes via UniFFI). |
| `bn254_blackbox_solver` | `noir-lang` | v1.0.0-beta.19 | BN254 curve ops used by the off-chain Poseidon2 helper. |

### Off-chain JS (`package.json`)

| Dep | Org | Version | Why |
|---|---|---|---|
| `@zkpassport/poseidon2` | `zkpassport` | ^0.6.2 | JS Poseidon2 used by `certs/build-tree.ts` to compute the CSCA Merkle tree off-chain. Must produce bit-identical output to the in-circuit Poseidon2 or the root won't verify against generated proofs. The Iden3/PSE libraries ship the *original* Poseidon (different algorithm) and aren't drop-in compatible. |

### Native toolchain (not npm/cargo deps but version-critical)

- `bb` CLI **must match** the version `barretenberg-rs` is built against (currently `4.2.0-aztecnr-rc.2`). Install via `make install-bb` into `~/.bb-4.2/bb`. Mismatch → proof/verifier disagree on `PAIRING_POINTS_SIZE` → on-chain `ProofLengthWrong`.
- `nargo` v1.0.0-beta.19 to compile the circuit.

### Notes on the zkpassport.io org

We depend on two libraries published by the [zkpassport.io](https://zkpassport.io) org — `noir_rsa` (Noir) and `@zkpassport/poseidon2` (npm). They're the only mature options in their respective niches for what we need, and both are pinned to specific versions. If they go dormant upstream, the pinned versions keep working; the migration path is to fork into our own GitHub org or vendor them locally (both are small surfaces).

## Getting started

```bash
pnpm install          # from repo root
cp .env.example .env  # fill in EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID
pnpm mobile           # start Expo dev server
```

For iOS physical device, building in Release mode via Xcode is the most reliable path (no Metro connectivity issues).

## Contract development

```bash
make contracts          # forge build + sync ABI to mobile app
make contracts-test     # forge test -vvv
```

After deploying, update the chain-specific registry env var
(`EXPO_PUBLIC_BASE_SEPOLIA_REGISTRY_ADDRESS`, `EXPO_PUBLIC_BASE_REGISTRY_ADDRESS`,
or `EXPO_PUBLIC_ANVIL_REGISTRY_ADDRESS`) in both `.env` and `apps/mobile/.env`,
then rebuild the app — env vars are baked into the JS bundle.

## Status

- Phase 1 ✅ — wallet connection (MetaMask / WC wallets via AppKit)
- Phase 2 ✅ — MRZ entry, camera OCR, NFC + BAC auth, stub proof generation
- Phase 3 ✅ — real Noir circuit, Mopro integration, in-circuit RSA + DSC↔CSCA chain + CSCA Merkle inclusion, UltraHonk on-chain verification
- Phase 4 ✅ — single-tier sigil model + immutable registry (no governor)
- Pending — transfer `CSCAMerkleTree` ownership to a multisig before mainnet. See [HIGH-LEVEL-ARCHITECTURE.md](HIGH-LEVEL-ARCHITECTURE.md) for details.