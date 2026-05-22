# Sigil — High-Level Architecture

Mobile app for verifying Ethereum wallets against government-issued passports using NFC + ZK proofs. Passport data never leaves the device. A user can sigilize multiple wallets per passport — they share a public on-chain nullifier (the explicit single-tier privacy trade-off).

---

## System Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          SIGIL ARCHITECTURE                              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌───────────────────────────────────────────────────────────────────┐ │
│  │                    MOBILE APP (React Native)                       │ │
│  │                  Expo SDK 54 / RN 0.81 / TypeScript                │ │
│  │                                                                   │ │
│  │  ┌─────────┐  ┌────────────┐  ┌────────────┐  ┌───────────────┐ │ │
│  │  │ Home    │→ │PassportScan│→ │ProofGen    │→ │VerifySuccess  │ │ │
│  │  │Screen   │  │Screen      │  │Screen      │  │Screen         │ │ │
│  │  │         │  │            │  │            │  │               │ │ │
│  │  │- Wallet │  │- Camera    │  │- Mopro     │  │- Tx hash      │ │ │
│  │  │  list + │  │  OCR (MRZ) │  │  prover    │  │  + explorer   │ │ │
│  │  │  status │  │- NFC scan  │  │- ZK proof  │  │  link         │ │ │
│  │  │- First- │  │  (DG1+SOD) │  │  generation│  │               │ │ │
│  │  │  sigil  │  │            │  │- register  │  │               │ │ │
│  │  │  modal  │  │            │  │  on-chain  │  │               │ │ │
│  │  └────┬────┘  └─────┬──────┘  └─────┬──────┘  └───────────────┘ │ │
│  │       │             │               │                            │ │
│  │       ▼             ▼               ▼                            │ │
│  │  ┌─────────────────────────────────────────────────────────┐    │ │
│  │  │              INFRASTRUCTURE LAYER                         │    │ │
│  │  │                                                           │    │ │
│  │  │  ┌─────────────┐  ┌──────────────┐  ┌─────────────────┐ │    │ │
│  │  │  │ wagmi v2 +  │  │ NFC Manager  │  │ Circuit Setup   │ │    │ │
│  │  │  │ AppKit      │  │ (react-nfc-  │  │ (copy JSON +    │ │    │ │
│  │  │  │ + viem      │  │  manager)    │  │  SRS to FS)     │ │    │ │
│  │  │  └──────┬──────┘  └──────┬───────┘  └────────┬────────┘ │    │ │
│  │  │         │                │                    │          │    │ │
│  │  │  ┌──────▼────────────────▼────────────────────▼───────┐  │    │ │
│  │  │  │         Proof Service (proofService.ts)            │  │    │ │
│  │  │  │                                                     │  │    │ │
│  │  │  │  generateSigilProof():                              │  │    │ │
│  │  │  │   1. parseSod(rawSODHex)                            │  │    │ │
│  │  │  │       → signedAttrs, signature, pubkey, certs       │  │    │ │
│  │  │  │   2. verifyDSCChain() — off-circuit DSC<-CSCA       │  │    │ │
│  │  │  │   3. Mopro.computeRedcParam(pubkey)                 │  │    │ │
│  │  │  │   4. Mopro.computeSigilInputs(...) → 4376 inputs    │  │    │ │
│  │  │  │       + nullifier + epoch_nullifier                 │  │    │ │
│  │  │  │   5. Mopro.generateNoirProof(...) → ~16KB proof     │  │    │ │
│  │  │  └────────────────────────┬────────────────────────────┘  │    │ │
│  │  │                           │                                 │    │ │
│  │  │  ┌────────────────────────▼────────────────────────────┐  │    │ │
│  │  │  │ Blockchain (wagmi useWriteContract + viem)          │  │    │ │
│  │  │  │   register(nullifier, epochNullifier, expiry, proof)│  │    │ │
│  │  │  └────────────────────────┬────────────────────────────┘  │    │ │
│  │  └───────────────────────────┼───────────────────────────────┘    │ │
│  │                              │                                    │ │
│  │  ┌───────────────────────────▼───────────────────────────────┐   │ │
│  │  │              Mopro FFI (Rust Native Module)                │   │ │
│  │  │  apps/mobile/modules/mopro/                                │   │ │
│  │  │  MoproFfiFramework.xcframework (iOS) / .so (Android)       │   │ │
│  │  │                                                             │   │ │
│  │  │  Exposes via uniffi (Rust → RN bridge):                    │   │ │
│  │  │  • computeRedcParam(modulus) → 257 / 513 bytes              │   │ │
│  │  │  • computeSigilInputs(...) → {inputs[], nullifier,         │   │ │
│  │  │       epochNullifier}                                       │   │ │
│  │  │  • generateNoirProof(circuitPath, inputs) → proof bytes    │   │ │
│  │  │  • getNoirVerificationKey(circuitPath) → VK bytes          │   │ │
│  │  │  • verifyNoirProof(circuitPath, proof, vk) → bool          │   │ │
│  │  │                                                             │   │ │
│  │  │  Internally: noir-rs 1.0.0 + barretenberg-rs 4.2.0;        │   │ │
│  │  │  bn254_blackbox_solver for Poseidon2; UltraHonk-Keccak     │   │ │
│  │  └───────────────────────────────────────────────────────────┘   │ │
│  └───────────────────────────────────────────────────────────────────┘ │
│                                                                       │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │                    WEB3 / WALLET LAYER                           │ │
│  │  Reown AppKit (MetaMask + WC) + wagmi v2 + viem v2              │ │
│  │  Standalone viem clients used for reads / simulation so they    │ │
│  │  don't break when the app backgrounds for MetaMask.             │ │
│  └─────────────────────────────────────────────────────────────────┘ │
│                                                                       │
├───────────────────────────────────────────────────────────────────────┤
│                    ON-CHAIN (Base Sepolia / Base)                     │
│                                                                       │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │                       SigilRegistry.sol                         │  │
│  │                                                                 │  │
│  │  register(nullifier, epochNullifier, passportExpiry, proof)    │  │
│  │  renew(nullifier, epochNullifier, passportExpiry, proof)       │  │
│  │  unregister()                                                   │  │
│  │                                                                 │  │
│  │  isVerified(wallet) / nullifierOf(wallet) / getWallets(null)   │  │
│  │                                                                 │  │
│  │  Talks directly to (all immutables, frozen in constructor):    │  │
│  │  ├── IUltraHonkVerifier  → SigilUltraHonkVerifier (generated)  │  │
│  │  │   (inline interface; private _verifyProof helper does the   │  │
│  │  │    BN254 reduction on hashedAddress + public-input marshal) │  │
│  │  ├── CSCAMerkleTree      → ICAO Master List Merkle root        │  │
│  │  └── i_registrationTTL, i_maxDailyRegistrations (uint params)  │  │
│  │                                                                 │  │
│  │  State:                                                         │  │
│  │  ├── s_registrations[hashedAddr] → {expiresAt, registeredAt}   │  │
│  │  ├── s_nullifierByWallet[hashedAddr] → nullifier (PUBLIC)      │  │
│  │  ├── s_walletsByNullifier[nullifier] → address[]               │  │
│  │  └── s_epochCounts[epochNullifier] → uint8                     │  │
│  └────────────────────────────────────────────────────────────────┘  │
│                                                                       │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │            SigilUltraHonkVerifier (generated by bb)             │  │
│  │  Single verifier for the unified sigil circuit.                 │  │
│  │  Public inputs: [nullifier, epochNullifier, hashedAddr, root].  │  │
│  └────────────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────────────┘


