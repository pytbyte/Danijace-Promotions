import {
  queueSms,
} from "@/lib/sms/outbox/service";

import {
  SMS_TYPES,
} from "@/lib/sms/types";

/* =========================================================
   CONSTANTS
========================================================= */

const IMMEDIATE_PRIORITY = 10;

const REMINDER_PRIORITY = 50;

/* =========================================================
   HELPERS
========================================================= */

function requireValue(
  value: string | undefined,
  field: string,
): string {
  const normalized =
    value?.trim();

  if (!normalized) {
    throw new Error(
      `${field} is required.`,
    );
  }

  return normalized;
}

function formatAmount(
  amount: number,
): string {
  if (
    !Number.isFinite(amount) ||
    amount < 0
  ) {
    throw new Error(
      "SMS amount must be a valid non-negative number.",
    );
  }

  return amount.toLocaleString(
    "en-KE",
    {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    },
  );
}

function requirePositiveAmount(
  amount: number,
): number {
  if (
    !Number.isFinite(amount) ||
    amount <= 0
  ) {
    throw new Error(
      "SMS amount must be greater than zero.",
    );
  }

  return amount;
}

/* =========================================================
   SAVINGS DEPOSIT
========================================================= */

/**
 * Queues a savings deposit receipt.
 *
 * The notification intentionally does not include the
 * member's savings balance.
 *
 * Idempotency:
 *
 * savings_deposit:<transactionId>
 */
export async function queueSavingsDepositSms(
  data: {
    transactionId: string;
    memberId: string;
    recipient: string;
    memberName: string;
    amount: number;
  },
): Promise<string> {
  const transactionId =
    requireValue(
      data.transactionId,
      "transactionId",
    );

  const memberId =
    requireValue(
      data.memberId,
      "memberId",
    );

  const recipient =
    requireValue(
      data.recipient,
      "recipient",
    );

  const memberName =
    requireValue(
      data.memberName,
      "memberName",
    );

  const amount =
    requirePositiveAmount(
      data.amount,
    );

  const message =
    `GEO-SHUA: Hi ${memberName}, we have received your savings deposit of KES ${formatAmount(amount)}. Thank you.`;

  return queueSms({
    type:
      SMS_TYPES.SAVINGS_DEPOSIT,

    memberId,

    recipient,

    message,

    priority:
      IMMEDIATE_PRIORITY,

    idempotencyKey:
      `savings_deposit:${transactionId}`,
  });
}

/* =========================================================
   LOAN PAYMENT RECEIVED
========================================================= */

/**
 * Queues a loan repayment receipt.
 *
 * Idempotency:
 *
 * loan_payment_received:<repaymentId>
 */
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
  const repaymentId =
    requireValue(
      data.repaymentId,
      "repaymentId",
    );

  const loanId =
    requireValue(
      data.loanId,
      "loanId",
    );

  const memberId =
    requireValue(
      data.memberId,
      "memberId",
    );

  const recipient =
    requireValue(
      data.recipient,
      "recipient",
    );

  const memberName =
    requireValue(
      data.memberName,
      "memberName",
    );

  const amount =
    requirePositiveAmount(
      data.amount,
    );

  const remainingBalance =
    data.remainingBalance !== undefined
      ? formatAmount(
          data.remainingBalance,
        )
      : undefined;

  const message =
    remainingBalance !== undefined
      ? `GEO-SHUA: Hi ${memberName}, your loan repayment of KES ${formatAmount(amount)} has been received. Remaining loan balance: KES ${remainingBalance}.`
      : `GEO-SHUA: Hi ${memberName}, your loan repayment of KES ${formatAmount(amount)} has been received. Thank you.`;

  return queueSms({
    type:
      SMS_TYPES.LOAN_PAYMENT_RECEIVED,

    memberId,

    loanId,

    recipient,

    message,

    priority:
      IMMEDIATE_PRIORITY,

    idempotencyKey:
      `loan_payment_received:${repaymentId}`,
  });
}

/* =========================================================
   LOAN DISBURSEMENT
========================================================= */

/**
 * Queues the loan disbursement notification.
 *
 * Idempotency:
 *
 * loan_disbursement:<loanId>
 */
