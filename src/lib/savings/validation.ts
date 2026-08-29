/**
 * Savings validation and normalization.
 *
 * This file is responsible for:
 * - Validating savings accounts
 * - Validating savings transactions
 * - Normalizing safe input values
 *
 * It must NOT:
 * - Write to MongoDB
 * - Write to localStorage
 * - Modify existing financial records
 * - Calculate loan eligibility
 * - Check database relationships
 *
 * Database-dependent rules belong in service.ts.
 *
 * Financial records must remain auditable.
 *
 * =========================================================
 * IMPORTANT
 * =========================================================
 *
 * SACCO information is intentionally NOT part of the savings
 * domain.
 *
 * Savings currently belong directly to a member.
 *
 * The savings domain therefore contains:
 *
 *   Member
 *      ↓
 *   Fixed Savings Account
 *      ↓
 *   Append-only Savings Ledger
 *
 * =========================================================
 */

import type {
  SavingsAccount,
  SavingsTransaction,
  SavingsTransactionSource,
  SavingsTransactionStatus,
  SavingsTransactionType,
} from "./types";

/* =========================================================
   TYPES
========================================================= */

export interface SavingsValidationResult {
  valid: boolean;
  errors: Record<string, string>;
}

/* =========================================================
   CONSTANTS
========================================================= */

/**
 * Maximum reasonable transaction amount.
 *
 * This is only a safety boundary against malformed input.
 *
 * It is NOT a business limit.
 */
const MAX_TRANSACTION_AMOUNT = 100_000_000;

/**
 * Maximum length for ordinary textual fields.
 */
const MAX_ID_LENGTH = 200;
const MAX_NAME_LENGTH = 200;
const MAX_REFERENCE_LENGTH = 200;
const MAX_REASON_LENGTH = 1000;

/* =========================================================
   BASIC HELPERS
========================================================= */

/**
 * Check whether a value is a non-empty string.
 */
const isNonEmptyString = (
  value: unknown
): value is string =>
  typeof value === "string" &&
  value.trim().length > 0;

/**
 * Check whether a value is a non-empty string
 * within the allowed length.
 */
const isValidText = (
  value: unknown,
  maxLength: number
): value is string =>
  isNonEmptyString(value) &&
  value.trim().length <= maxLength;

/**
 * Check whether a value is a finite number.
 */
const isFiniteNumber = (
  value: unknown
): value is number =>
  typeof value === "number" &&
  Number.isFinite(value);

/**
 * Check whether a value is a valid date string.
 */
const isValidDate = (
  value: unknown
): value is string => {
  if (
    typeof value !== "string" ||
    !value.trim()
  ) {
    return false;
  }

  const timestamp = Date.parse(value);

  return !Number.isNaN(timestamp);
};

/**
 * Check whether a number has no more than
 * two decimal places.
 */
const hasMaximumTwoDecimalPlaces = (
  value: number
): boolean => {
  const stringValue = value.toString();

  if (
    stringValue.includes("e") ||
    stringValue.includes("E")
  ) {
    const fixed = value.toFixed(12);

    const decimalPart =
      fixed.split(".")[1] || "";

    return (
      decimalPart.replace(/0+$/, "").length <= 2
    );
  }

  const decimalPart =
    stringValue.split(".")[1] || "";

  return decimalPart.length <= 2;
};

/* =========================================================
   ENUM HELPERS
========================================================= */

/**
 * Check transaction type.
 */
const isValidTransactionType = (
  value: unknown
): value is SavingsTransactionType =>
  value === "deposit" ||
  value === "adjustment" ||
  value === "reversal";

/**
 * Check transaction source.
 */
const isValidTransactionSource = (
  value: unknown
): value is SavingsTransactionSource =>
  value === "sms" ||
  value === "manual" ||
  value === "system";

/**
 * Check transaction status.
 */
const isValidTransactionStatus = (
  value: unknown
): value is SavingsTransactionStatus =>
  value === "pending" ||
  value === "confirmed" ||
  value === "reversed";

/* =========================================================
   ACCOUNT VALIDATION
========================================================= */

/**
 * Validate a savings account.
 *
 * This validates structure and basic financial safety.
 *
 * It does NOT verify:
 *
 * - whether the member exists
 * - whether another account already exists
 * - whether the account belongs to the correct member
 * - whether the balance matches the ledger
 *
 * Those rules belong in service.ts.
 */
