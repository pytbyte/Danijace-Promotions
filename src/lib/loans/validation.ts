/**
 * GEO-SHUA
 * Loan Validation
 *
 * This file handles input validation only.
 *
 * IMPORTANT:
 * Database/business-rule checks belong in the loan service.
 *
 * Examples:
 * - member existence
 * - member status
 * - existing open loan
 * - savings balance
 * - maximum loan amount
 * - outstanding balance
 * - loan completion
 * - fine history
 *
 * Financial records are append-oriented.
 */

import type {
  CreateLoanInput,
  CreateLoanRepaymentInput,
  LoanGuarantor,
  LoanSettings,
  LoanType,
} from "./types";

/* =========================================================
   VALIDATION RESULT
========================================================= */

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/* =========================================================
   CONSTANTS
========================================================= */

/**
 * Money values are stored to two decimal places.
 *
 * We allow more precision during validation because
 * the service will normalize monetary values before
 * persistence.
 */
const MAX_MONEY = 1_000_000_000_000;

/**
 * Prevent accidentally accepting absurdly large text
 * fields from API/SMS input.
 */
const MAX_TEXT_LENGTH = 500;

/**
 * Transaction references are deliberately smaller.
 *
 * M-Pesa references are normally short, but allowing
 * some extra room keeps the validator future-proof.
 */
const MAX_TRANSACTION_REFERENCE_LENGTH = 100;

/**
 * SMS messages can be considerably longer than normal
 * user-entered fields.
 */
const MAX_RAW_MESSAGE_LENGTH = 10_000;

/* =========================================================
   INTERNAL HELPERS
========================================================= */

/**
 * Check whether a value is a finite number.
 */
function isFiniteNumber(
  value: unknown,
): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value)
  );
}

/**
 * Validate a non-empty string.
 */
function validateRequiredText(
  value: unknown,
  fieldName: string,
  maxLength = MAX_TEXT_LENGTH,
): string[] {
  const errors: string[] = [];

  if (
    typeof value !== "string" ||
    value.trim().length === 0
  ) {
    errors.push(
      `${fieldName} is required.`,
    );

    return errors;
  }

  if (
    value.trim().length >
    maxLength
  ) {
    errors.push(
      `${fieldName} must not exceed ${maxLength} characters.`,
    );
  }

  return errors;
}

/**
 * Validate an optional string.
 */
function validateOptionalText(
  value: unknown,
  fieldName: string,
  maxLength = MAX_TEXT_LENGTH,
): string[] {
  const errors: string[] = [];

  if (value === undefined) {
    return errors;
  }

  if (typeof value !== "string") {
    errors.push(
      `${fieldName} must be text.`,
    );

    return errors;
  }

  if (
    value.trim().length >
    maxLength
  ) {
    errors.push(
      `${fieldName} must not exceed ${maxLength} characters.`,
    );
  }

  return errors;
}

/**
 * Validate a valid JavaScript Date.
 */
function validateDate(
  value: unknown,
  fieldName: string,
): string[] {
  if (
    !(value instanceof Date) ||
    Number.isNaN(value.getTime())
  ) {
    return [
      `${fieldName} must be a valid date.`,
    ];
  }

  return [];
}

/**
 * Validate a positive finite monetary amount.
 */
export function validateAmount(
  amount: number,
  fieldName = "Amount",
): string[] {
  const errors: string[] = [];

  if (!isFiniteNumber(amount)) {
    errors.push(
      `${fieldName} must be a valid number.`,
    );

    return errors;
  }

  if (amount <= 0) {
    errors.push(
      `${fieldName} must be greater than zero.`,
    );
  }

  if (amount > MAX_MONEY) {
    errors.push(
      `${fieldName} is too large.`,
    );
  }

  return errors;
}

/**
 * Validate a non-negative monetary amount.
 *
 * Used for settings such as daily fines where zero
 * may legitimately mean "no fine".
 */
function validateNonNegativeAmount(
  amount: number,
  fieldName: string,
): string[] {
  const errors: string[] = [];

  if (!isFiniteNumber(amount)) {
    errors.push(
      `${fieldName} must be a valid number.`,
    );

    return errors;
  }

  if (amount < 0) {
    errors.push(
      `${fieldName} must be zero or greater.`,
    );
  }

  if (amount > MAX_MONEY) {
    errors.push(
      `${fieldName} is too large.`,
    );
  }

  return errors;
}

