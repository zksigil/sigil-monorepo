# Sigil — Claude Code Reference

## What This Project Does
Mobile app (iOS + Android) for verifying Ethereum wallets with government-issued passports via NFC + ZK proofs (zkPassport). Passport data NEVER leaves the device.

## Monorepo Structure
- `apps/mobile/` — React Native (Expo SDK 54, bare workflow)
- `packages/contracts/` — Foundry smart contracts (Solidity 0.8.24)
- `packages/shared-types/` — TypeScript types shared between packages

## Tech Stack
- **Package manager**: pnpm (workspace-aware). Always use `pnpm` not `npm` or `yarn`.
- **Mobile**: React Native 0.76, Expo SDK 54, TypeScript strict mode
- **Navigation**: React Navigation v6 (native-stack)
- **State**: Zustand v5 (wagmi is source of truth for on-chain state)
- **Data fetching**: TanStack Query v5
- **Styling**: NativeWind v4 (Tailwind for React Native) — use `className` prop
- **Web3 (mobile)**: Reown AppKit (`@reown/appkit-react-native`) + wagmi v2 + viem v2
- **Chain**: Base Sepolia (testnet, chain ID 84532) → Base mainnet (8453)
- **Contracts**: Foundry (forge), Solidity 0.8.24, OpenZeppelin v5

## Critical Setup Notes
- Run `pnpm install` from the repo root (not inside apps/mobile)
- The `.npmrc` sets `node-linker=hoisted` — required for React Native native modules
- `EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID` must be set in `.env` before `pnpm mobile`
- `index.js` MUST import `react-native-get-random-values` as the very first line
- `@walletconnect/react-native-compat` must be imported before any WC/AppKit code

## Polyfill Import Order (index.js)
```
1. react-native-get-random-values   (crypto polyfill for Hermes)
2. @walletconnect/react-native-compat (WC shims)
3. expo registerRootComponent
4. App.tsx
```

## Common Commands
```bash
pnpm mobile              # Start Expo dev server
pnpm mobile:ios          # Run on iOS simulator
pnpm mobile:android      # Run on Android emulator
pnpm contracts:build     # forge build
pnpm contracts:test      # forge test -vvv
pnpm typecheck           # TypeScript check all packages
```

## Contract Deployment
```bash
cd packages/contracts
forge script script/DeployVerificationRegistry.s.sol \
  --rpc-url base_sepolia --broadcast --verify -vvvv
```
Then update `EXPO_PUBLIC_VERIFICATION_REGISTRY_ADDRESS` in `.env`.

## Code Conventions
- TypeScript strict mode everywhere — no `any` types
- Use `` `0x${string}` `` for Ethereum addresses/hashes (not plain `string`)
- NativeWind className for styling — no StyleSheet.create() in new components
- Errors follow pattern: `ContractName__ErrorName`
- State variables: `s_` prefix. Immutables: `i_` prefix. Constants: `SCREAMING_SNAKE`
- CEI pattern in all Solidity functions: Checks → Effects → Interactions
- Test files: `*.t.sol` for Foundry, `*.test.tsx` for React Native

## Phase 2 TODO (Not in Phase 1)
- NFC passport reading (requires Apple entitlement + react-native-nfc-manager)
- zkPassport circuit integration + proof generation
- Real groth16 proof verification in VerificationRegistry.sol
- Gas estimation UI before tx submission
- Verification status screen

## iOS NFC Entitlement (Phase 2 Prerequisite)
Before implementing NFC:
1. Apple Developer Portal: enable NFC Tag Reading capability
2. `ios/mobile/mobile.entitlements`: add `com.apple.developer.nfc.readersession.formats`
3. Info.plist: `NFCReaderUsageDescription` (already in app.json)
4. Minimum iOS 16.0 (set in app.json)

## Phase 3 Privacy Architecture — Two-Tier Verification

### Overview
Two tiers of on-chain verification, both integrable with a single mapping lookup:

**Base tier** — proof of personhood, fully unlinkable
- The registry is just a set of hashed addresses: `mapping(bytes32 => bool) public verified`
- No passport-derived data on-chain. Protocol X checks `verified[keccak256(msg.sender)]`
- Multiple addresses per passport allowed. Nothing links them.

**Primary tier** — sybil resistance (one address per passport, globally)
- A second set: `mapping(bytes32 => bool) public verifiedPrimary`
- Protocol X checks `verifiedPrimary[keccak256(msg.sender)]`
- Enforced via a single global nullifier — not per-protocol
- Primary nullifier is an opaque `bytes32`; not tied to any base-tier address, so the two tiers are unlinkable even for the same passport holder

### Primary Nullifier (deterministic per passport)
The primary nullifier is `hash(s, 1)` — nonce is fixed at 1. The same passport always produces the same nullifier, so changing the primary address re-uses that nullifier on-chain.

