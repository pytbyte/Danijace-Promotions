/**
 * =========================================================
 * GEO-SHUA
 * INCOMING BANK TRANSACTION PROCESSOR
 * =========================================================
 *
 * RESPONSIBILITY
 * ---------------------------------------------------------
 *
 * This file is the orchestration/routing layer between:
 *
 *   Android SMS
 *       ↓
 *   parser.ts
 *       ↓
 *   bank destination classification
 *       ↓
 *   member resolution
 *       ↓
 *   savings service OR loan service
 *
 * This project does NOT currently have a separate
 * classifier.ts.
 *
 * Therefore bank-account classification is intentionally
 * kept here.
 *
 * It does NOT implement financial persistence itself.
 *
 * Existing financial services remain authoritative:
 *
 *   createSavingsDeposit()
 *   createLoanRepayment()
 *
 * =========================================================
 *
 * CRITICAL BANK ACCOUNT SEMANTIC
 * ---------------------------------------------------------
 *
 * The account number appearing in the bank SMS is a BANK
 * COLLECTION / DESTINATION ACCOUNT.
 *
 * It is NOT:
 *
 * - a GEO-SHUA member ID
 * - a GEO-SHUA savings account ID
 * - a GEO-SHUA loan ID
 * - a GEO-SHUA loan number
 *
 * The destination account determines the transaction route:
 *
 *   082083  → loan
 *   2650821 → savings
 *
 * The sender name identifies the GEO-SHUA member.
 *
 * The bank transaction reference identifies the external
 * payment.
 *
 * =========================================================
 *
 * DATE ARCHITECTURE
 * ---------------------------------------------------------
 *
 * parser.ts currently exposes transactionDate as a Date.
 *
 * The financial system uses calendar-date strings:
 *
 *   YYYY-MM-DD
 *
 * Therefore this processor converts the parser Date once,
 * at the boundary, before calling the financial services.
 *
 * Financial services never receive a JavaScript Date for
 * financial transaction dates.
 *
 * =========================================================
 */

import {
  getMembers,
} from "@/lib/members/service";

import {
  createSavingsDeposit,
  getOrCreateSavingsAccount,
} from "@/lib/savings/service";

import {
  createLoanRepayment,
  getLoans,
} from "@/lib/loans/service";

import type {
  TransactionSource,
} from "@/lib/loans/types";

import type {
  SavingsTransaction,
} from "@/lib/savings/types";

import type {
  ParsedBankSms,
} from "@/lib/sms/parser";

/* =========================================================
   CONSTANTS
========================================================= */

/**
 * GEO-SHUA BANK COLLECTION / DESTINATION ACCOUNTS.
 *
 * IMPORTANT:
 *
 * These are NOT GEO-SHUA member financial accounts.
 *
 * They are routing identifiers contained in the bank SMS.
 */
const LOAN_BANK_ACCOUNT =
  "082083";

const SAVINGS_BANK_ACCOUNT =
  "2650821";

/* =========================================================
   TYPES
========================================================= */

export type IncomingTransactionActor = {
  name: string;
  email: string;
};

export type ProcessIncomingTransactionOptions = {
  recordedBy?: IncomingTransactionActor;
};

type BankPaymentType =
  | "loan"
  | "savings"
  | "unknown";

type ClassifiedBankTransaction =
  ParsedBankSms & {
    transactionType:
      BankPaymentType;
  };

type ResolvedMember = {
  id: string;
  name: string;
};

type ResolvedLoan =
  Awaited<
    ReturnType<typeof getLoans>
  >["loans"][number];

type LoanRepayment =
  Awaited<
    ReturnType<
      typeof createLoanRepayment
    >
  >;

export type ProcessIncomingTransactionResult =
  | {
      status: "processed";

      type: "savings";

      transaction: ParsedBankSms;

      member: ResolvedMember;

      savingsAccount: {
        id: string;
        accountNumber: string;
      };

      savingsTransaction:
        SavingsTransaction;
    }
  | {
      status: "processed";

      type: "loan";

      transaction: ParsedBankSms;

      member: ResolvedMember;

      loan: ResolvedLoan;

      repayment: LoanRepayment;
    };

