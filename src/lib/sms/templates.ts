import {
  SMS_TYPES,
  type SmsType,
} from "./types";

/* =========================================================
   FORMATTERS
========================================================= */

function formatKes(
  amount: number,
): string {
  return `KES ${amount.toLocaleString(
    "en-KE",
    {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    },
  )}`;
}

function cleanName(
  name: string,
): string {
  return name.trim() || "Member";
}

/* =========================================================
   LOAN DISBURSEMENT
========================================================= */

export function buildLoanDisbursementSms(input: {
  memberName: string;
  loanNumber: string;
  amount: number;
}): string {
  return [
    `GEO-SHUA: Dear ${cleanName(input.memberName)},`,
    `your loan ${input.loanNumber} of ${formatKes(input.amount)} has been approved and disbursed.`,
    `Thank you for choosing GEO-SHUA.`,
  ].join(" ");
}

/* =========================================================
   LOAN PAYMENT
========================================================= */

export function buildLoanPaymentReceivedSms(input: {
  memberName: string;
  loanNumber: string;
  amount: number;
  balance?: number;
}): string {
  const balanceText =
    input.balance !== undefined
      ? ` Outstanding balance: ${formatKes(input.balance)}.`
      : "";

  return [
    `GEO-SHUA: Dear ${cleanName(input.memberName)},`,
    `your payment of ${formatKes(input.amount)} for loan ${input.loanNumber} has been received.`,
    balanceText,
  ].join(" ").trim();
}

/* =========================================================
   LOAN REMINDER
========================================================= */

export function buildLoanPaymentReminderSms(input: {
  memberName: string;
  loanNumber: string;
  installmentAmount: number;
  dueDate: string;
}): string {
  return [
    `GEO-SHUA reminder: Dear ${cleanName(input.memberName)},`,
    `your weekly installment of ${formatKes(input.installmentAmount)} for loan ${input.loanNumber} is due on ${input.dueDate}.`,
    `Please make your payment on time.`,
  ].join(" ");
}

/* =========================================================
   INSTALLMENT CLEARED
========================================================= */

export function buildLoanInstallmentClearedSms(input: {
  memberName: string;
  loanNumber: string;
}): string {
  return [
    `GEO-SHUA: Dear ${cleanName(input.memberName)},`,
    `your current installment for loan ${input.loanNumber} has been cleared.`,
    `Thank you for your payment.`,
  ].join(" ");
}

/* =========================================================
   SAVINGS DEPOSIT
========================================================= */

export function buildSavingsDepositSms(input: {
  memberName: string;
  amount: number;
  accountNumber: string;
  balance?: number;
}): string {
  const balanceText =
    input.balance !== undefined
      ? ` Your savings balance is ${formatKes(input.balance)}.`
      : "";

  return [
    `GEO-SHUA: Dear ${cleanName(input.memberName)},`,
    `your savings deposit of ${formatKes(input.amount)} to ${input.accountNumber} has been received.`,
    balanceText,
  ].join(" ").trim();
}

/* =========================================================
   SAVINGS WITHDRAWAL
========================================================= */

export function buildSavingsWithdrawalSms(input: {
  memberName: string;
  amount: number;
  accountNumber: string;
  balance?: number;
}): string {
  const balanceText =
    input.balance !== undefined
      ? ` Your savings balance is ${formatKes(input.balance)}.`
      : "";

  return [
    `GEO-SHUA: Dear ${cleanName(input.memberName)},`,
    `your savings withdrawal of ${formatKes(input.amount)} from ${input.accountNumber} has been processed.`,
    balanceText,
  ].join(" ").trim();
}

/* =========================================================
   SMS TYPE GUARD
========================================================= */

export function isSmsType(
  value: string,
): value is SmsType {
  return Object.values(
    SMS_TYPES,
  ).includes(value as SmsType);
}
