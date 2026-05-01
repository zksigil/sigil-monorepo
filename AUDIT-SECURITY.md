# Sigil Smart Contract Security Audit

**Auditor:** Security Auditor (3-person audit team)
**Branch:** `audit/security-review`
**Scope:** Web3 / Solidity audit of the immutable Sigil registry, with emphasis on
information leaks and manipulation/abuse vectors. Mainnet deployment readiness.
**Files in scope (priority order):**

1. `packages/contracts/src/VerificationRegistry.sol`
2. `packages/contracts/src/CSCAMerkleTree.sol`
3. `packages/contracts/src/ProofVerifier.sol`
4. `packages/contracts/src/interfaces/*.sol`
5. `packages/contracts/script/Deploy.s.sol` and `DeployDev.s.sol`
6. `packages/contracts/test/*.t.sol`
7. `apps/mobile/src/features/verification/services/proofService.ts`
8. `apps/mobile/src/infrastructure/blockchain/contracts.ts`, `contractAbis.ts`
9. `apps/mobile/src/features/verification/components/ProofGenerationScreen.tsx`,
   `useProofGeneration.ts`

The auto-generated `verifiers/SigilUltraHonkVerifier.sol` was sanity-checked as a
wrapper consumer only (not deeply audited per scope).

`packages/circuits/sigil/src/main.nr` was read for the public-input contract
between circuit and on-chain verifier — the rate-limit finding hinges on it.

---

## Summary of Findings

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 1 |
| Medium | 2 |
| Low | 4 |
| Info | 6 |

The contract architecture is overall sound: state-machine logic in
`VerificationRegistry` is correct, immutability is enforced cleanly, and the
cryptographic primitives are wired through correctly. The single biggest finding
is that the documented "10 registrations per passport per day" rate limit is
trivially circumventable on-chain due to a circuit/contract binding gap (see
**H-1**). The other findings are governance/UX/observability issues that do not
threaten funds but matter for a live mainnet deployment.

---

## High

### H-1. Daily rate limit can be bypassed: `epoch_day` is unconstrained against on-chain time

- **Location:**
  - `packages/contracts/src/VerificationRegistry.sol:133-175` (`register`)
  - `packages/circuits/sigil/src/main.nr:36, 132-133` (`epoch_day` private input)
- **Severity:** High
- **Description:**

  The system documents (CLAUDE.md, `IVerificationRegistry` NatSpec) the rate
  limit as **"max 10 new registrations per passport per day"**, and the contract
  enforces `s_epochCounts[epochNullifier] < i_maxDailyRegistrations` per
  registration. The intended binding is:

  > `epochNullifier = Poseidon2(passport_secret, epoch_day)`, where
  > `epoch_day = floor(block.timestamp / 1 days)`.

  The Noir circuit constrains `epoch_nullifier == Poseidon2(passport_secret,
  epoch_day)` (main.nr:132) — but `epoch_day` is a **private** input and is
  **never bound to on-chain time**. The on-chain registry treats
  `epochNullifier` as a free-form `bytes32` per-bucket counter; there is no
  contract-side constraint that the supplied `epochNullifier` corresponds to
  today's `floor(block.timestamp / 1 days)`.

  As a consequence, a holder of a passport secret (legitimate user, or an
  attacker with a stolen passport) can compute any number of distinct
  `epoch_nullifier` values by feeding **any value** for `epoch_day` (negative,
  far future, randomized, etc.). Each unique `epochNullifier` gets its own
  fresh `s_epochCounts` slot, each allowing up to `MAX_DAILY` registrations.

- **Impact:**

  The "daily" rate limit is in practice **per arbitrary epoch bucket**, so the
  effective per-passport-per-day cap is unbounded. A stolen passport can be
  used to mass-sigilize wallets at the rate of `MAX_DAILY × N` per real day
  (where N = how many distinct `epoch_nullifier` proofs the attacker has
  prepared). With current defaults that's `10 × N`. The only practical limit
  is per-proof generation cost (~5–15s on a phone, much faster on a server
  with parallelism), and the per-tx gas cost of UltraHonk verification.

  This breaks the rate-limit guarantee that's surfaced in product copy,
  documentation, and audit memory.

