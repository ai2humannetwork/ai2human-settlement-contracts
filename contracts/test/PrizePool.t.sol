// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test, console} from "forge-std/Test.sol";
import {PrizePool} from "../src/PrizePool.sol";
import {PrizePoolFactory} from "../src/PrizePoolFactory.sol";
import {MerkleProof} from "openzeppelin-contracts/contracts/utils/cryptography/MerkleProof.sol";

/**
 * @title MockUSDC
 */
contract MockUSDC {
    string public name = "USD Coin";
    string public symbol = "USDC";
    uint8 public decimals = 6;
    uint256 public totalSupply_;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        totalSupply_ += amount;
        balanceOf[to] += amount;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "insufficient balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            require(allowed >= amount, "insufficient allowance");
            allowance[from][msg.sender] = allowed - amount;
        }
        require(balanceOf[from] >= amount, "insufficient balance");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function getBalance(address account) external view returns (uint256) {
        return balanceOf[account];
    }
}

/**
 * @title TestMerkleLib
 * @notice Pure solidity merkle tree utilities for test purposes.
 */
library TestMerkleLib {
    function hashPair(bytes32 a, bytes32 b) internal pure returns (bytes32) {
        return a < b ? keccak256(abi.encodePacked(a, b)) : keccak256(abi.encodePacked(b, a));
    }

    function computeRootFromLeaves(bytes32[] memory leaves) internal pure returns (bytes32) {
        if (leaves.length == 0) return bytes32(0);
        bytes32[] memory hashes = leaves;
        while (hashes.length > 1) {
            bytes32[] memory newHashes = new bytes32[]((hashes.length + 1) / 2);
            for (uint256 i = 0; i < hashes.length / 2; i++) {
                newHashes[i] = hashPair(hashes[i * 2], hashes[i * 2 + 1]);
            }
            if (hashes.length % 2 == 1) {
                newHashes[newHashes.length - 1] = hashes[hashes.length - 1];
            }
            hashes = newHashes;
        }
        return hashes[0];
    }

    /// @notice Build a simple sorted merkle tree and return root + proof for a leaf
    function buildSortedTreeAndProof(
        bytes32[] memory sortedLeaves
    ) internal pure returns (bytes32 root, bytes32[] memory proof, uint256 leafIndex) {
        // Build tree level by level
        bytes32[] memory current = sortedLeaves;
        bytes32[] memory proofs = new bytes32[](0);

        while (current.length > 1) {
            bytes32[] memory next = new bytes32[]((current.length + 1) / 2);
            for (uint256 i = 0; i < current.length / 2; i++) {
                next[i] = hashPair(current[i * 2], current[i * 2 + 1]);
            }
            if (current.length % 2 == 1) {
                next[next.length - 1] = current[current.length - 1];
            }
            current = next;
        }
        root = current[0];

        // For a 2-leaf tree, proof is just the other leaf
        if (sortedLeaves.length == 2) {
            proof = new bytes32[](1);
            proof[0] = sortedLeaves[1];
        } else if (sortedLeaves.length == 1) {
            proof = new bytes32[](0);
        }
    }

    /// @notice Sort two values (a,b) - returns (a,b) with a <= b
    function sortPair(bytes32 a, bytes32 b) internal pure returns (bytes32, bytes32) {
        return a < b ? (a, b) : (b, a);
    }
}

// =============================================================================
// PrizePool Tests
// =============================================================================

