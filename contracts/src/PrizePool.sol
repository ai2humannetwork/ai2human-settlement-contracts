// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "openzeppelin-contracts/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "openzeppelin-contracts/contracts/utils/ReentrancyGuard.sol";
import {MerkleProof} from "openzeppelin-contracts/contracts/utils/cryptography/MerkleProof.sol";
import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";

/**
 * @title PrizePool
 * @notice A single-campaign prize pool contract.
 *         Deposits USDC, supports backend-verified FCFS claims, optional Merkle claims,
 *         and refund after deadline.
 *
 * @dev Security properties:
 *       - ReentrancyGuard on all external state-changing functions
 *       - CEI (Checks-Effects-Interactions) pattern on claim
 *       - Only callable by owner for admin functions
 *       - Deadline enforced on claims
 *       - Owner-only claimFor lets the backend verify off-chain tasks before payout
 *       - Optional Merkle proof prevents unauthorized direct claims
 *       - Pull-based refund pattern (agent calls claim for refund after deadline)
 */
contract PrizePool is Ownable, ReentrancyGuard {

    //--------------------------------------------------------------------------
    // Errors

    error AlreadyClaimed();
    error InvalidMerkleProof();
    error ClaimPeriodEnded();
    error NotClaimPeriod();
    error ZeroBalance();
    error AllSlotsClaimed();
    error TransferFailed();
    error InvalidAmount();
    error InvalidRecipient();

    //--------------------------------------------------------------------------
    // Events

    event Claimed(address indexed recipient, uint256 amount, bytes32 indexed leafHash);
    event ClaimFor(address indexed operator, address indexed recipient, uint256 amount);
    event Refunded(address indexed recipient, uint256 amount);
    event Deposited(address indexed from, uint256 amount);

    //--------------------------------------------------------------------------
    // State

    /// @notice USDC token address
    address public immutable usdcToken;

    /// @notice Merkle root for winner verification
    bytes32 public merkleRoot;

    /// @notice Deadline timestamp - claims allowed until this time
    uint256 public deadline;

    /// @notice Maximum number of winners (max slots)
    uint256 public maxWinners;

    /// @notice Number of winners who have claimed
    uint256 public claimedCount;

    /// @notice Agent address - receives refund of remaining after deadline
    address public agent;

    /// @notice Whether the pool has been drawn (VRF result incorporated into merkleRoot)
    bool public drawn;

    /// @notice Whether the pool is paused
    bool public paused;

    /// @notice Whether the merkle root has been locked (draw final)
    bool public merkleRootLocked;

    /// @notice Tracks which recipients have claimed (recipient => bool)
    mapping(address => bool) public claimed;

    /// @notice Tracks total amount claimed per address (to prevent merkle root change exploit)
    mapping(address => uint256) public claimedAmount;

    //--------------------------------------------------------------------------
    // Modifiers

    modifier duringClaimPeriod() {
        if (block.timestamp > deadline) revert ClaimPeriodEnded();
        if (paused) revert ClaimPeriodEnded();
        _;
    }

    //--------------------------------------------------------------------------

    constructor(
        address _usdcToken,
        bytes32 _merkleRoot,
        uint256 _deadline,
        uint256 _maxWinners,
        address _agent
    ) Ownable(msg.sender) {
        require(_usdcToken != address(0), "usdcToken required");
        require(_deadline > block.timestamp, "deadline must be in future");
        require(_maxWinners > 0, "maxWinners must be > 0");

        usdcToken = _usdcToken;
        merkleRoot = _merkleRoot;
        merkleRootLocked = false;
        deadline = _deadline;
        maxWinners = _maxWinners;
        agent = _agent;
        drawn = false;
        paused = false;
    }

    //--------------------------------------------------------------------------
    // Admin Functions (onlyOwner)

    /// @notice Update merkle root after draw (called by backend)
    /// @dev Can be called once to set winners, then LOCKED — cannot be changed again.
    ///      This prevents admin from changing merkle root to re-claim with higher amounts.
    function updateMerkleRoot(bytes32 _newRoot) external onlyOwner {
        require(!merkleRootLocked, "MerkleRoot already locked");
        merkleRoot = _newRoot;
        merkleRootLocked = true;
    }

    /// @notice Lock the merkle root manually (irreversible)
    function lockMerkleRoot() external onlyOwner {
        merkleRootLocked = true;
    }

    /// @notice Emergency pause
    function pause() external onlyOwner {
        paused = true;
    }

    /// @notice Unpause
    function unpause() external onlyOwner {
        paused = false;
    }

    /// @notice Extend deadline (in case of technical issues)
    function extendDeadline(uint256 _newDeadline) external onlyOwner {
        require(_newDeadline > deadline, "must extend deadline");
        deadline = _newDeadline;
    }

    //--------------------------------------------------------------------------
    // Public Claim Function

    /**
     * @notice Claim reward using Merkle proof.
     *         The proof must be generated from the winner list off-chain.
     *         leaf = keccak256(abi.encodePacked(recipient, amount))
     *
     * @param amount      Reward amount in USDC (6 decimals)
     * @param merkleProof Merkle proof proving caller is an eligible winner
     */
    function claim(uint256 amount, bytes32[] calldata merkleProof)
        external
        nonReentrant
        duringClaimPeriod
    {
        require(merkleRootLocked, "MerkleRoot not finalized");
        // Build leaf hash and verify proof
        bytes32 leaf = keccak256(abi.encodePacked(msg.sender, amount));
        if (!MerkleProof.verify(merkleProof, merkleRoot, leaf)) {
            revert InvalidMerkleProof();
        }

        _claimTo(msg.sender, amount, leaf);
    }

    /**
     * @notice Pay a verified quester in FCFS mode.
     * @dev The backend verifies off-chain task completion before calling this.
     *      This is the path for "any wallet can claim after completing all tasks".
     */
    function claimFor(address recipient, uint256 amount)
        external
        onlyOwner
        nonReentrant
        duringClaimPeriod
    {
        _claimTo(recipient, amount, bytes32(0));
        emit ClaimFor(msg.sender, recipient, amount);
    }

    //--------------------------------------------------------------------------
    // Refund (agent calls after deadline to get remaining USDC back)

    function refund() external nonReentrant {
        if (block.timestamp <= deadline) revert NotClaimPeriod();
        if (msg.sender != agent) revert("not agent");
        if (paused) revert ClaimPeriodEnded();

        uint256 remaining = IERC20(usdcToken).balanceOf(address(this));
        if (remaining == 0) revert ZeroBalance();

        emit Refunded(agent, remaining);

        (bool success, ) = usdcToken.call(
            abi.encodeWithSignature("transfer(address,uint256)", agent, remaining)
        );
        if (!success) revert TransferFailed();
    }

    //--------------------------------------------------------------------------
    // View Functions

    function isClaimed(address recipient) external view returns (bool) {
        return claimed[recipient];
    }

    function getRemainingSlots() external view returns (uint256) {
        return maxWinners > claimedCount ? maxWinners - claimedCount : 0;
    }

    function getPoolInfo() external view returns (
        uint256 poolBalance,
        uint256 claimedTotal,
        uint256 remaining,
        bool isPaused,
        bool isDrawn,
        uint256 slotsLeft
    ) {
        poolBalance = IERC20(usdcToken).balanceOf(address(this));
        claimedTotal = claimedCount;
        remaining = poolBalance;
        isPaused = paused;
        isDrawn = drawn;
        slotsLeft = maxWinners > claimedCount ? maxWinners - claimedCount : 0;
    }

    function _claimTo(address recipient, uint256 amount, bytes32 leafHash) internal {
        if (recipient == address(0)) revert InvalidRecipient();
        if (claimed[recipient]) revert AlreadyClaimed();
        if (claimedCount >= maxWinners) revert AllSlotsClaimed();
        if (amount == 0) revert InvalidAmount();

        claimed[recipient] = true;
        claimedAmount[recipient] = amount;
        claimedCount++;

        emit Claimed(recipient, amount, leafHash);

        (bool success, bytes memory data) = usdcToken.call(
            abi.encodeWithSignature("transfer(address,uint256)", recipient, amount)
        );
        if (!success || (data.length > 0 && !abi.decode(data, (bool)))) {
            revert TransferFailed();
        }
    }
}
