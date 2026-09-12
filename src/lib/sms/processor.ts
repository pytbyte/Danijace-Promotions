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
 * GEO-SHUA financial/calendar dates are represented as:
 *
 *   YYYY-MM-DD
 *
 * Examples:
 *
 *   2026-09-11
 *   2026-09-12
 *
 * JavaScript Date objects and timestamps may still exist
 * in legacy MongoDB records or at external boundaries.
 *
 * This file therefore accepts:
 *
 *   - YYYY-MM-DD strings
 *   - ISO date strings
 *   - ISO timestamp strings
 *   - JavaScript Date objects
 *   - numeric timestamps
 *
 * and normalizes them to:
 *
 *   YYYY-MM-DD
 *
 * BEFORE they are used by the financial layer.
 *
 * IMPORTANT:
 *
 * Once a financial date has been normalized, all financial
 * comparisons are string-to-string comparisons.
 *
 * Because YYYY-MM-DD is lexicographically sortable:
 *
 *   "2026-09-05" < "2026-09-11"
 *
 * is chronologically correct.
 *
 * Financial services therefore never need to compare:
 *
 *   Date
 *   string
 *
 * and this avoids the Date | string errors that occur when
 * old MongoDB records contain timestamps.
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

/**
 * GEO-SHUA financial calendar timezone.
 *
 * Legacy timestamps are interpreted using Kenya time when
 * they need to be converted into a calendar date.
 *
 * This prevents a UTC timestamp around midnight from being
 * accidentally assigned to the wrong Kenyan calendar day.
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

/**
 * Financial/calendar date input.
 *
 * The application should ultimately use strings, but this
 * boundary intentionally accepts legacy representations.
 */
