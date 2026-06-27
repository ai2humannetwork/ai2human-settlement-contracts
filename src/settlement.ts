import { executeBaseSettlement, isValidBaseWalletAddress } from "./baseSettlement";
import { executeBnbSettlement, isValidBnbWalletAddress } from "./bnbSettlement";
import { executeSolanaSettlement, isValidSolanaWalletAddress } from "./solanaSettlement";
import { executeXLayerSettlement, isValidWalletAddress as isValidXLayerWalletAddress } from "./xlayerSettlement";
import type { SettlementRail, SettlementReceipt } from "./settlementTypes";

export type { SettlementRail, SettlementReceipt } from "./settlementTypes";

export const DEFAULT_SETTLEMENT_RAIL: SettlementRail =
  parseSettlementRail(
    process.env.NEXT_PUBLIC_DEFAULT_SETTLEMENT_RAIL || process.env.DEFAULT_SETTLEMENT_RAIL
  ) || "base";

export function parseSettlementRail(value: unknown): SettlementRail | null {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === "base") return "base";
  if (normalized === "bnb") return "bnb";
  if (normalized === "xlayer") return "xlayer";
  if (normalized === "solana") return "solana";
  return null;
}

export function getSettlementRailLabel(rail: SettlementRail): string {
  if (rail === "base") return "Base";
  if (rail === "bnb") return "BNB Chain";
  if (rail === "solana") return "Solana";
  return "X Layer";
}

export function isValidSettlementAddress(value: string): boolean {
  return (
    isValidBaseWalletAddress(value) ||
    isValidBnbWalletAddress(value) ||
    isValidXLayerWalletAddress(value) ||
    isValidSolanaWalletAddress(value)
  );
}

export function inferSettlementRailFromAddress(value: string): SettlementRail | null {
  const normalized = String(value || "").trim();
  if (!normalized) return null;
  if (isValidSolanaWalletAddress(normalized)) return "solana";
  if (
    isValidBaseWalletAddress(normalized) ||
    isValidBnbWalletAddress(normalized) ||
    isValidXLayerWalletAddress(normalized)
  ) {
    return DEFAULT_SETTLEMENT_RAIL;
  }
  return null;
}

export async function executeSettlement(input: {
  amount: string;
  receiverAddress?: string;
  rail?: SettlementRail;
}): Promise<SettlementReceipt> {
  const rail = input.rail || DEFAULT_SETTLEMENT_RAIL;
  if (rail === "base") {
    return executeBaseSettlement({
      amount: input.amount,
      receiverAddress: input.receiverAddress
    });
  }
  if (rail === "bnb") {
    return executeBnbSettlement({
      amount: input.amount,
      receiverAddress: input.receiverAddress
    });
  }
  if (rail === "solana") {
    return executeSolanaSettlement({
      amount: input.amount,
      receiverAddress: input.receiverAddress
    });
  }

  return executeXLayerSettlement({
    amount: input.amount,
    receiverAddress: input.receiverAddress
  });
}
