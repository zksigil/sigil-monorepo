# Passport Nullifier Circuit (Phase 3a)

Noir circuit for deriving a `passportNullifier` from passport data in zero knowledge.

## Trust Model

**Phase 3a (current):** Trust-the-device model. The mobile app reads DG1 and SOD from the passport via NFC, verifies the SOD signature locally, and feeds SHA256 hashes into the prover. The circuit only proves correct nullifier derivation — it does NOT verify the SOD/CSCA signature chain.

**Phase 3b (future):** In-circuit SOD verification. The RSA/ECDSA signature check moves inside the circuit, removing the need to trust the device.

## Circuit Logic

```
passport_secret    = Poseidon2(dg1_hash, sod_hash)
passport_nullifier = Poseidon2(passport_secret)
```

### Inputs

| Name                 | Visibility | Description                                      |
| -------------------- | ---------- | ------------------------------------------------ |
| `dg1_hash`           | private    | SHA256 of raw DG1 bytes, truncated to BN254 field |
| `sod_hash`           | private    | SHA256 of raw SOD bytes, truncated to BN254 field |
| `passport_nullifier` | public     | Derived nullifier, stored on-chain               |
| `wallet_address`     | public     | Connected wallet address (uint160 as Field)      |

### Constraints

1. `passport_secret == Poseidon2(dg1_hash, sod_hash)`
2. `passport_nullifier == Poseidon2(passport_secret)`

`wallet_address` is a public input that binds the proof to a specific address. The smart contract checks `wallet_address == msg.sender`.

## Mobile App: Pre-Prover Computation

Before calling the Mopro prover, the app must compute:

### 1. Truncate SHA256 to BN254 field

SHA256 produces 256 bits but the BN254 scalar field is ~254 bits. To fit:

```typescript
function truncateToBN254Field(sha256Hash: Uint8Array): bigint {
  // Mask top 3 bits of the first byte to ensure value < BN254 field order
  const truncated = new Uint8Array(sha256Hash);
  truncated[0] &= 0x1f; // Clear bits 7, 6, 5
  // Convert big-endian bytes to bigint
  return truncated.reduce((acc, byte) => (acc << 8n) | BigInt(byte), 0n);
}
```

### 2. Compute inputs

```typescript
import { sha256 } from '@noble/hashes/sha256';

const dg1Hash = truncateToBN254Field(sha256(rawDG1Bytes));
const sodHash = truncateToBN254Field(sha256(rawSODBytes));
const walletAddress = BigInt(connectedWalletAddress); // 0x... -> uint160
```

### 3. Generate proof (via Mopro SDK)

```typescript
const { proof, publicInputs } = await moproProve({
  dg1_hash: dg1Hash,
  sod_hash: sodHash,
  passport_nullifier: expectedNullifier,
  wallet_address: walletAddress,
});
```

The `passport_nullifier` and `wallet_address` are the public outputs submitted to the contract's `register()` function.

## Chain Domain Separation

In Phase 3a, `walletAddress` implicitly binds the proof to the deployment chain because the contract checks `wallet_address == msg.sender` on a specific chain.

For multi-chain deployments (Phase 3b), the nullifier derivation should incorporate `chainId` and `contractAddress`:

```
passport_nullifier = Poseidon2(passport_secret, chain_id, contract_address)
```

This prevents cross-chain linkability of the same passport.

## Build & Test

Requires [Nargo](https://noir-lang.org/docs/getting_started/installation/) v0.36.0+.

```bash
cd packages/circuits
nargo check    # Validate circuit
nargo compile  # Compile to ACIR
nargo test     # Run circuit tests (if any)
```