type CalendarDateInput =
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
 *
 * No JavaScript Date is required for calendar validation.
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
 * Convert a Date/timestamp into a calendar date using
 * Africa/Nairobi.
 *
 * IMPORTANT:
 *
 * We do NOT use:
 *
 *   date.toISOString().slice(0, 10)
 *
 * because that converts using UTC and can produce the
 * wrong Kenyan calendar date around midnight.
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

  const formatter =
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
    );

  const parts =
    formatter.formatToParts(
      value,
    );

  let year = "";
  let month = "";
  let day = "";

  for (
    const part of parts
  ) {
    if (
      part.type ===
      "year"
    ) {
      year =
        part.value;
    }

    if (
      part.type ===
      "month"
    ) {
      month =
        part.value;
    }

    if (
      part.type ===
      "day"
    ) {
      day =
        part.value;
    }
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
 * Normalize ANY supported financial date representation
 * into the canonical GEO-SHUA calendar date:
 *
 *   YYYY-MM-DD
 *
 * Supported:
 *
 *   "2026-09-11"
 *
 *   "2026-09-11T00:00:00.000Z"
 *
 *   new Date(...)
 *
 *   1726012800000
 *
 * This function is intentionally used at boundaries.
 *
 * After normalization, financial code should only use the
 * returned string.
 */
function toCalendarDate(
  value: CalendarDateInput,
): string {
  /* -------------------------------------------------------
     ALREADY CANONICAL STRING
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
     * Best case:
     *
     * The value is already the canonical financial date.
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
     * Example:
     *
     *   2026-09-11T00:00:00.000Z
     *
     * Do NOT simply slice the first ten characters
     * because the timestamp may cross the Kenya calendar
     * boundary.
     */
    const parsed =
      new Date(clean);

    if (
      !Number.isNaN(
        parsed.getTime(),
      )
    ) {
      return dateToNairobiCalendarDate(
        parsed,
      );
    }

    throw new Error(
      `Invalid financial date: "${value}". Expected YYYY-MM-DD or a valid timestamp.`,
    );
  }

  /* -------------------------------------------------------
     JAVASCRIPT DATE
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
 * Validate and normalize a financial date.
 *
 * This is useful when a database record can contain either:
 *
 *   string
 *   Date
 *   timestamp
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
        "Unsupported date type.",
      );
    }

    return toCalendarDate(
      value,
    );
  } catch {
    throw new Error(
      `${fieldName} is invalid. Expected a calendar date or a valid legacy timestamp.`,
    );
  }
}

/* =========================================================
   BANK DESTINATION CLASSIFICATION
========================================================= */

/**
 * Determine the financial destination from the BANK
 * collection account contained in the SMS.
 *
 * parser.ts only extracts the destination account.
 *
 * This function determines:
 *
 *   2650821 → savings
 *   082083  → loan
 *
 * Unknown accounts are NEVER guessed.
 */
function classifyBankAccount(
  destinationAccountNumber: string,
): BankPaymentType {
  /**
   * Keep bank account numbers as STRINGS.
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
   CLASSIFY PARSED TRANSACTION
========================================================= */

/**
 * Add the financial destination to the parsed transaction.
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
      ReturnType<
        typeof getMembers
      >
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
 * DATE SAFETY
 * ---------------------------------------------------------
 *
 * transactionDate is already:
 *
 *   YYYY-MM-DD
 *
 * loan.disbursementDate may be:
 *
 *   YYYY-MM-DD
 *   Date
 *   ISO timestamp
 *   numeric timestamp
 *
 * because older MongoDB records may have been persisted
 * using a Date.
 *
 * We normalize the loan date before comparing it.
 *
 * After normalization:
 *
 *   transactionDate
 *   disbursementDate
 *
 * are both strings.
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
     NORMALIZE DISBURSEMENT DATE
  ------------------------------------------------------- */

  /**
   * IMPORTANT:
   *
   * The database may contain either:
   *
   *   "2026-09-11"
   *
   * or an old MongoDB Date/timestamp.
   *
   * Normalize both into:
   *
   *   "2026-09-11"
   *
   * before comparison.
   */
  const disbursementDate =
    normalizeFinancialDate(
      loan.disbursementDate,
      `Active loan "${loan.loanNumber}" disbursement date`,
    );

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
   * Both values are now YYYY-MM-DD strings.
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
   * Normalize the parser's transaction date.
   *
   * The parser currently exposes a Date, but this helper
   * also protects us if the parser is later changed to
   * return a string or timestamp.
   */
  const transactionAt =
    normalizeFinancialDate(
      classified.transactionDate,
      "Bank transaction date",
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
       * GUARANTEED:
       *
       *   YYYY-MM-DD
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
   * Normalize the parser transaction date exactly once.
   *
   * Everything below uses the canonical financial
   * calendar-date string.
   */
  const transactionDate =
    normalizeFinancialDate(
      classified.transactionDate,
      "Bank transaction date",
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
       * GUARANTEED:
       *
       *   YYYY-MM-DD
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
 *   normalize transaction date
 *       ↓
 *   classify BANK destination
 *       ↓
 *   resolve GEO-SHUA member from sender name
 *       ↓
 *   savings OR loan
 *
 * IMPORTANT:
 *
 * The normalized financial date is intentionally NOT
 * written back into ParsedBankSms.
 *
 * ParsedBankSms remains the parser-layer object.
 *
 * Financial services receive the normalized YYYY-MM-DD
 * value separately.
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
   * IMPORTANT:
   *
   * The parser currently returns a Date.
   *
   * We normalize it immediately at the financial boundary.
   *
   * The rest of this processor works with:
   *
   *   YYYY-MM-DD
   *
   * If the parser is later changed to return:
   *
   *   string
   *
   * or:
   *
   *   timestamp
   *
   * this code continues to work.
   */
  const transactionDate =
    normalizeFinancialDate(
      parsedTransaction.transactionDate,
      "Parsed bank transaction date",
    );

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
    /**
     * We pass the already-normalized date to the loan
     * processor.
     *
     * This means there is no second Date conversion.
     */
    const {
      loan,
      repayment,
    } =
      await processLoanTransaction(
        parsedTransaction,
        {
          ...classified,

          /**
           * Keep the original parser object intact while
           * the loan processor receives the canonical
           * financial date separately.
           */
          transactionType:
            classified.transactionType,
        },
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

