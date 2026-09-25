
import {
  queueSms,
} from "@/lib/sms/outbox/service";

import {
  SMS_TYPES,
} from "@/lib/sms/types";

/* =========================================================
   PRIORITIES
========================================================= */

const IMMEDIATE_PRIORITY = 10;
const REMINDER_PRIORITY = 50;

/* =========================================================
   HELPERS
========================================================= */

function required(
  value: string | undefined,
  field: string,
): string {
  const result = value?.trim();

  if (!result) {
    throw new Error(`${field} is required.`);
  }

  return result;
}

function positiveAmount(
  amount: number,
): number {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error(
      "SMS amount must be greater than zero.",
    );
  }

  return amount;
}

function formatAmount(
  amount: number,
): string {
  positiveAmount(amount);

  return amount.toLocaleString("en-KE", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

function positiveInteger(
  value: number,
  field: string,
): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(
      `${field} must be a positive integer.`,
    );
  }

  return value;
}

/* =========================================================
   SAVINGS DEPOSIT
========================================================= */

export async function queueSavingsDepositSms(
  data: {
    transactionId: string;
    memberId: string;
    recipient: string;
    memberName: string;
    amount: number;
  },
): Promise<string> {
  const transactionId = required(
    data.transactionId,
    "transactionId",
  );

  const memberId = required(
    data.memberId,
    "memberId",
  );

  const recipient = required(
    data.recipient,
    "recipient",
  );

  const memberName = required(
    data.memberName,
    "memberName",
  );

  const amount = positiveAmount(
    data.amount,
  );

  const message =
    `XAUUSD\n Dear ${memberName}, savings deposit of KES ${formatAmount(amount)} received. Thank you.`;

  return queueSms({
    type: SMS_TYPES.SAVINGS_DEPOSIT,
    memberId,
    recipient,
    message,
    priority: IMMEDIATE_PRIORITY,
    idempotencyKey:
      `savings_deposit:${transactionId}`,
  });
}

/* =========================================================
   LOAN PAYMENT RECEIVED
========================================================= */

export async function queueLoanPaymentReceivedSms(
  data: {
    repaymentId: string;
    loanId: string;
    memberId: string;
    recipient: string;
    memberName: string;
    amount: number;
    remainingBalance?: number;
  },
): Promise<string> {
  const repaymentId = required(
    data.repaymentId,
    "repaymentId",
  );

  const loanId = required(
    data.loanId,
    "loanId",
  );

  const memberId = required(
    data.memberId,
    "memberId",
  );

  const recipient = required(
    data.recipient,
    "recipient",
  );

  const memberName = required(
    data.memberName,
    "memberName",
  );

  const amount = positiveAmount(
    data.amount,
  );

  let message =
    `GEO-SHUA LTD \nDear ${memberName}, loan payment of KES ${formatAmount(amount)} has been received.\n Thank you.`;

  return queueSms({
    type: SMS_TYPES.LOAN_PAYMENT_RECEIVED,
    memberId,
    loanId,
    recipient,
    message,
    priority: IMMEDIATE_PRIORITY,
    idempotencyKey:
      `loan_payment_received:${repaymentId}`,
  });
}

/* =========================================================
   LOAN DISBURSEMENT
========================================================= */

export async function queueLoanDisbursementSms(
  data: {
    loanId: string;
    memberId: string;
    recipient: string;
    memberName: string;
    amount: number;
    installmentAmount?: number;
    repaymentWeeks?: number;
    repaymentDay?: string;
    firstDueDate?: string;
    finalDueDate?: string;
    paybill?: string;
    accountNumber?: string;
    fineRate?: number;
  },
): Promise<string> {
  const loanId = required(
    data.loanId,
    "loanId",
  );

  const memberId = required(
    data.memberId,
    "memberId",
  );

  const recipient = required(
    data.recipient,
    "recipient",
  );

  const memberName = required(
    data.memberName,
    "memberName",
  );

  const amount = positiveAmount(
    data.amount,
  );

  const paybill =
    data.paybill?.trim() ||
    "542542";

  const accountNumber =
    data.accountNumber?.trim() ||
    "082083";

  const message = [
    `GEO-SHUA LTD`,
    `Dear ${memberName}, your loan of Ksh ${formatAmount(amount)} has been approved.`,
    `Weekly payment through`,
    `Paybill: ${paybill}`,
    `Account: ${accountNumber}`,
    `Thank you.`,
  ].join("\n");

  return queueSms({
    type:
      SMS_TYPES.LOAN_DISBURSEMENT,
    memberId,
    loanId,
    recipient,
    message,
    priority:
      IMMEDIATE_PRIORITY,
    idempotencyKey:
      `loan_disbursement:${loanId}`,
  });
}

/* =========================================================
   LOAN PAYMENT REMINDER
========================================================= */

export async function queueLoanPaymentReminderSms(
  data: {
    loanId: string;
    memberId: string;
    recipient: string;
    memberName: string;
    periodNumber: number;
    installmentAmount: number;
    dueDate: string;
    scheduledFor?: string;
  },
): Promise<string> {
  const loanId = required(
    data.loanId,
    "loanId",
  );

  const memberId = required(
    data.memberId,
    "memberId",
  );

  const recipient = required(
    data.recipient,
    "recipient",
  );

  const memberName = required(
    data.memberName,
    "memberName",
  );

  const periodNumber =
    positiveInteger(
      data.periodNumber,
      "periodNumber",
    );

  const installmentAmount =
    positiveAmount(
      data.installmentAmount,
    );

  const dueDate = required(
    data.dueDate,
    "dueDate",
  );

  const scheduledFor =
    data.scheduledFor?.trim();

  const message =
    `GEO-SHUA LTD \n Dear ${memberName} your weekly loan payment is due ${dueDate}. Please pay on time.`;

  return queueSms({
    type: SMS_TYPES.LOAN_PAYMENT_REMINDER,
    memberId,
    loanId,
    recipient,
    message,
    priority: REMINDER_PRIORITY,
    ...(scheduledFor
      ? { scheduledFor }
      : {}),
    idempotencyKey:
      `loan_payment_reminder:${loanId}:${periodNumber}`,
  });
}

/* =========================================================
   LOAN CLEARED
========================================================= */

export async function queueLoanClearedSms(
  data: {
    loanId: string;
    memberId: string;
    recipient: string;
    memberName: string;
  },
): Promise<string> {
  const loanId = required(
    data.loanId,
    "loanId",
  );

  const memberId = required(
    data.memberId,
    "memberId",
  );

  const recipient = required(
    data.recipient,
    "recipient",
  );

  const memberName = required(
    data.memberName,
    "memberName",
  );

  const message =
    `GEO-SHUA\n Dear ${memberName}, your loan is fully cleared. Thank you.: `;

  return queueSms({
    type: SMS_TYPES.LOAN_CLEARED,
    memberId,
    loanId,
    recipient,
    message,
    priority: IMMEDIATE_PRIORITY,
    idempotencyKey:
      `loan_cleared:${loanId}`,
  });
}
