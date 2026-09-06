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
 * The parser intentionally returns:
 *
 *   transactionType = "unknown"
 *
 * The processor then classifies it using the BANK
 * destination account number.
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
 * Resolve exactly one active loan for the member and verify
 * that the BANK transaction actually occurred after the
 * loan was disbursed.
 *
 * IMPORTANT:
 *
 * We are scanning SMS messages that already exist in the
 * Android inbox.
 *
 * Therefore:
 *
 *   smsDate
 *
 * tells us when Android received/stored the SMS.
 *
 * It MUST NOT be used to determine whether the payment
 * belongs to the loan.
 *
 * The authoritative temporal comparison is:
 *
 *   transactionDate > loan.disbursementDate
 *
 * where transactionDate is the date/time reported by the
 * bank inside the SMS.
 *
 * Zero loans:
 *   block automatic processing.
 *
 * Multiple active loans:
 *   block automatic processing.
 *
 * Transaction before or at disbursement:
 *   block automatic SMS repayment processing.
 *
 * We never guess where a payment belongs.
 */
async function resolveLoanForTransaction(
  member: ResolvedMember,
  transactionDate: Date,
): Promise<ResolvedLoan> {
  if (
    !(
      transactionDate instanceof
      Date
    ) ||
    Number.isNaN(
      transactionDate.getTime(),
    )
  ) {
    throw new Error(
      "Bank transaction date is invalid.",
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

  if (
    !(
      loan.disbursementDate instanceof
      Date
    ) ||
    Number.isNaN(
      loan.disbursementDate.getTime(),
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
   * The bank transaction must have occurred STRICTLY
   * AFTER the loan was disbursed.
   *
   * This is deliberately NOT:
   *
   *   smsDate > disbursementDate
   *
   * because the SMS may have remained in the Android inbox
   * for days before GEO-SHUA processed it.
   *
   * Example:
   *
   * Loan:
   *   Sep 1 08:00
   *
   * Android receives SMS:
   *   Sep 6 10:00
   *
   * Bank transaction:
   *   Sep 5 14:00
   *
   * Result:
   *   VALID
   *
   * because:
   *
   *   Sep 5 14:00 > Sep 1 08:00
   */
  if (
    transactionDate.getTime() <=
    loan.disbursementDate.getTime()
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
       * Bank-reported transaction time.
       */
      transactionAt:
        classified.transactionDate
          .toISOString(),

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
  const loan =
  await resolveLoanForTransaction(
    member,
    classified.transactionDate,
  );

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

      transactionDate:
        classified.transactionDate,

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
   LEGACY RAW SMS COMPATIBILITY
========================================================= */

/**
 * Compatibility helper for older callers that supply only
 * a raw SMS body.
 *
 * New code should preferably use:
 *
 *   parseBankSms()
 *       ↓
 *   processIncomingTransaction()
 *
 * because Android metadata such as:
 *
 * - address
 * - native SMS timestamp
 *
 * is otherwise unavailable.
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