// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "openzeppelin-contracts/contracts/access/Ownable.sol";
import {Create2} from "openzeppelin-contracts/contracts/utils/Create2.sol";
import {PrizePool} from "./PrizePool.sol";

/**
 * @title PrizePoolFactory
 * @notice Factory for deploying PrizePool instances for each campaign.
 *         Uses CREATE2 for deterministic addresses (salt = campaignId).
 *
 * @dev The factory deploys a minimal proxy per campaign.
 *       In production, you could use EIP-1167 minimal proxies for cheaper deployments.
 */
contract PrizePoolFactory is Ownable {

    //--------------------------------------------------------------------------
    // Events

    event PoolCreated(
        uint256 indexed campaignId,
        address indexed poolAddress,
        address indexed agent,
        uint256 maxWinners,
        uint256 deadline
    );

    //--------------------------------------------------------------------------
    // State

    /// @notice Maps campaignId => deployed PrizePool address
    mapping(uint256 => address) public pools;

    /// @notice Next campaign ID
    uint256 public nextCampaignId;

    /// @notice USDC token address
    address public immutable usdcToken;

    /// @notice Salt used for CREATE2 deployment
    bytes32 public constant SALY = bytes32(0x00000000000000000000000000000000000000000000000000000000DEADBEEF);

    //--------------------------------------------------------------------------

    constructor(address _usdcToken) Ownable(msg.sender) {
        usdcToken = _usdcToken;
    }

    //--------------------------------------------------------------------------
    // Admin Functions

    /**
     * @notice Deploy a new PrizePool for a campaign.
     *
     * @param campaignId   Unique campaign ID
     * @param merkleRoot   Merkle root for winner verification
     * @param deadline     Unix timestamp when claims end
     * @param maxWinners  Maximum number of winners
     * @param agent       Agent address who receives refund
     *
     * @return poolAddress The deployed PrizePool address
     */
    function createPool(
        uint256 campaignId,
        bytes32 merkleRoot,
        uint256 deadline,
        uint256 maxWinners,
        address agent
    ) external onlyOwner returns (address poolAddress) {
        require(pools[campaignId] == address(0), "already exists");
        require(deadline > block.timestamp, "deadline must be future");

        // Compute CREATE2 address
        bytes32 salt = keccak256(abi.encode(campaignId, SALY));
        bytes memory bytecode = _getPoolBytecode(
            usdcToken,
            merkleRoot,
            deadline,
            maxWinners,
            agent
        );

        poolAddress = Create2.computeAddress(salt, keccak256(bytecode));
        if (poolAddress.code.length == 0) {
            poolAddress = Create2.deploy(0, salt, bytecode);
        }

        pools[campaignId] = poolAddress;

        emit PoolCreated(campaignId, poolAddress, agent, maxWinners, deadline);
    }

    /**
     * @notice Update merkle root for a campaign (after VRF draw)
     */
    function updateMerkleRoot(uint256 campaignId, bytes32 newRoot) external onlyOwner {
        require(pools[campaignId] != address(0), "pool not found");
        PrizePool(pools[campaignId]).updateMerkleRoot(newRoot);
    }

    /**
     * @notice Pause a campaign pool (emergency)
     */
    function pausePool(uint256 campaignId) external onlyOwner {
        require(pools[campaignId] != address(0), "pool not found");
        PrizePool(pools[campaignId]).pause();
    }

    /**
     * @notice Unpause a campaign pool
     */
    function unpausePool(uint256 campaignId) external onlyOwner {
        require(pools[campaignId] != address(0), "pool not found");
        PrizePool(pools[campaignId]).unpause();
    }

    //--------------------------------------------------------------------------
    // View Functions

    function getPool(uint256 campaignId) external view returns (address) {
        return pools[campaignId];
    }

    //--------------------------------------------------------------------------
    // Internal

    function _getPoolBytecode(
        address _usdcToken,
        bytes32 _merkleRoot,
        uint256 _deadline,
        uint256 _maxWinners,
        address _agent
    ) internal pure returns (bytes memory) {
        return abi.encodePacked(
            type(PrizePool).creationCode,
            abi.encode(_usdcToken, _merkleRoot, _deadline, _maxWinners, _agent)
        );
    }
}