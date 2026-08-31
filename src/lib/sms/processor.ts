/**
 * GEO-SHUA
 * Bank SMS Payment Processor
 *
 * RESPONSIBILITY
 * ------------------------------------------------------------------
 *
 * Takes a classified bank transaction and resolves it against
 * GEO-SHUA's financial records.
 *
 * FLOW:
 *
 *     bank SMS
 *        ↓
 *     classifier.ts
 *        ↓
 *     payment classification
 *        ↓
 *     member/loan resolution
 *        ↓
 *     createLoanRepayment()
 *
 * IMPORTANT:
 *
 * The bank account number is NOT a GEO-SHUA savings account.
 *
 * The sender name is used to resolve the registered GEO-SHUA
 * member.
 *
 * The bank transaction reference is the immutable payment
 * identity.
 */

import {
  createLoanRepayment,
  getLoans,
} from "@/lib/loans/service";

import type {
  Loan,
  LoanRepayment,
} from "@/lib/loans/types";

import {
  classifyBankSms,
  type ClassifiedBankSms,
} from "@/lib/sms/classifier";

/* =========================================================
   TYPES
========================================================= */

export type ProcessBankSmsResult =
  | {
      status: "processed";
      payment: LoanRepayment;
      transaction: ClassifiedBankSms;
      loan: Loan;
    }
  | {
      status: "duplicate";
      payment: LoanRepayment;
      transaction: ClassifiedBankSms;
      loan: Loan | null;
    };

export type ProcessBankSmsOptions = {
  recordedBy?: {
    name: string;
    email: string;
  };
};

/* =========================================================
   NAME NORMALIZATION
========================================================= */

function normalizeName(
  value: string,
): string {
  return value
    .normalize("NFKC")
    .replace(
      /[\u2018\u2019\u201A\u0060]/g,
      "'",
    )
    .replace(
      /\s+/g,
      " ",
    )
    .trim()
    .toUpperCase();
}

/**
 * Financial member resolution must be exact.
 *
 * No fuzzy matching.
 * No partial matching.
 * No guessing.
 */
function namesEqual(
  left: string,
  right: string,
): boolean {
  return (
    normalizeName(left) ===
    normalizeName(right)
  );
}

/* =========================================================
   RESOLVE MEMBER + LOAN
========================================================= */

async function resolveLoanFromSender(
  transaction: ClassifiedBankSms,
): Promise<Loan> {
  const result =
    await getLoans({
      page: 1,
      limit: 100,
      search:
        transaction.senderName,
      status:
        "active",
    });

  if (
    !result.loans ||
    result.loans.length === 0
  ) {
    throw new Error(
      `No active GEO-SHUA loan could be found for member "${transaction.senderName}".`,
    );
  }

  /*
   * getLoans() search may be broader than an exact name
   * comparison.
   *
   * Therefore perform our own exact normalized comparison.
   */
  const exactMatches =
    result.loans.filter(
      (loan) =>
        namesEqual(
          loan.memberName,
          transaction.senderName,
        ),
    );

  if (
    exactMatches.length === 0
  ) {
    throw new Error(
      `Bank sender "${transaction.senderName}" did not exactly match a registered GEO-SHUA member with an active loan.`,
    );
  }

  /*
   * Never automatically choose between multiple active loans.
   */
  if (
    exactMatches.length > 1
  ) {
    const loanNumbers =
      exactMatches
        .map(
          (loan) =>
            loan.loanNumber,
        )
        .join(", ");

    throw new Error(
      `Multiple active loans match member "${transaction.senderName}": ${loanNumbers}. Automatic allocation is blocked.`,
    );
  }

  const loan =
    exactMatches[0];

  if (!loan) {
    throw new Error(
      `Unable to resolve loan for member "${transaction.senderName}".`,
    );
  }

  return loan;
}

/* =========================================================
   PROCESS CLASSIFIED TRANSACTION
========================================================= */

export async function processClassifiedBankPayment(
  transaction: ClassifiedBankSms,
  options: ProcessBankSmsOptions = {},
): Promise<ProcessBankSmsResult> {
  /*
   * -------------------------------------------------------
   * BASIC VALIDATION
   * -------------------------------------------------------
   */

  if (
    !transaction ||
    typeof transaction !==
      "object"
  ) {
    throw new Error(
      "A classified bank transaction is required.",
    );
  }

  /*
   * -------------------------------------------------------
   * PAYMENT ROUTING
   * -------------------------------------------------------
   *
   * Only loan transactions enter this processor.
   *
   * Savings payments must be handled by the savings
   * financial flow.
   */
  if (
    transaction.paymentType !==
    "loan"
  ) {
    if (
      transaction.paymentType ===
      "savings"
    ) {
      throw new Error(
        "This bank transaction is classified as a savings payment. It must not be processed as a loan repayment.",
      );
    }

    throw new Error(
      `Bank account "${transaction.bankAccountNumber}" is not configured as a GEO-SHUA loan payment account.`,
    );
  }

  /*
   * -------------------------------------------------------
   * RESOLVE LOAN
   * -------------------------------------------------------
   *
   * The bank sender name identifies the registered member.
   *
   * The bank account number only identified the payment
   * destination and has already been used by the classifier.
   */
  const loan =
    await resolveLoanFromSender(
      transaction,
    );

  /*
   * -------------------------------------------------------
   * CREATE REPAYMENT
   * -------------------------------------------------------
   *
   * The loan service owns:
   *
   * - transaction persistence
   * - idempotency
   * - balance calculation
   * - audit recording
   *
   * This processor does not manipulate balances itself.
   */
  const payment =
    await createLoanRepayment({
      loanId:
        loan.id,

      memberId:
        loan.memberId,

      amount:
        transaction.amount,

      transactionReference:
        transaction.transactionReference,

      transactionDate:
        transaction.transactionDate,

      source:
        "sms",

      rawMessage:
        transaction.rawMessage,

      ...(options.recordedBy
        ? {
            recordedBy:
              options.recordedBy,
          }
        : {}),
    });

  /*
   * The loan service is responsible for returning the
   * existing repayment when the transaction reference has
   * already been processed.
   *
   * At this layer we cannot safely claim "duplicate" unless
   * the service explicitly tells us that the record already
   * existed.
   *
   * Therefore a successful return is reported as processed.
   */
  return {
    status:
      "processed",

    payment,

    transaction,

    loan,
  };
}

/* =========================================================
   PROCESS RAW BANK SMS
========================================================= */

export async function processBankSms(
  rawMessage: string,
  options: ProcessBankSmsOptions = {},
): Promise<ProcessBankSmsResult> {
  /*
   * STEP 1
   *
   * Classify the raw bank SMS.
   */
  const transaction =
    classifyBankSms(
      rawMessage,
    );

  /*
   * STEP 2
   *
   * Resolve the GEO-SHUA member/loan and record the
   * repayment.
   */
  return processClassifiedBankPayment(
    transaction,
    options,
  );
}