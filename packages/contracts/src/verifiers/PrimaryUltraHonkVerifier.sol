// SPDX-License-Identifier: Apache-2.0
// Copyright 2022 Aztec
pragma solidity ^0.8.27;

import {Honk, BaseZKHonkVerifier} from "./HonkVerifierShared.sol";

uint256 constant N = 524288;
uint256 constant LOG_N = 19;
uint256 constant NUMBER_OF_PUBLIC_INPUTS = 11;
uint256 constant VK_HASH = 0x11407748e71e4cc7bd3e9c2e3825dcd14ac1643168f24dd247ce842ce78d5858;

library PrimaryHonkVerificationKey {
    function loadVerificationKey() internal pure returns (Honk.VerificationKey memory) {
        Honk.VerificationKey memory vk = Honk.VerificationKey({
            circuitSize: uint256(524288),
            logCircuitSize: uint256(19),
            publicInputsSize: uint256(11),
            ql: Honk.G1Point({
               x: uint256(0x1bee47c26bbc600cc5e19cde1624b92fbaa90b2fe7a2eda3fc73730345810763),
               y: uint256(0x1016bfc645375e6a5eef7c1614a6fbaa696d5d48f84cc6feedafb60ed1ff4441)
            }),
            qr: Honk.G1Point({
               x: uint256(0x2ca4847c7f04ca9b49d5e840ec508c7e8fbf2a617204189dc91015003f69f040),
               y: uint256(0x29d6c70e858265daacbaa9c629be2a66ad63b4158ddfa958a17c445f8fbdd1e0)
            }),
            qo: Honk.G1Point({
               x: uint256(0x216e7c96ddd4f0583e770409b29577cd46bf1c82b0342e517d6c826805e7bc6a),
               y: uint256(0x06ff66e44cd79162208816a29fbf9b2b34478be343b577f928b9bf7455f4e2c4)
            }),
            q4: Honk.G1Point({
               x: uint256(0x12628daa450ca620583b42887662ed14d829346d39ca91e31a687aef118b27f7),
               y: uint256(0x17d858731679ce93806ad77f4098129bab0557559cd517434c2d08a530083fbc)
            }),
            qm: Honk.G1Point({
               x: uint256(0x274c520c4fd882968f2e4bf53a28471c5aabd2e09f1435915f6c2ed630a9737b),
               y: uint256(0x1bba22bc345a508d2a762f3e31ce349d3e70eb78ef43fd0e58fd13601c9f3763)
            }),
            qc: Honk.G1Point({
               x: uint256(0x0d856d74d5115e0b57c4b87b5af9712cc2cd5b39da176dc0a51ac6b5bff7bbc2),
               y: uint256(0x09a06c35bac031b73766148f1b6693b3c728a28878c336803f5a9479eacafa5f)
            }),
            qLookup: Honk.G1Point({
               x: uint256(0x1ba4965f5c9aece9ec73dae1ce907d677ef2c3bb2897e0b2e0b14148f7881587),
               y: uint256(0x16c69f0faafd5efe3245317638479be58ea79271d116801dd148bfe5d179631d)
            }),
            qArith: Honk.G1Point({
               x: uint256(0x2966d86833aa1144ecc1a52c46e31a552c8457848310f9677fcd8248404c7fa5),
               y: uint256(0x20bfb9299e62cf2d24b11adbd852784f1b0168e6f0167179882b632e22a66a7d)
            }),
            qDeltaRange: Honk.G1Point({
               x: uint256(0x18bce0f588313a3776bf6fa03df2bf512b38280bb3d9d577ab48ca4f3ac5025b),
               y: uint256(0x24a2e4627bc0e501026c4f3e8ebbc4e064c9d886513a3f5e58f2a0795e44c4ef)
            }),
            qElliptic: Honk.G1Point({
               x: uint256(0x0a570d4aed3387c3929a0ef1cba01badc3559cb0a2eab3381fa8e1bc114c3556),
               y: uint256(0x1e8f3d76c3ed1faf44f68b72617c0231660567c3d0ad01a08df1d8f976b2ba5c)
            }),
            qMemory: Honk.G1Point({
               x: uint256(0x25cd3d7959bb25de832d3ab02f532f1a7490e780d82d21c6d789620db12b96f5),
               y: uint256(0x1f45241bb714454361645b64174e890c7cfa4d28c5ceb338f9537508025fbde8)
            }),
            qNnf: Honk.G1Point({
               x: uint256(0x169b73c5ae48b8a65b7be6e448fd3b442943249f47347ecda311590285879952),
               y: uint256(0x078a08809d13b4afb00ab144309eb53485d2898f1c6f7ed02eec69a932febfd0)
            }),
            qPoseidon2External: Honk.G1Point({
               x: uint256(0x1af2d62a5bf958e930f102e6a14a67b23f4c1573ce4cc54c369dda63a21d74eb),
               y: uint256(0x1fb6f18513580b3c83edd3d86d756245c1643c458b70352cee3968d663640c7d)
            }),
            qPoseidon2Internal: Honk.G1Point({
               x: uint256(0x238c2c1c06c6023610e4bb92a783fdb5e78fffe3fa5eb53c7d2d91b8fcad92f7),
               y: uint256(0x0e139e554dffbf4e21ee9b9ac5312fc6a7bb403b767e250ddeb8cac124003029)
            }),
            s1: Honk.G1Point({
               x: uint256(0x277d6d0c7b31624976bcfe6571c5540c97f3437734e52984bb99e0fc26d8fb11),
               y: uint256(0x00e2f5efe80fa5db26cdfd5fad6e7689d74ecfcf501f4f5e7a06ea1a7ba5166f)
            }),
            s2: Honk.G1Point({
               x: uint256(0x24f5071c55cb614bbc84eaa92354d0d37328c0b2b9cb09fea9fbbd5a6d46ce18),
               y: uint256(0x1ba1e9acf71be81021e91ab6cdd3c92a63d261ad429ef3ab402468f0d56cd792)
            }),
            s3: Honk.G1Point({
               x: uint256(0x25353ca35572653cd90f3eafa0ebba8f053ca31374bf654809dfe90cad9f3c14),
               y: uint256(0x17ce9506feffc640a23e397fdc22208b566d4f84ba06df7fb72cb1445190afd8)
            }),
            s4: Honk.G1Point({
               x: uint256(0x2c8d72831e5c0353a6e7421cf7274e58e1c01cd3c544e73ac7e811453b4a2774),
               y: uint256(0x0c238e351d3e373d0275462802a7ffa921ea64d52c51d0eec82fd619e0be7a02)
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
               x: uint256(0x275c0d5633e616d5574f3dc63a26d0ed26b18279d3abee5a7173358a77e1a463),
               y: uint256(0x1a10e010efcf33e4ff1c89484a076f8e5aa1a0e657776643d272962580ecd48d)
            }),
            id2: Honk.G1Point({
               x: uint256(0x03dec17ebdd131eaa9979cbb8539a358cd538c426a511fd4a7906796abe8ea3d),
               y: uint256(0x0f531eed3a329b62654815168d5190c0182c8322a3bfa10f7933b211c0adbe64)
            }),
            id3: Honk.G1Point({
               x: uint256(0x285b5774c2c6f02a835c73f2a25b3e5927aa3cab0a88b50028a2d71dbe7bf133),
               y: uint256(0x287069d2a1bf04a227971c5fbab112ae6fb7c3a348cb44602c98dbce0d0ed8a5)
            }),
            id4: Honk.G1Point({
               x: uint256(0x11337ca89e955be872073f5da17c40fc17d48fd72aaa5a6831dc73f536d7deee),
               y: uint256(0x189bb8e5319198dd56de7ff58232607cb25cd9b6d671ada1e475e96bd01c6629)
            }),
            lagrangeFirst: Honk.G1Point({
               x: uint256(0x0000000000000000000000000000000000000000000000000000000000000001),
               y: uint256(0x0000000000000000000000000000000000000000000000000000000000000002)
            }),
            lagrangeLast: Honk.G1Point({
               x: uint256(0x2c68c0c7e37cb35a4cc8debaece5cbefe709731fa853646ec4c99bc95bd7b634),
               y: uint256(0x2d919d2c802917ac1bf02a9123cf66b5f43cc10b348be6a454964530b0222f4e)
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
