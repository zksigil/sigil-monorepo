# Anvil End-to-End Smoke Test Plan

End-to-end test: wallet connect -> Skip NFC -> stub proof -> registerBase() on Anvil -> verify on-chain.

## Prerequisites

- Xcode installed with iOS simulator
- MetaMask mobile (or any WalletConnect-compatible wallet)
- Foundry toolchain (`forge`, `anvil`)
- pnpm

## 1. Start Anvil

```bash
anvil --chain-id 31337
```

Anvil starts with 10 pre-funded accounts (10,000 ETH each). The first test account:

| Field | Value |
|---|---|
| Address | `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266` |
| Private Key | `0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80` |

> Import this private key into MetaMask for testing.

**Keep the Anvil terminal running** throughout testing. If Anvil is restarted, all state is lost and contracts must be redeployed (see Step 2).

## 2. Deploy Contracts

In a new terminal:

```bash
cd packages/contracts

PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
DEPLOYER_ADDRESS=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 \
forge script script/Deploy.s.sol:Deploy \
  --rpc-url http://127.0.0.1:8545 \
  --broadcast -vvvv
```

Note the deployed addresses from the output:

| Contract | Expected Address (deterministic on fresh Anvil) |
|---|---|
| ProtocolConfig | `0x5FbDB2315678afecb367f032d93F642f64180aa3` |
| ProofVerifier (stub) | `0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512` |
| VerificationRegistry | `0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0` |

> Addresses are deterministic on a fresh Anvil. If you've run other transactions first, addresses will differ — use the values from the deploy output.

## 3. Set Environment Variables

Edit the root `.env` (symlinked to `apps/mobile/.env`):

```bash
# Add/update these lines in .env:
EXPO_PUBLIC_VERIFICATION_REGISTRY_ADDRESS=0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0
EXPO_PUBLIC_ANVIL_RPC_URL=http://127.0.0.1:8545
```

**Physical device instead of simulator?** Use your Mac's LAN IP:

```bash
EXPO_PUBLIC_ANVIL_RPC_URL=http://192.168.x.x:8545
```

Find your Mac's LAN IP: System Settings -> Wi-Fi -> Details -> IP address.

## 4. Start Metro (Required for Debug Builds)

```bash
pnpm mobile
```

Wait for the Metro bundler to start.

## 5. Build and Run (Debug Configuration)

The "Skip NFC" dev bypass button is gated behind `__DEV__`, which is only `true` in Debug builds. You **must** use a Debug build for this test.

In Xcode:
1. Open `apps/mobile/ios/mobile.xcworkspace`
2. **Edit Scheme** (Product -> Scheme -> Edit Scheme, or Cmd+<)
3. Select **Run** in the left sidebar
4. Change **Build Configuration** from `Release` to `Debug`
5. Select your target device/simulator
6. **Cmd+R** to build and run

> Debug builds require Metro to be running (Step 4). The app connects to Metro for JS bundle serving.

## 6. Connect Wallet

1. App launches to the Home screen
2. Tap **Connect Wallet**
3. In the AppKit modal, select **MetaMask** (or your preferred WC wallet)
4. Approve the connection in MetaMask
5. **Switch MetaMask to the Anvil network** (chain 31337, RPC http://127.0.0.1:8545)
   - MetaMask -> Settings -> Networks -> Add Network -> add Anvil with RPC URL `http://127.0.0.1:8545` and chain ID `31337`
6. Verify the app shows the connected wallet address and "Anvil (local)" as the network

## 7. Start Verification Flow

1. Tap **Verify Identity**
2. On the Passport Scan screen, you can enter any MRZ data (it won't be validated)
3. Tap **Begin NFC Scan**
4. NFC will fail (expected — no entitlement in dev builds)
5. In the error state, tap **[DEV] Skip NFC -- use dummy data**
   - This uses dummy passport data: doc `AB1234567`, DOB `900101`, expiry `300101`

## 8. Proof Generation + Contract Submission

1. The Proof Generation screen appears and generates a stub proof (~1s)
2. After proof generation, the app calls `registerBase()` on the Anvil contract
3. **Approve the transaction** in MetaMask when prompted
4. Wait for on-chain confirmation (near-instant on Anvil)
5. The app navigates to the **Verification Success** screen with a real tx hash

## 9. Verify On-Chain State

Confirm the wallet is now verified on-chain:

```bash
cast call 0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0 \
  "isVerified(address)(bool)" \
  0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 \
  --rpc-url http://127.0.0.1:8545
```

Expected output: `true`

## Troubleshooting

### "Skip NFC" button not visible
You are running a Release build. Switch to Debug (Step 5).

### Metro connection failed
- Simulator: Metro should auto-connect on `localhost`
- Physical device: ensure Mac and device are on the same Wi-Fi network (no AP isolation) and Metro is accessible

### Transaction reverts
Check the Anvil terminal for revert reasons. Common causes:
- Wrong chain in MetaMask (must be 31337)
- Contract not deployed (Anvil was restarted — redeploy per Step 2)
- Proof struct mismatch — check console logs prefixed `[TX]`

### Anvil restarted / addresses changed
Anvil is ephemeral. On restart:
1. Redeploy contracts (Step 2)
2. Update `.env` with new `EXPO_PUBLIC_VERIFICATION_REGISTRY_ADDRESS` if addresses changed
3. Restart Metro (`pnpm mobile`) to pick up new env vars

### MetaMask nonce error after Anvil restart
MetaMask caches nonces. After restarting Anvil: MetaMask -> Settings -> Advanced -> Clear Activity Tab Data.
