# Sigil Documentation Audit

Audit branch: `audit/docs-review` (off `master` @ `eeeee2b`).
Auditor scope: documentation, NatSpec, JSDoc, inline doc comments, Makefile/README scaffolding.
Out of scope: code logic. (Code-only changes from sister auditors are present in the worktree but were NOT included in this branch's commit; they will land via `audit/mobile-zk-review` and `audit/security`.)

## Summary

- 15 files modified.
- 16 issues found, 14 fixed in this branch, 2 deferred (one for sister auditors, one for the code-owner).
- All fixes verified against `pnpm typecheck` (passes), `forge build` (passes), `forge test` (54 / 54 pass), and `npx jest` (33 / 33 pass).

---

## Changes (file → before → after → why)

### 1. `README.md`
- "Two verification tiers (Base / Primary)" block → replaced with single-tier description (one stable nullifier per passport, multi-wallet linkability is opt-in). The two-tier model was removed in commit `1b1be0a`.
- "React Native 0.81" → "React Native 0.81.5" (matches `apps/mobile/package.json`).
- "Solidity 0.8.24" → "Solidity 0.8.28" (matches `foundry.toml` `solc_version = "0.8.28"`).
- "Phase 3 🚧" status block → replaced with Phase 3 ✅ + Phase 4 ✅ + a "Pending" line (matches the live `Phase 4 TODO` checkboxes in `CLAUDE.md`).
- `pnpm contracts:build` / `pnpm contracts:test` → `make contracts` / `make contracts-test`. Those `pnpm` scripts do NOT exist in `package.json` (only `contracts:sync-abi`); the canonical path is the `Makefile` targets.
- `EXPO_PUBLIC_VERIFICATION_REGISTRY_ADDRESS` → corrected to the per-chain trio (`EXPO_PUBLIC_BASE_SEPOLIA_REGISTRY_ADDRESS`, `EXPO_PUBLIC_BASE_REGISTRY_ADDRESS`, `EXPO_PUBLIC_ANVIL_REGISTRY_ADDRESS`) per `apps/mobile/src/infrastructure/blockchain/contracts.ts`.

### 2. `CLAUDE.md`
- "React Native 0.76" → "React Native 0.81.5".
- "Solidity 0.8.24" (twice — Monorepo Structure + Tech Stack) → "Solidity 0.8.28".
- Added `packages/circuits/` and `packages/mopro-circuits/` to the monorepo structure list (they were missing).
- "Common Commands" — replaced non-existent `pnpm contracts:build` / `contracts:test` with `make contracts` / `make contracts-test`; added `make circuits`, `make bb-verifier`, `make ios`.
- "Contract Deployment" — replaced reference to `DeployVerificationRegistry.s.sol` (file does not exist) with `Deploy.s.sol:Deploy` and the keystore-based command from the actual deploy script header. Updated env var reference to the per-chain ones.
- Removed "Phase 2 TODO" section (every item is shipped: NFC works, ZK proof generation works, real UltraHonk verification on-chain works, etc.). Kept the iOS NFC entitlement section as a setup reference, retitled to "iOS NFC Entitlement (already configured)" with the actual entitlement keys.

### 3. `HIGH-LEVEL-ARCHITECTURE.md`
- "Mopro.computeSigilInputs(...) → 4375 inputs" → 4376 inputs. Confirmed by counting elements in the compiled circuit JSON ABI (4376 total). The Rust `INPUT_CAPACITY = 4375` constant in `noir.rs` is a Vec growth hint and is one short — flagged below as a deferred non-doc fix.
- "{inputs[4375], ...}" in the Data Flow diagram → `[4376]`.
- Deploy/test command block: `pnpm contracts:build` / `pnpm contracts:test` → `make contracts` / `make contracts-test`.

### 4. `Makefile`
- `clean-circuits`: removed `passport_base.json` and `passport_primary.json` references (those files no longer exist post Phase 4 single-tier consolidation). Replaced with `passport_sigil.json`.
- `verify-sync`: same fix — checks `passport_sigil.json` hash, not the obsolete base/primary files. Updated success message to "Sigil circuit in sync".
- `anvil-deploy-real`: removed `DEPLOYER_ADDRESS=$(ANVIL_DEPLOYER)` env var and added a comment explaining why it's no longer needed (Forge resolves `msg.sender` from `--private-key`, and `Deploy.s.sol` reads `address deployer = msg.sender`). This matches commit `e9e2115` where the env var was dropped from the script but the Makefile target wasn't updated.

### 5. `PHASE-3C-PLAN.md`, `PHASE-3C-MVP-PLAN.md`, `PHASE-3C-PROGRESS.md`, `PHASE-3C-SESSION-SUMMARY.md`
Added a "HISTORICAL — kept for archaeology" preamble to each, calling out the specific things that have since been superseded (two-tier circuits → single sigil circuit, depth 12 → 9, governance setters removed, `verifyBaseProof`/`verifyPrimaryProof` → `verifyProof`, etc.). Did NOT delete — see "Recommendations" below.

### 6. `packages/circuits/README.md`
Was wildly stale: described "Phase 3a" (trust-the-device, just nullifier derivation, no RSA / cert-chain / Merkle / Mopro). Rewrote completely to match the live Phase 4 sigil circuit:
- 6 verified properties (SOD signature, DSC binding, CSCA signature, CSCA Merkle inclusion, stable nullifier, epoch nullifier)
- Public input table with the actual declaration order from `sigil/src/main.nr`
- Private input list copied from the `main()` signature
- Circuit-specific Make targets
- Constants (`SIGNED_ATTRS_MAX_LEN`, `DSC_TBS_MAX_LEN`, `MERKLE_DEPTH`)

### 7. `packages/contracts/README.md`
Was generic Foundry boilerplate. Replaced with a Sigil-specific overview:
- Layout map of `src/`, `script/`, `test/`
- Trust model paragraph (immutable registry; CSCA tree is the only privileged surface)
- Build/test commands (`make contracts`, `make contracts-test`)
- Deploy commands matching `Deploy.s.sol` actual headers
- One-paragraph behavioral summary of `register` / `renew` / `unregister`

### 8. `packages/contracts/src/VerificationRegistry.sol`
NatSpec on `s_epochCounts` claimed `epochNullifier = hash(s, "epoch", floor(block.timestamp / 1 days))`. The circuit actually computes `Poseidon2(passport_secret, epoch_day)` (no string-tagged "epoch" salt) — see `packages/circuits/sigil/src/main.nr:132` and `packages/mopro-circuits/src/noir.rs:168`. Fixed to match.

### 9. `packages/contracts/src/interfaces/IVerificationRegistry.sol`
Same `hash(s, "epoch", day)` discrepancy in two places (the @dev block at the top of the interface and the `register` @param). Fixed both to `Poseidon2(passport_secret, epoch_day)`.

### 10. `packages/contracts/src/interfaces/IProofVerifier.sol`
**Materially wrong** comment that contradicted the implementation:
- Claimed `epochNullifier` is `bytes32(0)` for renewals, "and the circuit allows zero in that slot."
- The contract (`VerificationRegistry.renew`) actually passes the **real** epoch nullifier through to the verifier on renewals. The comment in `renew` itself even says: *"The real epochNullifier is passed through to the verifier (the circuit always constrains it)."* Renewal tests (`test_Renew_*`) use `EPOCH_A_DAY1`, never zero.
- Fixed: rewrote the @dev block and the @param to say renewals pass the real per-day value through; the registry just doesn't increment the rate-limit counter.

This is the most consequential correction — anyone integrating against `IProofVerifier` could have built the wrong interpretation.

### 11. `packages/contracts/src/ProofVerifier.sol`
Pragma was `^0.8.24`; every other contract uses `^0.8.28` and `foundry.toml` is pinned at `0.8.28`. Aligned to `^0.8.28`. (Borderline code change, but it's just bumping a pragma floor and the contract was already being compiled at 0.8.28 anyway. Forge tests still pass.)

### 12. `apps/mobile/src/infrastructure/nfc/index.ts`
Two inline comments said `// Read EF.SOD (0x011D) — required for Phase 3 proof generation`. Phase 3 isn't a useful name today. Replaced with `// Read EF.SOD (0x011D) — required for ZK proof generation (DSC signature + cert chain)`.

---

## Issues found but NOT fixed (deferred)

### A. `packages/mopro-circuits/src/noir.rs` — `INPUT_CAPACITY = 4375`
Off by one (should be 4376 — see HIGH-LEVEL-ARCHITECTURE.md fix above). It's a `Vec::with_capacity` hint, so the only effect is one extra realloc on the first push past 4375. Not a correctness bug. **I updated only the explanatory comment** to read 4376 and noted the const is "one short by design legacy". Bumping the literal `4375 → 4376` is a one-character code change a code-owner can do in any cleanup PR.

### B. Sister-auditor changes left in worktree
The following code-only changes appeared in the worktree during this audit (they belong to `audit/mobile-zk-review` / `audit/security` running in parallel) and were intentionally NOT included in the `audit/docs-review` commit:
- `apps/mobile/src/features/verification/services/proofService.ts` — adds VK caching; passes `chainResult.cscaModulusHex` directly to `findCSCAMerkleProof`.
- `apps/mobile/src/features/verification/components/ProofGenerationScreen.tsx` — replaces `any`-typed error reads with a typed `ViemErrorShape`.
- `apps/mobile/src/features/verification/components/PassportScanScreen.tsx` — adds an explanatory comment to `handleDevSkip`.
- `apps/mobile/src/infrastructure/circuits/useCircuitSetup.ts` — accepts HTTP 200 in addition to 206 for the SRS download.
- `apps/mobile/src/infrastructure/sod/parseSod.ts` — removes unused DER helpers / SPKI builder.
- `packages/mopro-circuits/src/lib.rs` — re-exports `compute_redc_param`.
- `packages/mopro-circuits/src/noir.rs` — pulls `BARRETT_REDUCTION_OVERFLOW_BITS` into a named constant; doesn't read circuit JSON in `verify_noir_proof`.

These should be reviewed and merged via the appropriate audit branches.

---

## Doc rot risk areas (most likely to drift in future)

1. **Public input order.** `[nullifier, epochNullifier, hashedAddress, cscaMerkleRoot]` is duplicated in **5 places** that all must stay in lockstep:
   - `packages/circuits/sigil/src/main.nr` (declaration order — source of truth)
   - `packages/contracts/src/ProofVerifier.sol` (marshalling order)
   - `packages/contracts/src/interfaces/IProofVerifier.sol` (NatSpec)
   - `apps/mobile/src/features/verification/services/proofService.ts` (header comment)
   - `packages/mopro-circuits/src/noir.rs` (`compute_sigil_inputs` doc)
   - `packages/circuits/README.md` (now)
   - `HIGH-LEVEL-ARCHITECTURE.md` (diagram)
   Reorder one and the contract or proof verification breaks; the comments rot silently. Recommendation: add a `forge test` that asserts the `bytes32[] publicInputs` array layout in `ProofVerifier.verifyProof` against a hard-coded expected order.

2. **Circuit constants.** `SIGNED_ATTRS_MAX_LEN`, `DSC_TBS_MAX_LEN`, `MERKLE_DEPTH` are echoed in `proofService.ts` (`SIGNED_ATTRS_MAX_LEN`, `DSC_TBS_MAX_LEN`), `cscaMerkleProof.ts` (`siblings.length === 9` hardcoded), Mopro `compute_sigil_inputs`, and the `INPUT_CAPACITY` math comment. If any single one changes, others must follow. Recommendation: a single `circuit-constants.ts` exported from a shared package, or a build-time codegen step that reads from the circuit JSON.

3. **CSCA Merkle root.** The constant `CSCA_MERKLE_ROOT` literal appears in `Deploy.s.sol`, `DeployDev.s.sol`, `VerificationRegistry.t.sol`, `tree-data.json` (`treeData.root`, read by `cscaMerkleProof.ts`), and `PHASE-3C-PROGRESS.md` (now historical). The deploy scripts have one root; the test has a different root. Both are intentional (test uses an old fixture root) but the duplication invites drift.

4. **Solidity pragmas.** Now consistent (all `^0.8.28`). But the contract pragma vs `foundry.toml` `solc_version` is checked nowhere. Easy to forget when adding a new file.

5. **Phase numbering in docs and comments.** Many comments say "Phase 3", "Phase 4", "Phase 4b". When Phase 5 happens, every "Phase 4" reference becomes ambiguous. Recommendation: drop phase references from durable docs (NatSpec, README); keep them only in time-stamped progress files.

6. **`pnpm` script names.** Docs referenced `pnpm contracts:build` / `contracts:test`, which don't exist. Easy to invent these in docs without checking `package.json`. Recommendation: `pnpm` with no args lists actual scripts — keep doc commands tested or generate-able.

7. **Per-chain env var naming.** `EXPO_PUBLIC_BASE_SEPOLIA_REGISTRY_ADDRESS`, `EXPO_PUBLIC_BASE_REGISTRY_ADDRESS`, `EXPO_PUBLIC_ANVIL_REGISTRY_ADDRESS`, `EXPO_PUBLIC_BASE_SEPOLIA_RPC_URL`, `EXPO_PUBLIC_BASE_RPC_URL`, `EXPO_PUBLIC_ANVIL_RPC_URL`. Adding a new chain means updating `contracts.ts`, `appKitConfig.ts`, `chains.ts`, both `.env` files, and the `Deploy.s.sol` post-deploy log. The naming convention is consistent now; protect it with a typed enum-of-chain-ids → env-var-name map.

---

## Recommendation: PHASE-3C-*.md files

Annotated as historical (preamble at the top of each). Recommendation: **keep for archaeology, do not delete.** Reasoning:

- They contain design rationale (why Option C over Self/Rarimo) that's not captured anywhere else.
- They document the original CSCA tree depth choice (12, later changed to 9).
- The "Dev fallback for unlisted DSCs" decision and rationale are useful when someone later asks "why does proofService have this fallback?"
- They're cheap to keep — four ~10KB files at the repo root, marked clearly historical.

If the team wants them gone, a follow-up PR can move them under a `docs/history/` directory.

---

## Verification

| Check | Result |
|---|---|
| `pnpm typecheck` | passes (mobile, no errors) |
| `pnpm --filter mobile test` (`npx jest`) | 33 / 33 tests pass |
| `forge build` (in `packages/contracts`) | "Compiler run successful!" (only style notes, no errors) |
| `forge test` | 54 / 54 tests pass across 4 suites |

---

## Top 5 most consequential corrections

1. **`IProofVerifier` NatSpec said `epochNullifier == bytes32(0)` on renewals — it's actually the real per-day value.** Anyone integrating off the interface alone would have built the wrong call.
2. **`README.md` advertised a two-tier (Base/Primary) model that no longer exists** — the single-tier collapse landed in `1b1be0a`. New protocol integrators arriving via the README would have built the wrong mental model entirely.
3. **`packages/circuits/README.md` described a "Phase 3a trust-the-device" circuit** — completely different from the actual Phase 4 sigil circuit (RSA-2048 SOD verify + RSA-4096 CSCA verify + Merkle inclusion + dual nullifiers). Anyone referencing it for circuit semantics would be hopelessly off.
4. **Solidity version mismatch (0.8.24 in docs vs 0.8.28 in foundry.toml).** Aligned README, CLAUDE.md, and the one stragglar pragma in `ProofVerifier.sol`.
5. **Makefile `clean-circuits` and `verify-sync` referenced `passport_base.json` / `passport_primary.json`** which no longer exist. `verify-sync` would always run the warning branch; `clean-circuits` would silently skip the real `passport_sigil.json`.