- **Recommendation:**

  The contract must constrain `epochNullifier` to be tied to a canonical,
  block-derived day value. Two viable shapes:

  1. **Public epoch_day input.** Make `epoch_day` a public circuit input;
     have the circuit constrain `epoch_nullifier == Poseidon2(s, epoch_day)`
     as today, but additionally have the contract pass the on-chain-derived
     `floor(block.timestamp / 1 days)` as that public input. The contract
     then accepts the proof only if the passed `epoch_day` is within an
     allowed window (today, today-1 to forgive small clock skew). This
     requires a circuit redeploy.

  2. **Bind via a published "epoch root."** Have the contract publish the
     current `epoch_day` derivation function and require the proof to
     include `block.timestamp / 1 days` as a public input (call it
     `epoch_day_pub`). Reject the registration unless
     `block.timestamp / 1 days == epoch_day_pub` (or within ±1).

  Either way, the contract MUST get to verify that the proof's epoch_day
  matches today's UTC day. Today the contract has no such check.

  As a partial mitigation that does NOT require a circuit change, the
  contract could lower `MAX_DAILY_REGISTRATIONS` to `1` until the binding
  is fixed, so even the unbounded-bucket attack still yields ≤ 1 wallet per
  proof. (At 5–15s/proof on-device that's at least back to ≤ 17,280
  wallets/day per attacker — better than today's effectively unbounded, but
  still insufficient.)

  Until this is addressed, do not market the "daily cap" as a sybil
  defense — it isn't one.

---

## Medium

### M-1. `IProofVerifier` NatSpec lies about renewal semantics; on-chain behavior is correct but undocumented

- **Location:**
  - `packages/contracts/src/interfaces/IProofVerifier.sol:14-16`
  - `packages/contracts/src/VerificationRegistry.sol:178-200` (`renew`)
- **Severity:** Medium
- **Description:**

  `IProofVerifier`'s NatSpec states:

  > `epochNullifier` is `bytes32(0)` for renewals — the contract skips daily
  > rate limiting on renewals, and the circuit allows zero in that slot.

  This is **factually wrong**. The actual `VerificationRegistry.renew()`
  forwards the user-supplied `epochNullifier` straight through to
  `i_verifier.verifyProof(...)` (line 194), and the circuit (main.nr:132)
  always constrains `epoch_nullifier == Poseidon2(s, epoch_day)`. A zero
  passed in would (with overwhelming probability) make the proof reject.

  The behavior in the registry is correct (the comment on lines 192–193 says
  so explicitly). It's only the interface NatSpec that is stale and
  contradictory.

- **Impact:**

  Integrators reading the interface (the recommended ABI surface) are told
  to pass `bytes32(0)` for renewals. If they followed that, every renewal
  call would revert with `InvalidProof`. Worse, for a future verifier that
  somehow accepted zero, the documented behavior would become
  exploitable — a renewal could submit a synthetic null nullifier that
  bypasses the circuit's secret binding.

- **Recommendation:**

  Update `IProofVerifier`'s NatSpec to describe the actual semantics: the
  real `epochNullifier` is required for both register and renew; the only
  difference is that the contract counts towards the daily cap on register
  but not on renew. (See the small fix applied on this branch.)

### M-2. CSCA Merkle root rotation can grief in-flight registrations; no grace window

- **Location:**
  - `packages/contracts/src/CSCAMerkleTree.sol:65-67` (`setRoot`)
  - `packages/contracts/src/VerificationRegistry.sol:148, 194`
    (registry reads root inline)