export function validateSavingsAccount(
  account: Partial<SavingsAccount>
): SavingsValidationResult {
  const errors: Record<string, string> = {};

  /* -------------------------------------------------------
     ID
  ------------------------------------------------------- */

  if (
    !isValidText(
      account.id,
      MAX_ID_LENGTH
    )
  ) {
    errors.id =
      "Savings account ID is required";
  }

  /* -------------------------------------------------------
     MEMBER
  ------------------------------------------------------- */

  if (
    !isValidText(
      account.memberId,
      MAX_ID_LENGTH
    )
  ) {
    errors.memberId =
      "Member ID is required";
  }

  /* -------------------------------------------------------
     MEMBER NAME
  ------------------------------------------------------- */

  if (
    !isValidText(
      account.memberName,
      MAX_NAME_LENGTH
    )
  ) {
    errors.memberName =
      "Member name is required";
  }

  /* -------------------------------------------------------
     ACCOUNT NUMBER
  ------------------------------------------------------- */

  if (
    !isValidText(
      account.accountNumber,
      MAX_REFERENCE_LENGTH
    )
  ) {
    errors.accountNumber =
      "Savings account number is required";
  }

  /* -------------------------------------------------------
     ACCOUNT TYPE
  ------------------------------------------------------- */

  if (
    account.accountType !== "fixed"
  ) {
    errors.accountType =
      "Invalid savings account type";
  }

  /* -------------------------------------------------------
     BALANCE
  ------------------------------------------------------- */

  if (
    !isFiniteNumber(account.balance)
  ) {
    errors.balance =
      "Balance must be a valid number";
  } else {
    /**
     * A savings account balance must never be
     * negative.
     *
     * IMPORTANT:
     *
     * The service layer must ensure this cached
     * balance agrees with the authoritative ledger.
     */
    if (account.balance < 0) {
      errors.balance =
        "Savings balance cannot be negative";
    }

    if (
      account.balance >
      MAX_TRANSACTION_AMOUNT
    ) {
      errors.balance =
        "Savings balance exceeds the allowed safety limit";
    }

    if (
      !hasMaximumTwoDecimalPlaces(
        account.balance
      )
    ) {
      errors.balance =
        "Savings balance cannot have more than two decimal places";
    }
  }

  /* -------------------------------------------------------
     STATUS
  ------------------------------------------------------- */

  if (
    account.status !== "active" &&
    account.status !== "inactive"
  ) {
    errors.status =
      "Invalid savings account status";
  }

  /* -------------------------------------------------------
     ACTIVE STATE
  ------------------------------------------------------- */

  if (
    typeof account.isActive !== "boolean"
  ) {
    errors.isActive =
      "Account active state is required";
  }

  /* -------------------------------------------------------
     DATE CONSISTENCY
  ------------------------------------------------------- */

  if (
    !isValidDate(account.createdAt)
  ) {
    errors.createdAt =
      "A valid creation date is required";
  }

  if (
    !isValidDate(account.updatedAt)
  ) {
    errors.updatedAt =
      "A valid update date is required";
  }

  return {
    valid:
      Object.keys(errors).length === 0,

    errors,
  };
}

/* =========================================================
   TRANSACTION VALIDATION
========================================================= */

/**
 * Validate a savings transaction.
 *
 * This validates:
 *
 * - required fields
 * - monetary values
 * - transaction type
 * - source
 * - status
 * - references
 * - correction/reversal structure
 *
 * It does NOT verify database relationships.
 */