contract PrizePoolTest is Test {
    PrizePool public pool;
    MockUSDC public usdc;

    address public owner = makeAddr("owner");
    address public agent = makeAddr("agent");
    address public winner1 = makeAddr("winner1");
    address public winner2 = makeAddr("winner2");
    address public nonWinner = makeAddr("nonWinner");

    uint256 constant MAX_WINNERS = 2;

    function setUp() public {
        usdc = new MockUSDC();

        pool = new PrizePool(
            address(usdc),
            bytes32(0), // placeholder
            block.timestamp + 7 days,
            MAX_WINNERS,
            agent
        );
        pool.transferOwnership(owner);
    }

    // ===== HELPER: build merkle tree offline-style =====

    function _buildMerkleTree(address[] memory winners, uint256[] memory amounts)
        internal pure returns (bytes32 root)
    {
        // Sort winners by address (required for OpenZeppelin merkle proof)
        // Simple bubble sort for small arrays
        for (uint256 i = 0; i < winners.length; i++) {
            for (uint256 j = i + 1; j < winners.length; j++) {
                if (uint160(winners[i]) > uint160(winners[j])) {
                    (winners[i], winners[j]) = (winners[j], winners[i]);
                    (amounts[i], amounts[j]) = (amounts[j], amounts[i]);
                }
            }
        }

        // Build leaf hashes: keccak256(abi.encodePacked(winner, amount))
        bytes32[] memory leaves = new bytes32[](winners.length);
        for (uint256 i = 0; i < winners.length; i++) {
            leaves[i] = keccak256(abi.encodePacked(winners[i], amounts[i]));
        }

        // Compute root: hash pairs level by level
        bytes32[] memory hashes = leaves;
        while (hashes.length > 1) {
            bytes32[] memory next = new bytes32[]((hashes.length + 1) / 2);
            for (uint256 i = 0; i < hashes.length / 2; i++) {
                bytes32 a = hashes[i * 2];
                bytes32 b = hashes[i * 2 + 1];
                next[i] = a < b ? keccak256(abi.encodePacked(a, b)) : keccak256(abi.encodePacked(b, a));
            }
            if (hashes.length % 2 == 1) {
                next[next.length - 1] = hashes[hashes.length - 1];
            }
            hashes = next;
        }
        return hashes[0];
    }

    function _buildProofAndLeaf(
        address[] memory winners,
        uint256[] memory amounts,
        address recipient,
        uint256 amount
    ) internal pure returns (bytes32[] memory proof, bytes32 leaf) {
        // Sort
        for (uint256 i = 0; i < winners.length; i++) {
            for (uint256 j = i + 1; j < winners.length; j++) {
                if (uint160(winners[i]) > uint160(winners[j])) {
                    (winners[i], winners[j]) = (winners[j], winners[i]);
                    (amounts[i], amounts[j]) = (amounts[j], amounts[i]);
                }
            }
        }

        // Find index
        uint256 idx = type(uint256).max;
        for (uint256 i = 0; i < winners.length; i++) {
            if (winners[i] == recipient && amounts[i] == amount) {
                idx = i;
                break;
            }
        }
        require(idx != type(uint256).max, "not found");

        leaf = keccak256(abi.encodePacked(recipient, amount));

        // Build proof: for a 2-element tree, the proof is the sibling
        proof = new bytes32[](1);
        if (winners.length == 2) {
            proof[0] = keccak256(abi.encodePacked(winners[idx == 0 ? 1 : 0], amounts[idx == 0 ? 1 : 0]));
        }
    }

    // ===== TESTS =====

    function test_claim_happyPath() public {
        address[] memory winners = new address[](2);
        uint256[] memory amounts = new uint256[](2);
        winners[0] = winner1;
        winners[1] = winner2;
        amounts[0] = 50e6;
        amounts[1] = 50e6;

        bytes32 root = _buildMerkleTree(winners, amounts);

        vm.prank(owner);
        pool.updateMerkleRoot(root);

        usdc.mint(address(pool), 100e6);

        (bytes32[] memory proof, bytes32 leaf) = _buildProofAndLeaf(winners, amounts, winner1, 50e6);

        vm.prank(winner1);
        pool.claim(50e6, proof);

        assertTrue(pool.isClaimed(winner1));
        assertEq(usdc.getBalance(winner1), 50e6);
        assertEq(pool.claimedCount(), 1);
    }

    function test_claimFor_fcfsHappyPath() public {
        usdc.mint(address(pool), 100e6);

        vm.prank(owner);
        pool.claimFor(nonWinner, 50e6);

        assertTrue(pool.isClaimed(nonWinner));
        assertEq(usdc.getBalance(nonWinner), 50e6);
        assertEq(pool.claimedAmount(nonWinner), 50e6);
        assertEq(pool.claimedCount(), 1);
    }

    function test_claimFor_onlyOwner() public {
        usdc.mint(address(pool), 100e6);

        vm.prank(nonWinner);
        vm.expectRevert();
        pool.claimFor(nonWinner, 50e6);
    }

    function test_claimFor_allSlotsClaimedReverts() public {
        usdc.mint(address(pool), 100e6);

        vm.startPrank(owner);
        pool.claimFor(winner1, 50e6);
        pool.claimFor(winner2, 50e6);
        vm.expectRevert(abi.encodeWithSelector(PrizePool.AllSlotsClaimed.selector));
        pool.claimFor(nonWinner, 1e6);
        vm.stopPrank();
    }

    function test_claim_alreadyClaimedReverts() public {
        address[] memory winners = new address[](2);
        uint256[] memory amounts = new uint256[](2);
        winners[0] = winner1;
        winners[1] = winner2;
        amounts[0] = 50e6;
        amounts[1] = 50e6;

        bytes32 root = _buildMerkleTree(winners, amounts);

        vm.prank(owner);
        pool.updateMerkleRoot(root);
        usdc.mint(address(pool), 100e6);

        (bytes32[] memory proof, ) = _buildProofAndLeaf(winners, amounts, winner1, 50e6);

        vm.prank(winner1);
        pool.claim(50e6, proof);

        vm.prank(winner1);
        vm.expectRevert(abi.encodeWithSelector(PrizePool.AlreadyClaimed.selector));
        pool.claim(50e6, proof);
    }

    function test_claim_invalidProofReverts() public {
        bytes32 fakeRoot = keccak256(abi.encode("fake"));

        vm.prank(owner);
        pool.updateMerkleRoot(fakeRoot);
        usdc.mint(address(pool), 50e6);

        bytes32[] memory fakeProof = new bytes32[](0);

        vm.prank(winner1);
        vm.expectRevert(abi.encodeWithSelector(PrizePool.InvalidMerkleProof.selector));
        pool.claim(50e6, fakeProof);
    }

    function test_claim_afterDeadlineReverts() public {
        // Use short deadline
        PrizePool shortPool = new PrizePool(
            address(usdc),
            bytes32(0),
            block.timestamp + 1,
            MAX_WINNERS,
            agent
        );
        shortPool.transferOwnership(owner);

        address[] memory winners = new address[](1);
        uint256[] memory amounts = new uint256[](1);
        winners[0] = winner1;
        amounts[0] = 50e6;

        bytes32 root = _buildMerkleTree(winners, amounts);

        vm.prank(owner);
        shortPool.updateMerkleRoot(root);
        usdc.mint(address(shortPool), 50e6);

        (bytes32[] memory proof, ) = _buildProofAndLeaf(winners, amounts, winner1, 50e6);

        vm.warp(block.timestamp + 2);

        vm.prank(winner1);
        vm.expectRevert(abi.encodeWithSelector(PrizePool.ClaimPeriodEnded.selector));
        shortPool.claim(50e6, proof);
    }

    function test_refund_afterDeadline() public {
        usdc.mint(address(pool), 100e6);

        vm.warp(block.timestamp + 8 days);

        uint256 balanceBefore = usdc.getBalance(agent);

        vm.prank(agent);
        pool.refund();

        assertEq(usdc.getBalance(agent), balanceBefore + 100e6);
        assertEq(usdc.getBalance(address(pool)), 0);
    }

    function test_refund_beforeDeadlineReverts() public {
        usdc.mint(address(pool), 100e6);

        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(PrizePool.NotClaimPeriod.selector));
        pool.refund();
    }

    function test_pause() public {
        vm.prank(owner);
        pool.pause();

        address[] memory winners = new address[](1);
        uint256[] memory amounts = new uint256[](1);
        winners[0] = winner1;
        amounts[0] = 50e6;

        bytes32 root = _buildMerkleTree(winners, amounts);

        vm.prank(owner);
        pool.updateMerkleRoot(root);
        usdc.mint(address(pool), 50e6);

        (bytes32[] memory proof, ) = _buildProofAndLeaf(winners, amounts, winner1, 50e6);

        vm.prank(winner1);
        vm.expectRevert(abi.encodeWithSelector(PrizePool.ClaimPeriodEnded.selector));
        pool.claim(50e6, proof);
    }

    function test_getRemainingSlots() public {
        assertEq(pool.getRemainingSlots(), MAX_WINNERS);
    }

    function test_updateMerkleRoot() public {
        bytes32 newRoot = keccak256(abi.encode("test"));

        vm.prank(owner);
        pool.updateMerkleRoot(newRoot);

        assertEq(pool.merkleRoot(), newRoot);
    }
}