┌─────────────────────────────────────────────────────────────────────────┐
│                        DEVELOPMENT TOOLCHAIN                             │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  packages/circuits/                    packages/mopro-circuits/          │
│  ├── sigil/src/main.nr (Noir)        ├── src/noir.rs (Rust FFI)         │
│  └── Nargo.toml                       ├── MoproReactNativeBindings/     │
│       │                               │   └── MoproFfiFramework.xcfrwk  │
│       │ nargo compile                       ↑                            │
│       ↓                                     │ uniffi-bindgen-react-native │
│  target/passport_sigil.json ──────→  computeSigilInputs()                │
│                                       generateNoirProof()                │
│                                                                          │
│  packages/contracts/                                                      │
│  ├── src/                                                                 │
│  │   ├── SigilRegistry.sol          (immutable, no governor)              │
│  │   ├── CSCAMerkleTree.sol         (Ownable2Step — only setRoot)         │
│  │   └── verifiers/SigilUltraHonkVerifier.sol (regenerated)               │
│  └── test/                                                                │
│                                                                          │
│  Build commands (via Makefile):                                           │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │ make circuits        compile Noir + copy JSON to app assets      │   │
│  │ make bb-verifier     write VK + regenerate Solidity verifier     │   │
│  │ make ios             build Mopro xcframework + copy bindings     │   │
│  │ pnpm contracts:sync-abi  copy ABI to mobile app                  │   │
│  │ make anvil-deploy    deploy contracts to anvil + update .env     │   │
│  └──────────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## End-to-End Data Flow