**Data structure:**
```solidity
mapping(bytes32 => bytes32) public s_primarySlots;             // nullifier => keccak(wallet)
mapping(bytes32 => bytes32) public s_primaryNullifierByWallet; // keccak(wallet) => nullifier (reverse lookup)
mapping(bytes32 => uint256) public s_primaryUnregisteredAt;    // nullifier => cooldown deadline
```

**Registration:** ZK proof + `nullifier = hash(s, 1)`. Contract stores `s_primarySlots[nullifier] = keccak(msg.sender)`.
**Changing primary address:** call `unregisterPrimary()`, wait `cooldownPeriod` (default 7 days), then `registerPrimary()` from the new address with the same passport. The same nullifier reappears in `s_primarySlots`, mapped to the new address.

**Tradeoff:** old and new primary addresses share the on-chain nullifier and are publicly linkable as belonging to the same passport. v1 accepts this in exchange for a much smaller circuit (no chained-commitment proof) and a flat slot mapping. A chained-nullifier scheme that breaks the linkage was prototyped but cut for v1.

### Phone Recovery (no persistent state needed)
The passport secret `s` is derived from the passport itself, not stored on the phone. Recovery flow:
1. Tap passport on new phone → derive `s`
2. App computes `nullifier = hash(s, 1)` and reads `s_primarySlots[nullifier]`
3. If non-zero, the wallet whose `keccak(addr)` matches is the user's current primary

**Implication:** the app can be fully stateless. The passport + on-chain data is sufficient to reconstruct all state. The only unrecoverable loss is losing the physical passport.

### Passport Loss / Expiry
If a passport is lost or expires, the user cannot manage their old registered addresses (new passport = different `s`). Recovery via a new passport is a v2 concern — for v1, treat the passport as the root key.

### passportSecret Derivation (SOD-based, Phase 3a)
- `passportSecret s = Poseidon(SHA256(DG1_raw), SHA256(SOD_signature))`
- SOD signature (~256 bytes RSA/ECDSA) provides high entropy; deterministic across phone losses
- Include `chainId` + `contractAddress` in nullifier derivation to prevent cross-chain linkability
- NFC module needs `SELECT EF.SOD` (file ID `0x011D`) read after DG1

### ZK Circuit (Noir + Mopro)
- **Language**: Noir (no trusted setup, UltraHonk backend)
- **Prover**: Mopro React Native SDK (Rust core, native thread, ~5–15s on device)
- **NOT** snarkjs WASM (too slow, OOM risk on large circuits)
- **Public inputs (primary):** `[nullifier, hashed_address, csca_merkle_root]`
- **Public inputs (base):** `[epoch_nullifier, hashed_address, csca_merkle_root]`
- **Private inputs:** `[dg1_hash, sod_hash, nonce, signedAttrs+RSA witness, DSC TBS, CSCA pubkey/signature, CSCA Merkle siblings]`
- **Circuit proves (Phase 3c):** SOD signed by DSC (RSA-2048); DSC signed by CSCA (RSA-4096); CSCA pubkey is in the on-chain CSCA Merkle tree; nullifier is correctly derived from `s` and the (fixed) nonce
- Passport expiry is enforced at the contract entrypoint, not in the circuit

### Registration Lifecycle
All registrations (base and primary) have two independent expiry conditions:

**1. Passport expiry** — hard ceiling, enforced in the ZK circuit AND at the contract entrypoint
- `passportExpiry` is a public input to the proof; circuit asserts `block.timestamp < passportExpiry`
- Contract also checks at write time: `if (block.timestamp >= passportExpiry) revert VerificationRegistry__PassportExpired()`
- `isVerified` does NOT re-check passport expiry on read — it only checks `expiresAt`. Combined with the rounding below, a registration can stay valid up to ~89 days past actual passport expiry.

**2. Registration TTL** — requires periodic re-tap, default 180 days (6 months)
- User must re-submit a fresh proof before `expiresAt` to renew (re-tapping passport on phone)
- `isVerified` returns false lazily for expired registrations — no on-chain write required
- On renewal, `expiresAt` is updated; `registeredAt` is preserved; nullifier does not change for base tier; renewals skip the daily rate limit.

**Effective expiresAt** stored on-chain:
```
expiresAt = min(now + registrationTTL,
                ceil(passportExpiry / 90 days) * 90 days)
```
The passport-expiry component is rounded UP to the next 90-day boundary anchored to the Unix epoch (NOT calendar quarters). This is a **privacy** choice — it collapses ~365 distinguishable expiry values per year into 4, so multiple addresses registered from the same passport don't share a uniquely identifiable expiresAt. The trade-off is the ~89-day grace window noted above.

### Rate Limiting (base tier)
To limit damage from a stolen passport being used to mass-register addresses:
- Max **10 base registrations per passport per day**
- Enforced via an epoch nullifier: `epochNullifier = hash(s, "epoch", floor(block.timestamp / 1 days))`
- Contract stores a count per epoch nullifier; rejects registration when count >= `s_config.maxDailyRegistrations()`
- No per-passport identity stored on-chain — just nullifiers, same privacy model as primary tier

### Governance Architecture
All protocol parameters live outside the core registry so they can be updated without redeploying.

