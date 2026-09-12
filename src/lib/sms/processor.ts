/**
 * =========================================================
 * GEO-SHUA
 * INCOMING BANK TRANSACTION PROCESSOR
 * =========================================================
 *
 * RESPONSIBILITY
 * ---------------------------------------------------------
 *
 * Android SMS
 *     ↓
 * parser.ts
 *     ↓
 * bank destination classification
 *     ↓
 * member resolution
 *     ↓
 * savings service OR loan service
 *
 * This file is orchestration only.
 *
 * Financial persistence remains authoritative in:
 *
 *   createSavingsDeposit()
 *   createLoanRepayment()
 *
 * =========================================================
 *
 * BANK ACCOUNT SEMANTIC
 * ---------------------------------------------------------
 *
 * The destination account in the bank SMS is a BANK
 * COLLECTION / DESTINATION ACCOUNT.
 *
 * It is NOT:
 *
 * - a GEO-SHUA member ID
 * - a GEO-SHUA savings account ID
 * - a GEO-SHUA loan ID
 * - a GEO-SHUA loan number
 *
 * Routing:
 *
 *   082083  → loan
 *   2650821 → savings
 *
 * Sender name identifies the GEO-SHUA member.
 *
 * Bank transaction reference identifies the external
 * payment.
 *
 * =========================================================
 *
 * DATE ARCHITECTURE
 * ---------------------------------------------------------
 *
 * Financial/calendar dates are canonical:
 *
 *   YYYY-MM-DD
 *
 * Legacy MongoDB records may still contain:
 *
 *   Date
 *   ISO timestamp string
 *   numeric timestamp
 *
 * Legacy values are normalized at the boundary using:
 *
 *   Africa/Nairobi
 *
 * Financial comparisons are then string-to-string.
 *
 * Example:
 *
 *   "2026-09-05" < "2026-09-11"
 *
 * is chronologically correct.
 *
 * System timestamps such as createdAt/updatedAt remain
 * Date/timestamp values and are NOT converted here.
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
 * BANK COLLECTION / DESTINATION ACCOUNTS.
 *
 * These are routing identifiers from the bank SMS.
 */
const LOAN_BANK_ACCOUNT =
  "082083";

const SAVINGS_BANK_ACCOUNT =
  "2650821";

/**
 * Financial calendar timezone.
 *
 * Kenya is UTC+03:00.
 *
 * We use the named timezone instead of UTC because a
 * timestamp near midnight UTC can belong to the next
 * Kenyan calendar day.
 */
const FINANCIAL_TIME_ZONE =
  "Africa/Nairobi";

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

type FinancialDateInput =
  | string
  | Date
  | number;

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
 * Validate canonical GEO-SHUA financial calendar date.
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
 */