- **Severity:** Medium
- **Description:**

  Both `register` and `renew` read `i_cscaMerkleTree.getRoot()` on every call
  and pass that value to the verifier. The Fiat-Shamir transcript binds the
  proof to the root that was current when the proof was generated. So if the
  CSCA owner calls `setRoot(R2)` while a user's `register(... proof_against_R1)`
  is in the mempool / awaiting confirmation, the user's tx executes against
  R2, fails verification, and the user loses gas (UltraHonk verification is
  expensive — north of 1M gas).

  More concretely: an owner with malicious or compromised intent can grief
  users by repeatedly rotating the root; a careless owner doing a legitimate
  ICAO Master List update can incidentally invalidate every in-flight proof
  that was generated within the last few seconds.

  There is no "valid roots" set, no grace period, and no ring buffer of the
  last N roots.

- **Impact:**

  - DoS / gas-griefing of legitimate users.
  - Production rotation events become a service-affecting operation rather
    than a routine update.
  - For a malicious owner, an adversarial root rotation gives them a soft
    pause + DoS without any registry-side governance interface.

- **Recommendation:**

  Add a small ring buffer of the last K roots (e.g. K=2 or K=3, with a TTL
  per entry like 10–30 minutes after the rotation). Accept a proof if the
  proof's root matches any active root. This is a contract-side change,
  invisible to the circuit. Implementation sketch:

  ```solidity
  // Read either the current root or the previous one if it's still in grace.
  bytes32 currentRoot = i_cscaMerkleTree.getRoot();
  // Caller-supplied claimed root that the proof was built against:
  bytes32 claimedRoot = ...;
  require(
      claimedRoot == currentRoot ||
      (claimedRoot == previousRoot && block.timestamp <= grace),
      "InvalidRoot"
  );
  // pass claimedRoot to i_verifier.verifyProof
  ```

  Alternatively, add an additional argument `claimedRoot` to register/renew
  and have the registry assert it matches (current or recent) before
  forwarding. Either way: the goal is to prevent owner-driven grief.

  At minimum, consider adding a `pendingRootEffectiveAt` timer in
  `CSCAMerkleTree` so root changes have a known activation delay. Even a
  10-minute delay would be enough for users to notice and re-prove.

---

## Low

### L-1. `register()` re-registration after expiry consumes a rate-limit slot, but `renew()` does not — different semantic on the same end-state

- **Location:** `packages/contracts/src/VerificationRegistry.sol:143-175`,
  `:178-200`
- **Severity:** Low
- **Description:**

  After a registration's TTL expires, the user can recover liveness via either
  `register()` (consumes a rate-limit slot, all eviction logic runs) or
  `renew()` (no rate-limit consumption, only `expiresAt` is updated). When the
  nullifier is the same, the end-state is identical, but the rate-limit
  bookkeeping diverges. This isn't exploitable, but it's a dual-API surface
  for the same intent that integrators may not realize exists.

- **Impact:** Inconsistent observability of rate-limit consumption.
  An off-chain monitor that watches "passport X has used N of MAX_DAILY today"
  can be desynced by users who renew expired registrations rather than
  re-register them.

- **Recommendation:** Document this clearly in the registry NatSpec. Or
  collapse the two paths: have `register()` route to renew-semantics when the
  caller already has an entry with the same nullifier (regardless of expiry).
  Behavior change, so weigh against existing deployment.

### L-2. `s_nullifierByWallet` is `public` while peer mappings are `private`, with no documented rationale

- **Location:** `packages/contracts/src/VerificationRegistry.sol:85`
- **Severity:** Low
- **Description:**

  `s_nullifierByWallet` is declared `public`, exposing an auto-generated
  getter `s_nullifierByWallet(bytes32 hashedAddress) returns (bytes32)`.
  The contract also exposes `nullifierOf(address)` (which internally hashes
  the address) for the same purpose. The other registration mappings
  (`s_registrations`, `s_walletsByNullifier`, `s_walletIndex`,
  `s_epochCounts`) are all `private`.

  No real privacy is leaked — `keccak256(abi.encodePacked(wallet))` is
  trivially computable from a wallet address and `nullifierOf()` provides
  the same data. But the inconsistency creates two ABI surfaces for the
  same lookup, increases bytecode size, and makes future refactors more
  error-prone (a developer changing the storage layout has to remember
  this is part of the public ABI).

