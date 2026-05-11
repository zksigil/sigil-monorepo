# Sigil — Claude Code Reference

## What This Project Does
Mobile app (iOS + Android) for verifying Ethereum wallets with government-issued passports via NFC + ZK proofs (zkPassport). Passport data NEVER leaves the device.

## Monorepo Structure
- `apps/mobile/` — React Native (Expo SDK 54, bare workflow)
- `packages/contracts/` — Foundry smart contracts (Solidity 0.8.28)
- `packages/circuits/` — Noir circuit (`sigil/`) — single unified circuit
- `packages/mopro-circuits/` — Rust FFI bindings (Mopro) for the Noir prover

## Tech Stack
- **Package manager**: pnpm (workspace-aware). Always use `pnpm` not `npm` or `yarn`.
- **Mobile**: React Native 0.81.5, Expo SDK 54, TypeScript strict mode
- **Navigation**: React Navigation v6 (native-stack)
- **State**: Zustand v5 (wagmi is source of truth for on-chain state)
- **Data fetching**: TanStack Query v5
- **Styling**: NativeWind v4 (Tailwind for React Native) — use `className` prop
- **Web3 (mobile)**: Reown AppKit (`@reown/appkit-react-native`) + wagmi v2 + viem v2
- **Chain**: Base Sepolia (testnet, chain ID 84532) and Base mainnet (8453); anvil (31337) for local dev
- **Contracts**: Foundry (forge), Solidity 0.8.28 (foundry.toml-pinned), OpenZeppelin v5

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
pnpm typecheck           # TypeScript check (mobile)
pnpm contracts:sync-abi  # Regen apps/mobile/.../contractAbis.ts from SigilRegistry artifact
make contracts           # forge build + sync ABI
make contracts-test      # forge test -vvv
make circuits            # nargo compile + copy JSON to app assets
make bb-verifier         # Regenerate SigilUltraHonkVerifier.sol from VK
make ios                 # Build Mopro Rust FFI; writes xcframework + bindings into apps/mobile/modules/mopro/
make pods                # cd apps/mobile/ios && pod install (generates mobile.xcworkspace)
make bootstrap           # Full first-time setup from a fresh checkout (chains all of the above)
```

## Contract Deployment
```bash
cd packages/contracts
forge script script/Deploy.s.sol:Deploy \
  --rpc-url base_sepolia --account base_sepolia --broadcast -vvvv