/* =========================================================
   LOAN TYPE
========================================================= */

/**
 * Validate a loan type.
 */
export function validateLoanType(
  type: LoanType,
): string[] {
  if (
    type !== "emergency" &&
    type !== "regular"
  ) {
    return [
      "Invalid loan type.",
    ];
  }

  return [];
}

/* =========================================================
   GUARANTOR
========================================================= */

/**
 * Validate guarantor details.
 *
 * Guarantor ID number is optional.
 */
export function validateGuarantor(
  guarantor: LoanGuarantor,
): string[] {
  const errors: string[] = [];

  if (
    !guarantor ||
    typeof guarantor !== "object"
  ) {
    return [
      "Guarantor information is required.",
    ];
  }

  errors.push(
    ...validateRequiredText(
      guarantor.name,
      "Guarantor name",
      150,
    ),
  );

  if (
    typeof guarantor.name === "string" &&
    guarantor.name.trim().length > 0 &&
    guarantor.name.trim().length < 2
  ) {
    errors.push(
      "Guarantor name must contain at least 2 characters.",
    );
  }

  errors.push(
    ...validateRequiredText(
      guarantor.phone,
      "Guarantor phone number",
      30,
    ),
  );

  if (
    guarantor.idNumber !== undefined
  ) {
    errors.push(
      ...validateOptionalText(
        guarantor.idNumber,
        "Guarantor ID number",
        50,
      ),
    );
  }

  return errors;
}

/* =========================================================
   CREATE LOAN
========================================================= */

/**
 * Validate loan creation input.
 *
 * This function validates only the input itself.
 *
 * It does NOT query MongoDB.
 *
 * Service-level checks include:
 * - member exists
 * - member is active
 * - fixed savings account exists
 * - minimum savings
 * - maximum regular loan
 * - existing open loan
 * - existing outstanding liability
 */
export function validateCreateLoan(
  input: CreateLoanInput,
): ValidationResult {
  const errors: string[] = [];

  if (
    !input ||
    typeof input !== "object"
  ) {
    return {
      valid: false,
      errors: [
        "Loan data is required.",
      ],
    };
  }

  /* -------------------------------------------------------
     MEMBER
  ------------------------------------------------------- */

  errors.push(
    ...validateRequiredText(
      input.memberId,
      "Member ID",
      100,
    ),
  );

  /* -------------------------------------------------------
     LOAN TYPE
  ------------------------------------------------------- */

  errors.push(
    ...validateLoanType(
      input.type,
    ),
  );

  /* -------------------------------------------------------
     PRINCIPAL
  ------------------------------------------------------- */

  errors.push(
    ...validateAmount(
      input.principal,
      "Loan principal",
    ),
  );

  /* -------------------------------------------------------
     GUARANTOR
  ------------------------------------------------------- */

  errors.push(
    ...validateGuarantor(
      input.guarantor,
    ),
  );

  /* -------------------------------------------------------
     DAILY FINE
  ------------------------------------------------------- */

  if (
    input.dailyFine !== undefined
  ) {
    errors.push(
      ...validateNonNegativeAmount(
        input.dailyFine,
        "Daily fine",
      ),
    );
  }

  /* -------------------------------------------------------
     DISBURSEMENT DATE
  ------------------------------------------------------- */

  if (
    input.disbursementDate !==
    undefined
  ) {
    errors.push(
      ...validateDate(
        input.disbursementDate,
        "Disbursement date",
      ),
    );
  }

  return {
    valid:
      errors.length === 0,
    errors,
  };
}

/* =========================================================
   CREATE REPAYMENT
========================================================= */

/**
 * Validate loan repayment input.
 *
 * This function deliberately does not determine whether
 * the repayment can actually be applied to a loan.
 *
 * The service must determine:
 *
 * - which loan receives the payment
 * - whether the loan exists
 * - whether the loan is cancelled
 * - current outstanding balance
 * - whether the transaction reference already exists
 *
 * The transaction reference is the idempotency key.
 */
