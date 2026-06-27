/**
 * PrizePool on-chain settlement library.
 *
 * Flow (FCFS reward mode):
 *  1. Server creates campaign via PrizePoolFactory → deploys new PrizePool
 *  2. Server deposits USDC into PrizePool (via ERC20 transfer)
 *  3. Participants complete tasks → server marks questProgress verified
 *  4. Server calls claimFor(recipient, amount) after verifying completion
 *  5. Deadline passes → agent calls refund() to recover remaining USDC
 *
 * Security:
 *  - claimFor is owner-only; backend verification gates payouts
 *  - Optional MerkleProof path remains available for fixed winner lists
 *  - CEI pattern: claimed state updated BEFORE USDC transfer
 *  - ReentrancyGuard on claim(), claimFor(), and refund()
 *  - Deadline enforcement on claims
 */

import {
  createPublicClient,
  createWalletClient,
  defineChain,
  decodeEventLog,
  erc20Abi,
  formatUnits,
  getAddress,
  http,
  isAddress,
  zeroAddress
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { prizePoolAbi, prizePoolFactoryAbi, getChainConfig } from "./prizePoolContract";
import { prizePoolBytecode } from "./prizePoolBytecode";

const USDC_DECIMALS = 6;

// ============================================================
// Helpers
// ============================================================

function normalizePrivateKey(value: string): `0x${string}` {
  return (value.startsWith("0x") ? value : `0x${value}`) as `0x${string}`;
}

function parseAmount(raw: string): string {
  const match = String(raw || "").replace(/,/g, "").match(/\d+(?:\.\d+)?/);
  return match ? match[0] : "0";
}

function buildExplorerUrl(baseUrl: string, txHash: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/tx/${txHash}`;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isUsablePrizePoolAddress(value: string | undefined | null): boolean {
  if (!value || !isAddress(value)) return false;
  return value.toLowerCase() !== zeroAddress.toLowerCase();
}

// ============================================================
// Merkle tree helpers (used by server to build winner tree)
// ============================================================

/**
 * Build a sorted merkle tree root from winners list.
 * Uses OpenZeppelin-compatible hashing: keccak256(abi.encodePacked(a, b))
 * where a < b (sorted).
 */
export function buildMerkleRoot(winners: { address: string; amount: string }[]): string {
  // Sort by address ascending
  const sorted = [...winners].sort((a, b) =>
    a.address.toLowerCase() < b.address.toLowerCase() ? -1 : 1
  );

  // Build leaves
  const leaves = sorted.map((w) =>
    keccak256(abiEncodePacked(w.address, parseAmount(w.amount)))
  );

  // Build tree
  let hashes = leaves;
  while (hashes.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < hashes.length / 2; i++) {
      const a = hashes[i * 2];
      const b = hashes[i * 2 + 1];
      next.push(a < b ? keccak256(concatAbiPacked(a, b)) : keccak256(concatAbiPacked(b, a)));
    }
    if (hashes.length % 2 === 1) {
      next.push(hashes[hashes.length - 1]);
    }
    hashes = next;
  }
  return hashes[0];
}

/**
 * Build merkle proof for a specific winner.
 * Returns the sibling hashes needed to verify the leaf.
 */
export function buildMerkleProof(
  winners: { address: string; amount: string }[],
  recipient: string,
  amount: string
): string[] {
  const sorted = [...winners].sort((a, b) =>
    a.address.toLowerCase() < b.address.toLowerCase() ? -1 : 1
  );

  const leaf = keccak256(abiEncodePacked(recipient, parseAmount(amount)));

  // For a 2-winner tree, proof is just the other winner's hash
  if (sorted.length === 2) {
    const proof: string[] = [];
    for (const w of sorted) {
      if (w.address.toLowerCase() !== recipient.toLowerCase()) {
        proof.push(keccak256(abiEncodePacked(w.address, parseAmount(w.amount))));
      }
    }
    return proof;
  }

  // For larger trees, compute level-by-level
  const level = sorted.map((w) => keccak256(abiEncodePacked(w.address, parseAmount(w.amount))));
  const targetLeaf = level.find((h) => h === leaf) || leaf;

  let currentLevel = level;
  const proof: string[] = [];
  let targetIdx = currentLevel.indexOf(targetLeaf);

  while (currentLevel.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < currentLevel.length / 2; i++) {
      const a = currentLevel[i * 2];
      const b = currentLevel[i * 2 + 1];
      const siblingIdx = targetIdx % 2 === 0 ? i * 2 + 1 : i * 2;
      if (currentLevel.length > siblingIdx) {
        proof.push(currentLevel[siblingIdx]);
      }
      next.push(a < b ? keccak256(concatAbiPacked(a, b)) : keccak256(concatAbiPacked(b, a)));
    }
    if (currentLevel.length % 2 === 1) {
      next.push(currentLevel[currentLevel.length - 1]);
    }
    currentLevel = next;
    targetIdx = Math.floor(targetIdx / 2);
  }

  return proof;
}

/**
 * Verify a merkle proof on-chain (same logic as Solidity).
 */
export function verifyMerkleProof(
  root: string,
  recipient: string,
  amount: string,
  proof: string[]
): boolean {
  let leaf = keccak256(abiEncodePacked(recipient, parseAmount(amount)));
  for (const sibling of proof) {
    leaf = leaf < sibling
      ? keccak256(concatAbiPacked(leaf, sibling))
      : keccak256(concatAbiPacked(sibling, leaf));
  }
  return leaf === root;
}

// ============================================================
// Minimal keccak256 / abi.encodePacked polyfills (Node.js)
// ============================================================

function keccak256(data: string): string {
  // Use Node.js built-in crypto
  const crypto = require("crypto");
  const hash = crypto.createHash("shake256", { outputLength: 32 });
  hash.update(Buffer.from(data.slice(2), "hex"), "utf8");
  // Actually Node.js crypto doesn't support keccak directly...
  // Use the web3-style keccak256 via buffer
  const { keccak256: keccak } = require("js-sha3");
  return "0x" + keccak(Buffer.from(data.slice(2), "hex"));
}

function abiEncodePacked(...args: string[]): string {
  // Simplified: for our use case, just concat the hex-padded values
  // This is NOT a full abi.encodePacked — use ethereumjs-abi in production
  // For PrizePool leaf = keccak256(abi.encodePacked(addr, amount))
  // amount is uint256 (32 bytes), address is 20 bytes
  const [addr, amount] = args;
  const addrHex = addr.toLowerCase().replace("0x", "").padStart(40, "0");
  const amountHex = parseUnitsBn(amount).toString(16).padStart(64, "0");
  return "0x" + addrHex + amountHex;
}

function concatAbiPacked(a: string, b: string): string {
  return "0x" + a.slice(2) + b.slice(2);
}

function parseUnitsBn(amount: string): bigint {
  const num = parseAmount(amount);
  const parts = num.split(".");
  const whole = BigInt(parts[0] || "0");
  const frac = BigInt((parts[1] || "000000").slice(0, 6).padEnd(6, "0"));
  return whole * BigInt(1e6) + frac;
}

// ============================================================
// On-chain PrizePool operations
// ============================================================

function getPoolConfig() {
  const chainId = Number(process.env.BASE_CHAIN_ID || 8453);
  const rpcUrl = (process.env.BASE_RPC_URL || "https://mainnet.base.org").trim();
  const explorerBaseUrl = (process.env.BASE_EXPLORER_BASE_URL || "https://basescan.org").trim();
  const privateKey = String(
    process.env.PRIZE_POOL_PRIVATE_KEY ||
      process.env.BASE_SETTLEMENT_PRIVATE_KEY ||
      process.env.BASE_PRIVATE_KEY ||
      ""
  ).trim();
  const factoryAddress = String(
    process.env.PRIZE_POOL_FACTORY_ADDRESS || ""
  ).trim();
  const usdcAddress = (process.env.BASE_SETTLEMENT_TOKEN_ADDRESS || "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913").trim();

  const config = getChainConfig(chainId);
  const enabled = Boolean(privateKey);

  return {
    chainId,
    rpcUrl,
    explorerBaseUrl,
    privateKey,
    factoryAddress,
    usdcAddress,
    enabled,
    chain: config || undefined
  };
}

export function getPrizePoolSignerAddress(): string {
  const cfg = getPoolConfig();
  if (!cfg.enabled) return "";
  return privateKeyToAccount(normalizePrivateKey(cfg.privateKey)).address;
}

function buildViemChain(chainId: number) {
  const cfg = getChainConfig(chainId);
  if (!cfg) throw new Error(`Unsupported chain: ${chainId}`);
  return defineChain({
    id: chainId,
    name: cfg.name,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [cfg.rpcUrl] } },
    blockExplorers: { default: { name: cfg.name, url: cfg.explorerUrl } }
  });
}

// ============================================================
// createCampaign — deploy a new PrizePool via factory
// ============================================================

export type CreateCampaignResult =
  | { ok: true; campaignId: number; poolAddress: string; txHash: string; explorerUrl: string }
  | { ok: false; error: string };

function readPoolCreatedAddressFromLogs(input: {
  logs: ReadonlyArray<{ address: string; data: `0x${string}`; topics: readonly `0x${string}`[] }>;
  factoryAddress: string;
  campaignId: number;
}) {
  let eventPoolAddress = "";
  for (const log of input.logs) {
    if (log.address.toLowerCase() !== input.factoryAddress.toLowerCase()) continue;
    try {
      const decoded = decodeEventLog({
        abi: prizePoolFactoryAbi,
        data: log.data,
        topics: [...log.topics] as [`0x${string}`, ...`0x${string}`[]]
      });
      if (decoded.eventName !== "PoolCreated") continue;
      const args = decoded.args as unknown as {
        campaignId?: bigint;
        poolAddress?: string;
      };
      if (args.campaignId !== BigInt(input.campaignId)) continue;
      eventPoolAddress = String(args.poolAddress || "");
      break;
    } catch {
      // Ignore logs from other events/contracts in the same receipt.
    }
  }
  return eventPoolAddress;
}

async function resolvePrizePoolAddress(input: {
  publicClient: ReturnType<typeof createPublicClient>;
  factoryAddress: string;
  campaignId: number;
  txHash?: `0x${string}`;
  logs?: ReadonlyArray<{ address: string; data: `0x${string}`; topics: readonly `0x${string}`[] }>;
}) {
  let eventPoolAddress = "";
  const logs = input.logs || (
    input.txHash
      ? (await input.publicClient.getTransactionReceipt({ hash: input.txHash })).logs
      : []
  );
  if (logs.length) {
    eventPoolAddress = readPoolCreatedAddressFromLogs({
      logs,
      factoryAddress: input.factoryAddress,
      campaignId: input.campaignId
    });
  }

  const mappedPoolAddress = String(await input.publicClient.readContract({
    address: input.factoryAddress as `0x${string}`,
    abi: prizePoolFactoryAbi,
    functionName: "getPool",
    args: [BigInt(input.campaignId)]
  }));

  if (
    isUsablePrizePoolAddress(eventPoolAddress) &&
    isUsablePrizePoolAddress(mappedPoolAddress) &&
    eventPoolAddress.toLowerCase() !== mappedPoolAddress.toLowerCase()
  ) {
    throw new Error(
      `Factory pool mismatch for campaign ${input.campaignId}. Event=${eventPoolAddress}, getPool=${mappedPoolAddress}.`
    );
  }

  return isUsablePrizePoolAddress(eventPoolAddress)
    ? getAddress(eventPoolAddress)
    : isUsablePrizePoolAddress(mappedPoolAddress)
      ? getAddress(mappedPoolAddress)
      : "";
}

export type GetCampaignPoolAddressResult =
  | { ok: true; campaignId: number; poolAddress: string; txHash?: string; explorerUrl?: string }
  | { ok: false; error: string };

export async function getPrizePoolCampaignAddress(input: {
  campaignId: number;
  txHash?: string;
}): Promise<GetCampaignPoolAddressResult> {
  const cfg = getPoolConfig();

  if (!cfg.factoryAddress) {
    return { ok: false, error: "PrizePool factory is not configured." };
  }
  if (!Number.isFinite(input.campaignId) || input.campaignId <= 0) {
    return { ok: false, error: "Invalid campaign id." };
  }

  const chain = buildViemChain(cfg.chainId);
  const publicClient = createPublicClient({ chain, transport: http(cfg.rpcUrl) });

  try {
    const poolAddress = await resolvePrizePoolAddress({
      publicClient,
      factoryAddress: cfg.factoryAddress,
      campaignId: input.campaignId,
      txHash: input.txHash as `0x${string}` | undefined
    });
    if (!poolAddress) {
      return {
        ok: false,
        error: `No usable PrizePool address found for campaign ${input.campaignId}.`
      };
    }
    return {
      ok: true,
      campaignId: input.campaignId,
      poolAddress,
      txHash: input.txHash,
      explorerUrl: input.txHash ? buildExplorerUrl(cfg.explorerBaseUrl, input.txHash) : undefined
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return { ok: false, error: `Unable to resolve PrizePool address: ${msg}` };
  }
}

export async function createPrizePoolCampaign(input: {
  campaignId: number;
  merkleRoot?: string;
  deadline: number; // unix timestamp
  maxWinners: number;
  agent: string;
}): Promise<CreateCampaignResult> {
  const cfg = getPoolConfig();

  if (!cfg.enabled) {
    return { ok: false, error: "PrizePool not configured. Set PRIZE_POOL_PRIVATE_KEY." };
  }
  if (!prizePoolBytecode || !prizePoolBytecode.startsWith("0x")) {
    return { ok: false, error: "PrizePool bytecode is missing from the deployment bundle." };
  }

  if (!isAddress(input.agent)) {
    return { ok: false, error: "Invalid agent address." };
  }
  if (!Number.isFinite(input.campaignId) || input.campaignId <= 0) {
    return { ok: false, error: "Invalid campaign id." };
  }
  if (!Number.isFinite(input.deadline) || input.deadline <= Math.floor(Date.now() / 1000)) {
    return { ok: false, error: "PrizePool deadline must be in the future." };
  }
  if (!Number.isFinite(input.maxWinners) || input.maxWinners < 1) {
    return { ok: false, error: "PrizePool maxWinners must be at least 1." };
  }

  const chain = buildViemChain(cfg.chainId);
  const account = privateKeyToAccount(normalizePrivateKey(cfg.privateKey));
  const walletClient = createWalletClient({ account, chain, transport: http(cfg.rpcUrl) });
  const publicClient = createPublicClient({ chain, transport: http(cfg.rpcUrl) });

  try {
    const hash = await walletClient.deployContract({
      abi: prizePoolAbi,
      bytecode: prizePoolBytecode as `0x${string}`,
      args: [
        cfg.usdcAddress as `0x${string}`,
        (input.merkleRoot || "0x" + "0".repeat(64)) as `0x${string}`,
        BigInt(input.deadline),
        BigInt(input.maxWinners),
        input.agent as `0x${string}`
      ]
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") {
      return { ok: false, error: "PrizePool deployment transaction failed on-chain." };
    }

    const poolAddress = receipt.contractAddress && isUsablePrizePoolAddress(receipt.contractAddress)
      ? getAddress(receipt.contractAddress)
      : "";

    if (!poolAddress) {
      return {
        ok: false,
        error: `PrizePool deployment did not return a usable contract address for campaign ${input.campaignId}. tx=${hash}.`
      };
    }

    const owner = await readDeployedPrizePoolOwner({ publicClient, poolAddress });
    if (owner.toLowerCase() !== account.address.toLowerCase()) {
      return {
        ok: false,
        error: `Direct PrizePool owner mismatch after deploy. Owner=${owner}, signer=${account.address}, tx=${hash}.`
      };
    }

    return {
      ok: true,
      campaignId: input.campaignId,
      poolAddress,
      txHash: hash,
      explorerUrl: buildExplorerUrl(cfg.explorerBaseUrl, hash)
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return { ok: false, error: `createPool failed: ${msg}` };
  }
}

async function readDeployedPrizePoolOwner(input: {
  publicClient: ReturnType<typeof createPublicClient>;
  poolAddress: string;
}) {
  let lastError = "";
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      const code = await input.publicClient.getCode({ address: input.poolAddress as `0x${string}` });
      if (!code || code === "0x") {
        lastError = "contract code not available yet";
      } else {
        return await input.publicClient.readContract({
          address: input.poolAddress as `0x${string}`,
          abi: prizePoolAbi,
          functionName: "owner",
          args: []
        }) as string;
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : "unknown owner read error";
    }
    await sleep(750 * (attempt + 1));
  }
  throw new Error(lastError || "Unable to read PrizePool owner after deployment.");
}

// ============================================================
// depositToPool — fund the PrizePool with USDC
// ============================================================

export type DepositToPoolResult =
  | { ok: true; txHash: string; explorerUrl: string; amount: string }
  | { ok: false; error: string };

export async function depositToPrizePool(input: {
  poolAddress: string;
  amount: string; // e.g. "5" USDC
}): Promise<DepositToPoolResult> {
  const cfg = getPoolConfig();

  if (!cfg.enabled) {
    return { ok: false, error: "PrizePool not configured." };
  }

  if (!isAddress(input.poolAddress)) {
    return { ok: false, error: "Invalid pool address." };
  }

  const amount = parseAmount(input.amount);
  const value = parseUnits(amount, USDC_DECIMALS);
  const chain = buildViemChain(cfg.chainId);
  const account = privateKeyToAccount(normalizePrivateKey(cfg.privateKey));
  const walletClient = createWalletClient({ account, chain, transport: http(cfg.rpcUrl) });
  const publicClient = createPublicClient({ chain, transport: http(cfg.rpcUrl) });

  try {
    // First approve the pool to pull USDC
    const approveHash = await walletClient.writeContract({
      address: cfg.usdcAddress as `0x${string}`,
      abi: erc20Abi,
      functionName: "approve",
      args: [input.poolAddress as `0x${string}`, value]
    });
    await publicClient.waitForTransactionReceipt({ hash: approveHash });

    // Then call deposit (if pool has a deposit function)
    // NOTE: PrizePool.sol doesn't have a deposit() function — it expects USDC to be
    // transferred directly. For now, we do a plain transfer to the pool address.
    const txHash = await walletClient.writeContract({
      address: cfg.usdcAddress as `0x${string}`,
      abi: erc20Abi,
      functionName: "transfer",
      args: [input.poolAddress as `0x${string}`, value]
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status !== "success") {
      return { ok: false, error: "USDC transfer to pool failed." };
    }

    return {
      ok: true,
      txHash,
      explorerUrl: buildExplorerUrl(cfg.explorerBaseUrl, txHash),
      amount
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return { ok: false, error: `Deposit failed: ${msg}` };
  }
}

// ============================================================
// updateMerkleRoot — after drawing winners, update the pool
// ============================================================

export type UpdateMerkleRootResult =
  | { ok: true; txHash: string; explorerUrl: string }
  | { ok: false; error: string };

export async function updatePrizePoolMerkleRoot(input: {
  poolAddress: string;
  merkleRoot: string;
}): Promise<UpdateMerkleRootResult> {
  const cfg = getPoolConfig();

  if (!cfg.enabled) {
    return { ok: false, error: "PrizePool not configured." };
  }

  const chain = buildViemChain(cfg.chainId);
  const account = privateKeyToAccount(normalizePrivateKey(cfg.privateKey));
  const walletClient = createWalletClient({ account, chain, transport: http(cfg.rpcUrl) });
  const publicClient = createPublicClient({ chain, transport: http(cfg.rpcUrl) });

  try {
    const hash = await walletClient.writeContract({
      address: input.poolAddress as `0x${string}`,
      abi: prizePoolAbi,
      functionName: "updateMerkleRoot",
      args: [input.merkleRoot as `0x${string}`]
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") {
      return { ok: false, error: "updateMerkleRoot transaction failed." };
    }

    return {
      ok: true,
      txHash: hash,
      explorerUrl: buildExplorerUrl(cfg.explorerBaseUrl, hash)
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return { ok: false, error: `updateMerkleRoot failed: ${msg}` };
  }
}

// ============================================================
// getPoolInfo — read pool state from chain
// ============================================================

export async function getPrizePoolInfo(poolAddress: string) {
  if (!isUsablePrizePoolAddress(poolAddress)) return null;

  const cfg = getPoolConfig();
  const chain = buildViemChain(cfg.chainId);
  const publicClient = createPublicClient({ chain, transport: http(cfg.rpcUrl) });

  try {
    const result = await publicClient.readContract({
      address: poolAddress as `0x${string}`,
      abi: prizePoolAbi,
      functionName: "getPoolInfo",
      args: []
    }) as [bigint, bigint, bigint, boolean, boolean, bigint];

    return {
      poolBalance: formatUnits(result[0], USDC_DECIMALS),
      claimedTotal: result[1].toString(),
      remaining: formatUnits(result[2], USDC_DECIMALS),
      isPaused: result[3],
      isDrawn: result[4],
      slotsLeft: result[5].toString()
    };
  } catch (err) {
    return null;
  }
}

export type PrizePoolPayoutPreflightResult = {
  ok: boolean;
  issues: string[];
  poolAddress: string;
  owner?: string;
  signer?: string;
  agent?: string;
  expectedAgent?: string;
  deadline?: number;
  deadlineIso?: string;
  secondsUntilDeadline?: number;
  poolBalance?: string;
  expectedPayoutTotal?: string;
  slotsLeft?: number;
  expectedWinners?: number;
  isPaused?: boolean;
};

export async function getPrizePoolPayoutPreflight(input: {
  poolAddress: string;
  expectedPayoutTotal: string;
  expectedWinners: number;
  expectedAgent?: string;
}): Promise<PrizePoolPayoutPreflightResult> {
  const cfg = getPoolConfig();
  const issues: string[] = [];
  const base: PrizePoolPayoutPreflightResult = {
    ok: false,
    issues,
    poolAddress: input.poolAddress,
    expectedPayoutTotal: parseAmount(input.expectedPayoutTotal),
    expectedWinners: input.expectedWinners,
    expectedAgent: input.expectedAgent || undefined
  };

  if (!cfg.enabled) {
    issues.push("PrizePool signer is not configured.");
    return base;
  }
  if (!isUsablePrizePoolAddress(input.poolAddress)) {
    issues.push("Invalid PrizePool address.");
    return base;
  }
  if (input.expectedAgent && !isAddress(input.expectedAgent)) {
    issues.push("Expected refund agent address is invalid.");
    return base;
  }

  const chain = buildViemChain(cfg.chainId);
  const account = privateKeyToAccount(normalizePrivateKey(cfg.privateKey));
  const publicClient = createPublicClient({ chain, transport: http(cfg.rpcUrl) });
  const expectedPayoutTotal = parseUnits(parseAmount(input.expectedPayoutTotal), USDC_DECIMALS);

  try {
    const [owner, agent, deadline, poolInfo] = await Promise.all([
      publicClient.readContract({
        address: input.poolAddress as `0x${string}`,
        abi: prizePoolAbi,
        functionName: "owner",
        args: []
      }) as Promise<string>,
      publicClient.readContract({
        address: input.poolAddress as `0x${string}`,
        abi: prizePoolAbi,
        functionName: "agent",
        args: []
      }) as Promise<string>,
      publicClient.readContract({
        address: input.poolAddress as `0x${string}`,
        abi: prizePoolAbi,
        functionName: "deadline",
        args: []
      }) as Promise<bigint>,
      publicClient.readContract({
        address: input.poolAddress as `0x${string}`,
        abi: prizePoolAbi,
        functionName: "getPoolInfo",
        args: []
      }) as Promise<[bigint, bigint, bigint, boolean, boolean, bigint]>
    ]);

    const nowSeconds = Math.floor(Date.now() / 1000);
    const deadlineSeconds = Number(deadline);
    const poolBalance = poolInfo[0];
    const slotsLeft = Number(poolInfo[5]);

    if (owner.toLowerCase() !== account.address.toLowerCase()) {
      issues.push(`Backend signer ${account.address} is not PrizePool owner ${owner}.`);
    }
    if (input.expectedAgent && agent.toLowerCase() !== input.expectedAgent.toLowerCase()) {
      issues.push(`Refund agent mismatch. Pool agent is ${agent}, expected ${input.expectedAgent}.`);
    }
    if (deadlineSeconds <= nowSeconds) {
      issues.push("PrizePool claim deadline has passed. Extend the pool deadline before paying winners.");
    }
    if (poolInfo[3]) {
      issues.push("PrizePool is paused.");
    }
    if (slotsLeft < input.expectedWinners) {
      issues.push(`Not enough winner slots left. ${slotsLeft} slots left, ${input.expectedWinners} payouts pending.`);
    }
    if (poolBalance < expectedPayoutTotal) {
      issues.push(
        `Insufficient pool balance. Balance ${formatUnits(poolBalance, USDC_DECIMALS)} USDC, expected ${formatUnits(expectedPayoutTotal, USDC_DECIMALS)} USDC.`
      );
    }

    return {
      ...base,
      ok: issues.length === 0,
      owner,
      signer: account.address,
      agent,
      deadline: deadlineSeconds,
      deadlineIso: new Date(deadlineSeconds * 1000).toISOString(),
      secondsUntilDeadline: deadlineSeconds - nowSeconds,
      poolBalance: formatUnits(poolBalance, USDC_DECIMALS),
      slotsLeft,
      isPaused: poolInfo[3]
    };
  } catch (err) {
    issues.push(`Unable to read PrizePool state: ${err instanceof Error ? err.message : "unknown error"}`);
    return base;
  }
}

// ============================================================
// refundRemaining — agent calls refund after deadline
// ============================================================

export type RefundResult =
  | { ok: true; txHash: string; explorerUrl: string; amount: string }
  | { ok: false; error: string };

export async function refundPrizePool(input: {
  poolAddress: string;
}): Promise<RefundResult> {
  const cfg = getPoolConfig();

  if (!cfg.enabled) {
    return { ok: false, error: "PrizePool not configured." };
  }

  const chain = buildViemChain(cfg.chainId);
  const account = privateKeyToAccount(normalizePrivateKey(cfg.privateKey));
  const walletClient = createWalletClient({ account, chain, transport: http(cfg.rpcUrl) });
  const publicClient = createPublicClient({ chain, transport: http(cfg.rpcUrl) });

  try {
    const hash = await walletClient.writeContract({
      address: input.poolAddress as `0x${string}`,
      abi: prizePoolAbi,
      functionName: "refund",
      args: []
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") {
      return { ok: false, error: "Refund transaction failed on-chain." };
    }

    return {
      ok: true,
      txHash: hash,
      explorerUrl: buildExplorerUrl(cfg.explorerBaseUrl, hash),
      amount: "remaining"
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return { ok: false, error: `Refund failed: ${msg}` };
  }
}

// ============================================================
// claimOnChainPrizePool — winner claims directly on PrizePool
// ============================================================

export type ClaimOnChainResult =
  | { ok: true; txHash: string; explorerUrl: string }
  | { ok: false; error: string };

export async function claimOnChainPrizePool(input: {
  poolAddress: string;
  amount: string; // e.g. "0.5" USDC
  merkleProof: string[];
}): Promise<ClaimOnChainResult> {
  const cfg = getPoolConfig();

  if (!cfg.enabled) {
    return { ok: false, error: "PrizePool not configured." };
  }

  const chain = buildViemChain(cfg.chainId);
  const account = privateKeyToAccount(normalizePrivateKey(cfg.privateKey));
  const walletClient = createWalletClient({ account, chain, transport: http(cfg.rpcUrl) });
  const publicClient = createPublicClient({ chain, transport: http(cfg.rpcUrl) });

  const amountBn = parseUnits(input.amount, USDC_DECIMALS);

  try {
    const hash = await walletClient.writeContract({
      address: input.poolAddress as `0x${string}`,
      abi: prizePoolAbi,
      functionName: "claim",
      args: [amountBn, input.merkleProof as `0x${string}`[]]
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") {
      return { ok: false, error: "Claim transaction failed on-chain." };
    }

    return {
      ok: true,
      txHash: hash,
      explorerUrl: buildExplorerUrl(cfg.explorerBaseUrl, hash)
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return { ok: false, error: `claim failed: ${msg}` };
  }
}

// ============================================================
// claimForPrizePool — backend-verified FCFS payout
// ============================================================

export async function claimForPrizePool(input: {
  poolAddress: string;
  recipientAddress: string;
  amount: string;
}): Promise<ClaimOnChainResult> {
  const cfg = getPoolConfig();

  if (!cfg.enabled) {
    return { ok: false, error: "PrizePool not configured." };
  }
  if (!isAddress(input.poolAddress)) {
    return { ok: false, error: "Invalid PrizePool address." };
  }
  if (!isAddress(input.recipientAddress)) {
    return { ok: false, error: "Invalid recipient address." };
  }

  const chain = buildViemChain(cfg.chainId);
  const account = privateKeyToAccount(normalizePrivateKey(cfg.privateKey));
  const walletClient = createWalletClient({ account, chain, transport: http(cfg.rpcUrl) });
  const publicClient = createPublicClient({ chain, transport: http(cfg.rpcUrl) });
  const amountBn = parseUnits(input.amount, USDC_DECIMALS);

  try {
    const owner = await publicClient.readContract({
      address: input.poolAddress as `0x${string}`,
      abi: prizePoolAbi,
      functionName: "owner",
      args: []
    }) as string;

    if (owner.toLowerCase() !== account.address.toLowerCase()) {
      return {
        ok: false,
        error: `PrizePool signer ${account.address} is not pool owner ${owner}. Set PRIZE_POOL_PRIVATE_KEY to the pool owner key or deploy a pool owned by the backend signer.`
      };
    }

    const hash = await walletClient.writeContract({
      address: input.poolAddress as `0x${string}`,
      abi: prizePoolAbi,
      functionName: "claimFor",
      args: [input.recipientAddress as `0x${string}`, amountBn]
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") {
      return { ok: false, error: "claimFor transaction failed on-chain." };
    }

    return {
      ok: true,
      txHash: hash,
      explorerUrl: buildExplorerUrl(cfg.explorerBaseUrl, hash)
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return { ok: false, error: `claimFor failed: ${msg}` };
  }
}

function parseUnits(amount: string, decimals: number): bigint {
  const num = parseAmount(amount);
  const parts = num.split(".");
  const whole = BigInt(parts[0] || "0");
  const fracStr = (parts[1] || "000000").slice(0, decimals).padEnd(decimals, "0");
  const frac = BigInt(fracStr);
  return whole * BigInt(10 ** decimals) + frac;
}

export { formatUnits, parseUnits };
