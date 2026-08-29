/**
 * Savings domain types.
 *
 * =========================================================
 * FINANCIAL RULES
 * =========================================================
 *
 * 1. Savings transactions are permanent financial ledger records.
 * 2. Existing transaction amounts must NEVER be changed.
 * 3. Existing transaction references must NEVER be changed.
 * 4. Existing transaction dates must NEVER be changed.
 * 5. Corrections are represented by NEW adjustment transactions.
 * 6. Reversals are represented by NEW reversal transactions.
 * 7. A reversal contains the exact opposite amount of the
 *    transaction being reversed.
 * 8. Adjustments are signed financial deltas.
 * 9. The transaction ledger is authoritative for balances.
 * 10. savingsAccounts.balance is only a cached balance.
 * 11. Duplicate external transactions must be idempotent.
 * 12. Transactions must never be permanently deleted.
 * 13. Marking an original transaction as "reversed" is
 *     metadata only. It does not change its amount.
 *
 * =========================================================
 * ID RULE
 * =========================================================
 *
 * Application/API IDs are strings.
 *
 * MongoDB internally uses:
 *
 *   savingsAccounts._id -> ObjectId
 *   savingsAccounts.memberId -> ObjectId
 *
 * Conversion between MongoDB ObjectId and application
 * string IDs belongs in savings/service.ts.
 *
 * =========================================================
 * ACCOUNT COMPATIBILITY
 * =========================================================
 *
 * Existing MongoDB savings accounts may look like:
 *
 * {
 *   _id: ObjectId(...),
 *   memberId: ObjectId(...),
 *   accountNumber: "SAV-000001",
 *   accountType: "fixed",
 *   balance: 0,
 *   status: "active",
 *   createdAt: "...",
 *   updatedAt: "...",
 *   createdBy: "system"
 * }
 *
 * SACCO information is intentionally NOT part of the
 * savings domain.
 *
 * One member has one fixed savings account.
 *
 * =========================================================
 */

/* =========================================================
   TRANSACTION TYPES
========================================================= */

export type SavingsTransactionType =
  | "deposit"
  | "adjustment"
  | "reversal";

/* =========================================================
   TRANSACTION SOURCES
========================================================= */

export type SavingsTransactionSource =
  | "sms"
  | "manual"
  | "system";

/* =========================================================
   TRANSACTION STATUS
========================================================= */

export type SavingsTransactionStatus =
  | "pending"
  | "confirmed"
  | "reversed";

/* =========================================================
   ACCOUNT TYPES
========================================================= */

export type SavingsAccountType =
  | "fixed";

/* =========================================================
   ACCOUNT STATUS
========================================================= */

export type SavingsAccountStatus =
  | "active"
  | "inactive";

/* =========================================================
   RECORDED BY
========================================================= */

export interface SavingsTransactionRecordedBy {
  userId?: string;
  email?: string;
  name?: string;
}

/* =========================================================
   SAVINGS ACCOUNT
========================================================= */

/**
 * Fixed savings account belonging to a member.
 *
 * There is one fixed savings account per member.
 *
 * Application representation:
 *
 *   id       -> string
 *   memberId -> string
 *
 * MongoDB representation:
 *
 *   _id      -> ObjectId
 *   memberId -> ObjectId
 *
 * SACCO information is intentionally excluded.
 */
export interface SavingsAccount {
  /**
   * Public application identifier.
   *
   * MongoDB _id is converted from ObjectId to string
   * by savings/service.ts.
   */
  id: string;

  /**
   * Member who owns the account.
   *
   * Application representation is a string.
   *
   * MongoDB representation is ObjectId.
   */
  memberId: string;

  /**
   * Cached member name.
   *
   * Stored for display convenience.
   *
   * The member collection remains the authoritative
   * source for current member information.
   */
  memberName: string;

  /**
   * Public savings account number.
   *
   * Example:
   *
   *   SAV-000001
   */
  accountNumber: string;

  /**
   * Savings account type.
   *
   * GEO-SHUA currently uses fixed savings accounts.
   */
  accountType: SavingsAccountType;

  /**
   * Cached current balance.
   *
   * IMPORTANT:
   *
   * This is NOT the authoritative financial balance.
   *
   * The authoritative balance is calculated from the
   * savings transaction ledger.
   */
  balance: number;

  /**
   * Account lifecycle status.
   */
  status: SavingsAccountStatus;

  /**
   * Convenience boolean used by application code.
   *
   * This is derived from:
   *
   *   status === "active"
   *
   * It does not have to physically exist in MongoDB.
   */
  isActive: boolean;

