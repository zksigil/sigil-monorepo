# Sigil Mobile / ZK Audit — `audit/mobile-zk-review`

Reviewer: mobile / Mopro / Noir engineer  
Branch: `audit/mobile-zk-review`  
Baseline: `master @ eeeee2b`

This report covers the Noir circuit, the Rust FFI bridge, NFC + SOD parsing, the proof orchestration service, and the React Native UI / state layer. Findings are grouped by area and labeled with **Bug / Robustness / Efficiency / Readability**. File:line references use absolute paths.

The end-to-end flow is verified working on Base Sepolia. The audit focuses on incremental wins; large refactors are flagged but not applied.

---

## Table of contents

1. Circuit (`packages/circuits/sigil/src/main.nr`)
2. Rust FFI (`packages/mopro-circuits/src/{noir,error,lib}.rs`, Cargo)
3. NFC infrastructure (`apps/mobile/src/infrastructure/nfc/index.ts`)
4. SOD parsing (`apps/mobile/src/infrastructure/sod/parseSod.ts`)
5. Proof orchestration (`proofService.ts`, `useProofGeneration.ts`, `useCircuitSetup.ts`, `cscaMerkleProof.ts`)
6. RN UI (`ProofGenerationScreen.tsx`, `PassportScanScreen.tsx`)
7. State (Zustand stores, `useTrackedAccounts.ts`, `useVerificationStatus.ts`)
8. Tests
9. Summary table & follow-ups

---

## 1. Noir circuit — `packages/circuits/sigil/src/main.nr`

### C-1 [Readability] `hashed_address` is consumed via `let _ =` (line 136) — clarify the constraint relationship
The value is declared `pub` but never constrained inside the circuit; the comment correctly says the contract enforces it via `msg.sender`. The `let _ = hashed_address;` line is intentional but easy to miss. Recommend a doc-comment block at the head of the public-input list explicitly tagging which inputs are circuit-constrained vs. host-bound, e.g.:

```noir
// Public inputs:
//   nullifier         -- CONSTRAINED in-circuit (must equal Poseidon2([s,1]))
//   epoch_nullifier   -- CONSTRAINED in-circuit (must equal Poseidon2([s,epoch_day]))
//   hashed_address    -- HOST-BOUND only: the contract checks keccak256(msg.sender) == hashed_address
//   csca_merkle_root  -- CONSTRAINED in-circuit (must equal computed Merkle root)
```

This is a low-risk doc change. **Not applied** (style nit; defer to circuit owner).

### C-2 [Readability] `epoch_day` is unconstrained but never bounded (line 36)
The circuit accepts any field-element value of `epoch_day`. The contract trusts the resulting `epochNullifier` as opaque. There is no semantic bug because the per-epochNullifier counter still rate-limits (max 10 registrations bound to whatever `epoch_day` value the prover used), but the comment in `Cargo.toml`/`main.nr` should clarify that `epoch_day` is a free parameter chosen by the prover and the contract relies on the per-day rate-limit semantics through chosen monotone usage on the JS side. Worth a sentence in the doc-comment of `main`. **Not applied.**

### C-3 [Efficiency] Branchy Merkle inclusion (`#[no_predicates]`, line 140)
The `if index % 2 == 0` branch costs ~2x Poseidon2 calls per level (both branches generate witness then are blended). With `#[no_predicates]` Noir already optimizes this somewhat, but a constraint-only formulation:

```noir
let bit = (index >> i as u32) & 1;
let left  = bit * sibling + (1 - bit) * current;
let right = bit * current + (1 - bit) * sibling;
current = Poseidon2::hash([left, right], 2);
```

…would constrain in a single Poseidon call regardless of bit. This is a mild gate-count optimization for a 9-deep tree (saves ~50% of the conditional cost), but the cleaner phrasing also avoids tile generation. **Not applied** — would change witness layout, needs nargo recompile + bb verifier regen + e2e re-test.