```
Then update `EXPO_PUBLIC_BASE_SEPOLIA_REGISTRY_ADDRESS` (or `EXPO_PUBLIC_BASE_REGISTRY_ADDRESS`
for mainnet) in BOTH `.env` and `apps/mobile/.env`, and rebuild the app — env vars are
baked into the JS bundle. See "Production deploy procedure" below for keystore setup
and CSCA ownership transfer.

## Code Conventions
- TypeScript strict mode everywhere — no `any` types
- Use `` `0x${string}` `` for Ethereum addresses/hashes (not plain `string`)
- NativeWind className for styling — no StyleSheet.create() in new components
- Errors follow pattern: `ContractName__ErrorName`
- State variables: `s_` prefix. Immutables: `i_` prefix. Constants: `SCREAMING_SNAKE`
- CEI pattern in all Solidity functions: Checks → Effects → Interactions
- Test files: `*.t.sol` for Foundry, `*.test.tsx` for React Native

## iOS NFC Entitlement (already configured)
Reference for re-configuring after a new Apple Developer Portal session:
1. Apple Developer Portal: enable NFC Tag Reading capability
2. `apps/mobile/ios/mobile/mobile.entitlements`: includes `com.apple.developer.nfc.readersession.formats` and the eMRTD AID `com.apple.developer.nfc.readersession.iso7816.select-identifiers`
3. `Info.plist`: `NFCReaderUsageDescription` (also declared in `app.json`)
4. Minimum iOS 16.0 (set in app.json)

## Phase 4 Sigil Architecture — Single-Tier Identity-Anchored Sybil Resistance

### Product positioning
- **What Sigil sells:** passport-grade proof of personhood + protocol-pluggable sybil resistance, with the privacy story being "no passport data on-chain, just an opaque hash."
- **What Sigil does NOT sell:** unlinkability across a single user's own wallets. If a user sigilizes wallets A and B with the same passport, they share an on-chain nullifier and are publicly correlatable. Users who want a wallet to stay anonymous simply don't sigilize it.
- The two-tier (base/primary) model and the chained-nullifier rotation scheme were both cut. See `memory/project_single_tier_migration.md` for migration history.

### Overview
One stable nullifier per passport. A user can sigilize any number of wallets — they all share that nullifier on-chain. Protocols read `isVerified(wallet)` for personhood, and `nullifierOf(wallet)` to dedupe per-protocol (sybil resistance).

### Stable nullifier (deterministic per passport)
- `nullifier = Poseidon2(passport_secret, 1)` — nonce fixed at 1
- The same passport always produces the same nullifier
- `passport_secret = Poseidon2(SHA256(DG1_raw), SHA256(SOD_signature))`
- SOD signature (~256 bytes RSA/ECDSA) provides high entropy; deterministic across phone losses
- NFC module reads `SELECT EF.SOD` (file ID `0x011D`) after DG1

### On-chain storage
```solidity
mapping(bytes32 => Registration) private s_registrations;     // keccak(wallet) => Registration
mapping(bytes32 => bytes32)      public  s_nullifierByWallet; // keccak(wallet) => nullifier (public sybil ID)
mapping(bytes32 => address[])    private s_walletsByNullifier; // nullifier => wallets registered under it
mapping(bytes32 => mapping(address => uint256)) private s_walletIndex; // 1-based, supports O(1) swap-and-pop
mapping(bytes32 => uint8)        private s_epochCounts;       // epochNullifier => count today
```

### Phone recovery (stateless app)
Passport secret `s` is derived from the passport on every tap, not cached. Recovery on a new phone:
1. Tap passport → derive `s`
2. App computes `nullifier = hash(s, 1)` and reads `getWallets(nullifier)` to enumerate sigilized wallets
3. The user reconnects their wallet provider; their existing sigilized wallets re-appear in the UI

### Passport loss / expiry
Lost or expired passport → different `s` → user cannot manage their old sigilized wallets. Recovery via a new passport is v2 scope. For v1, the passport is the root key.

### ZK Circuit (Noir + Mopro)
- **Language:** Noir (no trusted setup, UltraHonk backend)
- **Prover:** Mopro React Native SDK (Rust core, native thread, ~5–15s on device)
- **Public inputs (in circuit declaration order):** `[nullifier, epoch_nullifier, hashed_address, csca_merkle_root]`
- **Private inputs:** `[dg1_hash, sod_hash, epoch_day, signedAttrs + RSA-2048 witness, DSC TBS, CSCA pubkey/RSA-4096 signature, CSCA Merkle siblings]`
- **Circuit proves:** SOD signed by DSC (RSA-2048); DSC signed by CSCA (RSA-4096); CSCA pubkey is in the on-chain CSCA Merkle tree; both nullifiers correctly derived from `s`
- Passport expiry is enforced at the contract entrypoint, not in the circuit

### Registration lifecycle
Every registration has two independent expiry conditions:

**1. Passport expiry** — hard ceiling, enforced at the contract entrypoint
- Contract checks at write time: `if (block.timestamp >= passportExpiry) revert __PassportExpired()`
- `isVerified` does NOT re-check passport expiry on read; it only checks `expiresAt`. Combined with the rounding below, a registration can stay valid up to ~89 days past actual passport expiry.

**2. Registration TTL** — requires periodic re-tap, default 180 days
- User must call `renew(nullifier, epochNullifier, passportExpiry, proof)` before `expiresAt` to extend
- `registeredAt` is preserved across renewals; only `expiresAt` is updated
- Renewal must use the same nullifier the wallet was registered with (`__NullifierMismatch` otherwise — to replace the passport, unregister first then register fresh)
- Renewals skip the daily rate limit
- `isVerified` returns false lazily for expired registrations (no on-chain write required)

**Effective expiresAt:**
```
expiresAt = min(now + registrationTTL,
                ceil(passportExpiry / 90 days) * 90 days)
