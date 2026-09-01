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
 *   transactionType
 *       ↓
 *   this processor
 *       ↓
 *   savings service OR loan service
 *
 * It does NOT implement financial persistence itself.
 *
 * Existing financial services remain authoritative:
 *
 *   createSavingsDeposit()
 *   createLoanRepayment()
 *
 * The processor:
 *
 * - resolves the GEO-SHUA member
 * - validates member status
 * - routes savings payments
 * - routes loan payments
 * - preserves the bank transaction reference
 * - preserves the bank collection account
 *
 * IMPORTANT
 * ---------------------------------------------------------
 *
 * The bank account number in the SMS is a BANK collection
 * account. It is NOT:
 *
 * - a GEO-SHUA member ID
 * - a GEO-SHUA savings account ID
 * - a GEO-SHUA loan ID
 * - a GEO-SHUA loan number
 *
 * The sender name identifies the GEO-SHUA member.
 *
 * The transaction reference identifies the bank payment.
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
   TYPES
========================================================= */

export type IncomingTransactionActor = {
  name: string;
  email: string;
};

export type ProcessIncomingTransactionOptions = {
  recordedBy?: IncomingTransactionActor;
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
   NAME NORMALIZATION
========================================================= */

/**
 * Normalize names before comparison.
 *
 * Examples:
 *
 *   Francis Mwangi Kamau
 *   FRANCIS MWANGI KAMAU
 *   Francis  Mwangi   Kamau
 *
 * become the same canonical value.
 */
function normalizeName(
  value: string
): string {
  return value
    .normalize("NFKC")
    .replace(
      /[\u2018\u2019\u201A\u0060]/g,
      "'"
    )
    .replace(
      /\s+/g,
      " "
    )
    .trim()
    .toUpperCase();
}

/* =========================================================
   NAME COMPARISON
========================================================= */

function namesEqual(
  left: string,
  right: string
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
  }
): string {
  const composed = [
    member.firstName,
    member.middleName,
    member.lastName,
  ]
    .filter(
      (
        value
      ): value is string =>
        typeof value ===
          "string" &&
        value.trim().length > 0
    )
    .join(" ")
    .trim();

  if (composed) {
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
 * Resolve a GEO-SHUA member from the name supplied by
 * the bank.
 *
 * IMPORTANT:
 *
 * This is exact matching.
 *
 * We do NOT:
 *
 * - fuzzy match
 * - choose the closest person
 * - choose the first result
 * - match partial names for the final decision
 *
 * The member service searches individual fields, so we
 * collect candidates using name tokens and then perform
 * an exact normalized full-name comparison ourselves.
 */
async function resolveMemberBySmsName(
  senderName: string
): Promise<ResolvedMember> {
  const cleanName =
    normalizeName(
      senderName
    );

  if (!cleanName) {
    throw new Error(
      "Bank SMS sender name is required."
    );
  }

  const tokens =
    Array.from(
      new Set(
        cleanName
          .split(" ")
          .map(
            (token) =>
              token.trim()
          )
          .filter(Boolean)
      )
    );

  if (tokens.length === 0) {
    throw new Error(
      "Bank SMS sender name is required."
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

  /*
   * Search using the complete sender name and each
   * individual token.
   *
   * The member service remains the search boundary.
   *
   * Final matching remains exact here.
   */
  const searchTerms =
    Array.from(
      new Set([
        senderName,
        ...tokens,
      ])
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

      if (!memberId) {
        continue;
      }

      candidates.set(
        memberId,
        candidate
      );
    }
  }

  if (
    candidates.size === 0
  ) {
    throw new Error(
      `No GEO-SHUA member could be found for bank sender "${senderName}".`
    );
  }

  /*
   * Exact normalized full-name match.
   */
  const exactMatches =
    Array.from(
      candidates.values()
    ).filter(
      (candidate) => {
        const candidateName =
          getMemberName(
            candidate as {
              firstName?: string;
              middleName?: string;
              lastName?: string;
              name?: string;
              fullName?: string;
            }
          );

        if (!candidateName) {
          return false;
        }

        return namesEqual(
          candidateName,
          senderName
        );
      }
    );

  if (
    exactMatches.length === 0
  ) {
    throw new Error(
      `Bank sender "${senderName}" did not exactly match a registered GEO-SHUA member.`
    );
  }

  /*
   * Never automatically choose between multiple exact
   * matches.
   */
  if (
    exactMatches.length > 1
  ) {
    throw new Error(
      `Multiple GEO-SHUA members exactly match bank sender "${senderName}". Automatic processing is blocked.`
    );
  }

  const member =
    exactMatches[0];

  if (!member) {
    throw new Error(
      `Unable to resolve GEO-SHUA member "${senderName}".`
    );
  }

  const memberId =
    typeof member._id ===
      "string"
      ? member._id.trim()
      : "";

  if (!memberId) {
    throw new Error(
      `Resolved member "${senderName}" has no valid member ID.`
    );
  }

  /*
   * Only active members may be automatically processed.
   *
   * Historical records remain untouched.
   */
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
      `Member "${senderName}" is not active and cannot receive automatic financial processing.`
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
      }
    );

  if (!canonicalName) {
    throw new Error(
      `Resolved member "${senderName}" has no valid registered name.`
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
 * Every new GEO-SHUA member is created with exactly one
 * fixed savings account.
 *
 * For legacy data where a member does not yet have one,
 * getOrCreateSavingsAccount() safely recovers the invariant.
 *
 * It can never create a second account because the savings
 * service enforces the unique memberId constraint.
 */
async function resolveSavingsAccount(
  member: ResolvedMember
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
      `Savings account could not be resolved for member "${member.name}".`
    );
  }

  if (
    account.status !==
    "active"
  ) {
    throw new Error(
      `Savings account "${account.accountNumber}" is inactive.`
    );
  }

  if (
    account.accountType !==
    "fixed"
  ) {
    throw new Error(
      `Savings account "${account.accountNumber}" is not the required fixed savings account.`
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
 * Resolve exactly one active loan for a member.
 *
 * If there are zero or multiple active loans, automatic
 * SMS allocation is blocked.
 */
async function resolveActiveLoan(
  member: ResolvedMember
): Promise<ResolvedLoan> {
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
    loans.length === 0
  ) {
    throw new Error(
      `No active GEO-SHUA loan could be found for member "${member.name}".`
    );
  }

  if (
    loans.length > 1
  ) {
    const loanNumbers =
      loans
        .map(
          (loan) =>
            loan.loanNumber
        )
        .filter(
          Boolean
        )
        .join(", ");

    throw new Error(
      `Member "${member.name}" has multiple active loans${
        loanNumbers
          ? ` (${loanNumbers})`
          : ""
      }. Automatic SMS repayment allocation is blocked.`
    );
  }

  const loan =
    loans[0];

  if (!loan) {
    throw new Error(
      `Unable to resolve the active loan for member "${member.name}".`
    );
  }

  return loan;
}

/* =========================================================
   PROCESS SAVINGS PAYMENT
========================================================= */

/**
 * Route a classified savings transaction into the
 * authoritative savings service.
 */
async function processSavingsTransaction(
  transaction: ParsedBankSms,
  member: ResolvedMember,
  options: ProcessIncomingTransactionOptions
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
      member
    );

  /*
   * The actual financial source is represented as "sms"
   * because this transaction entered GEO-SHUA through
   * the SMS ingestion pipeline.
   *
   * The external bank collection account is preserved
   * separately as sourceReference.
   */
  const savingsTransaction =
    await createSavingsDeposit({
      savingsAccountId:
        savingsAccount.id,

      memberId:
        member.id,

      memberName:
        member.name,

      amount:
        transaction.amount,

      source:
        "sms",

      /*
       * Immutable bank transaction reference.
       */
      reference:
        transaction.reference,

      /*
       * Deterministic SMS identity.
       *
       * The savings service also protects itself using
       * unique indexes/reference validation.
       */
      smsId:
        createSmsId(
          transaction
        ),

      /*
       * This tells us which external bank collection
       * account received the money.
       *
       * It is NOT the GEO-SHUA savings account ID.
       */
      sourceReference:
        transaction.accountNumber,

      transactionAt:
        transaction.transactionDate.toISOString(),

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
   PROCESS LOAN PAYMENT
========================================================= */

/**
 * Route a classified loan transaction into the
 * authoritative loan service.
 */
async function processLoanTransaction(
  transaction: ParsedBankSms,
  member: ResolvedMember,
  options: ProcessIncomingTransactionOptions
): Promise<{
  loan: ResolvedLoan;

  repayment: LoanRepayment;
}> {
  const loan =
    await resolveActiveLoan(
      member
    );

  const repayment =
    await createLoanRepayment({
      loanId:
        loan.id,

      memberId:
        member.id,

      amount:
        transaction.amount,

      transactionReference:
        transaction.reference,

      transactionDate:
        transaction.transactionDate,

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
   SMS IDENTITY
========================================================= */

/**
 * Build a deterministic identity for this exact SMS.
 *
 * This is NOT the financial reference.
 *
 * The bank transaction reference remains the primary
 * financial identity.
 */
function createSmsId(
  transaction: ParsedBankSms
): string {
  return [
    transaction.reference,
    transaction.smsDate,
    transaction.accountNumber,
    transaction.address || "",
  ].join(":");
}

/* =========================================================
   MAIN PROCESSOR
========================================================= */

/**
 * Process one parsed bank transaction.
 *
 * The parser already determined transactionType:
 *
 *   savings
 *   loan
 *   unknown
 *
 * This function performs the actual routing.
 */
export async function processIncomingTransaction(
  parsedTransaction: ParsedBankSms,
  options: ProcessIncomingTransactionOptions = {}
): Promise<ProcessIncomingTransactionResult> {
  /* =======================================================
     VALIDATION
  ======================================================= */

  if (
    !parsedTransaction ||
    typeof parsedTransaction !==
      "object"
  ) {
    throw new Error(
      "Parsed bank transaction is required."
    );
  }

  if (
    typeof parsedTransaction.reference !==
      "string" ||
    !parsedTransaction.reference.trim()
  ) {
    throw new Error(
      "Parsed bank transaction reference is required."
    );
  }

  if (
    !Number.isFinite(
      parsedTransaction.amount
    ) ||
    parsedTransaction.amount <= 0
  ) {
    throw new Error(
      "Parsed bank transaction amount must be greater than zero."
    );
  }

  if (
    typeof parsedTransaction.senderName !==
      "string" ||
    !parsedTransaction.senderName.trim()
  ) {
    throw new Error(
      "Parsed bank transaction sender name is required."
    );
  }

  if (
    typeof parsedTransaction.accountNumber !==
      "string" ||
    !parsedTransaction.accountNumber.trim()
  ) {
    throw new Error(
      "Parsed bank transaction bank account number is required."
    );
  }

  if (
    ![
      "loan",
      "savings",
      "unknown",
    ].includes(
      parsedTransaction.transactionType
    )
  ) {
    throw new Error(
      "Parsed bank transaction type is invalid."
    );
  }

  if (
    !(parsedTransaction.transactionDate instanceof Date) ||
    Number.isNaN(
      parsedTransaction.transactionDate.getTime()
    )
  ) {
    throw new Error(
      "Parsed bank transaction date is invalid."
    );
  }

  /* =======================================================
     UNKNOWN DESTINATION
  ======================================================= */

  if (
    parsedTransaction.transactionType ===
    "unknown"
  ) {
    throw new Error(
      `Bank account "${parsedTransaction.accountNumber}" is not configured for GEO-SHUA savings or loan payments.`
    );
  }

  /* =======================================================
     MEMBER
  ======================================================= */

  const member =
    await resolveMemberBySmsName(
      parsedTransaction.senderName
    );

  /* =======================================================
     ROUTING
  ======================================================= */

  if (
    parsedTransaction.transactionType ===
    "savings"
  ) {
    const {
      savingsAccount,
      savingsTransaction,
    } =
      await processSavingsTransaction(
        parsedTransaction,
        member,
        options
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

  if (
    parsedTransaction.transactionType ===
    "loan"
  ) {
    const {
      loan,
      repayment,
    } =
      await processLoanTransaction(
        parsedTransaction,
        member,
        options
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

  /*
   * Defensive fallback.
   */
  throw new Error(
    `Bank account "${parsedTransaction.accountNumber}" could not be routed.`
  );
}

/* =========================================================
   LEGACY RAW-SMS COMPATIBILITY
========================================================= */

/**
 * Compatibility helper for older callers that still
 * provide a raw SMS body.
 *
 * New production code should use:
 *
 *   parseBankSms()
 *      ↓
 *   processIncomingTransaction()
 *
 * because Android metadata such as address/date is
 * otherwise lost.
 */
export async function processBankSms(
  rawMessage: string,
  options: ProcessIncomingTransactionOptions = {}
): Promise<ProcessIncomingTransactionResult> {
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
    options
  );
}