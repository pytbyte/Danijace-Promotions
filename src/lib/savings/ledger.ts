export type SavingsBalanceTotals = {
  totalDeposits: number;
  totalWithdrawals: number;
  totalReversals: number;
};

export type SavingsLedgerTransactionLike = {
  memberId?: string | null;
  type?: string | null;
  amount?: number | null;
  status?: string | null;
};

export function calculateAvailableSavingsBalance(
  totals: SavingsBalanceTotals,
): number {
  const totalDeposits = Number.isFinite(totals.totalDeposits)
    ? Math.max(0, totals.totalDeposits)
    : 0;

  const totalWithdrawals = Number.isFinite(totals.totalWithdrawals)
    ? Math.max(0, totals.totalWithdrawals)
    : 0;

  const totalReversals = Number.isFinite(totals.totalReversals)
    ? Math.max(0, totals.totalReversals)
    : 0;

  return Math.max(0, totalDeposits - totalWithdrawals - totalReversals);
}

export function calculateMemberAvailableSavingsBalance(
  transactions: SavingsLedgerTransactionLike[],
  memberId: string | null | undefined,
): number {
  if (!memberId) {
    return 0;
  }

  const totals = transactions.reduce<SavingsBalanceTotals>(
    (result, transaction) => {
      if (String(transaction.memberId ?? "") !== String(memberId)) {
        return result;
      }

      if (transaction.status && transaction.status !== "confirmed") {
        return result;
      }

      const amount = Number(transaction.amount ?? 0);

      if (!Number.isFinite(amount)) {
        return result;
      }

      if (transaction.type === "deposit" && amount > 0) {
        result.totalDeposits += amount;
      }

      if (transaction.type === "adjustment" && amount !== 0) {
        result.totalWithdrawals += Math.abs(amount);
      }

      if (transaction.type === "reversal" && amount !== 0) {
        result.totalReversals += Math.abs(amount);
      }

      return result;
    },
    {
      totalDeposits: 0,
      totalWithdrawals: 0,
      totalReversals: 0,
    },
  );

  return calculateAvailableSavingsBalance(totals);
}