/* =========================================================
   CALENDAR DATE HELPERS
========================================================= */

/**
 * Determine whether a year is a leap year.
 *
 * No JavaScript Date is used here because financial dates
 * are persisted as calendar strings.
 */
function isLeapYear(
  year: number,
): boolean {
  return (
    year % 4 === 0 &&
    (year % 100 !== 0 ||
      year % 400 === 0)
  );
}

/**
 * Return the number of days in a calendar month.
 */
function daysInMonth(
  year: number,
  month: number,
): number {
  switch (month) {
    case 2:
      return isLeapYear(year)
        ? 29
        : 28;

    case 4:
    case 6:
    case 9:
    case 11:
      return 30;

    default:
      return 31;
  }
}

/**
 * Validate GEO-SHUA's canonical financial calendar date.
 *
 * Valid:
 *
 *   2026-09-11
 *
 * Invalid:
 *
 *   2026-9-11
 *   11-09-2026
 *   2026-02-30
 *   Date object
 *   timestamp
 */
function isValidCalendarDate(
  value: unknown,
): value is string {
  if (
    typeof value !== "string"
  ) {
    return false;
  }

  const match =
    /^(\d{4})-(\d{2})-(\d{2})$/.exec(
      value,
    );

  if (!match) {
    return false;
  }

  const year =
    Number(match[1]);

  const month =
    Number(match[2]);

  const day =
    Number(match[3]);

  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day)
  ) {
    return false;
  }

  if (
    month < 1 ||
    month > 12
  ) {
    return false;
  }

  const maximumDay =
    daysInMonth(
      year,
      month,
    );

  return (
    day >= 1 &&
    day <= maximumDay
  );
}

/**
 * Convert the parser's Date into GEO-SHUA's canonical
 * financial calendar-date string.
 *
 * The parser boundary currently gives us a Date.
 *
 * The financial layer requires:
 *
 *   YYYY-MM-DD
 *
 * We therefore perform the conversion once here.
 *
 * NOTE:
 *
 * This uses the Date's calendar components rather than
 * converting the financial date into a UTC timestamp.
 */
function toCalendarDate(
  value: Date,
): string {
  if (
    !(value instanceof Date) ||
    Number.isNaN(
      value.getTime(),
    )
  ) {
    throw new Error(
      "Bank transaction date is invalid.",
    );
  }

  const year =
    value.getFullYear();

  const month =
    String(
      value.getMonth() + 1,
    ).padStart(2, "0");

  const day =
    String(
      value.getDate(),
    ).padStart(2, "0");

  const calendarDate =
    `${year}-${month}-${day}`;

  if (
    !isValidCalendarDate(
      calendarDate,
    )
  ) {
    throw new Error(
      "Bank transaction calendar date is invalid.",
    );
  }

  return calendarDate;
}

/* =========================================================
   BANK DESTINATION CLASSIFICATION
========================================================= */

/**
 * Determine the financial destination from the BANK
 * collection account contained in the SMS.
 *
 * This is deliberately NOT done by parser.ts.
 *
 * parser.ts only extracts:
 *
 *   destinationAccountNumber = "2650821"
 *
 * This function determines:
 *
 *   2650821 → savings
 *   082083  → loan
 *
 * Unknown accounts are NEVER guessed.
 *
 * IMPORTANT:
 *
 * This function does NOT query:
 *
 * - savingsAccounts
 * - loans
 * - members
 *
 * It only identifies the configured BANK collection
 * destination.
 */
function classifyBankAccount(
  destinationAccountNumber: string,
): BankPaymentType {
  /**
   * IMPORTANT:
   *
   * Keep this as a STRING.
   *
   * Do NOT convert to Number().
   *
   * Otherwise:
   *
   *   "082083"
   *
   * could become:
   *
   *   "82083"
   */
  const clean =
    destinationAccountNumber
      .trim()
      .replace(/\s+/g, "");

  if (
    clean ===
    LOAN_BANK_ACCOUNT
  ) {
    return "loan";
  }

  if (
    clean ===
    SAVINGS_BANK_ACCOUNT
  ) {
    return "savings";
  }

  return "unknown";
}

