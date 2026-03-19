# zkproof-verifier

Mobile app for verifying Ethereum wallets with government-issued passports using NFC + ZK proofs. Passport data never leaves the device.

## What it does

You tap your passport to your phone, the app reads it over NFC, generates a ZK proof locally, and registers your wallet on-chain. Protocols can then do a single mapping lookup to check if a wallet is verified — no passport data on-chain, no way to link wallets back to a person.

Two verification tiers:
- **Base tier** — proof of personhood. Multiple wallets per passport allowed, fully unlinkable.
- **Primary tier** — sybil resistance. One wallet per passport globally, enforced via nullifier.

## Stack

- **Mobile**: React Native 0.81 / Expo SDK 54 (bare workflow), TypeScript strict
- **Contracts**: Foundry / Solidity 0.8.24, deployed on Base Sepolia → Base mainnet
- **Web3**: Reown AppKit + wagmi v2 + viem v2
- **ZK**: Noir circuits, Mopro prover (runs on-device, ~5–15s)

## Monorepo layout

```
apps/mobile/          React Native app
packages/contracts/   Foundry smart contracts
packages/shared-types/ TypeScript types
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
pnpm contracts:build
pnpm contracts:test
```

After deploying, update `EXPO_PUBLIC_VERIFICATION_REGISTRY_ADDRESS` in `.env`.

## Status

- Phase 1 ✅ — wallet connection (MetaMask / WC wallets via AppKit)
- Phase 2 ✅ — MRZ entry, camera OCR, NFC + BAC auth, stub proof generation
- Phase 3 🚧 — real ZK circuit, Mopro integration, two-tier registry redesign, SOD-based passport secret