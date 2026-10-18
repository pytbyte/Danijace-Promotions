import { test } from "node:test";
import assert from "node:assert/strict";

import {
  calculateAvailableSavingsBalance,
  calculateMemberAvailableSavingsBalance,
} from "./ledger";

test("available savings subtracts withdrawals and reversals from deposits", () => {
  const available = calculateAvailableSavingsBalance({
    totalDeposits: 15000,
    totalWithdrawals: 3000,
    totalReversals: 10000,
  });

  assert.equal(available, 2000);
});

test("negative totals are treated as zero", () => {
  const available = calculateAvailableSavingsBalance({
    totalDeposits: 0,
    totalWithdrawals: 500,
    totalReversals: 0,
  });

  assert.equal(available, 0);
});

test("member available savings subtracts withdrawals and reversals from deposits", () => {
  const available = calculateMemberAvailableSavingsBalance(
    [
      { memberId: "member-1", type: "deposit", amount: 6000, status: "confirmed" },
      { memberId: "member-1", type: "deposit", amount: 5000, status: "confirmed" },
      { memberId: "member-1", type: "adjustment", amount: -2000, status: "confirmed" },
      { memberId: "member-1", type: "reversal", amount: 1500, status: "confirmed" },
      { memberId: "member-2", type: "deposit", amount: 10000, status: "confirmed" },
    ],
    "member-1",
  );

  assert.equal(available, 7500);
});
