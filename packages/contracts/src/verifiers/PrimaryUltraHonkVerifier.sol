// SPDX-License-Identifier: Apache-2.0
// Copyright 2022 Aztec
pragma solidity ^0.8.27;

import {Honk, BaseZKHonkVerifier} from "./HonkVerifierShared.sol";

uint256 constant N = 524288;
uint256 constant LOG_N = 19;
uint256 constant NUMBER_OF_PUBLIC_INPUTS = 19;
uint256 constant VK_HASH = 0x14a2968e108bd466d4ca446840e0669b558eb6275af02d6b70cde1e448966b75;

library PrimaryHonkVerificationKey {
    function loadVerificationKey() internal pure returns (Honk.VerificationKey memory) {
        Honk.VerificationKey memory vk = Honk.VerificationKey({
            circuitSize: uint256(524288),
            logCircuitSize: uint256(19),
            publicInputsSize: uint256(19),
            ql: Honk.G1Point({
               x: uint256(0x1cb8cab6bca8102b918e15f78347153b9127bb9fdd1a25fe3e367eae5ecee35c),
               y: uint256(0x1877817ad62ecb29ed5654661464f8c3bdb263cfa17bb3a04b64a2e0df7e9857)
            }),
            qr: Honk.G1Point({
               x: uint256(0x1fed5fd817da50651f9e72b6792c0974f117bf10f3aa6c7778153df7070882b0),
               y: uint256(0x2282f966cc83c1c21aa1fb8a9f8fa69f52abe6a0399735556d69e9a88ec57389)
            }),
            qo: Honk.G1Point({
               x: uint256(0x0e1f47b27347a62de07db9df6f072b8969d14a459668d934e45a9039f5d69d1e),
               y: uint256(0x2ea33ebcd6f0f0501d9a41e966ba3b5f004d050701e0292387ee816462197d81)
            }),
            q4: Honk.G1Point({
               x: uint256(0x0194500a8b7963cb217966951983b5f1e68b3fc7c0a52b16a0c4766d62ae62e7),
               y: uint256(0x2c392250886454cf775eeb00afdac7876419a488fdfb25f28c50b63ad18ae561)
            }),
            qm: Honk.G1Point({
               x: uint256(0x254000d28c232245ff998af9a4cc6e2e8a736c225624021593b1c89b301ad06d),
               y: uint256(0x0a26257ffbd6621505a78fb2102815d4e0bd39160c606f7ab96e4f5ce7ce5d34)
            }),
            qc: Honk.G1Point({
               x: uint256(0x001e3ade616682b4945e032aac20849c179c0199d2b87572b30fe05caee53f85),
               y: uint256(0x2867106e2f09fe2df7e8a177c0ddef6ea7688328fab5797279d71670f5458fa9)
            }),
            qLookup: Honk.G1Point({
               x: uint256(0x0d6af8e6481a34fc58a778628ff2fab4b716b07271f07bc4bb170851ae2a19fb),
               y: uint256(0x118c66eb8a0eba6cd20ffb85c91ec2da0c818c43bdc8639c3d9f7fe855b57de4)
            }),
            qArith: Honk.G1Point({
               x: uint256(0x239aaf8727020c1bc15efb3f64c49bff067204649a27206d2b74d1007151ffb2),
               y: uint256(0x0c13c67b09814f4973b97c7ee85a212ad2a3ed6f643778475d9dd745d5aebdbb)
            }),
            qDeltaRange: Honk.G1Point({
               x: uint256(0x190236d0145a1df05b034178b0ded2a85bed5ede7bf2a55f59f68f1c60fe3f74),
               y: uint256(0x0f5d328d1cf8dc2279ab9439518a20e86a7d48a4c7c8e201d5dcfa46b65cf1a1)
            }),
            qElliptic: Honk.G1Point({
               x: uint256(0x0c72f66fabbc2cf8925f9b2c7336d35d3c75cf081f512ef5b60b8edf3c2421b9),
               y: uint256(0x08a0ce42edda15052d70a58496f53b04e576c503743273cffac0d57ba4b7b6ba)
            }),
            qMemory: Honk.G1Point({
               x: uint256(0x1b02dbf6eb7527d88c422bb357b46fef81247437d2982042a94b49f3c3911d07),
               y: uint256(0x24e622162082063759c82012f15cfe3c314467e6e97e975dccc7f418661d59dd)
            }),
            qNnf: Honk.G1Point({
               x: uint256(0x21050ee2d0788e03c01d690f2bc1d05180de12996a7634899b81430e74c2a8a2),
               y: uint256(0x2570aa75a722f5090ee4cdcf281c8ead38f12d03c6d8c691b0b079aab4c6b848)
            }),
            qPoseidon2External: Honk.G1Point({
               x: uint256(0x08794c31edbc8f6701ffeb84a2cedd83781880bbce8b6146037c426c4edb2753),
               y: uint256(0x1a58095a3db54a6277e637b000393627e8a0c4533ef0452bdfc1b17e6c7b65aa)
            }),
            qPoseidon2Internal: Honk.G1Point({
               x: uint256(0x30057cb6576297cb315f81766c4dc8522b93bd97d59b095a19bd4bbc6ef94e85),
               y: uint256(0x05ba78fa4a26aa282566f51de91575ad789adba3312c299a03b791406425767f)
            }),
            s1: Honk.G1Point({
               x: uint256(0x24cc1ea90de9e04a12e1419270ddde75ff4a066be0c1457587bd461e39801c40),
               y: uint256(0x131900b5d955049e5b3d1f70005740f298a0a112bd4fbd52f286ee9ee6a71963)
            }),
            s2: Honk.G1Point({
               x: uint256(0x0d6d54a4dce8fba8b5f1493e5547b9ac0d9c047a4ff256686a15215f875411cd),
               y: uint256(0x26afedbbf2a9cecd822774357adecc1433b1cf582f2d243ccfbf5d1aaab6c7cb)
            }),
            s3: Honk.G1Point({
               x: uint256(0x25a3cc0122cc6c2c2551160a86b1c3317ee8f51afc54df252772f49df1beae42),
               y: uint256(0x21c86e5b3892d3c0e28974326a59687e83c91cee7e2abcee41d31a375b084fd0)
            }),
            s4: Honk.G1Point({
               x: uint256(0x1a2948e3247b35fa6c0cd987e1080c8de60201d4fd4064bc402f548f21063d9e),
               y: uint256(0x180138b1e07192bc49e503d4515601f87b115e529465e5401f6de5ead415a10a)
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
               x: uint256(0x201ba048b19b24856da82373da08ac0e71fb4103d8fc0678be3b6852faba8f6f),
               y: uint256(0x2408f7862ff8ab0676e1be67d9cc022c7741c3caf354b57d129477f2c6ede156)
            }),
            id2: Honk.G1Point({
               x: uint256(0x255d13120238cf956292dafe2ae620166bca0266ef708d5515bd38ac3e276c43),
               y: uint256(0x256e24661c16b406e87128d1fcebe83e0c22fb3fcfa772b8951f7b071de56c5c)
            }),
            id3: Honk.G1Point({
               x: uint256(0x20a3f3b1a7743e5165138e0acb4a8c84a23811ecd040fa698a6381f10f48590c),
               y: uint256(0x0823ba71a58dcb399368f20f84178f5ebab998953017299fb43dd2dd71b4576b)
            }),
            id4: Honk.G1Point({
               x: uint256(0x0ee6650c8e60c355793a7d9f23981eab041c01ce85a42fc4d277656b0f410698),
               y: uint256(0x265dce30423fa2c296565da33f5bda5657622dcbbd634cf64a41c47c278ff035)
            }),
            lagrangeFirst: Honk.G1Point({
               x: uint256(0x0000000000000000000000000000000000000000000000000000000000000001),
               y: uint256(0x0000000000000000000000000000000000000000000000000000000000000002)
            }),
            lagrangeLast: Honk.G1Point({
               x: uint256(0x1a97a977e55e4a4793128052e7d9476f9bb03a13a9800761479be711cd193c27),
               y: uint256(0x069104f8205afa1e33a0bea11345f85bdc91a56cf971dbdb276a643b851ef5b0)
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
