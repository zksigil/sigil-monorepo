#!/usr/bin/env node
/**
 * splice-zkmopro-verifier.mjs — Splices the zkmopro/aztec-packages ZK-Honk
 * verifier template over the template body produced by upstream `bb`.
 *
 * Why: the mobile prover links against zkmopro's BB fork
 * (`1.0.0-nightly.20250723`), which has `NUMBER_OF_ENTITIES = 41` and
 * `PROOF_SIZE = 508` — one more sumcheck evaluation than upstream. Upstream
 * `bb write_solidity_verifier` produces a 507-element verifier that rejects
 * zkmopro-format proofs with SumcheckFailed. Since zkmopro ships no CLI,
 * we reuse bb's header + VK library (VK bytes are version-invariant) and
 * splice in zkmopro's Solidity template.
 *
 * Input: bb-generated `<ContractName>.sol` (has VK library + upstream body)
 * Output: same path, rewritten with the zkmopro body and a renamed concrete
 *         contract that matches `bb`'s original contract name.
 *
 * Usage:
 *   node scripts/splice-zkmopro-verifier.mjs <generated.sol> <ContractName>
 */

import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const [generatedPath, contractName] = process.argv.slice(2);
if (!generatedPath || !contractName) {
  console.error('Usage: node splice-zkmopro-verifier.mjs <generated.sol> <ContractName>');
  process.exit(1);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const templatePath = join(__dirname, 'zkmopro-honk-zk.sol');

const src = readFileSync(generatedPath, 'utf8');
const template = readFileSync(templatePath, 'utf8');

// ── 1. Keep bb's header through the closing `}` of HonkVerificationKey library.
//     bb output structure:
//       // SPDX
//       pragma solidity >=0.8.21;
//
//       uint256 constant N = ...
//       uint256 constant LOG_N = ...
//       uint256 constant NUMBER_OF_PUBLIC_INPUTS = ...
//       library HonkVerificationKey {
//         ...
//       }
//       pragma solidity ^0.8.27;   <-- template body starts here (discard from here)
const headerMatch = src.match(/^([\s\S]*?library\s+HonkVerificationKey\s*\{[\s\S]*?\n\})\n/);
if (!headerMatch) {
  console.error('Could not locate HonkVerificationKey library in input');
  process.exit(1);
}
const header = headerMatch[1];

// ── 2. Patch zkmopro template:
//     - abstract `loadVerificationKey` must be `view virtual` so the concrete
//       override can be `view` (EXTCODECOPY is a view, not pure, operation —
//       see extract-vk.mjs).
//     - concrete `HonkVerifier` is renamed to the same name bb originally used.
const patchedTemplate = template
  .replace(
    /function\s+loadVerificationKey\(\)\s+internal\s+pure\s+virtual\s+returns\s*\(Honk\.VerificationKey\s+memory\)\s*;/,
    'function loadVerificationKey() internal view virtual returns (Honk.VerificationKey memory);'
  )
  .replace(
    /contract\s+HonkVerifier\s+is\s+BaseZKHonkVerifier/,
    `contract ${contractName} is BaseZKHonkVerifier`
  );

writeFileSync(generatedPath, header + '\n\n' + patchedTemplate);
console.log(`  ✅ ${generatedPath} — spliced with zkmopro body (${contractName})`);
