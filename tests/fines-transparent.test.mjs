import test from "node:test";
import assert from "node:assert/strict";

/*
 * Transparent fine regression tests for the DANIJACE PROMOTIONS loan domain.
 *
 * These tests intentionally mirror the financial rules implemented in:
 * - src/lib/loans/types.ts
 * - src/lib/loans/fines/reconcile.ts
 *
 * The purpose is to make the fine policy explicit and executable without
 * needing a live MongoDB connection.
 */

function money(value) {
  if (!Number.isFinite(value)) {
    throw new Error("Invalid monetary value.");
  }

  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function normalizeRate(value) {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error("Rate must be between 0 and 1.");
  }

  return money(value);
}

function calculateLoanAmountDue(
  installmentAmount,
  principal,
  interestAmount,
  amountPaid,
) {
  const remainingCore = Math.max(
    0,
    money(principal + interestAmount) - amountPaid,
  );

  return money(
    Math.min(money(installmentAmount), remainingCore),
  );
}

function calculateFine(
  expectedInstallment,
  paymentsDuringPeriod,
  fineRate,
) {
  const installmentShortfall = money(
    Math.max(0, expectedInstallment - paymentsDuringPeriod),
  );

  const fineAmount = money(
    Math.max(0, installmentShortfall * fineRate),
  );

  return {
    expectedInstallment,
    paymentsDuringPeriod,
    installmentShortfall,
    fineRate,
    fineAmount,
  };
}

function runFineScenario({
  name,
  installmentAmount,
  principal,
  interestAmount,
  amountPaid,
  paymentsDuringPeriod,
  fineRate,
  expected,
}) {
  const normalizedRate = normalizeRate(fineRate);
  const expectedInstallment = calculateLoanAmountDue(
    installmentAmount,
    principal,
    interestAmount,
    amountPaid,
  );

  const result = calculateFine(
    expectedInstallment,
    paymentsDuringPeriod,
    normalizedRate,
  );

  assert.equal(
    result.expectedInstallment,
    expected.expectedInstallment,
    `${name}: expected installment mismatch`,
  );

  assert.equal(
    result.installmentShortfall,
    expected.installmentShortfall,
    `${name}: installment shortfall mismatch`,
  );

  assert.equal(
    result.fineAmount,
    expected.fineAmount,
    `${name}: fine amount mismatch`,
  );
}

test("Fine formula: no fine when the installment is fully paid", () => {
  runFineScenario({
    name: "Fully paid installment",
    installmentAmount: 5000,
    principal: 10000,
    interestAmount: 0,
    amountPaid: 5000,
    paymentsDuringPeriod: 5000,
    fineRate: 0.1,
    expected: {
      expectedInstallment: 5000,
      installmentShortfall: 0,
      fineAmount: 0,
    },
  });
});

test("Fine formula: shortfall is based on unpaid portion only", () => {
  runFineScenario({
    name: "Partial installment shortfall",
    installmentAmount: 5000,
    principal: 10000,
    interestAmount: 0,
    amountPaid: 2000,
    paymentsDuringPeriod: 3000,
    fineRate: 0.1,
    expected: {
      expectedInstallment: 5000,
      installmentShortfall: 2000,
      fineAmount: 200,
    },
  });
});

test("Fine formula: expected installment is capped by remaining core balance", () => {
  runFineScenario({
    name: "Remaining core balance caps expected installment",
    installmentAmount: 5000,
    principal: 7000,
    interestAmount: 0,
    amountPaid: 5000,
    paymentsDuringPeriod: 1000,
    fineRate: 0.1,
    expected: {
      expectedInstallment: 2000,
      installmentShortfall: 1000,
      fineAmount: 100,
    },
  });
});

test("Fine formula: zero fine rate produces zero fine", () => {
  runFineScenario({
    name: "Zero rate",
    installmentAmount: 5000,
    principal: 10000,
    interestAmount: 0,
    amountPaid: 2000,
    paymentsDuringPeriod: 1000,
    fineRate: 0,
    expected: {
      expectedInstallment: 5000,
      installmentShortfall: 4000,
      fineAmount: 0,
    },
  });
});

test("Fine formula: overpayment during period eliminates fine", () => {
  runFineScenario({
    name: "Overpayment removes fine",
    installmentAmount: 5000,
    principal: 10000,
    interestAmount: 0,
    amountPaid: 1000,
    paymentsDuringPeriod: 6000,
    fineRate: 0.1,
    expected: {
      expectedInstallment: 5000,
      installmentShortfall: 0,
      fineAmount: 0,
    },
  });
});

test("Fine formula: percentage is applied to shortfall, not total balance", () => {
  const loanBalance = 100000;
  const expectedInstallment = 10000;
  const paymentsDuringPeriod = 2500;
  const fineRate = 0.12;

  const result = calculateFine(
    expectedInstallment,
    paymentsDuringPeriod,
    normalizeRate(fineRate),
  );

  assert.equal(result.installmentShortfall, 7500);
  assert.equal(result.fineAmount, 900);
  assert.notEqual(result.fineAmount, loanBalance * fineRate);
});
