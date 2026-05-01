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
│  │                    VerificationRegistry.sol                     │  │
│  │                                                                 │  │
│  │  register(nullifier, epochNullifier, passportExpiry, proof)    │  │
│  │  renew(nullifier, epochNullifier, passportExpiry, proof)       │  │
│  │  unregister()                                                   │  │
│  │                                                                 │  │
│  │  isVerified(wallet) / nullifierOf(wallet) / getWallets(null)   │  │
│  │                                                                 │  │
│  │  Delegates to (all immutables, set in constructor, frozen):    │  │
│  │  ├── ProofVerifier        → SigilUltraHonkVerifier (generated) │  │
│  │  ├── CSCAMerkleTree       → ICAO Master List Merkle root       │  │
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
│  │   ├── VerificationRegistry.sol  (immutable, no governor)               │
│  │   ├── ProofVerifier.sol                                                │
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
     │      │     → {inputs[4375], nullifier, epochNullifier}
     │      └─ Mopro.generateNoirProof(...) → ~16 KB UltraHonk-Keccak proof
     │
     ├─ 5. On-chain registration
     │      └─ VerificationRegistry.register(nullifier, epochNullifier,
     │                                        passportExpiry, proof)
     │           ├─ ProofVerifier.verifyProof(...) → SigilUltraHonkVerifier
     │           │      → pairing check
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
| **ZK Proving** | mopro-ffi | file:./modules/mopro | Rust FFI bridge |
| | noir-rs | 1.0.0 (PR #37) | Noir prover |
| | barretenberg-rs | 4.2.0-aztecnr-rc.2 | UltraHonk-Keccak backend |
| | bn254_blackbox_solver | beta.19 | Poseidon2 permutation |
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
- ✅ **Phase 3a/b/c:** Real RSA verification + DSC↔CSCA chain + CSCA Merkle inclusion in-circuit; UltraHonk on-chain verification working end-to-end on anvil
- ✅ **Phase 4:** Single-tier sigil model (this document) — contracts + circuit + Mopro + app refactored. E2E with physical device pending.
- ✅ **Phase 4b:** Stripped governance from registry — contract is immutable post-deploy. Only privileged action in the system is `CSCAMerkleTree.setRoot` (Ownable2Step).
- 🚧 **Pending:** Transfer `CSCAMerkleTree` ownership to multisig / `TimelockController`; renewal prompts in app.