- **Impact:** Negligible; redundant external surface.

- **Recommendation:** Make `s_nullifierByWallet` `private` and rely on
  `nullifierOf()` only. (Note: this is an ABI change — not safe to apply
  to an already-deployed mainnet contract; for any redeployment, prefer
  the consistent shape.)

### L-3. `CSCAMerkleTree.setRoot` accepts `bytes32(0)`, allowing the owner to soft-pause the system

- **Location:** `packages/contracts/src/CSCAMerkleTree.sol:65-67`
- **Severity:** Low
- **Description:**

  `setRoot` does not validate that `newRoot != bytes32(0)`. The owner can
  set the root to zero, which makes every new proof fail (the circuit
  constrains `computed_root == csca_merkle_root`, and the CSCA leaves
  hash to non-zero values). Existing registrations are unaffected
  (`isVerified` does not re-verify the root), so this is not catastrophic,
  but it's a soft-pause power that is not documented as part of the trust
  model.

- **Impact:** Owner can DoS new registrations indefinitely until they
  set a non-zero root. Combined with **M-2**, this effectively gives the
  CSCA owner a pause switch over the registry.

- **Recommendation:**
  - Add `require(newRoot != bytes32(0), "InvalidRoot")` to `_setRoot`.
  - Document the soft-pause power in the trust model section of CLAUDE.md
    if the zero-check is intentionally omitted.

### L-4. `getWallets(nullifier)` returns an unbounded `address[]`; on-chain consumers can be gas-griefed by a user with many wallets