```
User opens app
     │
     ├─ 1. Connect wallet (Reown AppKit → MetaMask / WC)
     │      → wallet address available
     │
     ├─ 2. (First sigilize only) Education modal explains the linkability
     │      mental model: "Sigilized wallets are publicly tied to your
     │      passport. Other wallets you sigilize will share this identity
     │      on-chain. Wallets you don't sigilize stay anonymous."
     │
     ├─ 3. Tap passport to phone (NFC)
     │      ├─ BAC authentication (MRZ → session keys)
     │      ├─ Read DG1 (MRZ data) → rawDG1Hex
     │      └─ Read SOD (Security Object) → rawSODHex
     │
     ├─ 4. Proof generation (proofService.generateSigilProof)
     │      ├─ parseSod(rawSODHex) → signedAttrs, signature, DSC pubkey, certs
     │      ├─ verifyDSCChain() — off-circuit DSC←CSCA via @noble RSA
     │      ├─ Mopro.computeRedcParam(pubkey) for Barrett reduction
     │      ├─ Mopro.computeSigilInputs(dg1Hash, sodHash, epochDay, ...)
     │      │     → {inputs[4376], nullifier, epochNullifier}
     │      └─ Mopro.generateNoirProof(...) → ~16 KB UltraHonk-Keccak proof
     │
     ├─ 5. On-chain registration
     │      └─ SigilRegistry.register(nullifier, epochNullifier,
     │                                 passportExpiry, proof)
     │           ├─ _verifyProof(...) → SigilUltraHonkVerifier
     │           │      (inline; BN254-reduces hashedAddress + pairing check)
     │           ├─ Append wallet to s_walletsByNullifier[nullifier]
     │           ├─ Set s_nullifierByWallet[hashedAddr] = nullifier
     │           └─ Set s_registrations[hashedAddr] = {expiresAt, registeredAt}
     │
     └─ 6. Verification complete
            → Protocols call: isVerified(wallet)        for personhood
                              nullifierOf(wallet)       for sybil dedup
                              getWallets(nullifier)     for "all my wallets" view
```

---

## Behavior and trade-offs

This section describes what each contract operation does at a user level
and why the system is shaped the way it is. The on-chain surface lives in
`SigilRegistry.sol`; the app maps each UI action 1:1 onto one of these
calls.

### Registration

`register(nullifier, epochNullifier, passportExpiry, proof)` writes a
`Registration` for `msg.sender` after the ZK proof verifies. The wallet
is added to the nullifier's wallet list, and `nullifierOf(wallet)`
returns the per-passport stable identifier from then on.

The proof is bound to the caller via
`hashed_address = keccak256(msg.sender) mod p`, which is a public
input. A proof generated for wallet A cannot be replayed from wallet B.

There's no session or two-step flow because the wallet has to sign the
registration tx itself anyway (the proof binds to `msg.sender`), so any
preparatory step would just add a round trip without changing what the
user does on each wallet.

### Expiration

A registration has two independent expiry conditions. The contract
takes the stricter of the two.

1. **Passport expiry**, rounded up to the next 90-day boundary on the
   Unix epoch. This is a privacy choice. The raw passport expiry has
   ~365 distinguishable values per year; rounding collapses that into 4
   so the on-chain timestamp doesn't fingerprint a specific issuance
   batch. Trade-off: a registration can read as valid for up to ~89 days
   past the real passport expiry. We accept this because the check is
   not safety-critical (a protocol just sees a stale `true`).
2. **Registration TTL**, default 180 days from the most recent
   `register`/`renew`. Forces a periodic re-tap. The point isn't expiry
   per se; it's that we want occasional re-proof of physical possession
   of the passport so a long-lost phone with cached state doesn't keep
   acting as a "live" identity in the registry.

The effective `expiresAt` is `min(now + ttl, ceilQuarter(passportExpiry))`.
`isVerified(wallet)` reads `expiresAt` only, so expiry is lazy: no one
has to pay gas to evict an expired registration.

### Renewal