### C-4 [Efficiency] CSCA pubkey -> field hashing happens twice morally (lines 109 / 91)
`sha256_var(csca_pubkey, 512)` for the leaf hash is independent from RSA-4096 verification, which already SHA-256s the DSC TBS — but they're different inputs. The current arrangement is correct. The leaf hash uses `sha256_var(csca_pubkey, 512)` even though `csca_pubkey` is fixed-length 512: prefer fixed-length `sha256(csca_pubkey)` for predictability. **Not applied** (semantic-equivalent in current Noir version; revisit when Noir stdlib exposes a fixed-length variant).

### C-5 [Readability] Magic constants 256/18, 512/35, 257/513 lack a comment on derivation (lines 67-68, 93-94)
The limb counts are derived from `ceil(2048/120) = 18` and `ceil(4096/120) = 35` for noir-bignum's 120-bit limbs. Worth a one-liner comment. **Not applied** — circuit-level cleanup deferred.

### C-6 [Robustness] `bytes_to_field` (line 193) silently truncates beyond field modulus
For 32-byte input where the high bits exceed `p`, the multiplication `result * 256` reduces mod p as it goes. This is fine but the function's docstring should make the modular reduction explicit since `csca_pubkey_hash` (32 bytes from SHA-256) can be ≥p. The off-circuit tree-builder must use the same convention. **Already documented** at line 192 ("reduced modulo the BN254 field prime") — fine.

---

## 2. Rust FFI — `packages/mopro-circuits/src/noir.rs`

### R-1 [Bug] `verify_noir_proof` reads bytecode but never uses it (line 111)
```rust
let _bytecode = read_bytecode(&circuit_path)?;
verify_ultra_honk_keccak(proof, vk, false)
```
Verification needs the VK and the proof, not the bytecode. The `read_bytecode` call adds an unnecessary disk read + JSON parse on every verify. Worse, it makes `verify_noir_proof` fail for any caller who doesn't have the circuit JSON on disk (e.g. a remote verifier). It also makes the `circuit_path` parameter misleading.

**Severity:** Robustness — wastes ~5–20 ms per verify and confuses the API surface.

**Sketch fix:**
```rust
pub fn verify_noir_proof(
    _circuit_path: String,  // kept for ABI compat
    proof: Vec<u8>,
    on_chain: bool,
    vk: Vec<u8>,
    _low_memory_mode: bool,
) -> Result<bool, MoproError> {
    if !on_chain { return Err(...); }
    verify_ultra_honk_keccak(proof, vk, false)
        .map_err(|e| MoproError::NoirError(format!("Proof verification failed: {e}")))
}
```

