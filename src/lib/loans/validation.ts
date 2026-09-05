/**
 * GEO-SHUA
 * Loan Validation
 *
 * Input validation only.
 *
 * IMPORTANT:
 * ---------------------------------------------------------
 * Database/business-rule checks belong in the loan service.
 *
 * This file MUST NOT query MongoDB.
 *
 * Business rules such as:
 * - member existence
 * - member status
 * - existing open loan
 * - savings balance
 * - maximum loan amount
 * - outstanding balance
 * - repayment history
 * - default status
 * - fine history
 * - waiver balance
 *
 * belong in service.ts.
 *
 * Financial records are append-oriented.
 */

import type {
  CreateLoanInput,
  CreateLoanRepaymentInput,
  CreateLoanWaiverInput,
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

const MAX_MONEY = 1_000_000_000_000;

const MAX_TEXT_LENGTH = 500;

const MAX_TRANSACTION_REFERENCE_LENGTH = 100;

const MAX_RAW_MESSAGE_LENGTH = 10_000;

const MAX_RATE = 1;

const MAX_CYCLE_DAYS = 3650;

/* =========================================================
   INTERNAL HELPERS
========================================================= */

function isFiniteNumber(
  value: unknown,
): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value)
  );
}

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

function validateAmount(
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

function validateRate(
  rate: unknown,
  fieldName: string,
): string[] {
  if (
    !isFiniteNumber(rate) ||
    rate < 0 ||
    rate > MAX_RATE
  ) {
    return [
      `${fieldName} must be between 0 and 1.`,
    ];
  }

  return [];
}

function validatePositiveInteger(
  value: unknown,
  fieldName: string,
  maximum = MAX_CYCLE_DAYS,
): string[] {
  const errors: string[] = [];

  if (
    !Number.isInteger(value) ||
    (value as number) <= 0
  ) {
    errors.push(
      `${fieldName} must be a whole number greater than zero.`,
    );

    return errors;
  }

  if (
    (value as number) > maximum
  ) {
    errors.push(
      `${fieldName} is too large.`,
    );
  }

  return errors;
}

/* =========================================================
   LOAN TYPE
========================================================= */

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
     NEW FINE RATE
  ------------------------------------------------------- */

  if (
    input.fineRate !== undefined
  ) {
    errors.push(
      ...validateRate(
        input.fineRate,
        "Fine rate",
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

  /* -------------------------------------------------------
     REPAYMENT DATE
  ------------------------------------------------------- */

  if (
    input.repaymentDate !==
    undefined
  ) {
    errors.push(
      ...validateDate(
        input.repaymentDate,
        "Repayment date",
      ),
    );
  }

  /* -------------------------------------------------------
     END DATE
  ------------------------------------------------------- */

  if (
    input.endDate !==
    undefined
  ) {
    errors.push(
      ...validateDate(
        input.endDate,
        "Loan end date",
      ),
    );
  }

  /*
   * Date ordering is additionally checked in the service
   * because the service determines the authoritative
   * disbursement date.
   */

  return {
    valid:
      errors.length === 0,
    errors,
  };
}

/* =========================================================
   CREATE REPAYMENT
========================================================= */

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
   CREATE WAIVER
========================================================= */

export function validateCreateLoanWaiver(
  input: CreateLoanWaiverInput,
): ValidationResult {
  const errors: string[] = [];

  if (
    !input ||
    typeof input !== "object"
  ) {
    return {
      valid: false,
      errors: [
        "Loan waiver data is required.",
      ],
    };
  }

  /* -------------------------------------------------------
     LOAN ID
  ------------------------------------------------------- */

  errors.push(
    ...validateRequiredText(
      input.loanId,
      "Loan ID",
      100,
    ),
  );

  /* -------------------------------------------------------
     AMOUNT
  ------------------------------------------------------- */

  errors.push(
    ...validateAmount(
      input.amount,
      "Waiver amount",
    ),
  );

  /* -------------------------------------------------------
     REASON
  ------------------------------------------------------- */

  errors.push(
    ...validateRequiredText(
      input.reason,
      "Waiver reason",
      500,
    ),
  );

  /* -------------------------------------------------------
     ACTOR
  ------------------------------------------------------- */

  if (
    !input.waivedBy ||
    typeof input.waivedBy !== "object"
  ) {
    errors.push(
      "Waived-by information is required.",
    );
  } else {
    errors.push(
      ...validateRequiredText(
        input.waivedBy.name,
        "Waived-by name",
        150,
      ),
    );

    errors.push(
      ...validateRequiredText(
        input.waivedBy.email,
        "Waived-by email",
        254,
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
   LOAN SETTINGS
========================================================= */

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
    errors.push(
      ...validateRate(
        settings.regularInterestRate,
        "Regular interest rate",
      ),
    );
  }

  /* -------------------------------------------------------
     EMERGENCY INTEREST
  ------------------------------------------------------- */

  if (
    settings.emergencyInterestRate !==
    undefined
  ) {
    errors.push(
      ...validateRate(
        settings.emergencyInterestRate,
        "Emergency interest rate",
      ),
    );
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
     NEW 7-DAY REPAYMENT CYCLE
  ------------------------------------------------------- */

  if (
    settings.repaymentCycleDays !==
    undefined
  ) {
    errors.push(
      ...validatePositiveInteger(
        settings.repaymentCycleDays,
        "Repayment cycle days",
      ),
    );
  }

  /* -------------------------------------------------------
     NEW FINE RATE
  ------------------------------------------------------- */

  if (
    settings.fineRate !==
    undefined
  ) {
    errors.push(
      ...validateRate(
        settings.fineRate,
        "Fine rate",
      ),
    );
  }

  /* -------------------------------------------------------
     LEGACY GRACE DAYS
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
     EMERGENCY LOANS
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
     REGULAR LOANS
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