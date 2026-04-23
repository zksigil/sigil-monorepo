#!/usr/bin/env node
/**
 * mopro-vk-to-solidity.mjs — Convert Mopro's in-memory Noir VK (1816 bytes,
 * 3×u64 header + 28×G1 points) into a Solidity SSTORE2 data contract
 * compatible with the zkmopro UltraHonk verifier (1888 bytes, 3×uint256
 * header + 28×G1 points).
 *
 * The system `bb` CLI (v0.87.0) produces VK commitments that differ from
 * zkmopro's bb fork (1.0.0-nightly.20250723). Generating the Solidity VK
 * from the Mopro prover's own in-memory VK guarantees they match.
 *
 * Usage:
 *   node scripts/mopro-vk-to-solidity.mjs <mopro_vk_hex_file> <VKContractName> <outputPath>
 *
 * Input file: a single line of hex (with or without 0x prefix) = 1816 bytes.
 * Capture via console.log in proofService.ts or Mopro.getNoirVerificationKey().
 */

import { readFileSync, writeFileSync } from 'fs';

const [inputPath, vkContractName, outputPath] = process.argv.slice(2);

if (!inputPath || !vkContractName || !outputPath) {
  console.error('Usage: node mopro-vk-to-solidity.mjs <mopro_vk_hex_file> <VKContractName> <outputPath>');
  process.exit(1);
}

// ── 1. Read + validate input ────────────────────────────────────────────
const raw = readFileSync(inputPath, 'utf8').trim();
const hex = raw.startsWith('0x') ? raw.slice(2) : raw;
const buf = Buffer.from(hex, 'hex');

const MOPRO_VK_SIZE = 1816;
const HEADER_SIZE = 24;          // 3 × u64
const POINT_SIZE = 64;           // 2 × 32-byte field element
const NUM_POINTS = 28;

if (buf.length !== MOPRO_VK_SIZE) {
  console.error(`Expected ${MOPRO_VK_SIZE} bytes, got ${buf.length}`);
  process.exit(1);
}

// ── 2. Parse Mopro header (big-endian u64) ─────────────────────────────
const logCircuitSize = buf.readBigUInt64BE(0);
const publicInputsSize = buf.readBigUInt64BE(8);
const pubInputsOffset = buf.readBigUInt64BE(16);

const circuitSize = 1n << logCircuitSize;

console.log(`Mopro VK header:`);
console.log(`  logCircuitSize    = ${logCircuitSize}`);
console.log(`  publicInputsSize  = ${publicInputsSize}`);
console.log(`  pubInputsOffset   = ${pubInputsOffset}`);
console.log(`  circuitSize       = ${circuitSize} (computed from logCircuitSize)`);

// ── 3. Parse 28 G1 points ──────────────────────────────────────────────
// Ordering MUST match bb's MSGPACK_FIELDS for UltraFlavor::VerificationKey (see
// barretenberg/flavor/ultra_flavor.hpp). This is the serialization order written
// by acir_write_vk_ultra_keccak_zk_honk and differs from the Solidity struct
// declaration order on positions 9-11 (qElliptic comes before qMemory/qNnf).
const pointNames = [
  'qm', 'qc', 'ql', 'qr', 'qo', 'q4',
  'qLookup', 'qArith', 'qDeltaRange', 'qElliptic', 'qMemory', 'qNnf',
  'qPoseidon2External', 'qPoseidon2Internal',
  's1', 's2', 's3', 's4',
  'id1', 'id2', 'id3', 'id4',
  't1', 't2', 't3', 't4',
  'lagrangeFirst', 'lagrangeLast',
];

if (pointNames.length !== NUM_POINTS) {
  console.error(`Expected ${NUM_POINTS} point names, got ${pointNames.length}`);
  process.exit(1);
}

const points = {};
let p = HEADER_SIZE;
for (const name of pointNames) {
  const x = '0x' + buf.slice(p, p + 32).toString('hex');
  const y = '0x' + buf.slice(p + 32, p + 64).toString('hex');
  points[name] = { x, y };
  p += POINT_SIZE;
}