```
Passport expiry rounded UP to the next 90-day boundary anchored to the Unix epoch (NOT calendar quarters). Privacy choice: collapses ~365 distinguishable expiry values per year into 4. Trade-off: ~89-day grace window noted above.

### Rate limiting
To limit damage from a stolen passport being used to mass-sigilize wallets:
- Max **10 new registrations per passport per day** (default; bounded 1–50 by the registry's constructor)
- Enforced via an epoch nullifier: `epochNullifier = Poseidon2(s, epoch_day)` where `epoch_day = floor(block.timestamp / 1 days)`
- Contract stores a count per epoch nullifier; rejects registration when `count >= maxDailyRegistrations`
- Renewals are exempt — the contract still passes the real epoch nullifier through to the verifier (the circuit always constrains it) but does not increment the counter

### Trust Model — Immutable Registry
```
SigilRegistry  ← immutable: no governor, no setters, no pause, no successor.
       │                  Parameters baked in as immutables at deploy time.
       │ reads root from
       ▼
CSCAMerkleTree        ← Ownable2Step. Single privileged action: setRoot(newRoot).
       ▲                Initial owner = deployer EOA; MUST be transferred before mainnet.
       │ owner is
       │
   <external address>  ← only on-chain power: rotate the CSCA root.
                         Cannot affect existing registrations or change verifier rules.
                         There is NO Sigil-owned governor contract. The owner is just
                         an external address — see "Production deploy procedure" below.
```

**There is no governor contract in this repo.** The "governance" is just whoever owns
`CSCAMerkleTree`'s `Ownable2Step` role. That address is set in the deploy script's
constructor call and can be transferred after deploy. See the production deploy
procedure below for the three concrete options (Safe, TimelockController, EOA-for-dev).

The registry contract has no governance surface. Every parameter is set in the constructor and frozen:
- `i_verifier` (`IUltraHonkVerifier` — small interface declared inline in `SigilRegistry.sol`) — frozen
- `i_cscaMerkleTree` (`CSCAMerkleTree` — concrete contract type, no separate interface) — frozen (CSCA tree's OWN `setRoot` handles updates)
- `i_registrationTTL` (uint256) — frozen, bounded `[30 days, 365 days]` in constructor
- `i_maxDailyRegistrations` (uint8) — frozen, bounded `[1, 50]` in constructor

If parameters or the verifier ever need to change, the path is "deploy v2 and let integrators choose to migrate" — there is no `setSuccessor` back-door.

### Contract Interface
```solidity
struct Registration {
    uint48 expiresAt;
    uint48 registeredAt; // preserved across renewals
}

// Mutations
function register(bytes32 nullifier, bytes32 epochNullifier, uint48 passportExpiry, bytes calldata proof) external;
function renew(bytes32 nullifier, bytes32 epochNullifier, uint48 passportExpiry, bytes calldata proof) external;
function unregister() external;

// Protocol integration
function isVerified(address wallet) external view returns (bool);
function nullifierOf(address wallet) external view returns (bytes32);  // public sybil identifier
function getExpiry(address wallet) external view returns (uint48);
function getRegisteredAt(address wallet) external view returns (uint48);
function getWallets(bytes32 nullifier) external view returns (address[] memory);