/* =========================================================
   CLASSIFY PARSED TRANSACTION
========================================================= */

/**
 * Add the financial destination to the parsed transaction.
 *
 * The parser intentionally returns the bank destination
 * without determining the financial domain.
 *
 * The processor classifies it here.
 */
function classifyTransaction(
  parsed: ParsedBankSms,
): ClassifiedBankTransaction {
  const transactionType =
    classifyBankAccount(
      parsed.destinationAccountNumber,
    );

  return {
    ...parsed,

    transactionType,
  };
}

/* =========================================================
   NAME NORMALIZATION
========================================================= */

/**
 * Normalize names before comparison.
 */
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

/* =========================================================
   NAME COMPARISON
========================================================= */

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
   MEMBER NAME
========================================================= */

/**
 * Build the canonical registered member name.
 *
 * Current member structure:
 *
 *   firstName
 *   middleName
 *   lastName
 *
 * Legacy compatibility:
 *
 *   name
 *   fullName
 */
function getMemberName(
  member: {
    firstName?: string;
    middleName?: string;
    lastName?: string;
    name?: string;
    fullName?: string;
  },
): string {
  const composed =
    [
      member.firstName,
      member.middleName,
      member.lastName,
    ]
      .filter(
        (
          value,
        ): value is string =>
          typeof value ===
            "string" &&
          value.trim().length >
            0,
      )
      .join(" ")
      .trim();

  if (
    composed.length >
    0
  ) {
    return composed;
  }

  if (
    typeof member.name ===
      "string" &&
    member.name.trim()
  ) {
    return member.name.trim();
  }

  if (
    typeof member.fullName ===
      "string" &&
    member.fullName.trim()
  ) {
    return member.fullName.trim();
  }

  return "";
}

/* =========================================================
   RESOLVE MEMBER BY SMS NAME
========================================================= */

/**
 * Resolve a GEO-SHUA member using the name supplied by
 * the bank.
 *
 * IMPORTANT:
 *
 * Member identity comes from senderName.
 *
 * The bank destination account is NOT used to resolve
 * the member.
 *
 * The final financial identity decision is EXACT.
 */