export async function queueLoanDisbursementSms(
  data: {
    loanId: string;
    memberId: string;
    recipient: string;
    memberName: string;
    amount: number;
    installmentAmount?: number;
    firstDueDate?: string;
  },
): Promise<string> {
  const loanId =
    requireValue(
      data.loanId,
      "loanId",
    );

  const memberId =
    requireValue(
      data.memberId,
      "memberId",
    );

  const recipient =
    requireValue(
      data.recipient,
      "recipient",
    );

  const memberName =
    requireValue(
      data.memberName,
      "memberName",
    );

  const amount =
    requirePositiveAmount(
      data.amount,
    );

  const installmentAmount =
    data.installmentAmount !== undefined
      ? requirePositiveAmount(
          data.installmentAmount,
        )
      : undefined;

  const firstDueDate =
    data.firstDueDate
      ? requireValue(
          data.firstDueDate,
          "firstDueDate",
        )
      : undefined;

  const details: string[] = [];

  details.push(
    `KES ${formatAmount(amount)} has been approved and disbursed to your GEO-SHUA loan.`,
  );

  if (
    installmentAmount !==
    undefined
  ) {
    details.push(
      `Your weekly installment is KES ${formatAmount(installmentAmount)}.`,
    );
  }

  if (firstDueDate) {
    details.push(
      `Your first due date is ${firstDueDate}.`,
    );
  }

  const message =
    `GEO-SHUA: Hi ${memberName}, ` +
    details.join(" ") +
    ` Thank you.`;

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

/**
 * Queues a reminder for an upcoming loan installment.
 *
 * The reminder is normally scheduled one calendar day before
 * the installment due date.
 *
 * Idempotency:
 *
 * loan_payment_reminder:<loanId>:<periodNumber>
 */
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
  const loanId =
    requireValue(
      data.loanId,
      "loanId",
    );

  const memberId =
    requireValue(
      data.memberId,
      "memberId",
    );

  const recipient =
    requireValue(
      data.recipient,
      "recipient",
    );

  const memberName =
    requireValue(
      data.memberName,
      "memberName",
    );

  if (
    !Number.isInteger(
      data.periodNumber,
    ) ||
    data.periodNumber <= 0
  ) {
    throw new Error(
      "periodNumber must be a positive integer.",
    );
  }

  const installmentAmount =
    requirePositiveAmount(
      data.installmentAmount,
    );

  const dueDate =
    requireValue(
      data.dueDate,
      "dueDate",
    );

  const scheduledFor =
    data.scheduledFor
      ? requireValue(
          data.scheduledFor,
          "scheduledFor",
        )
      : undefined;

  const message =
    `GEO-SHUA: Hi ${memberName}, this is a reminder that your loan installment of KES ${formatAmount(installmentAmount)} is due on ${dueDate}. Please make your payment on time. Thank you.`;

  return queueSms({
    type:
      SMS_TYPES.LOAN_PAYMENT_REMINDER,

    memberId,

    loanId,

    recipient,

    message,

    priority:
      REMINDER_PRIORITY,

    ...(scheduledFor
      ? {
          scheduledFor,
        }
      : {}),

    idempotencyKey:
      `loan_payment_reminder:${loanId}:${data.periodNumber}`,
  });
}

/* =========================================================
   LOAN CLEARED
========================================================= */

/**
 * Queues the final loan-clearance notification.
 *
 * Idempotency:
 *
 * loan_cleared:<loanId>
 */
export async function queueLoanClearedSms(
  data: {
    loanId: string;
    memberId: string;
    recipient: string;
    memberName: string;
  },
): Promise<string> {
  const loanId =
    requireValue(
      data.loanId,
      "loanId",
    );

  const memberId =
    requireValue(
      data.memberId,
      "memberId",
    );

  const recipient =
    requireValue(
      data.recipient,
      "recipient",
    );

  const memberName =
    requireValue(
      data.memberName,
      "memberName",
    );

  const message =
    `GEO-SHUA: Hi ${memberName}, your loan has been fully cleared. Thank you for completing your repayment with GEO-SHUA.`;

  return queueSms({
    type:
      SMS_TYPES.LOAN_CLEARED,

    memberId,

    loanId,

    recipient,

    message,

    priority:
      IMMEDIATE_PRIORITY,

    idempotencyKey:
      `loan_cleared:${loanId}`,
  });
}