`renew(nullifier, epochNullifier, passportExpiry, proof)` refreshes
`expiresAt` without touching `registeredAt`. Renewals skip the daily
rate limit (they're liveness refreshes, not new commitments). The
supplied nullifier has to match the one the wallet was originally
registered with; trying to renew under a different passport reverts
with `__NullifierMismatch`. To swap passports the user has to
`unregister` first and re-register fresh.

The app prompts for renewal once the registration is within 30 days of
`expiresAt`.

### Unregister

`unregister()` removes `msg.sender` from `s_registrations`,
`s_nullifierByWallet`, and the nullifier's wallet array. Wallet
removal is O(1) via 1-based-index swap-and-pop.

No event is emitted. That's deliberate. A `WalletUnregistered(wallet, nullifier)`
event would let any indexer link the wallet to its nullifier in
perpetuity, undoing most of the privacy gain from unregistering.

There's no cooldown. A wallet can re-register the same block, subject
to the daily limit.

### Registering multiple wallets

A user can call `register` from any number of wallets under the same
passport. Each call:

- Derives the same `nullifier` (Poseidon2 of the passport secret with
  the constant `1`), so all sigilized wallets under one passport share
  one identifier
- Generates a fresh proof bound to that wallet's address
- Counts against the daily rate limit

After multiple registrations:
- `isVerified(walletA)` and `isVerified(walletB)` both return true
- `nullifierOf(walletA) == nullifierOf(walletB)`
- `getWallets(nullifier)` returns the full list

This is also the recovery path on a new phone. The passport secret is
re-derived from a fresh tap; the app computes the nullifier and reads
`getWallets(nullifier)` to surface every previously sigilized wallet
without any cached app state.

### Linkability trade-off

Two sigilized wallets under the same passport are publicly linkable
on-chain. Anyone reading `s_nullifierByWallet` can see they share a
nullifier and conclude they're held by one person. That's the explicit
cost of giving protocols a one-mapping-lookup sybil signal.

What is NOT exposed:

- The passport itself. The nullifier is an opaque 32-byte hash; it
  doesn't carry name, DOB, nationality, or DSC pubkey.
- Wallets the user does not sigilize. Sigilization is opt-in per
  wallet, so users who want a wallet to stay anonymous simply don't
  register it.

Cross-protocol unlinkability (the Worldcoin pattern of an action-scoped
nullifier, so the same passport produces a different nullifier per
protocol) was considered and cut. It would have required a larger
circuit, made `nullifierOf` non-constant per wallet, and complicated
the "one mapping lookup" integration story.

### Rate limit

Max 10 new registrations per passport per day, default. Renewals don't
count.

The intent is to bound damage if a passport secret leaks (stolen phone
before unlock, malicious app that read DG1+SOD over NFC). Without a
cap, the attacker could mass-sigilize wallets they control under the
victim's passport, polluting the victim's `getWallets` set. With a cap
of 10, the damage is bounded and visible.

The mechanism: the contract counts registrations bucketed by
`epochNullifier = Poseidon2(passport_secret, epoch_day)`. Same passport,
same day, same bucket.

Currently `epoch_day` is a private circuit input, not derived from
`block.timestamp` on-chain, so the bucket isn't actually pinned to
today. See `docs/audits/security.md` finding **H-1** for the open fix.

---

## Key Packages & Tooling

| Category | Package | Version | Purpose |
|---|---|---|---|
| **Mobile** | react-native | 0.81.5 | Core RN framework |
| | expo | 54.0.33 | Dev tools, native modules |
| | react-native-nfc-manager | 3.17.2 | NFC reading (ISO 14443) |
| | @react-native-ml-kit/text-recognition | 2.0.0 | MRZ OCR from camera |
| **Web3** | @reown/appkit-react-native | 2.0.2 | Wallet connection modal |
| | wagmi | 2.15.0 | React hooks for blockchain |
| | viem | 2.23.0 | Ethereum client library |
| **ZK Proving** | mopro-ffi | 0.3.5 (`packages/mopro-circuits/Cargo.toml`) | Rust FFI bridge (Rust ↔ Hermes via UniFFI) |
| | noir_rs (`zkmopro/noir-rs`) | git rev `0e4fdc9f…` | Noir prover; rev pinned to match `barretenberg-rs` |
| | barretenberg-rs | =4.2.0-aztecnr-rc.2 | UltraHonk-Keccak backend; `bb` CLI must match |
| | bn254_blackbox_solver | v1.0.0-beta.19 | BN254 ops used by off-chain Poseidon2 helper |
| **Circuits** | Noir | 1.0.0 | ZK circuit language |
| | noir-bignum | v0.9.2 | Big number arithmetic |
| | noir_rsa | v0.10.0 | RSA signature verification |
| | poseidon | v0.2.6 | Poseidon2 hash in-circuit |
| | sha256 | v0.3.0 | SHA-256 in-circuit |
| **Contracts** | Foundry | — | Build/test framework |
| | @openzeppelin/contracts | v5 | ReentrancyGuard, Ownable2Step |

---

## Build & Deployment Pipeline

### 1. Noir Circuit (`packages/circuits/`)

```bash
make circuits        # nargo compile --workspace + copy JSON to app assets
```

Output: `packages/circuits/target/passport_sigil.json` and `apps/mobile/assets/circuits/passport_sigil.json`.

### 2. Solidity Verifier (`packages/contracts/src/verifiers/`)

```bash
make bb-verifier     # bb write_vk + write_solidity_verifier
```

Output: `SigilUltraHonkVerifier.sol`. Must stay under 24,576 bytes (EIP-170) — currently 24,254 bytes deployed. Keep `optimizer_runs = 1` in `foundry.toml`; never enable `via_ir`.

### 3. Mopro Rust FFI (`packages/mopro-circuits/`)

```bash
make ios             # uniffi-bindgen-react-native build ios + copy xcframework + bindings
pnpm install         # CRITICAL: refresh hoisted node_modules/mopro-ffi/
```

> **⚠️ pnpm hoisting trap:** `mopro-ffi` is a `file:` dep — pnpm copies (not symlinks) into `node_modules/mopro-ffi/`. After `make ios`, run `pnpm install`. If pnpm doesn't detect the change (no version bump), `rm -rf node_modules/mopro-ffi` first then reinstall.

### 4. Smart Contracts (`packages/contracts/`)

```bash
make contracts             # forge build + pnpm contracts:sync-abi
make contracts-test        # forge test -vvv
pnpm contracts:sync-abi    # regenerate apps/mobile/.../contractAbis.ts
```

### 5. Anvil end-to-end

```bash
anvil --host 0.0.0.0
make anvil-env             # detect LAN IP, update both .env files
make anvil-deploy          # deploy with MockProofVerifier + write registry address to .envs
```

---

## Privacy Properties (Phase 4 single-tier)

- No name, DOB, nationality, or other passport-derived data on-chain — only opaque nullifiers
- All wallets sigilized under one passport are publicly linkable via `nullifierByWallet` (the explicit single-tier trade-off — opt-in per wallet)
- Wallets the user does not sigilize remain anonymous
- Events: `WalletVerified(address indexed wallet)` only — NO nullifiers in events
- Cross-protocol unlinkability (Worldcoin's action-scoped nullifier pattern) was deferred — too much UX/circuit cost for this product's scope

---

## Current Status

- ✅ **Phase 1:** Wallet connection
- ✅ **Phase 2:** NFC scan, MRZ OCR, stub proof generation
- ✅ **Phase 3a/b/c:** Real RSA verification + DSC↔CSCA chain + CSCA Merkle inclusion in-circuit; UltraHonk on-chain verification working end-to-end on anvil and Base Sepolia
- ✅ **Phase 4:** Single-tier sigil model (this document) — contracts + circuit + Mopro + app refactored; E2E verified on physical device
- ✅ **Phase 4b:** Stripped governance from registry — contract is immutable post-deploy. Only privileged action in the system is `CSCAMerkleTree.setRoot` (Ownable2Step). `VerificationRegistry` renamed to `SigilRegistry`; `ProofVerifier` inlined into the registry.
- ✅ **Polish + App Store:** Renewal flow in-app, tracked external addresses, ENS, App Store v1.0 submitted as Sigil.xyz.
- 🚧 **Pending:** Transfer `CSCAMerkleTree` ownership to multisig / `TimelockController` before mainnet.

> **Open audit finding:** the documented daily rate limit (max 10 registrations per
> passport per day) is currently bypassable — `epoch_day` is a private circuit input
> and not bound to on-chain time. See [`docs/audits/security.md`](docs/audits/security.md)
> finding **H-1**. Not exploitable for fund loss; it does mean the rate limit isn't a
> real sybil defense until fixed.