// Constructor immutables (read-only)
function i_verifier() external view returns (IUltraHonkVerifier);
function i_cscaMerkleTree() external view returns (CSCAMerkleTree);
function i_registrationTTL() external view returns (uint256);
function i_maxDailyRegistrations() external view returns (uint8);
```

**Standard protocol integration:**
```solidity
if (!sigil.isVerified(msg.sender)) revert NotVerified();
bytes32 nullifier = sigil.nullifierOf(msg.sender);
if (seen[nullifier]) revert AlreadyParticipated();
seen[nullifier] = true;
```

### Production deploy procedure (CSCA ownership)

The registry is fully deployed by `Deploy.s.sol`, but the CSCAMerkleTree's owner
starts as the **deployer EOA**. Before any production / mainnet deployment is
considered live, the owner MUST be transferred to one of the following:

| Option | What it is | Pros | Cons |
|---|---|---|---|
| Gnosis Safe (multisig) | Deployed via the Safe UI (https://safe.global), not in this repo | M-of-N signers, instant updates, well understood | No on-chain delay — captured signers can rotate root immediately |
| `TimelockController` (OpenZeppelin) | Could be added to `Deploy.s.sol` | Forced N-day delay → updates are observable + reactable | Slower; need a proposer (an EOA or Safe) on top |
| Safe **+** Timelock (proposer = Safe, executor = anyone) | Combines both | Best of both: M-of-N approval + observable delay | Two contracts to manage |

**Key management.** Use Foundry keystores (`cast wallet import <name> --interactive`) — the
encrypted keystore lives at `~/.foundry/keystores/<name>` and is unlocked at deploy time
with a password prompt. No raw private keys in env vars or shell history. The deploy
script uses `msg.sender` (which Forge sets from `--account`), so no `DEPLOYER_ADDRESS`
env var is needed either.

Whichever ownership target you pick, the procedure is:

```bash
# 1. Deploy contracts (BASE_SEPOLIA_RPC_URL exported in shell).
#    Optionally append `--verify` and export BASESCAN_API_KEY=... to publish source on Basescan.
forge script script/Deploy.s.sol:Deploy \
  --rpc-url base_sepolia --account base_sepolia --broadcast

# 2. From the deployer keystore, propose ownership transfer
cast send <CSCATree> 'transferOwnership(address)' <newOwner> \
  --account base_sepolia --rpc-url base_sepolia

# 3. From newOwner, accept ownership (Ownable2Step requires this — guards typos)
cast send <CSCATree> 'acceptOwnership()' \
  --account <newOwnerAccount> --rpc-url base_sepolia

# 4. Verify the transfer
cast call <CSCATree> 'owner()(address)' --rpc-url base_sepolia
```

**Until step 3 completes, the deployer EOA still owns the tree** — `Ownable2Step` only
changes ownership on accept, not on transfer. This is intentional: it prevents accidentally
transferring to a wrong/dead address.

We have NOT picked one of the three options yet — that's a production-deployment
decision, not a contract-architecture decision. For dev / anvil, the deployer EOA is
fine and `DeployDev.s.sol` leaves it that way.

### Privacy Properties
- No name, DOB, nationality, or any passport-derived data on-chain — just an opaque hash
- All wallets sigilized under the same passport are publicly linkable via the shared `nullifierByWallet` mapping (this is the explicit single-tier trade-off — users opt-in per wallet)
- Wallets the user does NOT sigilize remain anonymous
- Events: `WalletVerified(address indexed wallet)` only — NO nullifiers in events
- Consider ERC-4337 paymaster for gas (eliminates funder-address deanonymization)

### Phase 4 TODO
- [x] Collapse two-tier into single-tier `SigilRegistry.sol`
- [x] Consolidate `base/` + `primary/` Noir circuits into one `sigil/` circuit
- [x] Regenerate `SigilUltraHonkVerifier.sol` from the unified circuit
- [x] Update Mopro `compute_sigil_inputs` to emit both `nullifier` and `epoch_nullifier`
- [x] Refactor mobile app: single `Sigilize` CTA, first-sigilize education modal, `useTrackedAccounts` reads `isVerified` + `nullifierOf`
- [x] Strip governance from registry — registry is immutable; only `CSCAMerkleTree.setRoot` is privileged
- [x] App prompts renewal when registration is within 30 days of expiry (shipped in `ui/polish-pass-3`)
- [x] Inline ProofVerifier into the registry, drop `ICSCAMerkleTree` interface (`refactor/inline-proof-verifier`)
- [x] Rename `VerificationRegistry` → `SigilRegistry` (`refactor/sigil-registry-rename`)
- [ ] Transfer `CSCAMerkleTree` ownership to a multisig (or `TimelockController`) before mainnet deploy