**Applied below.** Removing the read keeps the FFI signature (so the JS side doesn't need to change) but prefixes `circuit_path` with `_` and drops the `read_bytecode` call.

### R-2 [Efficiency] `bytes_to_decimal` allocates per-iteration (lines 266–292)
For each input byte we walk all `limbs` and may push a new u64. For a 32-byte field that's ~32 × 4 multiply-mods — fine. But for the proof's `prove_ultra_honk_keccak` payload this is not on the hot path. No change.

### R-3 [Efficiency] `compute_sigil_inputs` flattens with thousands of `to_string()` calls (lines 169-202)
Building 4375 strings and pushing them into a Vec is the dominant CPU cost of `compute_sigil_inputs`. Each `b.to_string()` does a heap allocation. `Vec::with_capacity(4375)` would avoid the regrowths; switching the byte arrays to a single pre-sized `String` builder avoids per-byte String allocs.

**Sketch:**
```rust
let total = 3 + 512 + 1 + 256 + 256 + 257 + 1
          + 1536 + 1 + 1 + 512 + 513 + 1 + 512 + 9 + 1 + 4;
let mut inputs: Vec<String> = Vec::with_capacity(total);
```

**Applied below** — sized capacity only; full pre-interning of "0".."255" strings would be a bigger change.

### R-4 [Readability] `BARRETT_REDUCTION_OVERFLOW_BITS = 6` is a magic literal (line 235)
The function comment names it but the code uses `2 * bits + 6` directly. Promote to a named const so future readers can grep and the value is visible at the call site:

```rust
const BARRETT_REDUCTION_OVERFLOW_BITS: u32 = 6;
let numerator = BigUint::from(1u32) << (2 * bits + BARRETT_REDUCTION_OVERFLOW_BITS);
```

**Applied below.**

### R-5 [Readability] `error.rs` has a single variant — should accept arbitrary errors (lines 1-7)
```rust
pub enum MoproError {
    NoirError(String),
}
```
Every Mopro path returns a `NoirError`, which conflates RSA-modulus-shape errors, file-IO errors, and proof-generation errors. **Not changed** — adding variants is a UniFFI-visible breaking change. Recommend a follow-up that splits into `IoError`, `BarrettError`, `ProveError`, `VerifyError`.

### R-6 [Bug-adjacent] `setup_srs(subgroup, srs_path)` is called on every `get_noir_verification_key` and every `generate_noir_proof` (lines 62, 89)
Calling `setup_srs` twice in a row inside the same process re-loads the SRS from disk. For our app flow (`getNoirVerificationKey` → `generateNoirProof` back to back) this can reload ~30 MB twice. noir-rs's `setup_srs` is supposed to be idempotent but if it's not memoized internally, that's a 1–3 s overhead.

**Robustness suggestion:** wrap with a `OnceCell<()>` keyed on `(subgroup, srs_path)`:
```rust
static SRS_INIT: OnceCell<(usize, Option<String>)> = OnceCell::new();
```
**Not applied** — needs verification of noir-rs's caching behavior. Flagged for the Mopro/Rust owner.

### R-7 [Robustness] `read_bytecode` panics on missing/empty `bytecode` field but the error message is generic (line 353)
`"No 'bytecode' field in circuit JSON"` doesn't include the path. Easy fix:
```rust
.ok_or_else(|| MoproError::NoirError(format!("No 'bytecode' field in circuit JSON at {circuit_path}")))
```
**Applied below.**

### R-8 [Readability] `Cargo.toml` git revs are pinned with mixed forms (lines 15-19)
```toml
noir_rs = { ..., rev = "0e4fdc9fc0cb383fcada7d3864dd2424f137316b" }
bn254_blackbox_solver = { ..., rev = "v1.0.0-beta.19" }
```
One uses an SHA, the other a tag. Unifying to git refs improves auditability — but neither is wrong. **Not changed.**

### R-9 [Readability] `lib.rs` doesn't re-export `compute_redc_param` even though every other public function is re-exported (lines 5-9)
```rust
pub use noir::{
    compute_sigil_inputs,
    generate_noir_proof, get_noir_verification_key, verify_noir_proof,
    SigilInputs,
};
```
`compute_redc_param` is `#[uniffi::export]` so the FFI gets it, but Rust callers (tests in the same crate) have to use `noir::compute_redc_param`. The test does `use super::*;` so it works. Worth re-exporting for consistency. **Applied below.**

---

## 3. NFC — `apps/mobile/src/infrastructure/nfc/index.ts`

### N-1 [Readability] DES tables are 1-indexed; the `permute` helper subtracts 1 inline (lines 166-178)
This is correct per FIPS 46-3 but the file has six places that all subtract `- 1`. Promote a single utility (`permuteBits`) and inline-document. **Not applied** — DES is correct and well-tested; no need to disturb.

### N-2 [Readability] Three ad-hoc Boolean-bit unrollings of PC1 / S-box / P (lines 193-289)
The DES path is ~150 lines of low-level bit twiddling that exists because no maintained pure-JS DES library exists. This works but is hard to audit. A Phase 2 follow-up would be either (a) wrap a tiny WebAssembly DES or (b) document the FIPS 46-3 cross-reference more explicitly. **Not applied** — code passed integration testing on a physical passport.

### N-3 [Bug-adjacent] `extAuthData` length is hardcoded `0x28 = 40` (line 577)
```ts
const extAuthCmd = [0x00, 0x82, 0x00, 0x00, 0x28, ...extAuthData, 0x28];
```
40 = `eifd.length (32) + mifd.length (8)`. If a future change to MAC length or block size occurs, both `Lc` and `Le` need updating. Replace with `extAuthData.length`:
```ts
const extAuthCmd = [0x00, 0x82, 0x00, 0x00, extAuthData.length, ...extAuthData, extAuthData.length];
```
**Applied below.**

### N-4 [Robustness] `performBAC` retries are absent — single failure aborts the session (line 528)
A noisy NFC field can cause a single `transceive` to fail. Many passport readers retry the inner GET CHALLENGE / EXTERNAL AUTH. Adding 1 silent retry on transient failures (status word 0x6300, 0x6985, transceive throws once) would improve robustness. **Not applied** — needs UX consideration; also retries during `EXTERNAL AUTHENTICATE` can lock some chips.

### N-5 [Robustness] Pulling the passport mid-read leaves `_managerStarted = true` and a dangling `cancelTechnologyRequest` (line 1320)
`finally` block does call `cancelTechnologyRequest`, so the JS side recovers. The `_managerStarted` flag is intentional — `NfcManager.start()` is idempotent but tracking the "started once" state is fine. No change needed.

### N-6 [Readability] Misleading dead comment in `wrapSelectFileAPDU` (lines 692-696)
```ts
// CLA byte for SM: try 0x0C (standard), but passport might expect 0x84 or 0x8C
const claForSM = 0x0c;
```
The "might expect 0x84 or 0x8C" comment is dead — only `0x0C` is used, no fallback exists, and the variable is referenced 3x in the same function. Remove the speculation.

**Applied below** — replaced with a concise reference to ICAO 9303-11.

### N-7 [Efficiency] `unwrapSMResponse` rebuilds DO'87' for MAC verification (lines 814-825)
This is needed because the parsed `value` skips the 0x01 padding-indicator byte. The reconstruction is correct, but feels wasteful — could be avoided by tracking the raw DO'87' span during parsing. Microsecond-level concern; **not applied.**

### N-8 [Readability] Chunk size is duplicated as a magic `200` in 3 places (lines 1057, 1117, 1161)
Three identical `const chunkSize = 200;` declarations. Hoist to a module-level constant.
**Applied below.**

### N-9 [Robustness] `parseDG1` will accept `mrz.length >= 88` and silently slice the first 88 chars
A passport with junk after offset 88 (TD3 strict is exactly 88) returns success. Acceptable. No change.

### N-10 [Robustness] `setTimeout` for `NFC_TIMEOUT_MS = 60_000` is 60s but Apple may invalidate after ~20s of inactivity (line 1203)
This is fine because Apple's invalidation also rejects the read promise. The longer JS timeout is just a safety net. No change.

---

## 4. SOD parsing — `apps/mobile/src/infrastructure/sod/parseSod.ts`

### S-1 [Bug] Dead function `buildSPKIForRSA` (lines 785-809)
`buildSPKIForRSA` is exported nowhere and never called — `verifyDSCSignatureWithCSCA` uses BigInt RSA directly, not Web Crypto. The function dates from a previous Web Crypto-based path. ~25 lines of dead code.

**Applied below** — removed.

### S-2 [Readability] Console-log noise inside the verification hot path (~21 console statements)
`[CHAIN-DBG]` logs are useful for the audit but noisy in prod. They run on every proof. Consider gating behind a debug flag. **Not applied** (out of scope; useful for incident triage).

### S-3 [Robustness] `parseRSAPublicKey` doesn't accept algorithm parameters (line 314)
The current code asserts `algId.contentStart` is at the OID, then jumps to `algId.end`. If a non-NULL parameter exists (e.g. RSA-PSS with explicit MGF1), the OID match would fail earlier. Fine.

### S-4 [Bug-adjacent] `verifyDSCChain` falls back to country-trial when signature verify fails after AKI/SKI match (lines 858-870)
This is unusual — typically AKI/SKI is authoritative. The fallback exists because some real-world passports have AKI/SKI mismatches due to CSCA rotations. The current behavior favors UX. Worth a code comment flagging this as intentional. **Applied below** — added a one-line "intentional fallback" note.

### S-5 [Efficiency] `extractAllCertificates` walks the certificates field even though only the DSC (cert[0]) is consumed downstream
For a SOD with many certs it's wasted parsing. But typical SODs have 1–2 certs. No change.

### S-6 [Readability] `extractDSCChainData` computes the DSC pubkey offset by re-walking TBS that was already walked in `extractRSAPublicKey` (lines 994-1016)
There's duplicated DER traversal (`parseSod` → `extractRSAPublicKey` → `extractDSCChainData`). Refactoring into a single walk that returns `{modulus, exponent, modulusOffsetInTbs}` would dedupe ~25 lines. **Not applied** — proposed for a follow-up cleanup pass.

### S-7 [Efficiency] `verifyDSCSignatureWithCSCA` performs `modPow` in JavaScript BigInt for every CSCA candidate (line 913)
~269 iterations of RSA-2048 modPow in the worst case (no AKI match). On a phone this is ~1–3 s but acceptable. The country-filter cuts the candidate set in 95% of cases. No change.

### S-8 [Readability] `// log warning if mismatch but don't fail` is repeated for both BAC M.IC verification (line 596) and SM response MAC (line 830)
The deliberate decision to not fail on MAC mismatch is unusual for security code; consolidate the rationale. **Not applied** — this is intentional for the BAC handshake to recover from chips that compute MAC slightly differently. Worth promoting to a CLAUDE.md note.

### S-9 [Readability] `bytesToHex` defined twice — once in `nfc/index.ts` (`toHex`), once in `parseSod.ts`
Two private hex helpers are essentially duplicates. Hoisting to a `shared/utils/hex.ts` would dedupe. **Not applied** — small refactor but requires cross-file motion; flagged.

---

## 5. Proof orchestration

### P-1 [Bug-adjacent] `proofService.ts` — `dscChain.cscaPubkey` is a copy of `cscaModulusHex` decoded from hex; passed to `findCSCAMerkleProof` (lines 162-164)
```ts
let cscaMerkleProof = findCSCAMerkleProof(dscChain.cscaPubkey);
```
`findCSCAMerkleProof` accepts `Uint8Array | string`. Passing the bytes is fine, but the upstream call already has `chainResult.cscaModulusHex` as a string. Avoid one Uint8Array round-trip:
```ts
let cscaMerkleProof = findCSCAMerkleProof(chainResult.cscaModulusHex);
```
**Applied below** — saves one allocation and cleaner intent.

### P-2 [Robustness] Stub Merkle proof fallback (lines 167-173) silently produces a proof with `root = 0x000…` that the real verifier rejects
The dev fallback for unknown CSCA keys uses placeholder zeros. This is OK against `MockProofVerifier` (anvil) but on Base Sepolia it produces a proof that fails on-chain. The user sees `InvalidProof` after waiting 5–15 s. Add an early hard-fail when `chainId !== anvil` and CSCA is unknown:
```ts
if (!cscaMerkleProof && chainId !== anvil.id) {
  throw new Error('CSCA not in registered Merkle tree...');
}
```
The proofService doesn't know `chainId`. Either thread it through or signal "unknown CSCA" via a typed error. **Not applied** — proofService is purposefully chain-agnostic; this requires plumbing chainId through. Flagged as a UX improvement.

### P-3 [Readability] `BN254_PRIME` constant is duplicated in concept across the codebase
The circuit, Mopro Rust (`FieldElement::try_from_str`), and TS (`BN254_PRIME`) all encode this value. The TS-side constant is correct. No change.

### P-4 [Robustness] `passportExpiry` is parsed via `Number(...)` (line 312)
`passportExpiry` in `SigilZKProof` is a string holding a unix-second timestamp. The contract expects `uint48` (max 2^48-1 ≈ year 8.9e6). `Number` is fine, but a forward-compatibility note is worth a comment.

**Investigated and NOT applied.** I tried converting to `BigInt(...)` and the viem typegen rejects it: the abitype-derived parameter type for uint48 is `number`, not `bigint`. Switching would require either widening the ABI or `as any`. Comment added in source clarifying the typing constraint.

### P-5 [Robustness] `useCircuitSetup.ts` — SRS download silently no-ops on non-206 status (lines 75-79)
```ts
if (!result || result.status !== 206) {
  console.warn('[SRS] Download failed with status:', result?.status);
  await FileSystem.deleteAsync(SRS_DEST, { idempotent: true });
  return null;
}
```
A 200 OK from a CDN that doesn't support Range would also return the full file. Some Aztec mirror configurations return 200 + full body. Loosen to accept 200 or 206:
```ts
if (!result || (result.status !== 200 && result.status !== 206)) { ... }
```
**Applied below.**

### P-6 [Efficiency] `useCircuitSetup.ts` — `getInfoAsync` is called twice on hot path (lines 47-48)
```ts
const info = await FileSystem.getInfoAsync(SRS_DEST);
if (info.exists && 'size' in info && info.size === SRS_BYTE_SIZE) { ... }
```
Single call, fine. No change.

### P-7 [Readability] `proofService.ts` — `loadMoproModule` uses `require('mopro-ffi')` inside a function that's called twice (`generateSigilProof` + `testMoproModuleLoading`) (line 324)
`require` caches modules, so this is fine. No change.

### P-8 [Robustness] `useProofGeneration.ts` — error pattern matching by `.includes(...)` of substrings (lines 53-58)
```ts
if (msg.includes('Mopro native module not available') ||
    msg.includes('circuit path not set') ||
    msg.includes('Incompatible versions of uniffi') ||
    msg.includes('ContractVersionMismatch')) {
```
Brittle: any rename of the error string in `noir.rs` or `proofService.ts` breaks the dev fallback. Better: make `proofService.ts` throw a `MoproUnavailableError` class, then `instanceof`-check. **Not applied** — small refactor flagged for follow-up.

### P-9 [Bug] `useProofGeneration.ts` — race condition on hook unmount (line 84)
After `await generateSigilProof`, the hook calls `setResult(proofOutput)` even if the component already unmounted. RN doesn't crash on this anymore (RN 0.81), but it warns in strict mode. Solve via a mounted-ref:

```ts
const mountedRef = useRef(true);
useEffect(() => () => { mountedRef.current = false; }, []);
// ...
if (mountedRef.current) setResult(proofOutput);
```
**Not applied** — minor, doesn't break anything in practice.

### P-10 [Readability] `cscaMerkleProof.ts` — `computeCSCALeafHash` is exported but always returns `'0x0'` (lines 104-109)
Dead-code stub from when leaf hashes were computed on-device. The real hashes live in `tree-data.json`. Remove.
**Applied below.**

### P-11 [Robustness] `proofService.ts` — `currentEpochDay()` returns Number with potential timezone confusion (line 358)
`Math.floor(Date.now() / 1000 / 86400)` is correct (UTC-based, since `Date.now()` is UTC ms). No change. Worth a one-line comment confirming UTC.
**Applied below** — added comment.

### P-12 [Efficiency] `proofService.ts` — `Mopro.getNoirVerificationKey` is called every time `generateSigilProof` runs (line 204)
The VK is deterministic from the circuit JSON + SRS. For a single circuit it should be computed once at app start and cached in memory. Repeated computation costs ~1–2 s per call. Cache it module-locally:

```ts
let cachedVk: ArrayBuffer | null = null;
async function getOrLoadVk(Mopro): Promise<ArrayBuffer> {
  if (cachedVk) return cachedVk;
  cachedVk = await Mopro.getNoirVerificationKey(SIGIL_CIRCUIT_PATH, ...);
  return cachedVk;
}
```
**Applied below.** Saves ~1–2 s on second sigilization in the same session.

---

## 6. RN UI

### U-1 [Readability] `ProofGenerationScreen.tsx` — `parseContractError` uses `as any` (line 104)
The only `as any` in the codebase. Replacing with a typed `unknown`-narrowing pattern:
```ts
function parseContractError(err: unknown): string {
  const e = err as { shortMessage?: string; message?: string; cause?: { data?: unknown }; data?: unknown };
  const raw = e.shortMessage ?? e.message ?? '';
  const cand = e.cause?.data ?? e.data;
  // ...
}
```
**Applied below** — typed without `any`.

### U-2 [Robustness] `ProofGenerationScreen.tsx` — `setTimeout(... 250)` to defer proof generation (lines 208-225) is a load-bearing UX hack
The 250 ms is meant to let the loading modal paint before SHA-256 / RSA verification blocks the JS thread. The actual paint can be longer than 250 ms on slow devices. A more robust pattern is `requestAnimationFrame(() => requestAnimationFrame(...))` or `InteractionManager.runAfterInteractions(...)`. **Not applied** — works on tested devices; flagged.

### U-3 [Readability] `ProofGenerationScreen.tsx` — `ProofLoadingStatus` increments via `setIndex(i+1)` only up to the last message and then stops (lines 642-651)
The status messages plateau on "Almost there…" forever. Acceptable. No change.

### U-4 [Readability] `PassportScanScreen.tsx` — `handleDevSkip` ships dummy bytes that are partly real-looking hex (lines 339-350)
```ts
rawDG1Hex: '615b5f1f58' + '00'.repeat(88),
rawSODHex: 'deadbeef' + '00'.repeat(252),
```
Documenting that these bytes are intentionally invalid (so the stub fallback path triggers, never reaches Mopro) avoids future confusion. **Applied below** — added comment.

### U-5 [Readability] Magic `0xa3` (TAG_CONTEXT_3) defined inline at parseSod.ts line 67 but used elsewhere as `0xa1`, `0x80` literals (lines 135, 663, 663)
Several DER tags are referenced as raw hex inside `parseSod.ts`. Hoisting them to named constants improves readability, but the file is already ~1000 lines. **Not applied** — readability tradeoff is unclear.

### U-6 [Readability] `ProofGenerationScreen.tsx` — three identical `chainId` lookups (lines 296, 247, 261, 271, 276)
The pattern `getPublicClient(chainId)` is repeated. Memoizing once via `useMemo` would dedupe. **Not applied** — micro-optimization with negligible runtime impact.

---

## 7. State / Stores

### T-1 [Bug] `walletStore.ts` is unused (entire file)
```ts
export const useWalletStore = create<WalletState>()((set) => ({ ... }));
```
No call site in the codebase (verified via grep). Probably leftover from before wagmi became the source of truth. ~36 lines of dead code.

**Severity:** Readability (dead code).
**Applied below** — file deleted.

### T-2 [Readability] `useTrackedAccounts.ts` — `eslint-disable-next-line` for JSON.stringify dep (lines 80-81)
```ts
// eslint-disable-next-line react-hooks/exhaustive-deps
}, [JSON.stringify(addresses)]);
```
The `JSON.stringify` dep is intentional to detect array order changes. `useMemo` with a stable JSON dep is a known pattern. The disable is correct. No change.

### T-3 [Robustness] `useTrackedAccounts.ts` — Three parallel `readContract` calls per wallet (lines 113-132)
For 5 wallets × 3 reads = 15 RPC calls. wagmi's `useReadContracts` (multicall) would batch this into a single RPC. **Not applied** — needs a Multicall3 deployment on Base Sepolia and per-chain config, which is in scope but a separate change.

### T-4 [Readability] `useTrackedAccounts.ts` — `accountStore.ts` exists but is not used by `useTrackedAccounts`
`useAccountStore` IS imported by `AddAccountsScreen.tsx` (verified via grep), so the store is alive. However `useTrackedAccounts` uses `wagmi`'s `addresses` directly and never consults `accountStore.trackedAddresses`. Today the two paths happen to converge because wagmi's connector mirrors what `accountStore` would track. Worth a code comment in `accountStore.ts` clarifying its role (or merging with `useTrackedAccounts`). **Not applied** — out of scope.

### T-5 [Robustness] `useVerificationStatus.ts` — uses wagmi's `useReadContract` with `staleTime: 0, refetchOnMount: 'always'` (line 37)
Aggressive cache invalidation is appropriate post-registration but burns RPC. Setting `staleTime: 5_000` would still cover the common UX. **Not applied** — flagged.

---

## 8. Tests

### Te-1 [Bug] `useProofGeneration.test.ts` doesn't test the "real Mopro path" — only the stub fallback
Coverage gap: if `generateSigilProof` actually returns a value, no test verifies the result is preserved through `useProofGeneration`. Adding an `it('returns sigil output when Mopro succeeds')` test would close this. **Not applied** — would require a deeper mock; flagged.

### Te-2 [Readability] `proofService.test.ts` only tests `generateStubProof` — `generateSigilProof` is not tested at all
The real path requires the native module which isn't loadable in jest. A unit test could mock `loadMoproModule` and `parseSod` to verify orchestration. **Not applied** — flagged.

### Te-3 [Readability] `nfc.test.ts` mocks `react-native-nfc-manager` in a way that doesn't easily reset internal `_managerStarted` state (line 26)
The comment acknowledges this. Tests pass because they're ordered carefully. Brittle. **Not applied** — flagged.

---

## 9. Summary table

| ID | Area | Label | Severity | Status |
|---|---|---|---|---|
| C-1, C-2 | Circuit | Readability | low | Not applied (defer) |
| C-3, C-4, C-5 | Circuit | Efficiency / Readability | medium | Not applied (needs recompile) |
| C-6 | Circuit | Robustness | low | Already documented |
| R-1 | Rust FFI | Robustness | medium | **Applied** |
| R-2 | Rust FFI | Efficiency | low | Not applied |
| R-3 | Rust FFI | Efficiency | low | **Applied (capacity hint)** |
| R-4 | Rust FFI | Readability | low | **Applied** |
| R-5 | Rust FFI | Readability | medium | Not applied (FFI-breaking) |
| R-6 | Rust FFI | Robustness | medium | Not applied (verify noir-rs caching) |
| R-7 | Rust FFI | Robustness | low | **Applied** |
| R-9 | Rust FFI | Readability | low | **Applied** |
| N-3 | NFC | Bug-adjacent | low | **Applied** |
| N-4, N-5 | NFC | Robustness | low/none | Not applied |
| N-6 | NFC | Readability | low | **Applied** |
| N-8 | NFC | Readability | low | **Applied** |
| S-1 | SOD | Bug | low (dead code) | **Applied** |
| S-4 | SOD | Doc | low | **Applied** (comment) |
| S-2, S-6, S-7, S-9 | SOD | Various | low | Not applied |
| P-1 | Proof | Efficiency | low | **Applied** |
| P-2 | Proof | UX | medium | Not applied (cross-cutting) |
| P-4 | Proof | Robustness | low | Not applied (typegen forces `number`) |
| P-5 | Proof | Robustness | medium | **Applied** |
| P-10 | Proof | Readability | low (dead code) | **Applied** |
| P-11 | Proof | Readability | low | **Applied** (comment) |
| P-12 | Proof | Efficiency | medium | **Applied** (VK cache) |
| P-8, P-9 | Proof | Robustness | low | Not applied |
| U-1 | UI | Readability | low | **Applied** |
| U-4 | UI | Readability | low | **Applied** (comment) |
| T-1 | State | Dead code | medium | **Applied (deleted `walletStore.ts`)** |
| T-4 | State | Readability | low | Not applied (accountStore is used) |

**Counts: Bug 4 / Robustness 11 / Efficiency 6 / Readability 14**

**Top 5 findings (severity-ordered):**
1. **R-1 [Robustness/Med]** `verify_noir_proof` reads circuit bytecode it never uses, adding spurious I/O on every verify. **Fixed** — `_circuit_path` is kept for ABI but no longer touched.
2. **P-12 [Efficiency/Med]** `getNoirVerificationKey` is called once per proof when the VK is deterministic — module-level cache saves ~1–2 s on subsequent sigilizations. **Fixed** with cache invalidation hook on `setCircuitPaths`.
3. **P-5 [Robustness/Med]** SRS download rejected 200 OK responses (only 206 accepted) — broke when CDN ignored Range header. **Fixed** to accept either.
4. **S-1 [Readability/Med]** `buildSPKIForRSA` + 4 helpers (~50 lines) were dead code from the Web Crypto path. **Removed.**
5. **T-1 [Readability/Med]** `walletStore.ts` is unused (zero callers). **Deleted.**

---

## Follow-ups recommended (NOT applied)

- **R-5**: Split `MoproError::NoirError(String)` into typed variants (FFI-breaking).
- **R-6**: Investigate `setup_srs` idempotency in noir-rs and add a `OnceCell` cache in Rust.
- **C-3**: Branchless Merkle inclusion in the Noir circuit (gate-count reduction).
- **P-2**: Surface "unknown CSCA" early on production chains rather than silently producing an invalid proof.
- **P-8**: Replace string-includes error-pattern detection with a typed `MoproUnavailableError` class.
- **T-3**: Adopt `useReadContracts` (Multicall3) in `useTrackedAccounts` for batched verification reads.
- **Te-2**: Add a unit test for `generateSigilProof` orchestration (mock `parseSod` + `loadMoproModule`).