**Separation of concerns:**
```
TimelockController          ← governor (multisig proposer initially, DAO later)
ProtocolConfig              ← all tunable parameters (with hard bounds)
ProofVerifier               ← ZK proof verification logic (swappable for circuit upgrades)
OracleUpdater (role)        ← DSC/revocation Merkle root — separate from governor
VerificationRegistry        ← immutable core logic, reads from all of the above
```

**Governor pattern:**
```solidity
address public s_governor;
// Initially a multisig. Transfer to DAO contract via transferGovernance() — no registry change needed.
function transferGovernance(address newGovernor) external onlyGovernor;
function setConfig(IProtocolConfig newConfig) external onlyGovernor;
function setVerifier(IProofVerifier newVerifier) external onlyGovernor;
function setOracleUpdater(address newUpdater) external onlyGovernor;
function setSuccessor(address newRegistry) external onlyGovernor; // migration path
```

**ProtocolConfig parameters (with hard bounds enforced in contract):**
| Parameter | Default | Min | Max |
|---|---|---|---|
| `registrationTTL` | 180 days | 30 days | 365 days |
| `cooldownPeriod` | 7 days | 1 day | 90 days |
| `maxDailyRegistrations` | 10 | 1 | 50 |

**Successor / migration pattern** — if core logic ever needs replacing:
```solidity
function isVerified(address wallet) external view returns (bool) {
    if (s_successor != address(0)) return IVerificationRegistry(s_successor).isVerified(wallet);
    // ... normal check, including expiry
}
```
Integrating protocols need zero changes when a successor is set.

### Contract Interface
```solidity
struct Registration {
    uint48 expiresAt;        // registeredAt + TTL
    uint48 registeredAt;     // block.timestamp at first registration; preserved across renewals
}

// Base tier
mapping(bytes32 => Registration) private s_baseRegistrations; // keccak(wallet) => Registration
mapping(bytes32 => uint8)        private s_epochCounts;       // epochNullifier => count today

// Primary tier
mapping(bytes32 => bytes32) public  s_primarySlots;              // nullifier => keccak(wallet)
mapping(bytes32 => bytes32) public  s_primaryNullifierByWallet;  // keccak(wallet) => nullifier (reverse)
mapping(bytes32 => Registration) private s_primaryRegistrations; // keccak(wallet) => Registration
mapping(bytes32 => uint256) private s_primaryUnregisteredAt;     // nullifier => cooldown deadline

// Mutations
function registerBase(bytes32 epochNullifier, uint48 passportExpiry, bytes calldata proof) external;
function renewBase(uint48 passportExpiry, bytes calldata proof) external;
function unregisterBase() external;
function registerPrimary(bytes32 nullifier, uint48 passportExpiry, bytes calldata proof) external;
function renewPrimary(bytes32 nullifier, uint48 passportExpiry, bytes calldata proof) external;
function unregisterPrimary() external;

// Protocol integration (one line each) — returns false if expired
function isVerified(address wallet) external view returns (bool);
function isPrimaryVerified(address wallet) external view returns (bool);
```

To change the primary wallet for a passport: call `unregisterPrimary()` from the current primary, wait `cooldownPeriod`, then call `registerPrimary()` from the new wallet with a fresh proof. There is no `changePrimary()` function — the unregister/cooldown/re-register sequence is the only path, and old and new primary addresses share the same nullifier on-chain.

### Privacy Properties
- Base addresses: fully unlinkable — no passport-derived data on-chain
- Primary address: nullifier on-chain is opaque; not connected to any base-tier address (the two tiers remain unlinkable)
- **Primary changes are linkable** — the same nullifier appears for both the old and new primary address (v1 tradeoff for circuit simplicity)
- Rate limiting uses epoch nullifiers — no per-passport count stored, same privacy model
- Events: `WalletVerified(address indexed wallet)` only — NO nullifiers in events
- Consider ERC-4337 paymaster for gas (eliminates funder-address deanonymization)

### Phase 3 TODO
- [x] Update NFC module to read SOD (`SELECT EF.SOD` after DG1 in `src/infrastructure/nfc/index.ts`)
- [x] Redesign `VerificationRegistry.sol` per two-tier interface above
- [x] Deploy `ProtocolConfig.sol` with default parameters and hard bounds
- [x] Deploy `ProofVerifier.sol` (`MockProofVerifier` for anvil, real UltraHonk verifiers for prod)
- [ ] Deploy `TimelockController` as governor (multisig as proposer)
- [x] Write Noir circuit (Phase 3c: full CSCA→DSC→SOD chain + stable per-passport nullifier)
- [x] Integrate Mopro React Native SDK
- [x] Replace stub in `proofService.ts` with real Mopro proof generation
- [x] Deploy updated contract + set `EXPO_PUBLIC_VERIFICATION_REGISTRY_ADDRESS`
- [x] Wire `useVerificationStatus` hook to HomeScreen (show TTL countdown + renewal prompt)
- [ ] App prompts renewal when registration is within 30 days of expiry