if (p !== MOPRO_VK_SIZE) {
  console.error(`Parser pointer ended at ${p}, expected ${MOPRO_VK_SIZE}`);
  process.exit(1);
}

// Sanity check: lagrangeFirst should be (1, 2)
if (points.lagrangeFirst.x !== '0x' + '00'.repeat(31) + '01' ||
    points.lagrangeFirst.y !== '0x' + '00'.repeat(31) + '02') {
  console.warn(`⚠️  lagrangeFirst is not (1, 2): got ${points.lagrangeFirst.x} / ${points.lagrangeFirst.y}`);
  console.warn(`    Point ordering may differ from Solidity struct — verify before deploying.`);
} else {
  console.log(`✅ lagrangeFirst = (1, 2) — point ordering matches`);
}

// ── 4. Emit Solidity SSTORE2 contract ──────────────────────────────────
const mstoreLines = [];
let offset = 0;
const hexOffset = (n) => '0x' + (n * 0x20).toString(16);
function pushScalar(name, value) {
  mstoreLines.push(`            // ${name}`);
  mstoreLines.push(`            mstore(${offset === 0 ? 'm' : `add(m, ${hexOffset(offset)})`}, ${value})`);
  offset++;
}
function pushPoint(name, x, y) {
  mstoreLines.push(`            // ${name}`);
  mstoreLines.push(`            mstore(${offset === 0 ? 'm' : `add(m, ${hexOffset(offset)})`}, ${x})`);
  offset++;
  mstoreLines.push(`            mstore(add(m, ${hexOffset(offset)}), ${y})`);
  offset++;
}

pushScalar('circuitSize', circuitSize.toString());
pushScalar('logCircuitSize', logCircuitSize.toString());
pushScalar('publicInputsSize', publicInputsSize.toString());

// Write points in SOLIDITY STRUCT DECLARATION ORDER (Honk.VerificationKey in
// BaseUltraHonkVerifier.sol). This differs from the Mopro/BB serialization order
// at positions 9-11: the struct has qMemory, qNnf, qElliptic but BB serializes
// qElliptic, qMemory, qNnf. We parse input in BB order above, then emit in
// struct order here so that loadVerificationKey()'s extcodecopy-then-read-by-
// field produces correct commitments.
const structOrder = [
  'qm', 'qc', 'ql', 'qr', 'qo', 'q4',
  'qLookup', 'qArith', 'qDeltaRange', 'qMemory', 'qNnf', 'qElliptic',
  'qPoseidon2External', 'qPoseidon2Internal',
  's1', 's2', 's3', 's4',
  'id1', 'id2', 'id3', 'id4',
  't1', 't2', 't3', 't4',
  'lagrangeFirst', 'lagrangeLast',
];

for (const name of structOrder) {
  pushPoint(name, points[name].x, points[name].y);
}

const totalBytes = offset * 32;
const totalHex = '0x' + totalBytes.toString(16);

const sol = `// SPDX-License-Identifier: Apache-2.0
// Copyright 2022 Aztec
pragma solidity >=0.8.21;

/// @title ${vkContractName}
/// @notice SSTORE2-style data contract — deployed bytecode IS the raw VK data.
///         The UltraHonk verifier reads this via EXTCODECOPY into a Honk.VerificationKey struct.
///
/// @dev Auto-generated by scripts/mopro-vk-to-solidity.mjs from Mopro's in-memory VK
///      (zkmopro bb fork format). Do not edit manually.
///      Data layout: ${offset} consecutive uint256 words (${totalBytes} bytes) matching the
///      Honk.VerificationKey struct memory layout.
contract ${vkContractName} {
    constructor() {
        assembly {
            let m := mload(0x40)

${mstoreLines.join('\n')}

            // ${offset} words × 32 bytes = ${totalBytes} = ${totalHex}
            return(m, ${totalHex})
        }
    }
}
`;

writeFileSync(outputPath, sol);
console.log(`\n✅ ${outputPath} written (${offset} words / ${totalBytes} bytes)`);
