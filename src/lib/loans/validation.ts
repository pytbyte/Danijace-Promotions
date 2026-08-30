/**
 * GEO-SHUA
 * Loan Validation
 *
 * This file handles input validation only.
 *
 * Database/business-rule checks such as:
 * - member existence
 * - existing active loan
 * - savings balance
 * - outstanding fines
 *
 * belong in the loan service.
 */

import {
  CreateLoanInput,
  CreateLoanRepaymentInput,
  LoanGuarantor,
  LoanSettings,
  LoanType,
} from "./types";

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validate a positive monetary amount.
 */
export function validateAmount(
  amount: number,
  fieldName = "Amount",
): string[] {
  const errors: string[] = [];

  if (typeof amount !== "number" || !Number.isFinite(amount)) {
    errors.push(`${fieldName} must be a valid number.`);
    return errors;
  }

  if (amount <= 0) {
    errors.push(`${fieldName} must be greater than zero.`);
  }

  return errors;
}

/**
 * Validate a loan type.
 */
export function validateLoanType(type: LoanType): string[] {
  if (type !== "emergency" && type !== "regular") {
    return ["Invalid loan type."];
  }

  return [];
}

/**
 * Validate guarantor details.
 *
 * Guarantor ID number is optional.
 */
export function validateGuarantor(
  guarantor: LoanGuarantor,
): string[] {
  const errors: string[] = [];

  if (!guarantor || typeof guarantor !== "object") {
    return ["Guarantor information is required."];
  }

  if (
    typeof guarantor.name !== "string" ||
    guarantor.name.trim().length < 2
  ) {
    errors.push("Guarantor name is required.");
  }

  if (
    typeof guarantor.phone !== "string" ||
    guarantor.phone.trim().length < 7
  ) {
    errors.push("A valid guarantor phone number is required.");
  }

  if (
    guarantor.idNumber !== undefined &&
    typeof guarantor.idNumber !== "string"
  ) {
    errors.push("Guarantor ID number must be text.");
  }

  return errors;
}

/**
 * Validate loan creation input.
 *
 * This does NOT check member existence or financial eligibility.
 * Those checks belong to the service layer.
 */
export function validateCreateLoan(
  input: CreateLoanInput,
): ValidationResult {
  const errors: string[] = [];

  if (!input || typeof input !== "object") {
    return {
      valid: false,
      errors: ["Loan data is required."],
    };
  }

  if (
    typeof input.memberId !== "string" ||
    input.memberId.trim().length === 0
  ) {
    errors.push("Member ID is required.");
  }

  errors.push(...validateLoanType(input.type));

  errors.push(...validateAmount(input.principal, "Loan principal"));

  errors.push(...validateGuarantor(input.guarantor));

  if (input.dailyFine !== undefined) {
    errors.push(...validateAmount(input.dailyFine, "Daily fine"));
  }

  if (input.disbursementDate !== undefined) {
    if (
      !(input.disbursementDate instanceof Date) ||
      Number.isNaN(input.disbursementDate.getTime())
    ) {
      errors.push("Disbursement date must be a valid date.");
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate loan repayment input.
 *
 * This is intentionally simple because the same input
 * will eventually be used by:
 *
 * 1. Manual repayment entry
 * 2. SMS/M-Pesa parser
 */
export function validateLoanRepayment(
  input: CreateLoanRepaymentInput,
): ValidationResult {
  const errors: string[] = [];

  if (!input || typeof input !== "object") {
    return {
      valid: false,
      errors: ["Repayment data is required."],
    };
  }

  if (
    input.loanId !== undefined &&
    (typeof input.loanId !== "string" ||
      input.loanId.trim().length === 0)
  ) {
    errors.push("Loan ID must be valid.");
  }

  if (
    input.memberId !== undefined &&
    (typeof input.memberId !== "string" ||
      input.memberId.trim().length === 0)
  ) {
    errors.push("Member ID must be valid.");
  }

  errors.push(...validateAmount(input.amount, "Repayment amount"));

  if (
    typeof input.transactionReference !== "string" ||
    input.transactionReference.trim().length === 0
  ) {
    errors.push("Transaction reference is required.");
  }

  if (
    !(input.transactionDate instanceof Date) ||
    Number.isNaN(input.transactionDate.getTime())
  ) {
    errors.push("Transaction date must be a valid date.");
  }

  if (
    input.source !== "manual" &&
    input.source !== "sms" &&
    input.source !== "system"
  ) {
    errors.push("Invalid repayment source.");
  }

  if (
    input.rawMessage !== undefined &&
    typeof input.rawMessage !== "string"
  ) {
    errors.push("Raw SMS message must be text.");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate loan settings.
 *
 * Interest rates are decimal values:
 *
 * 30% = 0.30
 * 40% = 0.40
 */
export function validateLoanSettings(
  settings: Partial<LoanSettings>,
): ValidationResult {
  const errors: string[] = [];

  if (!settings || typeof settings !== "object") {
    return {
      valid: false,
      errors: ["Loan settings are required."],
    };
  }

  if (settings.regularInterestRate !== undefined) {
    if (
      !Number.isFinite(settings.regularInterestRate) ||
      settings.regularInterestRate < 0 ||
      settings.regularInterestRate > 1
    ) {
      errors.push(
        "Regular interest rate must be between 0 and 1.",
      );
    }
  }

  if (settings.emergencyInterestRate !== undefined) {
    if (
      !Number.isFinite(settings.emergencyInterestRate) ||
      settings.emergencyInterestRate < 0 ||
      settings.emergencyInterestRate > 1
    ) {
      errors.push(
        "Emergency interest rate must be between 0 and 1.",
      );
    }
  }

  if (settings.regularMinimumSavings !== undefined) {
    errors.push(
      ...validateAmount(
        settings.regularMinimumSavings,
        "Regular minimum savings",
      ),
    );
  }

  if (settings.regularSavingsMultiplier !== undefined) {
    if (
      !Number.isFinite(settings.regularSavingsMultiplier) ||
      settings.regularSavingsMultiplier <= 0
    ) {
      errors.push(
        "Regular savings multiplier must be greater than zero.",
      );
    }
  }

  if (settings.repaymentGraceDays !== undefined) {
    if (
      !Number.isInteger(settings.repaymentGraceDays) ||
      settings.repaymentGraceDays < 0
    ) {
      errors.push(
        "Repayment grace days must be a whole number of zero or greater.",
      );
    }
  }

  if (settings.defaultDailyFine !== undefined) {
    if (
      !Number.isFinite(settings.defaultDailyFine) ||
      settings.defaultDailyFine < 0
    ) {
      errors.push(
        "Default daily fine must be zero or greater.",
      );
    }
  }

  if (settings.emergencyLoansEnabled !== undefined) {
    if (typeof settings.emergencyLoansEnabled !== "boolean") {
      errors.push(
        "Emergency loan enabled setting must be true or false.",
      );
    }
  }

  if (settings.regularLoansEnabled !== undefined) {
    if (typeof settings.regularLoansEnabled !== "boolean") {
      errors.push(
        "Regular loan enabled setting must be true or false.",
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Normalize text safely.
 */
export function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

/**
 * Normalize guarantor information before saving.
 */
export function normalizeGuarantor(
  guarantor: LoanGuarantor,
): LoanGuarantor {
  return {
    name: normalizeText(guarantor.name),
    phone: guarantor.phone.trim(),
    ...(guarantor.idNumber?.trim()
      ? {
          idNumber: guarantor.idNumber.trim(),
        }
      : {}),
  };
}