- **Location:** `packages/contracts/src/VerificationRegistry.sol:240-242`
- **Severity:** Low
- **Description:**

  `getWallets` returns the full wallet array under a nullifier. The array is
  bounded only by total registrations under that passport. With **H-1**
  unfixed, an attacker can effectively spam this array with hundreds of
  entries; even without H-1, the array grows monotonically until the user
  unregisters (expiry alone does not remove from the array).

  If any **on-chain** consumer ever iterates this array (e.g. for "give a
  reward to all sigilized wallets of a passport"), they are exposed to
  unbounded gas usage and possible OOG.

- **Impact:** DoS surface for any contract that calls `getWallets()` on-chain.

- **Recommendation:**
  - Document explicitly that `getWallets` is intended for off-chain use.
  - If on-chain enumeration is a likely use case, add a paginated variant:
    `getWallets(bytes32 nullifier, uint256 start, uint256 limit)`.
  - Optionally, prune expired registrations from the array (would change
    semantics — currently the array intentionally includes expired entries).

---

## Info

### I-1. `IProofVerifier.verifyProof` declared `view`; reentrancy via verifier is impossible by EVM construction, but `nonReentrant` is still useful belt-and-suspenders

- **Location:** `packages/contracts/src/interfaces/IProofVerifier.sol:25-31`,
  `VerificationRegistry.sol:138, 183, 203`
- **Description:** `external view` calls compile to `STATICCALL`, which the
  EVM enforces as state-pure. So even a malicious `IProofVerifier`
  implementation cannot reenter the registry. The `nonReentrant` modifier
  on `register/renew/unregister` therefore guards against future interface
  changes more than current attack surface. No action needed; just noting
  the assumption is sound.

### I-2. Hashed-address binding to `msg.sender` relies on Fiat-Shamir, not an in-circuit constraint

- **Location:**
  - `packages/circuits/sigil/src/main.nr:136` (`let _ = hashed_address;`)
  - `packages/contracts/src/ProofVerifier.sol:39` (mod-p reduction)
  - `packages/contracts/src/VerificationRegistry.sol:139, 184`
    (`hashedAddress = keccak256(abi.encodePacked(msg.sender))`)
- **Description:** The circuit does not constrain `hashed_address` to any
  derived value — it only consumes it as a public input. The proof's binding
  to a specific `msg.sender` is therefore enforced exclusively by the
  Fiat-Shamir transcript: changing the public input invalidates the
  challenge sequence, so the proof would fail Sumcheck/Shplemini.

  This is a known sound pattern, but it's fragile — anyone modifying the
  generated UltraHonk verifier or the transcript hashing must be aware that
  the proof–wallet binding is downstream of transcript correctness, not an
  explicit equality assertion. The current verifier (bb 4.2.0-aztecnr-rc.2)
  hashes public inputs into the transcript, so the binding holds. This is
  also called out in `memory/project_audit_findings.md` as a previously
  acknowledged design choice.

  **Recommendation:** Add a regression-test that re-uses a valid proof for
  the same passport but a **different** `msg.sender` and asserts revert with
  `InvalidProof`. Currently the test suite does not directly cover this
  with a real verifier (`ProofVerifier.t.sol` is only a stub).

### I-3. `MockProofVerifier` is publicly mutable and is bundled in the contracts package

- **Location:** `packages/contracts/test/mocks/MockProofVerifier.sol`,
  `packages/contracts/script/DeployDev.s.sol`
- **Description:** `MockProofVerifier` exposes `setReject(bool)` and
  `setShouldRevert(bool)` with **no access control**. Anyone can flip these.
  This is fine for tests on Foundry / anvil. The risk is operator error: if
  someone runs `DeployDev.s.sol` against a public network instead of anvil
  (it accepts a private-key flag and chain-agnostic RPC), real users could
  end up registering against a no-op verifier.

  **Recommendation:**
  - Move `MockProofVerifier` into `test/` only and exclude it from any
    `script/` deploy path that targets non-local networks. The current
    `DeployDev.s.sol` references it from `test/mocks/`, which forge-build
    happens to allow but is unusual structurally.
  - Add a `require(block.chainid == 31337, "anvil only")` guard to
    `DeployDev.s.sol:run()` so this script cannot be run against any
    public chain by accident.

### I-4. Stub-proof fallback in mobile client computes a deterministic nullifier from passport bytes via keccak256

- **Location:**
  - `apps/mobile/src/features/verification/services/proofService.ts:277-297`
  - `apps/mobile/src/features/verification/hooks/useProofGeneration.ts:46-82`
- **Description:** When the Mopro native module fails to load with one of
  four known module-loading errors, the hook silently falls back to
  `generateStubProof`, which computes
  `passportNullifier = keccak256(DG1 || SOD)` and submits an all-zero proof.
  Against the real `ProofVerifier` (UltraHonk), this proof will be rejected.
  Against `MockProofVerifier`, it will be accepted, which means the on-chain
  nullifier ends up as `keccak256(DG1 || SOD)`.

  **Why this matters in dev/prod confusion:**
  - If a production build accidentally points at a registry deployed with
    `MockProofVerifier` (see I-3), the user's nullifier is now
    `keccak256(DG1 || SOD)`, which an attacker who later obtains the user's
    DG1/SOD bytes can recompute deterministically — so the nullifier is no
    longer ZK-protected.
  - The fallback path also still ships in production binaries; while the
    error-string heuristic is unlikely to match in production, it's a code
    path that survives if the prod Mopro binary is removed during a build
    accident.

  **Recommendation:**
  - Gate `generateStubProof` behind `process.env.NODE_ENV !== 'production'`
    or a `__DEV__` flag and have it `throw` on production builds.
  - Or remove the fallback entirely and treat module-load failure as a
    hard error.

### I-5. `WalletVerified` event is emitted on every register call (including same-nullifier re-registration after expiry), but never on renew or unregister — minor observability mismatch

- **Location:** `packages/contracts/src/VerificationRegistry.sol:174`
- **Description:**
  - `register()` emits `WalletVerified` even when this is the second-or-later
    registration of the same wallet under the same nullifier.
  - `renew()` does not emit anything, despite extending `expiresAt`.
  - `unregister()` does not emit (intentional per privacy comment).

  This is mostly a UX issue for off-chain indexers — they cannot reliably
  distinguish "first sigilization of this wallet" from "subsequent
  re-registration after expiry" purely from events. They have to call
  `getRegisteredAt` to disambiguate.

  Renewal silence also means an indexer cannot keep an accurate
  `expiresAt` timestamp from event data alone — they must poll.

  **Recommendation:** Either emit a separate `WalletRenewed` event from
  `renew()`, or document the event semantics explicitly. Keep
  `unregister()` silent (privacy requirement).

### I-6. Pragma drift between `ProofVerifier.sol` (`^0.8.24`) and the rest of the codebase (`^0.8.28`)

- **Location:** `packages/contracts/src/ProofVerifier.sol:2`
- **Description:** All other in-scope contracts use `pragma solidity ^0.8.28`
  while `ProofVerifier.sol` uses `^0.8.24`. The repo's `foundry.toml` pins
  `solc_version = "0.8.28"`, so deployments are uniform — but a downstream
  consumer importing `ProofVerifier.sol` could end up compiling it against
  0.8.24 with subtle codegen differences (immutables in 0.8.27+ have a
  bytecode storage tweak via `MCOPY` etc.).

  **Recommendation:** Tighten to `pragma solidity ^0.8.28` for consistency.
  (Applied as a small fix on this branch.)

---

## Previously documented in `memory/project_audit_findings.md` (referenced for completeness)

These findings exist in repository memory and are intentionally accepted or
already mitigated; flagging them here only so the auditor's report is
self-contained:

- **Merkle depth = 9 (512 leaves)** is sufficient for current ICAO ML cert
  count (~269) but leaves limited headroom. Acceptable; trade-off documented.
- **`hashed_address` is unconstrained inside the circuit; binding via
  Fiat-Shamir.** See I-2 above.
- **`redc_param` witness risk** — `noir-bignum` Barrett reduction overflow
  bits changed between v0.7 and v0.9; current circuit pins `v0.9.2`. The
  client-side `Mopro.computeRedcParam` is trusted; if it produced a wrong
  redc, the circuit would mis-verify RSA. Mitigation: that redc is consumed
  inside the circuit's verified RSA path, so a wrong redc would just yield
  an invalid proof (verifier rejects).
- **UltraHonk verifier contract size** is close to the 24,576-byte EIP-170
  cap. `optimizer_runs = 1` and `via_ir = false` are mandatory; documented
  in CLAUDE.md.

---

## Test coverage gaps

While running `forge test`, all 54 tests pass. But the following coverage
gaps are worth filling:

1. **No test for the rate-limit bypass attack (H-1).** Add a test that
   computes proofs against `MAX_DAILY × 100` distinct fake `epochNullifier`
   values and verifies that `s_walletsByNullifier[nullifier].length` grows
   to `MAX_DAILY × 100`.
2. **No test for proof-binding via `msg.sender` against the real verifier.**
   `ProofVerifier.t.sol` is currently a stub. Re-enable it with a real
   proof generated against the unified circuit, then add a test that
   reuses the same proof with a different sender and asserts revert.
3. **No test for `_cappedExpiry` boundary at `passportExpiry > type(uint48).max - QUARTER + 1`.**
   The fallback branch in `_cappedExpiry` is uncovered.
4. **No test for re-registration after multi-cycle nullifier change**
   (A → B → A → B → A) to confirm the wallet array remains sound.
5. **No test for `register()` rate-limit increment isolation when proof is
   rejected** — the increment must NOT happen on revert. Should be obvious
   from the code (revert before `count + 1`), but tests should pin it.
6. **No test for CSCA owner setting root to `bytes32(0)`** (related to L-3).

---

## Small fixes applied on this branch

The following non-architectural fixes were applied directly:

1. `IProofVerifier.sol`: corrected the stale NatSpec describing renewal
   semantics (M-1).
2. `ProofVerifier.sol`: tightened pragma to `^0.8.28` for consistency (I-6).

No state-machine, ABI, or storage-layout changes were made. All forge tests
continue to pass after the fixes.
