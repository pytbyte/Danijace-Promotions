/**
 * Savings domain types.
 *
 * IMPORTANT:
 * Savings transactions are financial records.
 *
 * Existing transactions must never be permanently deleted
 * or modified in a way that destroys their historical meaning.
 *
 * Corrections and reversals must be represented by NEW
 * transactions linked to the original transaction.
 */

/**
 * The type of financial movement recorded against a savings account.
 */
export type SavingsTransactionType =
  | "deposit"
  | "adjustment"
  | "reversal";

/**
 * Where the savings transaction originated.
 */
export type SavingsTransactionSource =
  | "sms"
  | "manual"
  | "system";

/**
 * Processing state of a savings transaction.
 */
export type SavingsTransactionStatus =
  | "pending"
  | "confirmed"
  | "reversed";

/**
 * The fixed savings account belonging to a member.
 *
 * IMPORTANT:
 * The application uses `id` as its public identifier.
 *
 * MongoDB's internal `_id` is handled only by the service layer.
 */
export interface SavingsAccount {
  id: string;

  /**
   * Member who owns the savings account.
   */
  memberId: string;

  /**
   * SACCO owning the account.
   */
  saccoId: string;

  /**
   * Cached member/SACCO names for display and historical context.
   */
  memberName: string;
  saccoName: string;

  /**
   * Cached current balance.
   *
   * The transaction ledger remains authoritative.
   */
  balance: number;

  /**
   * Account status.
   */
  isActive: boolean;

  createdAt: string;
  updatedAt: string;
}

/**
 * A single immutable financial movement in a savings account.
 *
 * Positive amounts increase savings.
 * Negative amounts decrease savings.
 *
 * Once confirmed, the financial meaning of a transaction
 * must never be silently changed.
 */
export interface SavingsTransaction {
  id: string;

  /**
   * Account affected by this transaction.
   */
  savingsAccountId: string;

  /**
   * Member who owns the account.
   */
  memberId: string;

  /**
   * SACCO owning the transaction.
   */
  saccoId: string;

  /**
   * Cached information for historical display.
   */
  memberName: string;
  saccoName: string;

  /**
   * Financial amount.
   *
   * Deposit:
   *   positive
   *
   * Adjustment:
   *   positive or negative
   *
   * Reversal:
   *   normally negative
   */
  amount: number;

  type: SavingsTransactionType;

  source: SavingsTransactionSource;

  status: SavingsTransactionStatus;

  /**
   * External transaction/reference number.
   *
   * Examples:
   * - Capiter transaction reference
   * - M-Pesa receipt number
   * - Manual reference
   */
  reference?: string;

  /**
   * Reference to the originating SMS.
   */
  smsId?: string;

  /**
   * Controlled source reference for reconciliation.
   */
  sourceReference?: string;

  /**
   * If this transaction corrects or reverses another
   * transaction, this points to the original transaction.
   */
  relatedTransactionId?: string;

  /**
   * Human-readable explanation for an adjustment or reversal.
   */
  reason?: string;

  /**
   * User/system responsible for recording the transaction.
   */
  recordedBy?: {
    userId?: string;
    email?: string;
    name?: string;
  };

  /**
   * Actual date/time the financial event occurred.
   *
   * This may differ from createdAt when an SMS is processed
   * later or a historical entry is recorded.
   */
  transactionAt: string;

  /**
   * When the application recorded the transaction.
   */
  createdAt: string;

  /**
   * Last metadata update.
   *
   * Financial meaning must not be changed through ordinary updates.
   */
  updatedAt: string;

  /**
   * Offline-first synchronization state.
   */
  synced: boolean;
}