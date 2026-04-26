// SPDX-License-Identifier: Apache-2.0
// Copyright 2022 Aztec
pragma solidity ^0.8.27;

import {Honk, BaseZKHonkVerifier} from "./HonkVerifierShared.sol";

uint256 constant N = 524288;
uint256 constant LOG_N = 19;
uint256 constant NUMBER_OF_PUBLIC_INPUTS = 12;
uint256 constant VK_HASH = 0x1d065fe9efe66f2f62c2d9af7e9c1548cf2ed79e23dab3cca9ecf3c5613fea8c;

library PrimaryHonkVerificationKey {
    function loadVerificationKey() internal pure returns (Honk.VerificationKey memory) {
        Honk.VerificationKey memory vk = Honk.VerificationKey({
            circuitSize: uint256(524288),
            logCircuitSize: uint256(19),
            publicInputsSize: uint256(12),
            ql: Honk.G1Point({
               x: uint256(0x162b190b2f19f09601a389a24d129a6f29052231ceed2d9dc3bc3e567914bd1a),
               y: uint256(0x1bdf22914acf18718a014e21bd2bbe1058db4ab8ef90eaf0508aa59b48d76e8e)
            }),
            qr: Honk.G1Point({
               x: uint256(0x264365c992fc6365697c00e07c329da36c4a0b579979af2ef6d759782af0321e),
               y: uint256(0x1c24a43f43a342c6cfe6ac350aec65c41e800d5ccf59ae3bd34d80094e7b3200)
            }),
            qo: Honk.G1Point({
               x: uint256(0x2b9fce69619ab0605ef2a66083dcebc0f736960606da44c49cf92145985aacfc),
               y: uint256(0x23eb5ddec7d1c60590696ff1e85b1b360970c6918aee8b56bb30c90980a12917)
            }),
            q4: Honk.G1Point({
               x: uint256(0x2fb9744ca0ef70ac54bbade0498beda5c49a1382055c23ee7d3f031c8064bc1c),
               y: uint256(0x12a105664b59b7424cd06dc393735dedd2cb713ed80268891f9bb1c940f4ad74)
            }),
            qm: Honk.G1Point({
               x: uint256(0x14c2acb40af18f7e7cdd01fcccc5e4f8c26bbddc79c59985278759696eedd3d7),
               y: uint256(0x16ccdf1ed5c7e24723990945187fec9159e1bfe8c9eb51a8f61a5a37f7278b94)
            }),
            qc: Honk.G1Point({
               x: uint256(0x1fe3198aef9adefc5006cd059e0c6aa67dccee40b467fb0040a5eb77d891fd11),
               y: uint256(0x2aff94169d0c660273a253613bbdf17eed1312c57ced27b6784131655e355f6a)
            }),
            qLookup: Honk.G1Point({
               x: uint256(0x299a584669fac723e207e11e2ff6f581646033b2431282bb6de490680a7f1ae7),
               y: uint256(0x0192320c40baad9a1b42087866e7726ce696e2ad7a428eacf230683428ee565c)
            }),
            qArith: Honk.G1Point({
               x: uint256(0x086d2d70f88b9ee6affc2bf918302866a298fa060775fa353fbb0177947433d8),
               y: uint256(0x1390a8b6f721abe392959964041660878eedfb9206299e706d4c548db1f1b7fb)
            }),
            qDeltaRange: Honk.G1Point({
               x: uint256(0x03726815a1883193a6b576237ea7b0a4a23c133112619d5a873daf6d3b3a3142),
               y: uint256(0x1d4907277e8650f8f5cfea5163b64badbc2864b8788ce80fc5654262ca3b60c3)
            }),
            qElliptic: Honk.G1Point({
               x: uint256(0x2c86b822d7c1bc2fe8e355ab560148374af7ef031ae3162628f452c70aad72f7),
               y: uint256(0x2b75d047bf1d31af4fd2c134b07f40a6ec3728c21b2476e4ca7b8894e6efc546)
            }),
            qMemory: Honk.G1Point({
               x: uint256(0x28d6095bb8c74607518c018eaf8c63c9dd7d019660ec00d5ebe6383b8f03dd50),
               y: uint256(0x23dc6a4d3d91dd3d1e76a4f079265fbad2a23fb7342c302e345da02c888569ac)
            }),
            qNnf: Honk.G1Point({
               x: uint256(0x2658504b3f2c8b6232ab1d15d674ad1c072a6d005ca733b958b1acefb0f69699),
               y: uint256(0x1a7e8280f48eac78db671ca6b864f32976c23a7da104c2d57ce6ff20e639ed3e)
            }),
            qPoseidon2External: Honk.G1Point({
               x: uint256(0x1761458dd9c181f1620e4ba613e7b7483be39615e7225582c77a8a3fdd898c6e),
               y: uint256(0x09646d83cf910adf7ff0f3b5d586a3339ab99f74f8704c11ae65060f9af27806)
            }),
            qPoseidon2Internal: Honk.G1Point({
               x: uint256(0x1865a615645e16cab3e2db7aed6699b2e1ea6b4321991b42a29c78b19edb3449),
               y: uint256(0x2d5ad5a844fbd569f35344f7f5b9ce99fa3d53eb22efcfc506c05387d56c124d)
            }),
            s1: Honk.G1Point({
               x: uint256(0x3038e503216734622bc366a7a80fa4a59a21728f6f0256da91c3cf0e5919ca2d),
               y: uint256(0x02d57a88e1490425abf7ad8ca36254b6bcdd4871c8c39ab1bcfdf32264dd1127)
            }),
            s2: Honk.G1Point({
               x: uint256(0x00f4e6cdbdf9a060b13fea2762692d7d93766bd32dd676eb9837c0fef9d59895),
               y: uint256(0x2092370a5d98be08b09bf95fa298c4a64cbb605e5e4a2073b40901c9719bb2ea)
            }),
            s3: Honk.G1Point({
               x: uint256(0x11837f0189954d24a5f76acec4d9d254eba99569bc2756e9bafef85792268ecd),
               y: uint256(0x15559bc5628933327d409a506afe113fbc03366c5b35c812e5d83147576935af)
            }),
            s4: Honk.G1Point({
               x: uint256(0x26dda7cefa8ec505b1c9f30e5645ca06d1b6889a4c718c026ae36f4ffa48e950),
               y: uint256(0x0b6d756fe51f3051196ebb3f204d8d39a41af7687ccb1d9b398ace973497fd57)
            }),
            t1: Honk.G1Point({
               x: uint256(0x26814a59803555635a3b6dfd056d19f4a6c6ffdf80a72db78762e237d58cd5f6),
               y: uint256(0x0b9dc32399025796005b2f68c15991f45b8d96069231f48e0d0c34d57593a6a6)
            }),
            t2: Honk.G1Point({
               x: uint256(0x1f6cd5b6d43f67798ae4655c016f37750e1b5cb997a3adf8540bf55bb9264ec4),
               y: uint256(0x0ed62d10b019355f008b46412d0e2d596cc6183848f32c60ec74fe2bcd76b20f)
            }),
            t3: Honk.G1Point({
               x: uint256(0x23a2906d03204aa4f79b5b80b92eaa2020dfdab8c9db8335bca3c8284b1585b2),
               y: uint256(0x24aecae332db48e03b97fc645a7f059116c4d15f7c9a51f17c3830fe7c1e3b42)
            }),
            t4: Honk.G1Point({
               x: uint256(0x08524b40cf87b668119022f691cfac834c5e938cf9e8bd4bd5847e2408407276),
               y: uint256(0x0e1e9d4327e635f547da67aef57e86e699df860731437ec57f9890fe4b3a4205)
            }),
            id1: Honk.G1Point({
               x: uint256(0x03f81af8e63d570cb91384a8de7f86caf4afd01ec7a814fe95f91e5a35c8621a),
               y: uint256(0x1d70660e09e93872c51e6c07504fbd2c70f3173714a37f658538a5e79d85801e)
            }),
            id2: Honk.G1Point({
               x: uint256(0x236014b5fabe5fb049231b8ab8eaae26dd2971e106f3fe6fa0360f9d145be27e),
               y: uint256(0x134cfd2f8ec5a2882cd0718ec142df2c2c64b2c7318d4e76caaa5ffccca46571)
            }),
            id3: Honk.G1Point({
               x: uint256(0x0a63b54f7f23a233243ec3f7616ebd4681b2ca6a5e002317309c0e040302e98a),
               y: uint256(0x0776839ca773ce0a09b65787711d35c76793c541d9211e5139482552e4b0530e)
            }),
            id4: Honk.G1Point({
               x: uint256(0x2c3ce5e8295104d19bee039504098d985fd167ac96a7975518bb2ae59c15788a),
               y: uint256(0x15b732db93282b0d45408783edd764693a1286629f1042a68124fc5a881e8505)
            }),
            lagrangeFirst: Honk.G1Point({
               x: uint256(0x0000000000000000000000000000000000000000000000000000000000000001),
               y: uint256(0x0000000000000000000000000000000000000000000000000000000000000002)
            }),
            lagrangeLast: Honk.G1Point({
               x: uint256(0x207be9cc9c8c6ab2dab3b8a954e5c774de9e68be1c4884f1e07021cf2fb10b0a),
               y: uint256(0x2ea65ba4dd3e7900ec7319947c2413cae8c555e8dc1843654f8ac9444bef5efb)
            })
        });
        return vk;
    }
}

contract PrimaryUltraHonkVerifier is BaseZKHonkVerifier(N, LOG_N, VK_HASH, NUMBER_OF_PUBLIC_INPUTS) {
    function loadVerificationKey() internal pure override returns (Honk.VerificationKey memory) {
        return PrimaryHonkVerificationKey.loadVerificationKey();
    }
}