  /**
   * Account creation timestamp.
   */
  createdAt: string;

  /**
   * Last account metadata update timestamp.
   */
  updatedAt: string;

  /**
   * Who created the account.
   *
   * Automatically-created member accounts normally use:
   *
   *   "system"
   */
  createdBy?: string;
}

/* =========================================================
   SAVINGS TRANSACTION
========================================================= */

/**
 * A single financial movement in the savings ledger.
 *
 * This is a ledger record, NOT a mutable balance record.
 *
 * Once confirmed, its financial meaning must never be
 * silently modified.
 *
 * Corrections and reversals are always NEW transactions.
 */
export interface SavingsTransaction {
  /**
   * Unique public transaction identifier.
   *
   * MongoDB stores this application ID as _id.
   */
  id: string;

  /**
   * Savings account affected by this transaction.
   */
  savingsAccountId: string;

  /**
   * Member who owns the savings account.
   *
   * Application representation is a string.
   */
  memberId: string;

  /**
   * Cached member name at the time the transaction
   * was recorded.
   *
   * This preserves historical display context even if
   * the member's current name changes later.
   */
  memberName: string;

  /**
   * Financial amount represented by this ledger entry.
   *
   * SIGN CONVENTION
   * ----------------
   *
   * Positive amount:
   *   Money enters savings.
   *
   * Negative amount:
   *   Money leaves savings.
   *
   * DEPOSIT
   * -------
   *
   * Normally positive.
   *
   * Example:
   *
   *   +1000
   *
   * ADJUSTMENT
   * ----------
   *
   * Signed financial correction.
   *
   * Example:
   *
   *   +200
   *
   * or:
   *
   *   -200
   *
   * REVERSAL
   * --------
   *
   * Exact opposite of the original transaction.
   *
   * Example:
   *
   *   Original:  +1000
   *   Reversal: -1000
   *
   * Example:
   *
   *   Original:  -300
   *   Reversal:  +300
   */
  amount: number;

  /**
   * Financial transaction type.
   */
  type: SavingsTransactionType;

  /**
   * Origin of the transaction.
   */
  source: SavingsTransactionSource;

  /**
   * Current transaction lifecycle status.
   *
   * "reversed" describes the state of the original
   * transaction after a separate reversal transaction
   * has been created.
   */
  status: SavingsTransactionStatus;

  /**
   * External transaction/reference identifier.
   *
   * Examples:
   *
   * - Capiter transaction reference
   * - M-Pesa receipt number
   * - Manual receipt/reference
   *
   * Used for idempotency and reconciliation.
   */
  reference?: string;

  /**
   * Identifier of the SMS that produced this transaction.
   *
   * Important for preventing the same SMS from creating
   * multiple financial entries.
   */
  smsId?: string;

  /**
   * Controlled reference to the originating external event.
   *
   * Useful for reconciliation and future integrations.
   */
  sourceReference?: string;

  /**
   * Links this transaction to another transaction.
   *
   * Used for:
   *
   * - adjustments
   * - reversals
   */
  relatedTransactionId?: string;

  /**
   * Human-readable explanation for an adjustment
   * or reversal.
   */
  reason?: string;

  /**
   * Person or system responsible for recording
   * the transaction.
   */
  recordedBy?: SavingsTransactionRecordedBy;

  /**
   * Actual date/time when the financial event occurred.
   *
   * This may differ from createdAt when:
   *
   * - an SMS is processed later
   * - historical data is entered manually
   */
  transactionAt: string;

  /**
   * Date/time when the application recorded the
   * transaction.
   */
  createdAt: string;

  /**
   * Date/time when transaction metadata was last updated.
   *
   * This must never be used to silently change the
   * financial meaning of the transaction.
   */
  updatedAt: string;

  /**
   * Offline-first synchronization state.
   *
   * Technical metadata only.
   *
   * It must NEVER affect balance calculations.
   */
  synced: boolean;
}

/* =========================================================
   FINANCIAL AMOUNT TYPES
========================================================= */

/**
 * Positive amount entering a savings account.
 *
 * Runtime validation is handled by validation.ts.
 */
export type SavingsCreditAmount =
  number;

/**
 * Negative amount leaving a savings account.
 *
 * Runtime validation is handled by validation.ts.
 */
export type SavingsDebitAmount =
  number;

/**
 * Signed adjustment amount.
 *
 * Positive:
 *   increases savings.
 *
 * Negative:
 *   decreases savings.
 */
export type SavingsAdjustmentAmount =
  number;

/**
 * Reversal amount.
 *
 * Must always equal:
 *
 *   -original.amount
 */
export type SavingsReversalAmount =
  number;

