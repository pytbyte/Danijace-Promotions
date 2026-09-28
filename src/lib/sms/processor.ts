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
 * SMS validation
 *     ↓
 * bank destination classification
 *     ↓
 * member resolution
 *     ↓
 * savings service OR loan service
 *
 * This module is orchestration only.
 *
 * Financial persistence remains authoritative in:
 *
 *   createSavingsDeposit()
 *   createLoanRepayment()
 *
 * =========================================================
 *
 * BANK DESTINATION ACCOUNTS
 * ---------------------------------------------------------
 *
 * These are BANK COLLECTION / DESTINATION accounts.
 *
 *   082083   → loan repayments
 *   2650821  → savings deposits
 *
 * They are NOT GEO-SHUA financial account IDs.
 *
 * Member identity comes from the bank SMS sender name.
 *
 * =========================================================
 *
 * DATE ARCHITECTURE
 * ---------------------------------------------------------
 *
 * Financial dates:
 *
 *   YYYY-MM-DD
 *
 * Exact system timestamps:
 *
 *   milliseconds since epoch / Date / ISO timestamp
 *
 * Financial dates are normalized using:
 *
 *   Africa/Nairobi
 *
 * Exact bank transaction timestamps are preserved as
 * instants because they are required for historical loan
 * resolution and SMS replay protection.
 *
 * IMPORTANT:
 *
 *   parsedTransaction.smsDate
 *
 * is the Android SMS inbox/receipt timestamp.
 *
 *   parsedTransaction.transactionDate
 *
 * is the bank-reported transaction timestamp.
 *
 * They are NOT interchangeable.
 *
 * =========================================================
 *
 * LOAN REPLAY PROTECTION
 * ---------------------------------------------------------
 *
 * Two chronological checks are intentionally separate:
 *
 * 1. transactionDate >= loan.disbursementDate
 *
 *    Protects the financial calendar.
 *
 * 2. transactionAt >= loan.authorizedAt
 *
 *    Prevents a bank transaction that occurred before a
 *    loan was authorized from being attached to that loan.
 *
 * Android SMS receipt time is NOT used for this check.
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

const LOAN_BANK_ACCOUNT = "082083";

const SAVINGS_BANK_ACCOUNT = "2650821";

const FINANCIAL_TIME_ZONE =
  "Africa/Nairobi";

const SMS_LOOKBACK_HOURS = 36;

