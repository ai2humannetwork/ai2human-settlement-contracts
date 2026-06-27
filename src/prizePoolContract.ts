/**
 * PrizePool Contract ABI & Address — Base Sepolia
 *
 * Networks:
 *  - Base Mainnet (8453):  TBD after first deployment
 *  - Base Sepolia (84532): TBD after first deployment
 *
 * Verification: Check Basescan after deploy.
 */

import { erc20Abi } from "viem";
import type { Abi, Address } from "viem";

// ============================================================
// PrizePool ABI (from contracts/out/PrizePool.sol/PrizePool.json)
// ============================================================

export const prizePoolAbi = [
  {
    type: "constructor",
    inputs: [
      { name: "_usdcToken", type: "address", internalType: "address" },
      { name: "_merkleRoot", type: "bytes32", internalType: "bytes32" },
      { name: "_deadline", type: "uint256", internalType: "uint256" },
      { name: "_maxWinners", type: "uint256", internalType: "uint256" },
      { name: "_agent", type: "address", internalType: "address" }
    ],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "agent",
    inputs: [],
    outputs: [{ name: "", type: "address", internalType: "address" }],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "claim",
    inputs: [
      { name: "amount", type: "uint256", internalType: "uint256" },
      { name: "merkleProof", type: "bytes32[]", internalType: "bytes32[]" }
    ],
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "claimFor",
    inputs: [
      { name: "recipient", type: "address", internalType: "address" },
      { name: "amount", type: "uint256", internalType: "uint256" }
    ],
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "claimed",
    inputs: [{ name: "", type: "address", internalType: "address" }],
    outputs: [{ name: "", type: "bool", internalType: "bool" }],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "claimedCount",
    inputs: [],
    outputs: [{ name: "", type: "uint256", internalType: "uint256" }],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "deadline",
    inputs: [],
    outputs: [{ name: "", type: "uint256", internalType: "uint256" }],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "drawn",
    inputs: [],
    outputs: [{ name: "", type: "bool", internalType: "bool" }],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "extendDeadline",
    inputs: [{ name: "_newDeadline", type: "uint256", internalType: "uint256" }],
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "getPoolInfo",
    inputs: [],
    outputs: [
      {
        name: "poolBalance",
        type: "uint256",
        internalType: "uint256"
      },
      {
        name: "claimedTotal",
        type: "uint256",
        internalType: "uint256"
      },
      {
        name: "remaining",
        type: "uint256",
        internalType: "uint256"
      },
      { name: "isPaused", type: "bool", internalType: "bool" },
      { name: "isDrawn", type: "bool", internalType: "bool" },
      {
        name: "slotsLeft",
        type: "uint256",
        internalType: "uint256"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "getRemainingSlots",
    inputs: [],
    outputs: [{ name: "", type: "uint256", internalType: "uint256" }],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "isClaimed",
    inputs: [{ name: "recipient", type: "address", internalType: "address" }],
    outputs: [{ name: "", type: "bool", internalType: "bool" }],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "maxWinners",
    inputs: [],
    outputs: [{ name: "", type: "uint256", internalType: "uint256" }],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "merkleRoot",
    inputs: [],
    outputs: [{ name: "", type: "bytes32", internalType: "bytes32" }],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "usdcToken",
    inputs: [],
    outputs: [{ name: "", type: "address", internalType: "address" }],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "owner",
    inputs: [],
    outputs: [{ name: "", type: "address", internalType: "address" }],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "pause",
    inputs: [],
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "paused",
    inputs: [],
    outputs: [{ name: "", type: "bool", internalType: "bool" }],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "refund",
    inputs: [],
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "unpause",
    inputs: [],
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "updateMerkleRoot",
    inputs: [{ name: "_newRoot", type: "bytes32", internalType: "bytes32" }],
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "event",
    name: "Claimed",
    inputs: [
      { name: "recipient", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
      { name: "leafHash", type: "bytes32", indexed: true }
    ],
    anonymous: false
  },
  {
    type: "event",
    name: "ClaimFor",
    inputs: [
      { name: "operator", type: "address", indexed: true },
      { name: "recipient", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false }
    ],
    anonymous: false
  },
  {
    type: "event",
    name: "Deposited",
    inputs: [
      { name: "from", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false }
    ],
    anonymous: false
  },
  {
    type: "event",
    name: "Refunded",
    inputs: [
      { name: "recipient", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false }
    ],
    anonymous: false
  },
  {
    type: "error",
    name: "AlreadyClaimed",
    inputs: []
  },
  {
    type: "error",
    name: "AllSlotsClaimed",
    inputs: []
  },
  {
    type: "error",
    name: "ClaimPeriodEnded",
    inputs: []
  },
  {
    type: "error",
    name: "InvalidAmount",
    inputs: []
  },
  {
    type: "error",
    name: "InvalidMerkleProof",
    inputs: []
  },
  {
    type: "error",
    name: "InvalidRecipient",
    inputs: []
  },
  {
    type: "error",
    name: "NotClaimPeriod",
    inputs: []
  },
  {
    type: "error",
    name: "TransferFailed",
    inputs: []
  },
  {
    type: "error",
    name: "ZeroBalance",
    inputs: []
  }
] as const satisfies Abi;

// ============================================================
// PrizePoolFactory ABI
// ============================================================

export const prizePoolFactoryAbi = [
  {
    type: "constructor",
    inputs: [
      { name: "_usdcToken", type: "address", internalType: "address" }
    ],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "createPool",
    inputs: [
      { name: "campaignId", type: "uint256", internalType: "uint256" },
      { name: "merkleRoot", type: "bytes32", internalType: "bytes32" },
      { name: "deadline", type: "uint256", internalType: "uint256" },
      { name: "maxWinners", type: "uint256", internalType: "uint256" },
      { name: "agent", type: "address", internalType: "address" }
    ],
    outputs: [{ name: "poolAddress", type: "address", internalType: "address" }],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "getPool",
    inputs: [{ name: "campaignId", type: "uint256", internalType: "uint256" }],
    outputs: [{ name: "", type: "address", internalType: "address" }],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "nextCampaignId",
    inputs: [],
    outputs: [{ name: "", type: "uint256", internalType: "uint256" }],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "pausePool",
    inputs: [{ name: "campaignId", type: "uint256", internalType: "uint256" }],
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "pools",
    inputs: [{ name: "", type: "uint256", internalType: "uint256" }],
    outputs: [{ name: "", type: "address", internalType: "address" }],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "unpausePool",
    inputs: [{ name: "campaignId", type: "uint256", internalType: "uint256" }],
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "updateMerkleRoot",
    inputs: [
      { name: "campaignId", type: "uint256", internalType: "uint256" },
      { name: "newRoot", type: "bytes32", internalType: "bytes32" }
    ],
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "usdcToken",
    inputs: [],
    outputs: [{ name: "", type: "address", internalType: "address" }],
    stateMutability: "view"
  },
  {
    type: "event",
    name: "PoolCreated",
    inputs: [
      { name: "campaignId", type: "uint256", indexed: true },
      { name: "poolAddress", type: "address", indexed: true },
      { name: "agent", type: "address", indexed: true },
      { name: "maxWinners", type: "uint256", indexed: false },
      { name: "deadline", type: "uint256", indexed: false }
    ],
    anonymous: false
  }
] as const satisfies Abi;

// ============================================================
// ERC20 ABI (subset needed for balance/transfer)
// ============================================================

export { erc20Abi };

// ============================================================
// Network config
// ============================================================

export const BASE_SEPOLIA_CHAIN_ID = 84532;
export const BASE_MAINNET_CHAIN_ID = 8453;
export const BASE_SEPOLIA_RPC = "https://sepolia.base.org";
export const BASE_MAINNET_RPC = "https://mainnet.base.org";

// Default test addresses (Base Sepolia)
export const BASE_SEPOLIA_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

export function getChainConfig(chainId: number) {
  if (chainId === BASE_SEPOLIA_CHAIN_ID) {
    return {
      id: BASE_SEPOLIA_CHAIN_ID,
      name: "Base Sepolia",
      rpcUrl: BASE_SEPOLIA_RPC,
      explorerUrl: "https://sepolia.basescan.org"
    };
  }
  if (chainId === BASE_MAINNET_CHAIN_ID) {
    return {
      id: BASE_MAINNET_CHAIN_ID,
      name: "Base",
      rpcUrl: BASE_MAINNET_RPC,
      explorerUrl: "https://basescan.org"
    };
  }
  return null;
}
