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
- Pending — transfer `CSCAMerkleTree` ownership to a multisig before mainnet; in-app renewal prompts within 30 days of expiry. See [HIGH-LEVEL-ARCHITECTURE.md](HIGH-LEVEL-ARCHITECTURE.md) for details.