// =============================================================================
// PrizePoolFactory Tests
// =============================================================================

contract PrizePoolFactoryTest is Test {
    PrizePoolFactory public factory;
    MockUSDC public usdc;

    address public owner = makeAddr("owner");
    address public agent = makeAddr("agent");

    function setUp() public {
        usdc = new MockUSDC();
        factory = new PrizePoolFactory(address(usdc));
        factory.transferOwnership(owner);
    }

    function test_createPool() public {
        vm.prank(owner);
        address poolAddr = factory.createPool(
            1, // campaignId
            bytes32(0),
            block.timestamp + 7 days,
            10,
            agent
        );

        assertTrue(poolAddr != address(0));
        assertEq(factory.getPool(1), poolAddr);
    }

    function test_createPool_twiceReverts() public {
        vm.prank(owner);
        factory.createPool(1, bytes32(0), block.timestamp + 7 days, 10, agent);

        vm.prank(owner);
        vm.expectRevert("already exists");
        factory.createPool(1, bytes32(0), block.timestamp + 7 days, 10, agent);
    }

    function test_updateMerkleRoot() public {
        bytes32 newRoot = keccak256(abi.encode("updated"));

        vm.prank(owner);
        factory.createPool(1, bytes32(0), block.timestamp + 7 days, 10, agent);

        vm.prank(owner);
        factory.updateMerkleRoot(1, newRoot);

        PrizePool pool = PrizePool(factory.getPool(1));
        assertEq(pool.merkleRoot(), newRoot);
    }

    function test_pausePool() public {
        vm.prank(owner);
        factory.createPool(1, bytes32(0), block.timestamp + 7 days, 10, agent);

        vm.prank(owner);
        factory.pausePool(1);

        PrizePool pool = PrizePool(factory.getPool(1));
        assertTrue(pool.paused());
    }
}