async function resolveMemberBySmsName(
  senderName: string,
): Promise<ResolvedMember> {
  const cleanName =
    normalizeName(
      senderName,
    );

  if (
    cleanName.length ===
    0
  ) {
    throw new Error(
      "Bank SMS sender name is required.",
    );
  }

  const tokens =
    Array.from(
      new Set(
        cleanName
          .split(" ")
          .map(
            (token) =>
              token.trim(),
          )
          .filter(Boolean),
      ),
    );

  if (
    tokens.length ===
    0
  ) {
    throw new Error(
      "Bank SMS sender name is required.",
    );
  }

  type Candidate =
    Awaited<
      ReturnType<typeof getMembers>
    >["members"][number];

  const candidates =
    new Map<
      string,
      Candidate
    >();

  /**
   * Search by complete name first, then individual
   * name tokens.
   */
  const searchTerms =
    Array.from(
      new Set([
        senderName,
        ...tokens,
      ]),
    );

  for (
    const searchTerm of
      searchTerms
  ) {
    const result =
      await getMembers({
        page: 1,

        limit: 100,

        search:
          searchTerm,
      });

    for (
      const candidate of
        result.members || []
    ) {
      const memberId =
        typeof candidate._id ===
          "string"
          ? candidate._id.trim()
          : "";

      if (
        memberId.length ===
        0
      ) {
        continue;
      }

      candidates.set(
        memberId,
        candidate,
      );
    }
  }

  /* -------------------------------------------------------
     NO CANDIDATES
  ------------------------------------------------------- */

  if (
    candidates.size ===
    0
  ) {
    throw new Error(
      `No GEO-SHUA member could be found for bank sender "${senderName}".`,
    );
  }

  /* -------------------------------------------------------
     EXACT MATCH
  ------------------------------------------------------- */

  const exactMatches =
    Array.from(
      candidates.values(),
    ).filter(
      (
        candidate,
      ) => {
        const candidateName =
          getMemberName(
            candidate as {
              firstName?: string;
              middleName?: string;
              lastName?: string;
              name?: string;
              fullName?: string;
            },
          );

        if (
          candidateName.length ===
          0
        ) {
          return false;
        }

        return namesEqual(
          candidateName,
          senderName,
        );
      },
    );

  if (
    exactMatches.length ===
    0
  ) {
    throw new Error(
      `Bank sender "${senderName}" did not exactly match a registered GEO-SHUA member.`,
    );
  }

  /* -------------------------------------------------------
     MULTIPLE EXACT MATCHES
  ------------------------------------------------------- */

  if (
    exactMatches.length >
    1
  ) {
    throw new Error(
      `Multiple GEO-SHUA members exactly match bank sender "${senderName}". Automatic processing is blocked.`,
    );
  }

  const member =
    exactMatches[0];

  if (!member) {
    throw new Error(
      `Unable to resolve GEO-SHUA member "${senderName}".`,
    );
  }

  const memberId =
    typeof member._id ===
      "string"
      ? member._id.trim()
      : "";

  if (
    memberId.length ===
    0
  ) {
    throw new Error(
      `Resolved member "${senderName}" has no valid member ID.`,
    );
  }

  /* -------------------------------------------------------
     MEMBER STATUS
  ------------------------------------------------------- */

  const memberStatus =
    typeof member.status ===
      "string"
      ? member.status
          .trim()
          .toLowerCase()
      : "";

  if (
    memberStatus !==
    "active"
  ) {
    throw new Error(
      `Member "${senderName}" is not active and cannot receive automatic financial processing.`,
    );
  }

  const canonicalName =
    getMemberName(
      member as {
        firstName?: string;
        middleName?: string;
        lastName?: string;
        name?: string;
        fullName?: string;
      },
    );

  if (
    canonicalName.length ===
    0
  ) {
    throw new Error(
      `Resolved member "${senderName}" has no valid registered name.`,
    );
  }

  return {
    id:
      memberId,

    name:
      canonicalName,
  };
}

/* =========================================================
   RESOLVE SAVINGS ACCOUNT
========================================================= */

/**
 * Every member should have exactly one savings account.
 *
 * The savings service owns the unique-member constraint.
 *
 * NOTE:
 *
 * We intentionally do NOT compare this GEO-SHUA savings
 * account number with the bank destination account.
 *
 * The two values have completely different meanings.
 */
async function resolveSavingsAccount(
  member: ResolvedMember,
): Promise<{
  id: string;
  accountNumber: string;
}> {
  const account =
    await getOrCreateSavingsAccount({
      memberId:
        member.id,

      memberName:
        member.name,
    });

  if (!account) {
    throw new Error(
      `Savings account could not be resolved for member "${member.name}".`,
    );
  }

  if (
    account.status !==
    "active"
  ) {
    throw new Error(
      `Savings account "${account.accountNumber}" is inactive.`,
    );
  }

  /**
   * Existing GEO-SHUA savings service currently expects
   * the account type to be "fixed".
   *
   * We preserve that existing invariant here.
   */
  if (
    account.accountType !==
    "fixed"
  ) {
    throw new Error(
      `Savings account "${account.accountNumber}" is not the required fixed savings account.`,
    );
  }

  if (
    typeof account.id !==
      "string" ||
    account.id.trim().length ===
      0
  ) {
    throw new Error(
      `Savings account "${account.accountNumber}" has no valid account ID.`,
    );
  }

  return {
    id:
      account.id,

    accountNumber:
      account.accountNumber,
  };
}

/* =========================================================
   RESOLVE ACTIVE LOAN FOR TRANSACTION
========================================================= */

/**
 * Resolve exactly one active loan for the member.
 *
 * IMPORTANT DATE ARCHITECTURE
 * ---------------------------------------------------------
 *
 * transactionDate is now a canonical calendar-date string:
 *
 *     YYYY-MM-DD
 *
 * loan.disbursementDate is also a canonical calendar-date
 * string:
 *
 *     YYYY-MM-DD
 *
 * No JavaScript Date objects are used for financial
 * persistence or financial comparison.
 *
 * Because YYYY-MM-DD is lexicographically sortable,
 * direct string comparison is chronologically correct.
 *
 * Example:
 *
 *   "2026-09-05" < "2026-09-11"
 *
 * therefore:
 *
 *   transactionDate < disbursementDate
 *
 * is safe.
 *
 * =========================================================
 */