export function validateLoanRepayment(
  input: CreateLoanRepaymentInput,
): ValidationResult {
  const errors: string[] = [];

  if (
    !input ||
    typeof input !== "object"
  ) {
    return {
      valid: false,
      errors: [
        "Repayment data is required.",
      ],
    };
  }

  /* -------------------------------------------------------
     LOAN ID
  ------------------------------------------------------- */

  if (
    input.loanId !== undefined
  ) {
    errors.push(
      ...validateRequiredText(
        input.loanId,
        "Loan ID",
        100,
      ),
    );
  }

  /* -------------------------------------------------------
     MEMBER ID
  ------------------------------------------------------- */

  if (
    input.memberId !== undefined
  ) {
    errors.push(
      ...validateRequiredText(
        input.memberId,
        "Member ID",
        100,
      ),
    );
  }

  /*
   * At least one of loanId or memberId must be supplied.
   *
   * This is important because the service needs some
   * way to resolve the destination loan.
   */
  if (
    input.loanId === undefined &&
    input.memberId === undefined
  ) {
    errors.push(
      "Either Loan ID or Member ID is required.",
    );
  }

  /* -------------------------------------------------------
     AMOUNT
  ------------------------------------------------------- */

  errors.push(
    ...validateAmount(
      input.amount,
      "Repayment amount",
    ),
  );

  /* -------------------------------------------------------
     TRANSACTION REFERENCE
  ------------------------------------------------------- */

  errors.push(
    ...validateRequiredText(
      input.transactionReference,
      "Transaction reference",
      MAX_TRANSACTION_REFERENCE_LENGTH,
    ),
  );

  /* -------------------------------------------------------
     TRANSACTION DATE
  ------------------------------------------------------- */

  errors.push(
    ...validateDate(
      input.transactionDate,
      "Transaction date",
    ),
  );

  /* -------------------------------------------------------
     SOURCE
  ------------------------------------------------------- */

  if (
    input.source !== "manual" &&
    input.source !== "sms" &&
    input.source !== "system"
  ) {
    errors.push(
      "Invalid repayment source.",
    );
  }

  /* -------------------------------------------------------
     RAW SMS
  ------------------------------------------------------- */

  if (
    input.rawMessage !== undefined
  ) {
    errors.push(
      ...validateOptionalText(
        input.rawMessage,
        "Raw SMS message",
        MAX_RAW_MESSAGE_LENGTH,
      ),
    );
  }

  /*
   * SMS transactions should normally contain the
   * original message for reconciliation.
   *
   * We intentionally do NOT make this mandatory here
   * because callers may already have parsed/normalized
   * SMS data before reaching this layer.
   */

  /* -------------------------------------------------------
     RECORDED BY
  ------------------------------------------------------- */

  if (
    input.recordedBy !== undefined
  ) {
    if (
      !input.recordedBy ||
      typeof input.recordedBy !==
        "object"
    ) {
      errors.push(
        "Recorded-by information must be valid.",
      );
    } else {
      errors.push(
        ...validateRequiredText(
          input.recordedBy.name,
          "Recorded-by name",
          150,
        ),
      );

      errors.push(
        ...validateRequiredText(
          input.recordedBy.email,
          "Recorded-by email",
          254,
        ),
      );
    }
  }

  return {
    valid:
      errors.length === 0,
    errors,
  };
}

/* =========================================================
   LOAN SETTINGS
========================================================= */

/**
 * Validate loan settings.
 *
 * Interest rates are decimal fractions:
 *
 * 30% = 0.30
 * 40% = 0.40
 *
 * Database/business rules such as whether changing a
 * particular setting is authorized belong elsewhere.
 */
