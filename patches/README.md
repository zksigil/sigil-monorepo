# Patches

Dependencies patched at install time via pnpm's `patchedDependencies` (configured in
the root `package.json`). Each patch is pinned to a specific version — pnpm errors if
the installed version doesn't match, so version bumps will surface broken patches
loudly rather than silently no-op'ing.

## Active patches

### `react-native@0.81.5.patch`

Strips Flow's `opaque` keyword from four TurboModule spec files inside RN:

- `src/private/webapis/dom/nodes/specs/NativeDOM.js`
- `src/private/webapis/idlecallbacks/specs/NativeIdleCallbacks.js`
- `src/private/webapis/intersectionobserver/specs/NativeIntersectionObserver.js`
- `src/private/webapis/performance/specs/NativePerformance.js`

**Why:** without it, the bundling / TurboModule codegen pipeline fails on `opaque type X = Y`
declarations. `opaque` is Flow-only syntax and the toolchain in this app's setup doesn't
handle it cleanly. Removing the keyword leaves the type aliases functionally identical
for our purposes (we don't depend on the encapsulation that `opaque` provides).

**Retirement test:** on every RN bump (`apps/mobile/package.json`'s `react-native` version),
try `mv patches/react-native@*.patch /tmp/ && pnpm install && pnpm mobile`. If the build
succeeds, the patch is no longer needed — delete it and the corresponding entry in
`pnpm.patchedDependencies` of the root `package.json`. If it fails, restore the patch
and (if RN's version changed) regenerate it via `pnpm patch react-native@<new-version>`
+ `pnpm patch-commit`.

**Upstream:** worth filing a tracking issue against React Native (or the relevant
codegen tool) describing the exact downstream failure. We carry this patch only because
that fix isn't upstream yet.