async function resolveLoanForTransaction(
  member: ResolvedMember,
  transactionDate: string,
): Promise<ResolvedLoan> {
  if (
    !isValidCalendarDate(
      transactionDate,
    )
  ) {
    throw new Error(
      "Bank transaction calendar date is invalid.",
    );
  }

  const result =
    await getLoans({
      page: 1,

      limit: 100,

      memberId:
        member.id,

      status:
        "active",
    });

  const loans =
    result.loans || [];

  /* -------------------------------------------------------
     NO ACTIVE LOAN
  ------------------------------------------------------- */

  if (
    loans.length ===
    0
  ) {
    throw new Error(
      `No active GEO-SHUA loan could be found for member "${member.name}".`,
    );
  }

  /* -------------------------------------------------------
     MULTIPLE ACTIVE LOANS
  ------------------------------------------------------- */

  if (
    loans.length >
    1
  ) {
    const loanNumbers =
      loans
        .map(
          (loan) =>
            loan.loanNumber,
        )
        .filter(
          (
            value,
          ): value is string =>
            typeof value ===
              "string" &&
            value.trim().length >
              0,
        )
        .join(", ");

    throw new Error(
      `Member "${member.name}" has multiple active loans${
        loanNumbers.length >
        0
          ? ` (${loanNumbers})`
          : ""
      }. Automatic SMS repayment allocation is blocked.`,
    );
  }

  const loan =
    loans[0];

  if (!loan) {
    throw new Error(
      `Unable to resolve the active loan for member "${member.name}".`,
    );
  }

  /* -------------------------------------------------------
     VALIDATE DISBURSEMENT DATE
  ------------------------------------------------------- */

  const disbursementDate =
    loan.disbursementDate;

  if (
    !isValidCalendarDate(
      disbursementDate,
    )
  ) {
    throw new Error(
      `Active loan "${loan.loanNumber}" has an invalid disbursement date. Automatic SMS repayment processing is blocked.`,
    );
  }

  /* -------------------------------------------------------
     BANK TRANSACTION DATE PROTECTION
  ------------------------------------------------------- */

  /**
   * The bank transaction must occur STRICTLY AFTER the
   * loan disbursement date.
   *
   * We deliberately compare the BANK transaction date,
   * not the Android SMS receipt date.
   *
   * This prevents an old payment from being attached to
   * a loan that did not yet exist when the payment occurred.
   */
  if (
    transactionDate <=
    disbursementDate
  ) {
    throw new Error(
      "SMS_REPAYMENT_BEFORE_DISBURSEMENT",
    );
  }

  return loan;
}

/* =========================================================
   SMS IDENTITY
========================================================= */

/**
 * Build a deterministic identity for this exact SMS.
 *
 * IMPORTANT:
 *
 * This is an ingestion identity.
 *
 * The bank transaction reference remains the primary
 * financial identifier.
 */
function createSmsId(
  transaction: ParsedBankSms,
): string {
  return [
    transaction.reference,

    transaction.smsDate,

    transaction.destinationAccountNumber,

    transaction.address ||
      "",
  ].join(":");
}

/* =========================================================
   PROCESS SAVINGS
========================================================= */

/**
 * Route a savings payment into the authoritative
 * savings ledger service.
 */