function isValidCalendarDate(
  value: unknown,
): value is string {
  if (
    typeof value !==
    "string"
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
 * Convert a JavaScript Date into a Kenyan calendar date.
 *
 * IMPORTANT:
 *
 * Do NOT use:
 *
 *   date.toISOString().slice(0, 10)
 *
 * because that uses UTC.
 */
function dateToNairobiCalendarDate(
  value: Date,
): string {
  if (
    !(value instanceof Date) ||
    Number.isNaN(
      value.getTime(),
    )
  ) {
    throw new Error(
      "Financial date is invalid.",
    );
  }

  const parts =
    new Intl.DateTimeFormat(
      "en-CA",
      {
        timeZone:
          FINANCIAL_TIME_ZONE,

        year:
          "numeric",

        month:
          "2-digit",

        day:
          "2-digit",
      },
    ).formatToParts(
      value,
    );

  const year =
    parts.find(
      (part) =>
        part.type ===
        "year",
    )?.value;

  const month =
    parts.find(
      (part) =>
        part.type ===
        "month",
    )?.value;

  const day =
    parts.find(
      (part) =>
        part.type ===
        "day",
    )?.value;

  if (
    !year ||
    !month ||
    !day
  ) {
    throw new Error(
      "Unable to determine financial calendar date.",
    );
  }

  const calendarDate =
    `${year}-${month}-${day}`;

  if (
    !isValidCalendarDate(
      calendarDate,
    )
  ) {
    throw new Error(
      "Financial calendar date is invalid.",
    );
  }

  return calendarDate;
}

/**
 * Normalize any supported financial-date representation.
 *
 * Supported:
 *
 *   YYYY-MM-DD
 *   ISO date string
 *   ISO timestamp string
 *   Date
 *   numeric timestamp
 *
 * Returned value is ALWAYS:
 *
 *   YYYY-MM-DD
 */
function toCalendarDate(
  value: FinancialDateInput,
): string {
  /* -------------------------------------------------------
     STRING
  ------------------------------------------------------- */

  if (
    typeof value ===
    "string"
  ) {
    const clean =
      value.trim();

    if (
      clean.length ===
      0
    ) {
      throw new Error(
        "Financial date cannot be empty.",
      );
    }

    /**
     * Preferred representation.
     */
    if (
      isValidCalendarDate(
        clean,
      )
    ) {
      return clean;
    }

    /**
     * Legacy ISO/timestamp string.
     *
     * Convert the instant using Kenya timezone.
     */
    const parsed =
      new Date(clean);

    if (
      Number.isNaN(
        parsed.getTime(),
      )
    ) {
      throw new Error(
        `Invalid financial date: "${value}".`,
      );
    }

    return dateToNairobiCalendarDate(
      parsed,
    );
  }

  /* -------------------------------------------------------
     JAVASCRIPT / MONGODB DATE
  ------------------------------------------------------- */

  if (
    value instanceof Date
  ) {
    return dateToNairobiCalendarDate(
      value,
    );
  }

  /* -------------------------------------------------------
     NUMERIC TIMESTAMP
  ------------------------------------------------------- */

  if (
    typeof value ===
    "number"
  ) {
    if (
      !Number.isFinite(
        value,
      )
    ) {
      throw new Error(
        "Financial timestamp is invalid.",
      );
    }

    const parsed =
      new Date(value);

    if (
      Number.isNaN(
        parsed.getTime(),
      )
    ) {
      throw new Error(
        "Financial timestamp is invalid.",
      );
    }

    return dateToNairobiCalendarDate(
      parsed,
    );
  }

  throw new Error(
    "Unsupported financial date value.",
  );
}

/**
 * Normalize a potentially legacy database financial date.
 *
 * This deliberately accepts unknown because MongoDB legacy
 * documents may contain a BSON Date even if the current
 * TypeScript domain type says string.
 */
function normalizeFinancialDate(
  value: unknown,
  fieldName: string,
): string {
  try {
    if (
      typeof value !==
        "string" &&
      !(value instanceof Date) &&
      typeof value !==
        "number"
    ) {
      throw new Error(
        "Unsupported financial date type.",
      );
    }

    return toCalendarDate(
      value,
    );
  } catch {
    throw new Error(
      `${fieldName} is invalid. Expected YYYY-MM-DD or a valid legacy timestamp.`,
    );
  }
}

/* =========================================================
   BANK DESTINATION CLASSIFICATION
========================================================= */

/**
 * Determine whether the bank destination represents:
 *
 *   2650821 → savings
 *   082083  → loan
 *
 * Unknown accounts are never guessed.
 */
function classifyBankAccount(
  destinationAccountNumber: string,
): BankPaymentType {
  /**
   * Account numbers MUST remain strings.
   *
   * "082083" must not become "82083".
   */
  const clean =
    destinationAccountNumber
      .trim()
      .replace(
        /\s+/g,
        "",
      );

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
   CLASSIFY TRANSACTION
========================================================= */

function classifyTransaction(
  parsed: ParsedBankSms,
): ClassifiedBankTransaction {
  return {
    ...parsed,

    transactionType:
      classifyBankAccount(
        parsed.destinationAccountNumber,
      ),
  };
}

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
   RESOLVE MEMBER
========================================================= */

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

  if (
    candidates.size ===
    0
  ) {
    throw new Error(
      `No GEO-SHUA member could be found for bank sender "${senderName}".`,
    );
  }

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

        return (
          candidateName.length >
            0 &&
          namesEqual(
            candidateName,
            senderName,
          )
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
   RESOLVE ACTIVE LOAN
========================================================= */

/**
 * Resolve exactly one active loan.
 *
 * Loan disbursement dates may be:
 *
 *   YYYY-MM-DD
 *   Date
 *   ISO timestamp
 *   numeric timestamp
 *
 * They are normalized before comparison.
 *
 * IMPORTANT:
 *
 * A payment BEFORE the disbursement date is invalid.
 *
 * A payment ON the disbursement date is allowed.
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

  if (
    loans.length ===
    0
  ) {
    throw new Error(
      `No active GEO-SHUA loan could be found for member "${member.name}".`,
    );
  }

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

  const disbursementDate =
    normalizeFinancialDate(
      loan.disbursementDate,
      `Active loan "${loan.loanNumber}" disbursement date`,
    );

  /**
   * IMPORTANT:
   *
   * Same-day repayment is valid.
   *
   * Only an earlier calendar date is invalid.
   */
  if (
    transactionDate <
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

async function processSavingsTransaction(
  transaction: ParsedBankSms,
  classified:
    ClassifiedBankTransaction,
  member: ResolvedMember,
  transactionDate: string,
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

      source:
        "sms",

      reference:
        classified.reference,

      smsId:
        createSmsId(
          transaction,
        ),

      /**
       * BANK destination account.
       *
       * NOT the GEO-SHUA savings account ID.
       */
      sourceReference:
        classified.destinationAccountNumber,

      /**
       * Canonical financial date:
       *
       * YYYY-MM-DD
       */
      transactionAt:
        transactionDate,

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

async function processLoanTransaction(
  transaction: ParsedBankSms,
  classified:
    ClassifiedBankTransaction,
  member: ResolvedMember,
  transactionDate: string,
  options:
    ProcessIncomingTransactionOptions,
): Promise<{
  loan: ResolvedLoan;

  repayment: LoanRepayment;
}> {
  const loan =
    await resolveLoanForTransaction(
      member,
      transactionDate,
    );

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
       * Canonical financial date:
       *
       * YYYY-MM-DD
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
      .length ===
      0
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
      .length ===
      0
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
      .length ===
      0
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

  /* =======================================================
     NORMALIZE TRANSACTION DATE
  ======================================================= */

  /**
   * Normalize the parser/external date ONCE.
   *
   * From this point onward:
   *
   *   transactionDate
   *
   * is always:
   *
   *   YYYY-MM-DD
   */
  const transactionDate =
    normalizeFinancialDate(
      parsedTransaction.transactionDate,
      "Parsed bank transaction date",
    );

  /* =======================================================
     CLASSIFY
  ======================================================= */

  const classified =
    classifyTransaction(
      parsedTransaction,
    );

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
     SAVINGS
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
        transactionDate,
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
     LOAN
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
        transactionDate,
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