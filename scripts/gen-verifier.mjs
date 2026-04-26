#!/usr/bin/env node
/**
 * gen-verifier.mjs — Build a thin VK-embedding verifier contract from
 * `bb write_solidity_verifier` output.
 *
 * Usage:
 *   node scripts/gen-verifier.mjs <bb_output_dir> <ContractName> <outFile>
 *
 * Example:
 *   node scripts/gen-verifier.mjs /tmp/bb-out-base BaseUltraHonkVerifier \
 *     packages/contracts/src/verifiers/BaseUltraHonkVerifier.sol
 *
 * Inputs (in <bb_output_dir>):
 *   Verifier.sol   — bb write_solidity_verifier output (single concatenated file)
 *
 * Output:
 *   <outFile>      — contract that imports HonkVerifierShared.sol, embeds the VK
 *                    in a literal struct, and exposes the bb-generated UltraHonk verifier.
 *
 * The body of the verifier (Honk types, Fr, FrLib, ZKTranscriptLib, RelationsLib,
 * etc.) is shared across both Base and Primary verifiers and lives in
 * `packages/contracts/src/verifiers/HonkVerifierShared.sol`.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';

const args = process.argv.slice(2);
if (args.length !== 3) {
  console.error('Usage: gen-verifier.mjs <bb_output_dir> <ContractName> <outFile>');
  process.exit(1);
}
const [bbDir, contractName, outFile] = args;

const verifierSol = readFileSync(join(bbDir, 'Verifier.sol'), 'utf8');

// bb's Verifier.sol has two sections separated by a second `pragma`:
//   Section A: VK constants + library HonkVerificationKey { loadVerificationKey() }
//   Section B: shared Fr/Honk/transcript/relations/Honk verifier (lives in HonkVerifierShared.sol)
const firstPragma = verifierSol.indexOf('pragma solidity');
const splitIdx = verifierSol.indexOf('\npragma solidity', firstPragma + 1);
if (splitIdx < 0) {
  console.error('Could not find second pragma in', join(bbDir, 'Verifier.sol'));
  process.exit(1);
}
const headerSection = verifierSol.slice(0, splitIdx);

// Pull out the four constants (N, LOG_N, NUMBER_OF_PUBLIC_INPUTS, VK_HASH).
const constMatch = (name) => {
  const m = headerSection.match(new RegExp(`uint256 constant ${name} = ([^;]+);`));
  if (!m) {
    console.error(`Could not find constant ${name}`);
    process.exit(1);
  }
  return m[1].trim();
};
const N = constMatch('N');
const LOG_N = constMatch('LOG_N');
const NUM_PUB = constMatch('NUMBER_OF_PUBLIC_INPUTS');
const VK_HASH = constMatch('VK_HASH');

// Extract the HonkVerificationKey library body and rename to <Prefix>HonkVerificationKey.
const libMatch = headerSection.match(/library HonkVerificationKey \{[\s\S]*?\n\}\n?/);
if (!libMatch) {
  console.error('Could not find HonkVerificationKey library in bb output');
  process.exit(1);
}
const prefix = contractName.replace(/UltraHonkVerifier$/, '');
const libRenamed = libMatch[0]
  .replace('library HonkVerificationKey', `library ${prefix}HonkVerificationKey`)
  .replace(/[ \t]+$/gm, '');

const out = `// SPDX-License-Identifier: Apache-2.0
// Copyright 2022 Aztec
pragma solidity ^0.8.27;

import {Honk, BaseZKHonkVerifier} from "./HonkVerifierShared.sol";

uint256 constant N = ${N};
uint256 constant LOG_N = ${LOG_N};
uint256 constant NUMBER_OF_PUBLIC_INPUTS = ${NUM_PUB};
uint256 constant VK_HASH = ${VK_HASH};

${libRenamed.trim()}

contract ${contractName} is BaseZKHonkVerifier(N, LOG_N, VK_HASH, NUMBER_OF_PUBLIC_INPUTS) {
    function loadVerificationKey() internal pure override returns (Honk.VerificationKey memory) {
        return ${prefix}HonkVerificationKey.loadVerificationKey();
    }
}
`;

writeFileSync(outFile, out);
console.log(`✅ Wrote ${outFile} (${out.length} bytes, VK_HASH=${VK_HASH})`);
console.log(`   N=${N}  LOG_N=${LOG_N}  NUMBER_OF_PUBLIC_INPUTS=${NUM_PUB}`);
console.log(`   library: ${prefix}HonkVerificationKey`);
console.log(`   contract: ${contractName}`);
console.log(`   ${basename(outFile)} imports ./HonkVerifierShared.sol`);