async function processSavingsTransaction(
  transaction: ParsedBankSms,
  classified:
    ClassifiedBankTransaction,
  member: ResolvedMember,
  options:
    ProcessIncomingTransactionOptions,
): Promise<{
  savingsAccount: {
    id: string;
    accountNumber: string;
  };

  savingsTransaction:
    SavingsTransaction;
}> {
  const savingsAccount =
    await resolveSavingsAccount(
      member,
    );

  /**
   * Convert the parser Date into the canonical financial
   * calendar date before calling the savings service.
   *
   * This is the important Date → YYYY-MM-DD boundary.
   */
  const transactionAt =
    toCalendarDate(
      classified.transactionDate,
    );

  const savingsTransaction =
    await createSavingsDeposit({
      savingsAccountId:
        savingsAccount.id,

      memberId:
        member.id,

      memberName:
        member.name,

      amount:
        classified.amount,

      /**
       * This transaction entered GEO-SHUA through the
       * Android SMS ingestion pipeline.
       */
      source:
        "sms",

      /**
       * Immutable bank transaction reference.
       */
      reference:
        classified.reference,

      /**
       * Deterministic Android SMS identity.
       */
      smsId:
        createSmsId(
          transaction,
        ),

      /**
       * IMPORTANT:
       *
       * This is the BANK destination account.
       *
       * It is NOT the GEO-SHUA savings account ID.
       */
      sourceReference:
        classified.destinationAccountNumber,

      /**
       * Financial transaction date.
       *
       * Must remain YYYY-MM-DD.
       */
      transactionAt,

      ...(options.recordedBy
        ? {
            recordedBy: {
              name:
                options.recordedBy.name,

              email:
                options.recordedBy.email,
            },
          }
        : {}),
    });

  return {
    savingsAccount,

    savingsTransaction,
  };
}

/* =========================================================
   PROCESS LOAN
========================================================= */

/**
 * Route a loan payment into the authoritative loan
 * repayment service.
 */
async function processLoanTransaction(
  transaction: ParsedBankSms,
  classified:
    ClassifiedBankTransaction,
  member: ResolvedMember,
  options:
    ProcessIncomingTransactionOptions,
): Promise<{
  loan: ResolvedLoan;

  repayment: LoanRepayment;
}> {
  /**
   * Convert the parser Date exactly once.
   *
   * Everything below uses the canonical financial
   * calendar-date string.
   */
  const transactionDate =
    toCalendarDate(
      classified.transactionDate,
    );

  const loan =
    await resolveLoanForTransaction(
      member,
      transactionDate,
    );

  /**
   * Resolve the loan ID from the returned loan object.
   *
   * The current loan service exposes `id` as the public
   * string identifier.
   */
  if (
    typeof loan.id !==
      "string" ||
    loan.id.trim().length ===
      0
  ) {
    throw new Error(
      `Resolved loan "${loan.loanNumber}" has no valid loan ID.`,
    );
  }

  const repayment =
    await createLoanRepayment({
      loanId:
        loan.id,

      memberId:
        member.id,

      amount:
        classified.amount,

      transactionReference:
        classified.reference,

      /**
       * Financial transaction date.
       *
       * Must remain YYYY-MM-DD.
       */
      transactionDate,

      source:
        "sms" as TransactionSource,

      rawMessage:
        transaction.rawMessage,

      ...(options.recordedBy
        ? {
            recordedBy: {
              name:
                options.recordedBy.name,

              email:
                options.recordedBy.email,
            },
          }
        : {}),
    });

  return {
    loan,

    repayment,
  };
}

/* =========================================================
   MAIN PROCESSOR
========================================================= */

/**
 * Process one parsed bank transaction.
 *
 * Actual flow:
 *
 *   ParsedBankSms
 *       ↓
 *   classify BANK destination
 *       ↓
 *   resolve GEO-SHUA member from sender name
 *       ↓
 *   savings OR loan
 */
export async function processIncomingTransaction(
  parsedTransaction: ParsedBankSms,
  options:
    ProcessIncomingTransactionOptions = {},
): Promise<
  ProcessIncomingTransactionResult
