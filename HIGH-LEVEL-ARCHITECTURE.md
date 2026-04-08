# Sigil — High-Level Architecture

Mobile app for verifying Ethereum wallets with government-issued passports using NFC + ZK proofs. Passport data never leaves the device.

---

## System Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           SIGIL ARCHITECTURE                             │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌───────────────────────────────────────────────────────────────────┐ │
│  │                    MOBILE APP (React Native)                       │ │
│  │                   Expo SDK 54 / RN 0.81 / TypeScript               │ │
│  │                                                                   │ │
│  │  ┌─────────┐  ┌────────────┐  ┌────────────┐  ┌───────────────┐ │ │
│  │  │ Home    │→ │PassportScan│→ │ProofGen    │→ │VerifySuccess  │ │ │
│  │  │Screen   │  │Screen      │  │Screen      │  │Screen         │ │ │
│  │  │         │  │            │  │            │  │               │ │ │
│  │  │- Wallet │  │- Camera    │  │- Mopro     │  │- On-chain     │ │ │
│  │  │  connect│  │  OCR (MRZ) │  │  prover    │  │  status       │ │ │
│  │  │- AppKit │  │- NFC scan  │  │- ZK proof  │  │- Nullifier    │ │ │
│  │  │  modal  │  │  (DG1+SOD) │  │  generation│  │  display      │ │ │
│  │  └────┬────┘  └─────┬──────┘  └─────┬──────┘  └───────────────┘ │ │
│  │       │             │               │                            │ │
│  │       ▼             ▼               ▼                            │ │
│  │  ┌─────────────────────────────────────────────────────────┐    │ │
│  │  │              INFRASTRUCTURE LAYER                         │    │ │
│  │  │                                                           │    │ │
│  │  │  ┌─────────────┐  ┌──────────────┐  ┌─────────────────┐ │    │ │
│  │  │  │ Wallet Store│  │ NFC Manager  │  │ Circuit Setup   │ │    │ │
│  │  │  │ (zustand)   │  │ (react-nfc-  │  │ (copies JSON    │ │    │ │
│  │  │  │ + wagmi v2  │  │  manager)    │  │  to device FS)  │ │    │ │
│  │  │  └──────┬──────┘  └──────┬───────┘  └────────┬────────┘ │    │ │
│  │  │         │                │                    │          │    │ │
│  │  │  ┌──────▼────────────────▼────────────────────▼───────┐  │    │ │
│  │  │  │         Proof Service (proofService.ts)            │  │    │ │
│  │  │  │                                                     │  │    │ │
│  │  │  │  1. parseSod(rawSODHex)                             │  │    │ │
│  │  │  │     → extracts: signedAttrs, signature, pubkey      │  │    │ │
│  │  │  │  2. verifyRSASignatureJS() — sanity check           │  │    │ │
│  │  │  │  3. Mopro.computeRedcParam(pubkey)                  │  │    │ │
│  │  │  │  4. Mopro.computeBaseInputs(...) → 1289 inputs      │  │    │ │
│  │  │  │  5. Mopro.generateNoirProof(...) → ~16KB proof      │  │    │ │
│  │  │  └────────────────────────┬────────────────────────────┘  │    │ │
│  │  │                           │                               │    │ │
│  │  │  ┌────────────────────────▼────────────────────────────┐  │    │ │
│  │  │  │         Blockchain Service (blockchain/)            │  │    │ │
│  │  │  │                                                     │  │    │ │
│  │  │  │  - registerBase(proof, walletAddr)                  │  │    │ │
│  │  │  │  - registerPrimary(proof, walletAddr)               │  │    │ │
│  │  │  │  - Calls VerificationRegistry.on-chain              │  │    │ │
│  │  │  └────────────────────────┬────────────────────────────┘  │    │ │
│  │  └───────────────────────────┼───────────────────────────────┘    │ │
│  │                              │                                    │ │
│  │  ┌───────────────────────────▼───────────────────────────────┐   │ │
│  │  │              Mopro FFI (Rust Native Module)                │   │ │
│  │  │  apps/mobile/modules/mopro/                                │   │ │
│  │  │  MoproFfiFramework.xcframework (iOS) / .so (Android)       │   │ │
│  │  │                                                             │   │ │
│  │  │  Exposes via uniffi (Rust → RN bridge):                    │   │ │
│  │  │  • computeRedcParam(modulus) → 257 bytes                   │   │ │
│  │  │  • computeBaseInputs(...) → {inputs[], epochNullifier}     │   │ │
│  │  │  • computePrimaryInputs(...) → {inputs[], nullifier,       │   │ │
│  │  │       nextCommitment}                                      │   │ │
│  │  │  • generateNoirProof(circuitPath, inputs) → proof bytes    │   │ │
│  │  │  • getNoirVerificationKey(circuitPath) → VK bytes          │   │ │
│  │  │                                                             │   │ │
│  │  │  Internally uses:                                           │   │ │
│  │  │  • noir_rs (Mopro's Noir compiler)                         │   │ │
│  │  │  • bn254_blackbox_solver (Poseidon2)                       │   │ │
│  │  │  • Barretenberg backend (UltraHonk-Keccak prover)          │   │ │
│  │  └───────────────────────────────────────────────────────────┘   │ │
│  └───────────────────────────────────────────────────────────────────┘ │
│                                                                       │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │                    WEB3 / WALLET LAYER                           │ │
│  │                                                                  │ │
│  │  Reown AppKit (ex-WalletConnect)                                 │ │
│  │  ├── AppKit modal: MetaMask, Rainbow, WC deep linking           │ │
│  │  ├── wagmi v2 + viem v2: chain interaction, signing            │ │
│  │  └── @tanstack/react-query: data fetching + caching             │ │
│  │                                                                  │ │
│  │  Flow: User connects wallet → address available in proof input  │ │
│  └─────────────────────────────────────────────────────────────────┘ │
│                                                                       │
├───────────────────────────────────────────────────────────────────────┤
│                        ON-CHAIN (Base Mainnet)                        │
│                                                                       │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │                    VerificationRegistry.sol                     │  │
│  │                                                                 │  │
│  │  registerBase(proof, epochNullifier, expiry, hashedAddress)    │  │
│  │  registerPrimary(proof, nullifier, nextCommitment, ...)        │  │
│  │  changePrimary(proof, oldNullifier, nextNullifier, ...)        │  │
│  │                                                                 │  │
│  │  Delegates to:                                                  │  │
│  │  ├── ProofVerifier → UltraHonk verifier (generated by nargo)   │  │
│  │  ├── ProtocolConfig → tunable params (rate limits, TTL, etc)   │  │
│  │  └── Poseidon2Lib → on-chain Poseidon2 hashing                 │  │
│  │                                                                 │  │
│  │  State:                                                         │  │
│  │  ├── s_baseRegistrations[hashedAddr] → {expiresAt, reggedAt}   │  │
│  │  ├── s_primarySlots[nullifier] → {hashedAddr, nextCommitment}  │  │
│  │  └── s_nextCommitmentToNullifier[nextCommit] → nullifier       │  │
│  └────────────────────────────────────────────────────────────────┘  │
│                                                                       │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │              UltraHonk Verifiers (generated by nargo compile)   │  │
│  │                                                                 │  │
│  │  BaseVerifier.sol    → verifies base tier proofs               │  │
│  │  PrimaryVerifier.sol → verifies primary tier proofs            │  │
│  │                                                                 │  │
│  │  Auto-generated by Noir compiler → deployed as separate         │  │
│  │  contracts, called by ProofVerifier                             │  │
│  └────────────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────────────┘


┌─────────────────────────────────────────────────────────────────────────┐
│                        DEVELOPMENT TOOLCHAIN                             │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  packages/circuits/                    packages/mopro-circuits/          │
│  ├── base/src/main.nr (Noir)         ├── src/noir.rs (Rust FFI)         │
│  ├── primary/src/main.nr (Noir)      ├── MoproReactNativeBindings/      │
│  └── Nargo.toml                      │   └── MoproFfiFramework.xcfrwk   │
│       │                                    ↑                             │
│       │ nargo compile                      │ uniffi-bindgen-react-native  │
│       ↓                                    │                              │
│  target/passport_base.json ──────→  computeBaseInputs()                  │
│  target/passport_primary.json     computePrimaryInputs()                 │
│                                 generateNoirProof()                      │
│                                                                          │
│  packages/contracts/               packages/shared-types/                │
│  ├── src/                          ├── src/index.ts                       │
│  │   ├── VerificationRegistry.sol  │   ├── WalletInfo                     │
│  │   ├── ProofVerifier.sol         │   ├── WalletRecord                   │
│  │   ├── ProtocolConfig.sol        │   ├── ZKProofInputs                  │
│  │   └── verifiers/ (generated)    │   ├── VerificationPhase              │
│  └── test/                         │   └── ChainConfig                    │
│                                    └── (mirrors contract structs)         │
│                                                                          │
│  Build commands:                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │ nargo compile        → circuit JSON + Solidity verifiers         │   │
│  │ forge build          → contracts ABI                             │   │
│  │ ubrn build ios       → xcframework (Rust → Swift bridge)         │   │
│  │ pnpm contracts:sync-abi → copies ABI to mobile app               │   │
│  └──────────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## End-to-End Data Flow

```
User opens app
     │
     ├─ 1. Connect wallet (Reown AppKit → MetaMask/WC)
     │      → wallet address available
     │
     ├─ 2. Tap passport to phone (NFC)
     │      ├─ BAC authentication (MRZ code → session keys)
     │      ├─ Read DG1 (MRZ data) → rawDG1Hex
     │      └─ Read SOD (Security Object) → rawSODHex
     │
     ├─ 3. Proof Service processes
     │      ├─ parseSod(rawSODHex)
     │      │   → signedAttrs[104 bytes], signature[256], pubkey[256], exponent=65537
     │      ├─ verifyRSASignatureJS() ✅ (JS sanity check)
     │      ├─ Mopro.computeRedcParam(pubkey) → 257 bytes
     │      ├─ Mopro.computeBaseInputs(dg1Hash, sodHash, epochDay, ...)
     │      │   → 1289 field elements (Poseidon2 computed natively)
     │      └─ Mopro.generateNoirProof(circuitPath, inputs)
     │           → ~16,352 bytes UltraHonk-Keccak proof (~5–15s)
     │
     ├─ 4. On-chain registration
     │      └─ VerificationRegistry.registerBase(proof, epochNullifier, ...)
     │           ├─ ProofVerifier.verifyBaseProof(proof, publicInputs)
     │           │   └─ BaseVerifier.verify(proof, [nullifier, addr, expiry])
     │           │        → Barretenberg pairing check ✅
     │           └─ Store: s_baseRegistrations[hashedAddr] = {expiresAt, reggedAt}
     │
     └─ 5. Verification complete
            → Protocols can check: isVerified(wallet) → true
            → No passport data ever left the device
```

---

## Key Packages & Tooling

| Category | Package | Version | Purpose |
|----------|---------|---------|---------|
| **Mobile** | react-native | 0.81.5 | Core RN framework |
| | expo | 54.0.33 | Dev tools, native modules |
| | react-native-nfc-manager | 3.17.2 | NFC reading (ISO 14443) |
| | @react-native-ml-kit/text-recognition | 2.0.0 | MRZ OCR from camera |
| **Web3** | @reown/appkit-react-native | 2.0.2 | Wallet connection modal |
| | wagmi | 2.15.0 | React hooks for blockchain |
| | viem | 2.23.0 | Ethereum client library |
| | @tanstack/react-query | 5.56.0 | Data fetching/caching |
| **ZK Proving** | mopro-ffi | file:./modules/mopro | Rust FFI bridge |
| | noir_rs | v1.0.0-beta.8-3 | Noir compiler (Mopro fork) |
| | bn254_blackbox_solver | noir-lang/noir | Poseidon2 hash |
| **Circuits** | Noir | 1.0.0-beta.8 | ZK circuit language |
| | noir-bignum | v0.7.3 | Big number arithmetic |
| | noir_rsa | v0.9.0 | RSA signature verification |
| | poseidon | v0.1.1 | Poseidon2 hash in-circuit |
| **State** | zustand | 5.0.0 | Mobile app state management |
| **Contracts** | Foundry | — | Contract build/test framework |
| | @openzeppelin/contracts | — | ReentrancyGuard, Pausable |
| | poseidon2-evm | — | On-chain Poseidon2 verification |

---

## Build & Deployment Pipeline

### 1. Noir Circuits (`packages/circuits/`)

```bash
# Compile circuits to JSON + generate Solidity verifiers
cd packages/circuits/base && nargo compile
cd packages/circuits/primary && nargo compile

# Output:
#   packages/circuits/target/passport_base.json
#   packages/circuits/target/passport_primary.json

# Manually copy to app assets
cp packages/circuits/target/passport_base.json apps/mobile/assets/circuits/
cp packages/circuits/target/passport_primary.json apps/mobile/assets/circuits/
```

### 2. Mopro Rust FFI (`packages/mopro-circuits/`)

```bash
# Build Rust library for iOS targets
cd packages/mopro-circuits/MoproReactNativeBindings
uniffi-bindgen-react-native build ios --config ubrn.config.yaml --release

# Output:
#   MoproFfiFramework.xcframework/

# Manually copy to app modules (⚠️ easy to forget!)
rm -rf apps/mobile/modules/mopro/MoproFfiFramework.xcframework
cp -R MoproFfiFramework.xcframework apps/mobile/modules/mopro/
```

### 3. Smart Contracts (`packages/contracts/`)

```bash
# Build contracts
pnpm contracts:build   # runs forge build

# Sync ABI to mobile app
pnpm contracts:sync-abi

# Run tests
pnpm contracts:test
```

### 4. Mobile App (`apps/mobile/`)

```bash
# Install dependencies
pnpm install

# Start Expo dev server
pnpm mobile

# iOS physical device (Release mode recommended for ZK proving)
# Build via Xcode for reliable native module loading
```

> **⚠️ Manual copy steps are easy to forget!** After modifying circuits or the Rust FFI, always:
> 1. Copy compiled circuit JSON → `apps/mobile/assets/circuits/`
> 2. Copy rebuilt xcframework → `apps/mobile/modules/mopro/`
> 3. Clean Xcode DerivedData before rebuilding

---

## Verification Tiers

| Tier | Purpose | Public Inputs | On-Chain Storage |
|------|---------|---------------|------------------|
| **Base** | Proof of personhood | `epochNullifier`, `hashedAddress`, `passportExpiry` | `s_baseRegistrations[hashedAddr]` |
| **Primary** | Sybil resistance (1 wallet/passport) | `nullifier`, `nextCommitment`, `hashedAddress`, `passportExpiry` | `s_primarySlots[nullifier]` |

---

## Current Status

- ✅ **Phase 1**: Wallet connection working
- ✅ **Phase 2**: NFC scan, MRZ entry, stub proof generation
- ✅ **Phase 3b**: Real RSA verification in-circuit, proof generation working
- 🚧 **Phase 3c**: CSCA Merkle tree verification (future)
