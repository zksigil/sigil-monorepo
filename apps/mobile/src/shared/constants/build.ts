/**
 * Build-time flag for dev-only code paths.
 *
 * `__DEV__` is a Metro/Hermes intrinsic: `true` in development bundles, `false`
 * in release/production bundles. Branches gated on `false` are dead-code
 * eliminated by the production minifier, so dev-only code (anvil chain,
 * skip-NFC buttons, stub proof fallback, placeholder CSCA Merkle proof) is
 * physically absent from the App Store bundle even though the source remains
 * in the repo for local testing.
 *
 * To temporarily enable dev paths in a Release Xcode build (e.g. to test
 * anvil from a physical device with the JS bundle baked in), flip this to
 * `true`.
 */
export const IS_DEV_BUILD: boolean = __DEV__;