> {
  /* =======================================================
     BASIC VALIDATION
  ======================================================= */

  if (
    !parsedTransaction ||
    typeof parsedTransaction !==
      "object"
  ) {
    throw new Error(
      "Parsed bank transaction is required.",
    );
  }

  if (
    typeof parsedTransaction.reference !==
      "string" ||
    parsedTransaction.reference.trim()
      .length === 0
  ) {
    throw new Error(
      "Parsed bank transaction reference is required.",
    );
  }

  if (
    !Number.isFinite(
      parsedTransaction.amount,
    ) ||
    parsedTransaction.amount <=
      0
  ) {
    throw new Error(
      "Parsed bank transaction amount must be greater than zero.",
    );
  }

  if (
    typeof parsedTransaction.senderName !==
      "string" ||
    parsedTransaction.senderName.trim()
      .length === 0
  ) {
    throw new Error(
      "Parsed bank transaction sender name is required.",
    );
  }

  if (
    typeof parsedTransaction.destinationAccountNumber !==
      "string" ||
    parsedTransaction.destinationAccountNumber
      .trim()
      .length === 0
  ) {
    throw new Error(
      "Parsed bank transaction bank destination account number is required.",
    );
  }

  if (
    parsedTransaction.status !==
    "confirmed"
  ) {
    throw new Error(
      "Only confirmed bank transactions may enter financial processing.",
    );
  }

  /**
   * IMPORTANT:
   *
   * This Date validation is correct because this is the
   * parser boundary.
   *
   * ParsedBankSms.transactionDate is currently a Date.
   *
   * It is converted to YYYY-MM-DD before entering the
   * financial services.
   */
  if (
    !(
      parsedTransaction.transactionDate instanceof
      Date
    ) ||
    Number.isNaN(
      parsedTransaction.transactionDate.getTime(),
    )
  ) {
    throw new Error(
      "Parsed bank transaction date is invalid.",
    );
  }

  /* =======================================================
     CLASSIFY BANK DESTINATION
  ======================================================= */

  const classified =
    classifyTransaction(
      parsedTransaction,
    );

  /* =======================================================
     UNKNOWN BANK DESTINATION
  ======================================================= */

  if (
    classified.transactionType ===
    "unknown"
  ) {
    throw new Error(
      `Bank destination account "${classified.destinationAccountNumber}" is not configured as a GEO-SHUA loan or savings collection destination.`,
    );
  }

  /* =======================================================
     RESOLVE MEMBER
  ======================================================= */

  const member =
    await resolveMemberBySmsName(
      classified.senderName,
    );

  /* =======================================================
     ROUTE SAVINGS
  ======================================================= */

  if (
    classified.transactionType ===
    "savings"
  ) {
    const {
      savingsAccount,
      savingsTransaction,
    } =
      await processSavingsTransaction(
        parsedTransaction,
        classified,
        member,
        options,
      );

    return {
      status:
        "processed",

      type:
        "savings",

      transaction:
        parsedTransaction,

      member,

      savingsAccount,

      savingsTransaction,
    };
  }

  /* =======================================================
     ROUTE LOAN
  ======================================================= */

  if (
    classified.transactionType ===
    "loan"
  ) {
    const {
      loan,
      repayment,
    } =
      await processLoanTransaction(
        parsedTransaction,
        classified,
        member,
        options,
      );

    return {
      status:
        "processed",

      type:
        "loan",

      transaction:
        parsedTransaction,

      member,

      loan,

      repayment,
    };
  }

  /* =======================================================
     DEFENSIVE FALLBACK
  ======================================================= */

  throw new Error(
    `Bank destination account "${classified.destinationAccountNumber}" could not be routed.`,
  );
}

/* =========================================================
   RAW SMS COMPATIBILITY
========================================================= */

/**
 * Compatibility helper for callers that supply only a raw
 * SMS body.
 *
 * The parser remains responsible for creating the initial
 * ParsedBankSms object.
 */
export async function processBankSms(
  rawMessage: string,
  options:
    ProcessIncomingTransactionOptions = {},
): Promise<
  ProcessIncomingTransactionResult
> {
  if (
    typeof rawMessage !==
      "string" ||
    rawMessage.trim().length ===
      0
  ) {
    throw new Error(
      "Raw bank SMS message is required.",
    );
  }

  const {
    parseBankSms,
  } = await import(
    "@/lib/sms/parser"
  );

  const parsed =
    parseBankSms({
      address:
        null,

      body:
        rawMessage,

      date:
        Date.now(),
    });

  return processIncomingTransaction(
    parsed,
    options,
  );
}