const SMS_LOOKBACK_MS =
  SMS_LOOKBACK_HOURS *
  60 *
  60 *
  1000;


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
    ReturnType<typeof createLoanRepayment>
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
    (
      year % 100 !== 0 ||
      year % 400 === 0
    )
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
 * Validate canonical GEO-SHUA financial date.
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
 * Convert an exact Date into a Kenyan financial date.
 *
 * Never use:
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
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      },
    ).formatToParts(value);

  const year =
    parts.find(
      (part) =>
        part.type === "year",
    )?.value;

  const month =
    parts.find(
      (part) =>
        part.type === "month",
    )?.value;

  const day =
    parts.find(
      (part) =>
        part.type === "day",
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
 * Normalize a supported financial-date value.
 *
 * Output:
 *
 *   YYYY-MM-DD
 */
function toCalendarDate(
  value: FinancialDateInput,
): string {
  if (
    typeof value === "string"
  ) {
    const clean =
      value.trim();

    if (!clean) {
      throw new Error(
        "Financial date cannot be empty.",
      );
    }

    if (
      isValidCalendarDate(
        clean,
      )
    ) {
      return clean;
    }

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

  if (
    value instanceof Date
  ) {
    return dateToNairobiCalendarDate(
      value,
    );
  }

  if (
    typeof value === "number"
  ) {
    if (
      !Number.isFinite(value)
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
 */
function normalizeFinancialDate(
  value: unknown,
  fieldName: string,
): string {
  try {
    if (
      typeof value !== "string" &&
      !(value instanceof Date) &&
      typeof value !== "number"
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
   EXACT TIMESTAMP HELPERS
========================================================= */

/**
 * Normalize an exact timestamp.
 *
 * Supports:
 *
 * - Date
 * - milliseconds
 * - seconds
 * - numeric timestamp string
 * - ISO timestamp string
 */
function toTimestamp(
  value: unknown,
): number {
  if (
    value instanceof Date
  ) {
    const timestamp =
      value.getTime();

    if (
      Number.isFinite(timestamp)
    ) {
      return timestamp;
    }

    throw new Error(
      "Timestamp is invalid.",
    );
  }

  if (
    typeof value === "number"
  ) {
    if (
      !Number.isFinite(value)
    ) {
      throw new Error(
        "Timestamp is invalid.",
      );
    }

    return Math.abs(value) <
      100_000_000_000
      ? value * 1000
      : value;
  }

  if (
    typeof value === "string"
  ) {
    const clean =
      value.trim();

    if (!clean) {
      throw new Error(
        "Timestamp is empty.",
      );
    }

    if (
      /^\d+$/.test(clean)
    ) {
      const numeric =
        Number(clean);

      if (
        !Number.isFinite(numeric)
      ) {
        throw new Error(
          "Timestamp is invalid.",
        );
      }

      return Math.abs(numeric) <
        100_000_000_000
        ? numeric * 1000
        : numeric;
    }

    const parsed =
      new Date(clean);

    if (
      Number.isNaN(
        parsed.getTime(),
      )
    ) {
      throw new Error(
        "Timestamp is invalid.",
      );
    }

    return parsed.getTime();
  }

  throw new Error(
    "Timestamp is missing or unsupported.",
  );
}


/**
 * Normalize a loan/system timestamp.
 *
 * Unlike financial dates, this remains
 * an exact instant.
 */
function normalizeSystemTimestamp(
  value: unknown,
  fieldName: string,
): number {
  try {
    return toTimestamp(value);
  } catch {
    throw new Error(
      `${fieldName} is invalid. Expected a valid Date, ISO timestamp, or numeric timestamp.`,
    );
  }
}


/**
 * Validate the automatic SMS processing window.
 *
 * IMPORTANT:
 *
 * This uses the Android SMS receipt timestamp.
 *
 * It does NOT determine financial ownership.
 *
 * The bank transaction timestamp is handled separately
 * through transactionAt.
 */
function validateSmsWindow(
  smsDate: unknown,
): number {
  const smsTimestamp =
    toTimestamp(smsDate);

  const now =
    Date.now();

  if (
    smsTimestamp > now
  ) {
    throw new Error(
      "SMS timestamp is in the future and cannot be automatically processed.",
    );
  }

  if (
    smsTimestamp <
    now - SMS_LOOKBACK_MS
  ) {
    throw new Error(
      `SMS is outside the automatic ${SMS_LOOKBACK_HOURS}-hour processing window.`,
    );
  }

  return smsTimestamp;
}


/**
 * Convert the parser's exact bank transaction timestamp
 * into a validated Date.
 *
 * This timestamp represents when the bank transaction
 * actually happened.
 *
 * It is NOT the Android SMS receipt timestamp.
 */
function normalizeTransactionTimestamp(
  value: unknown,
): Date {
  const timestamp =
    toTimestamp(value);

  const date =
    new Date(timestamp);

  if (
    Number.isNaN(
      date.getTime(),
    )
  ) {
    throw new Error(
      "Bank transaction timestamp is invalid.",
    );
  }

  return date;
}


/* =========================================================
   BANK DESTINATION
========================================================= */

function classifyBankAccount(
  destinationAccountNumber: string,
): BankPaymentType {
  const account =
    destinationAccountNumber
      .trim()
      .replace(/\s+/g, "");

  if (
    account ===
    LOAN_BANK_ACCOUNT
  ) {
    return "loan";
  }

  if (
    account ===
    SAVINGS_BANK_ACCOUNT
  ) {
    return "savings";
  }

  return "unknown";
}


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
   NAME HELPERS
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
          typeof value === "string" &&
          value.trim().length > 0,
      )
      .join(" ")
      .trim();

  if (composed) {
    return composed;
  }

  if (
    typeof member.name === "string" &&
    member.name.trim()
  ) {
    return member.name.trim();
  }

  if (
    typeof member.fullName === "string" &&
    member.fullName.trim()
  ) {
    return member.fullName.trim();
  }

  return "";
}


/* =========================================================
   MEMBER RESOLUTION
========================================================= */

async function resolveMemberBySmsName(
  senderName: string,
): Promise<ResolvedMember> {
  const normalizedSender =
    normalizeName(
      senderName,
    );

  if (!normalizedSender) {
    throw new Error(
      "Bank SMS sender name is required.",
    );
  }

  const tokens =
    Array.from(
      new Set(
        normalizedSender
          .split(" ")
          .map(
            (token) =>
              token.trim(),
          )
          .filter(Boolean),
      ),
    );

  const searchTerms =
    Array.from(
      new Set([
        senderName,
        ...tokens,
      ]),
    );

  type Candidate =
    Awaited<
      ReturnType<typeof getMembers>
    >["members"][number];

  const candidates =
    new Map<
      string,
      Candidate
    >();

  for (
    const searchTerm of searchTerms
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
        typeof candidate._id === "string"
          ? candidate._id.trim()
          : "";

      if (memberId) {
        candidates.set(
          memberId,
          candidate,
        );
      }
    }
  }

  if (
    candidates.size === 0
  ) {
    throw new Error(
      `No GEO-SHUA member could be found for bank sender "${senderName}".`,
    );
  }

  const exactMatches =
    Array.from(
      candidates.values(),
    ).filter(
      (candidate) => {
        const candidateName =
          getMemberName(
            candidate,
          );

        return (
          candidateName.length > 0 &&
          namesEqual(
            candidateName,
            senderName,
          )
        );
      },
    );

  if (
    exactMatches.length === 0
  ) {
    throw new Error(
      `Bank sender "${senderName}" did not exactly match a registered GEO-SHUA member.`,
    );
  }

  if (
    exactMatches.length > 1
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
    typeof member._id === "string"
      ? member._id.trim()
      : "";

  if (!memberId) {
    throw new Error(
      `Resolved member "${senderName}" has no valid member ID.`,
    );
  }

  const status =
    typeof member.status === "string"
      ? member.status.trim().toLowerCase()
      : "";

  if (
    status !== "active"
  ) {
    throw new Error(
      `Member "${senderName}" is not active and cannot receive automatic financial processing.`,
    );
  }

  const canonicalName =
    getMemberName(
      member,
    );

  if (!canonicalName) {
    throw new Error(
      `Resolved member "${senderName}" has no valid registered name.`,
    );
  }

  return {
    id: memberId,
    name: canonicalName,
  };
}


/* =========================================================
   SAVINGS ACCOUNT RESOLUTION
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
    account.status !== "active"
  ) {
    throw new Error(
      `Savings account "${account.accountNumber}" is inactive.`,
    );
  }

  if (
    account.accountType !== "fixed"
  ) {
    throw new Error(
      `Savings account "${account.accountNumber}" is not the required fixed savings account.`,
    );
  }

  if (
    typeof account.id !== "string" ||
    !account.id.trim()
  ) {
    throw new Error(
      `Savings account "${account.accountNumber}" has no valid account ID.`,
    );
  }

  return {
    id: account.id,
    accountNumber:
      account.accountNumber,
  };
}


/* =========================================================
   LOAN RESOLUTION
========================================================= */

/**
 * Resolve exactly one historically eligible loan.
 *
 * IMPORTANT:
 *
 * We intentionally DO NOT restrict this query to:
 *
 *   status: "active"
 *
 * because an SMS may be processed after the loan that
 * originally received the bank transaction has already
 * become completed.
 *
 * Historical eligibility is determined using:
 *
 *   transactionAt >= authorizedAt
 *
 * and:
 *
 *   transactionDate >= disbursementDate
 *
 * If more than one historical loan is eligible, the system
 * refuses to guess.
 */
async function resolveLoanForTransaction(
  member: ResolvedMember,
  transactionDate: string,
  transactionAt: Date,
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

  if (
    !(transactionAt instanceof Date) ||
    Number.isNaN(
      transactionAt.getTime(),
    )
  ) {
    throw new Error(
      "Bank transaction timestamp is invalid.",
    );
  }

  const transactionTimestamp =
    transactionAt.getTime();

  if (
    !Number.isFinite(
      transactionTimestamp,
    )
  ) {
    throw new Error(
      "Bank transaction timestamp is invalid.",
    );
  }

  /**
   * IMPORTANT:
   *
   * No status filter here.
   *
   * We need historical loans, including completed loans,
   * because Android may replay an older SMS after the loan
   * has already been completed.
   */
  const result =
    await getLoans({
      page: 1,
      limit: 100,
      memberId:
        member.id,
    });

  const loans =
    result.loans || [];

  if (
    loans.length === 0
  ) {
    throw new Error(
      `No historical GEO-SHUA loan could be found for member "${member.name}".`,
    );
  }

  const eligibleLoans =
    loans.filter(
      (loan) => {
        /* -------------------------------------------------
           AUTHORIZATION TIMESTAMP
        ------------------------------------------------- */

        if (
          loan.authorizedAt ===
            undefined ||
          loan.authorizedAt ===
            null
        ) {
          return false;
        }

        let authorizedTimestamp: number;

        try {
          authorizedTimestamp =
            normalizeSystemTimestamp(
              loan.authorizedAt,
              `Loan "${loan.loanNumber}" authorization timestamp`,
            );
        } catch {
          return false;
        }

        /**
         * Critical historical protection.
         *
         * The actual BANK TRANSACTION must have happened
         * after the loan was authorized.
         *
         * Android SMS receipt time is deliberately NOT used.
         */
        if (
          transactionTimestamp <
          authorizedTimestamp
        ) {
          return false;
        }

        /* -------------------------------------------------
           DISBURSEMENT DATE
        ------------------------------------------------- */

        let disbursementDate: string;

        try {
          disbursementDate =
            normalizeFinancialDate(
              loan.disbursementDate,
              `Loan "${loan.loanNumber}" disbursement date`,
            );
        } catch {
          return false;
        }

        /**
         * Financial calendar protection.
         */
        if (
          transactionDate <
          disbursementDate
        ) {
          return false;
        }

        return true;
      },
    );

  if (
    eligibleLoans.length === 0
  ) {
    throw new Error(
      "SMS_REPAYMENT_NO_HISTORICALLY_ELIGIBLE_LOAN",
    );
  }

  /**
   * Never guess when multiple loans satisfy the basic
   * historical chronology.
   *
   * A future enhancement may use an explicit bank loan
   * identifier if the bank message contains one.
   */
  if (
    eligibleLoans.length > 1
  ) {
    const loanNumbers =
      eligibleLoans
        .map(
          (loan) =>
            loan.loanNumber,
        )
        .filter(
          (
            value,
          ): value is string =>
            typeof value === "string" &&
            value.trim().length > 0,
        )
        .join(", ");

    throw new Error(
      `SMS_REPAYMENT_AMBIGUOUS_LOAN${
        loanNumbers
          ? `:${loanNumbers}`
          : ""
      }`,
    );
  }

  const loan =
    eligibleLoans[0];

  if (!loan) {
    throw new Error(
      "Unable to resolve historically eligible loan.",
    );
  }

  return loan;
}


/* =========================================================
   SMS IDENTITY
========================================================= */

/**
 * Build the deterministic SMS identity used by savings
 * processing.
 *
 * The external bank reference remains the financial
 * transaction identity.
 */
function createSmsId(
  transaction: ParsedBankSms,
): string {
  return [
    transaction.reference,
    transaction.smsDate,
    transaction.destinationAccountNumber,
    transaction.address || "",
  ].join(":");
}


/* =========================================================
   SAVINGS PROCESSING
========================================================= */

async function processSavingsTransaction(
  transaction: ParsedBankSms,
  classified: ClassifiedBankTransaction,
  member: ResolvedMember,
  transactionDate: string,
  transactionAt: Date,
  options: ProcessIncomingTransactionOptions,
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

      sourceReference:
        classified.destinationAccountNumber,

      /**
       * Savings service currently uses transactionAt
       * for the financial transaction date.
       *
       * Preserve the existing contract here.
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
   LOAN PROCESSING
========================================================= */

async function processLoanTransaction(
  transaction: ParsedBankSms,
  classified: ClassifiedBankTransaction,
  member: ResolvedMember,
  transactionDate: string,
  transactionAt: Date,
  options: ProcessIncomingTransactionOptions,
): Promise<{
  loan: ResolvedLoan;
  repayment: LoanRepayment;
}> {
  /**
   * Resolve the loan using the ACTUAL BANK TRANSACTION
   * timestamp, not Android SMS receipt time.
   */
  const loan =
    await resolveLoanForTransaction(
      member,
      transactionDate,
      transactionAt,
    );

  if (
    typeof loan.id !== "string" ||
    !loan.id.trim()
  ) {
    throw new Error(
      `Resolved loan "${loan.loanNumber}" has no valid loan ID.`,
    );
  }

  /**
   * Financial persistence remains authoritative in
   * createLoanRepayment().
   *
   * transactionAt is deliberately persisted so that the
   * original bank event can be reconstructed later.
   */
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

      transactionDate,

      transactionAt,

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
  options: ProcessIncomingTransactionOptions = {},
): Promise<ProcessIncomingTransactionResult> {
  /* -------------------------------------------------------
     BASIC VALIDATION
  ------------------------------------------------------- */

  if (
    !parsedTransaction ||
    typeof parsedTransaction !== "object"
  ) {
    throw new Error(
      "Parsed bank transaction is required.",
    );
  }

  if (
    typeof parsedTransaction.reference !==
      "string" ||
    !parsedTransaction.reference.trim()
  ) {
    throw new Error(
      "Parsed bank transaction reference is required.",
    );
  }

  if (
    !Number.isFinite(
      parsedTransaction.amount,
    ) ||
    parsedTransaction.amount <= 0
  ) {
    throw new Error(
      "Parsed bank transaction amount must be greater than zero.",
    );
  }

  if (
    typeof parsedTransaction.senderName !==
      "string" ||
    !parsedTransaction.senderName.trim()
  ) {
    throw new Error(
      "Parsed bank transaction sender name is required.",
    );
  }

  if (
    typeof parsedTransaction.destinationAccountNumber !==
      "string" ||
    !parsedTransaction.destinationAccountNumber.trim()
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

  /* -------------------------------------------------------
     SMS TIMESTAMP
  ------------------------------------------------------- */

  /**
   * This timestamp is ONLY for the 36-hour automatic
   * processing window.
   *
   * It must not be used to determine loan ownership.
   */
  const smsTimestamp =
    validateSmsWindow(
      parsedTransaction.smsDate,
    );

  /**
   * Keep the variable explicitly referenced so the purpose
   * remains clear during future maintenance.
   */
  void smsTimestamp;

  /* -------------------------------------------------------
     EXACT BANK TRANSACTION TIMESTAMP
  ------------------------------------------------------- */

  /**
   * This is the critical timestamp.
   *
   * It comes from the bank-reported date/time inside the
   * SMS and represents when the financial transaction
   * actually occurred.
   */
  const transactionAt =
    normalizeTransactionTimestamp(
      parsedTransaction.transactionDate,
    );

  /* -------------------------------------------------------
     FINANCIAL DATE
  ------------------------------------------------------- */

  const transactionDate =
    normalizeFinancialDate(
      parsedTransaction.transactionDate,
      "Parsed bank transaction date",
    );

  /**
   * Defensive consistency check.
   *
   * The calendar date derived from the exact timestamp must
   * agree with the normalized financial date.
   */
  const transactionDateFromTimestamp =
    dateToNairobiCalendarDate(
      transactionAt,
    );

  if (
    transactionDateFromTimestamp !==
    transactionDate
  ) {
    throw new Error(
      "Parsed bank transaction date and transaction timestamp resolve to different Nairobi calendar dates.",
    );
  }

  /* -------------------------------------------------------
     DESTINATION CLASSIFICATION
  ------------------------------------------------------- */

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

  /* -------------------------------------------------------
     MEMBER
  ------------------------------------------------------- */

  const member =
    await resolveMemberBySmsName(
      classified.senderName,
    );

  /* -------------------------------------------------------
     SAVINGS
  ------------------------------------------------------- */

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
        transactionAt,
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

  /* -------------------------------------------------------
     LOAN
  ------------------------------------------------------- */

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
        transactionAt,
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

  /* -------------------------------------------------------
     DEFENSIVE FALLBACK
  ------------------------------------------------------- */

  throw new Error(
    `Bank destination account "${classified.destinationAccountNumber}" could not be routed.`,
  );
}


/* =========================================================
   RAW SMS COMPATIBILITY
========================================================= */

export async function processBankSms(
  rawMessage: string,
  options: ProcessIncomingTransactionOptions = {},
): Promise<ProcessIncomingTransactionResult> {
  if (
    typeof rawMessage !== "string" ||
    !rawMessage.trim()
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

  const smsTimestamp =
    Date.now();

  const parsed =
    parseBankSms({
      address: null,
      body: rawMessage,
      date: smsTimestamp,
    });

  return processIncomingTransaction(
    parsed,
    options,
  );
}