export function validateSavingsTransaction(
  transaction: Partial<SavingsTransaction>
): SavingsValidationResult {
  const errors: Record<string, string> = {};

  /* =======================================================
     IDENTIFIERS
  ======================================================= */

  if (
    !isValidText(
      transaction.id,
      MAX_ID_LENGTH
    )
  ) {
    errors.id =
      "Transaction ID is required";
  }

  if (
    !isValidText(
      transaction.savingsAccountId,
      MAX_ID_LENGTH
    )
  ) {
    errors.savingsAccountId =
      "Savings account ID is required";
  }

  if (
    !isValidText(
      transaction.memberId,
      MAX_ID_LENGTH
    )
  ) {
    errors.memberId =
      "Member ID is required";
  }

  /* =======================================================
     MEMBER INFORMATION
  ======================================================= */

  if (
    !isValidText(
      transaction.memberName,
      MAX_NAME_LENGTH
    )
  ) {
    errors.memberName =
      "Member name is required";
  }

  /* =======================================================
     AMOUNT
  ======================================================= */

  if (
    !isFiniteNumber(
      transaction.amount
    )
  ) {
    errors.amount =
      "Transaction amount must be a valid number";
  } else {
    if (
      transaction.amount === 0
    ) {
      errors.amount =
        "Transaction amount cannot be zero";
    }

    if (
      Math.abs(transaction.amount) >
      MAX_TRANSACTION_AMOUNT
    ) {
      errors.amount =
        "Transaction amount exceeds the allowed safety limit";
    }

    if (
      !hasMaximumTwoDecimalPlaces(
        transaction.amount
      )
    ) {
      errors.amount =
        "Transaction amount cannot have more than two decimal places";
    }
  }

  /* =======================================================
     TYPE
  ======================================================= */

  if (
    !isValidTransactionType(
      transaction.type
    )
  ) {
    errors.type =
      "Invalid transaction type";
  }

  /* =======================================================
     SOURCE
  ======================================================= */

  if (
    !isValidTransactionSource(
      transaction.source
    )
  ) {
    errors.source =
      "Invalid transaction source";
  }

  /* =======================================================
     STATUS
  ======================================================= */

  if (
    !isValidTransactionStatus(
      transaction.status
    )
  ) {
    errors.status =
      "Invalid transaction status";
  }

  /* =======================================================
     REFERENCES
  ======================================================= */

  if (
    transaction.reference !== undefined &&
    !isValidText(
      transaction.reference,
      MAX_REFERENCE_LENGTH
    )
  ) {
    errors.reference =
      "Reference cannot be empty or exceed the allowed length";
  }

  if (
    transaction.smsId !== undefined &&
    !isValidText(
      transaction.smsId,
      MAX_ID_LENGTH
    )
  ) {
    errors.smsId =
      "SMS ID cannot be empty or exceed the allowed length";
  }

  if (
    transaction.sourceReference !== undefined &&
    !isValidText(
      transaction.sourceReference,
      MAX_REFERENCE_LENGTH
    )
  ) {
    errors.sourceReference =
      "Source reference cannot be empty or exceed the allowed length";
  }

  /* =======================================================
     RELATED TRANSACTION
  ======================================================= */

  if (
    transaction.relatedTransactionId !==
      undefined &&
    !isValidText(
      transaction.relatedTransactionId,
      MAX_ID_LENGTH
    )
  ) {
    errors.relatedTransactionId =
      "Related transaction ID cannot be empty or exceed the allowed length";
  }

  /* =======================================================
     REASON
  ======================================================= */

  if (
    transaction.reason !== undefined &&
    !isValidText(
      transaction.reason,
      MAX_REASON_LENGTH
    )
  ) {
    errors.reason =
      "Reason cannot be empty or exceed the allowed length";
  }

  /* =======================================================
     RECORDED BY
  ======================================================= */

  if (
    transaction.recordedBy !== undefined
  ) {
    const recordedBy =
      transaction.recordedBy;

    if (
      recordedBy === null ||
      typeof recordedBy !== "object"
    ) {
      errors.recordedBy =
        "Recorded-by information must be an object";
    } else {
      if (
        recordedBy.userId !== undefined &&
        !isValidText(
          recordedBy.userId,
          MAX_ID_LENGTH
        )
      ) {
        errors["recordedBy.userId"] =
          "Recorded-by user ID cannot be empty or exceed the allowed length";
      }

      if (
        recordedBy.email !== undefined &&
        !isValidText(
          recordedBy.email,
          MAX_REFERENCE_LENGTH
        )
      ) {
        errors["recordedBy.email"] =
          "Recorded-by email cannot be empty or exceed the allowed length";
      }

      if (
        recordedBy.name !== undefined &&
        !isValidText(
          recordedBy.name,
          MAX_NAME_LENGTH
        )
      ) {
        errors["recordedBy.name"] =
          "Recorded-by name cannot be empty or exceed the allowed length";
      }
    }
  }

  /* =======================================================
     DATES
  ======================================================= */

  if (
    !isValidDate(
      transaction.transactionAt
    )
  ) {
    errors.transactionAt =
      "A valid transaction date is required";
  }

  if (
    !isValidDate(
      transaction.createdAt
    )
  ) {
    errors.createdAt =
      "A valid creation date is required";
  }

  if (
    !isValidDate(
      transaction.updatedAt
    )
  ) {
    errors.updatedAt =
      "A valid update date is required";
  }

  /* =======================================================
     SYNC
  ======================================================= */

  if (
    typeof transaction.synced !==
    "boolean"
  ) {
    errors.synced =
      "Sync status is required";
  }

  /* =======================================================
     TRANSACTION-SPECIFIC FINANCIAL RULES
  ======================================================= */

  /**
   * Deposits must increase savings.
   */
  if (
    transaction.type === "deposit" &&
    isFiniteNumber(transaction.amount) &&
    transaction.amount <= 0
  ) {
    errors.amount =
      "Deposit amount must be greater than zero";
  }

  /**
   * Reversals must decrease savings.
   *
   * The service layer is responsible for ensuring that
   * the reversal amount is exactly the negative of the
   * original transaction amount.
   */
  if (
    transaction.type === "reversal" &&
    isFiniteNumber(transaction.amount) &&
    transaction.amount >= 0
  ) {
    errors.amount =
      "Reversal amount must be negative";
  }

  /**
   * Adjustments may be positive or negative,
   * but never zero.
   */
  if (
    transaction.type === "adjustment" &&
    isFiniteNumber(transaction.amount) &&
    transaction.amount === 0
  ) {
    errors.amount =
      "Adjustment amount cannot be zero";
  }

  /* =======================================================
     SMS RULES
  ======================================================= */

  /**
   * SMS transactions must identify their source.
   */
  if (
    transaction.source === "sms" &&
    !isNonEmptyString(
      transaction.sourceReference
    ) &&
    !isNonEmptyString(
      transaction.smsId
    )
  ) {
    errors.sourceReference =
      "SMS transactions require an SMS or source reference";
  }

  /**
   * SMS transactions must have an external
   * transaction reference.
   */
  if (
    transaction.source === "sms" &&
    !isNonEmptyString(
      transaction.reference
    )
  ) {
    errors.reference =
      "SMS transactions require a transaction reference";
  }

  /* =======================================================
     REVERSAL RULES
  ======================================================= */

  /**
   * Every reversal must identify the transaction
   * it reverses.
   */
  if (
    transaction.type === "reversal" &&
    !isNonEmptyString(
      transaction.relatedTransactionId
    )
  ) {
    errors.relatedTransactionId =
      "A reversal must reference the original transaction";
  }

  /**
   * Reversals are system-generated financial
   * corrections.
   */
  if (
    transaction.type === "reversal" &&
    transaction.source !== "system"
  ) {
    errors.source =
      "Reversal transactions must use system source";
  }

  /* =======================================================
     ADJUSTMENT RULES
  ======================================================= */

  /**
   * Every adjustment requires an explanation.
   */
  if (
    transaction.type === "adjustment"
  ) {
    if (
      !isNonEmptyString(
        transaction.reason
      )
    ) {
      errors.reason =
        "An adjustment requires a reason";
    }

    if (
      !isNonEmptyString(
        transaction.relatedTransactionId
      )
    ) {
      errors.relatedTransactionId =
        "An adjustment must reference the transaction being corrected";
    }

    /**
     * Adjustments are controlled financial
     * corrections and therefore originate from
     * the system layer.
     */
    if (
      transaction.source !== "system"
    ) {
      errors.source =
        "Adjustment transactions must use system source";
    }
  }

  /* =======================================================
     RESULT
  ======================================================= */

  return {
    valid:
      Object.keys(errors).length === 0,

    errors,
  };
}

