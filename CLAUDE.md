# ZK Identity Verifier — Claude Code Reference

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
2. `ios/zkproof-verifier.entitlements`: add `com.apple.developer.nfc.readersession.formats`
3. Info.plist: `NFCReaderUsageDescription` (already in app.json)
4. Minimum iOS 16.0 (set in app.json)