export function validateLoanSettings(
  settings: Partial<LoanSettings>,
): ValidationResult {
  const errors: string[] = [];

  if (
    !settings ||
    typeof settings !== "object"
  ) {
    return {
      valid: false,
      errors: [
        "Loan settings are required.",
      ],
    };
  }

  /* -------------------------------------------------------
     REGULAR INTEREST
  ------------------------------------------------------- */

  if (
    settings.regularInterestRate !==
    undefined
  ) {
    if (
      !isFiniteNumber(
        settings.regularInterestRate,
      ) ||
      settings.regularInterestRate <
        0 ||
      settings.regularInterestRate >
        1
    ) {
      errors.push(
        "Regular interest rate must be between 0 and 1.",
      );
    }
  }

  /* -------------------------------------------------------
     EMERGENCY INTEREST
  ------------------------------------------------------- */

  if (
    settings.emergencyInterestRate !==
    undefined
  ) {
    if (
      !isFiniteNumber(
        settings.emergencyInterestRate,
      ) ||
      settings.emergencyInterestRate <
        0 ||
      settings.emergencyInterestRate >
        1
    ) {
      errors.push(
        "Emergency interest rate must be between 0 and 1.",
      );
    }
  }

  /* -------------------------------------------------------
     MINIMUM SAVINGS
  ------------------------------------------------------- */

  if (
    settings.regularMinimumSavings !==
    undefined
  ) {
    errors.push(
      ...validateNonNegativeAmount(
        settings.regularMinimumSavings,
        "Regular minimum savings",
      ),
    );
  }

  /* -------------------------------------------------------
     SAVINGS MULTIPLIER
  ------------------------------------------------------- */

  if (
    settings.regularSavingsMultiplier !==
    undefined
  ) {
    if (
      !isFiniteNumber(
        settings.regularSavingsMultiplier,
      ) ||
      settings.regularSavingsMultiplier <=
        0
    ) {
      errors.push(
        "Regular savings multiplier must be greater than zero.",
      );
    }

    if (
      isFiniteNumber(
        settings.regularSavingsMultiplier,
      ) &&
      settings.regularSavingsMultiplier >
        1000
    ) {
      errors.push(
        "Regular savings multiplier is too large.",
      );
    }
  }

  /* -------------------------------------------------------
     GRACE DAYS
  ------------------------------------------------------- */

  if (
    settings.repaymentGraceDays !==
    undefined
  ) {
    if (
      !Number.isInteger(
        settings.repaymentGraceDays,
      ) ||
      settings.repaymentGraceDays < 0
    ) {
      errors.push(
        "Repayment grace days must be a whole number of zero or greater.",
      );
    }

    if (
      Number.isInteger(
        settings.repaymentGraceDays,
      ) &&
      settings.repaymentGraceDays >
        3650
    ) {
      errors.push(
        "Repayment grace days is too large.",
      );
    }
  }

  /* -------------------------------------------------------
     DEFAULT DAILY FINE
  ------------------------------------------------------- */

  if (
    settings.defaultDailyFine !==
    undefined
  ) {
    errors.push(
      ...validateNonNegativeAmount(
        settings.defaultDailyFine,
        "Default daily fine",
      ),
    );
  }

  /* -------------------------------------------------------
     EMERGENCY LOANS ENABLED
  ------------------------------------------------------- */

  if (
    settings.emergencyLoansEnabled !==
    undefined &&
    typeof settings.emergencyLoansEnabled !==
      "boolean"
  ) {
    errors.push(
      "Emergency loan enabled setting must be true or false.",
    );
  }

  /* -------------------------------------------------------
     REGULAR LOANS ENABLED
  ------------------------------------------------------- */

  if (
    settings.regularLoansEnabled !==
      undefined &&
    typeof settings.regularLoansEnabled !==
      "boolean"
  ) {
    errors.push(
      "Regular loan enabled setting must be true or false.",
    );
  }

  return {
    valid:
      errors.length === 0,
    errors,
  };
}

/* =========================================================
   TEXT NORMALIZATION
========================================================= */

/**
 * Normalize ordinary user-entered text.
 *
 * This:
 * - removes leading/trailing whitespace
 * - collapses repeated whitespace
 *
 * It does NOT modify the semantic contents of the text.
 */
export function normalizeText(
  value: string,
): string {
  return value
    .trim()
    .replace(/\s+/g, " ");
}

/* =========================================================
   GUARANTOR NORMALIZATION
========================================================= */

/**
 * Normalize guarantor information before persistence.
 *
 * Validation should happen before this function is called.
 */
export function normalizeGuarantor(
  guarantor: LoanGuarantor,
): LoanGuarantor {
  return {
    name: normalizeText(
      guarantor.name,
    ),

    phone:
      guarantor.phone.trim(),

    ...(guarantor.idNumber?.trim()
      ? {
          idNumber:
            guarantor.idNumber.trim(),
        }
      : {}),
  };
}