// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// Pedersen commitments C = v·G + r·H on BN254 G1, via the ecAdd (0x06) and ecMul (0x07) precompiles.
/// G is the BN254 generator (1, 2). H = try-and-increment from keccak256("ofel/pedersen/H/v1" || 0x00),
/// with the even y; nobody knows log_G(H). The point at infinity is (0, 0).
library Pedersen {
    uint256 internal constant P = 21888242871839275222246405745257275088696311157297823662689037894645226208583;
    uint256 internal constant N = 21888242871839275222246405745257275088548364400416034343698204186575808495617;
    uint256 internal constant HX = 8151045900381500765177190642963759502868535262511941714456713950147686507285;
    uint256 internal constant HY = 19053106054203193574146046438424995143590580634524738320696592359494972851142;

    function onCurve(uint256 x, uint256 y) internal pure returns (bool) {
        if (x == 0 && y == 0) return false; // a size commitment is never the identity
        if (x >= P || y >= P) return false;
        return mulmod(y, y, P) == addmod(mulmod(mulmod(x, x, P), x, P), 3, P);
    }

    function add(uint256[2] memory a, uint256[2] memory b) internal view returns (uint256[2] memory r) {
        uint256[4] memory input = [a[0], a[1], b[0], b[1]];
        bool ok;
        assembly ("memory-safe") {
            ok := staticcall(gas(), 0x06, input, 0x80, r, 0x40)
        }
        require(ok, "ecAdd");
    }

    function mul(uint256[2] memory p, uint256 s) internal view returns (uint256[2] memory r) {
        uint256[3] memory input = [p[0], p[1], s];
        bool ok;
        assembly ("memory-safe") {
            ok := staticcall(gas(), 0x07, input, 0x60, r, 0x40)
        }
        require(ok, "ecMul");
    }

    function commit(uint256 value, uint256 blind) internal view returns (uint256[2] memory) {
        return add(mul([uint256(1), uint256(2)], value), mul([HX, HY], blind));
    }

    function opens(uint256[2] memory c, uint256 value, uint256 blind) internal view returns (bool) {
        uint256[2] memory want = commit(value, blind % N);
        return want[0] == c[0] && want[1] == c[1];
    }
}