/* =========================================================
   NORMALIZATION
========================================================= */

/**
 * Normalize a savings transaction before persistence.
 *
 * This function:
 *
 * - trims safe textual fields
 * - removes empty optional strings
 * - normalizes monetary precision
 *
 * It does NOT:
 *
 * - change transaction type
 * - change transaction source
 * - change transaction status
 * - change transaction relationships
 * - change transaction dates
 * - calculate balances
 * - modify an existing transaction
 */
export function normalizeSavingsTransaction(
  transaction: SavingsTransaction
): SavingsTransaction {
  return {
    ...transaction,

    id:
      transaction.id.trim(),

    savingsAccountId:
      transaction.savingsAccountId.trim(),

    memberId:
      transaction.memberId.trim(),

    memberName:
      transaction.memberName.trim(),

    amount:
      Math.round(
        (
          transaction.amount +
          Number.EPSILON
        ) * 100
      ) / 100,

    reference:
      transaction.reference?.trim() ||
      undefined,

    smsId:
      transaction.smsId?.trim() ||
      undefined,

    sourceReference:
      transaction.sourceReference?.trim() ||
      undefined,

    relatedTransactionId:
      transaction.relatedTransactionId?.trim() ||
      undefined,

    reason:
      transaction.reason?.trim() ||
      undefined,

    recordedBy:
      transaction.recordedBy
        ? {
            userId:
              transaction.recordedBy.userId?.trim() ||
              undefined,

            email:
              transaction.recordedBy.email?.trim() ||
              undefined,

            name:
              transaction.recordedBy.name?.trim() ||
              undefined,
          }
        : undefined,
  };
}
