import type { ObjectId } from "mongodb";

/* =========================================================
   INCOMING BANK SMS
========================================================= */

export type BankTransactionType =
  | "credit"
  | "debit"
  | "unknown";

export type BankAccountType =
  | "loan"
  | "savings"
  | "unknown";

export interface BankSmsMessage {
  address: string | null;
  body: string;
  date: number;
}

export interface ParsedBankTransaction {
  transactionReference: string;
  amount: number;
  transactionDate: Date;
  accountNumber: string;
  type: BankTransactionType;
  rawMessage: string;
  sender: string | null;
}

export interface ResolvedAccount {
  accountId: string;
  accountNumber: string;
  memberId: string;
  memberNumber: string;
  accountType: BankAccountType;
  loanId?: string;
  savingsAccountId?: string;
}

/* =========================================================
   OUTGOING SMS
========================================================= */

export const SMS_TYPES = {
  LOAN_DISBURSEMENT:
    "loan_disbursement",

  LOAN_PAYMENT_RECEIVED:
    "loan_payment_received",

  LOAN_PAYMENT_REMINDER:
    "loan_payment_reminder",

  LOAN_CLEARED:
    "loan_cleared",

  SAVINGS_DEPOSIT:
    "savings_deposit",
} as const;

export type SmsType =
  (typeof SMS_TYPES)[keyof typeof SMS_TYPES];

/* =========================================================
   SMS STATUS
========================================================= */

export const SMS_STATUSES = {
  PENDING: "pending",
  PROCESSING: "processing",
  SENT: "sent",
  FAILED: "failed",
  CANCELLED: "cancelled",
} as const;

export type SmsStatus =
  (typeof SMS_STATUSES)[keyof typeof SMS_STATUSES];

/* =========================================================
   SMS OUTBOX DOCUMENT
========================================================= */

export interface SmsOutboxDocument {
  _id?: ObjectId;

  type: SmsType;

  memberId?: ObjectId;

  loanId?: ObjectId;

  recipient: string;

  message: string;

  status: SmsStatus;

  /**
   * Lower number means higher priority.
   *
   * 10 = immediate financial notification
   * 20 = normal notification
   * 50 = reminder
   */
  priority: number;

  /**
   * DANIJACE PROMOTIONS financial calendar date.
   *
   * YYYY-MM-DD
   */
  scheduledFor?: string;

  /**
   * Queue processing timestamp.
   */
  availableAt: Date;

  /**
   * Number of sending attempts.
   */
  attempts: number;

  /**
   * Maximum number of attempts before
   * the SMS becomes permanently failed.
   */
  maxAttempts: number;

  /**
   * Android device currently processing
   * this SMS.
   */
  claimedBy?: string;

  claimedAt?: Date;

  sentAt?: Date;

  failedAt?: Date;

  failureReason?: string;

  /**
   * ID returned by the Android SMS sender,
   * when available.
   */
  providerMessageId?: string;

  /**
   * Prevents duplicate SMS messages when
   * the same financial event is processed
   * more than once.
   */
  idempotencyKey: string;

  createdAt: Date;

  updatedAt: Date;
}

/* =========================================================
   QUEUE SMS
========================================================= */

export interface QueueSmsInput {
  type: SmsType;

  memberId?: string;

  loanId?: string;

  recipient: string;

  message: string;

  priority?: number;

  /**
   * Financial calendar date.
   *
   * YYYY-MM-DD
   */
  scheduledFor?: string;

  /**
   * Actual queue timestamp.
   */
  availableAt?: Date;

  maxAttempts?: number;

  /**
   * Must uniquely identify the financial
   * event that produced this SMS.
   */
  idempotencyKey: string;
}

/* =========================================================
   CLAIM SMS
========================================================= */

export interface ClaimSmsInput {
  deviceId: string;

  /**
   * Maximum number of messages to claim
   * in one request.
   */
  limit?: number;
}

export interface SmsClaim {
  id: string;

  type: SmsType;

  memberId?: string;

  loanId?: string;

  recipient: string;

  message: string;

  scheduledFor?: string;

  attempts: number;
}

/* =========================================================
   SMS RESULT
========================================================= */

export type SmsResultStatus =
  | "sent"
  | "failed";

export interface ReportSmsResultInput {
  deviceId: string;

  smsId: string;

  status: SmsResultStatus;

  /**
   * Android/provider message identifier,
   * when available.
   */
  providerMessageId?: string;

  /**
   * Android failure information.
   */
  error?: string;
}

