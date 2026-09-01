/**
 * =========================================================
 * GEO-SHUA
 * INCOMING BANK TRANSACTION PROCESSOR
 * =========================================================
 *
 * RESPONSIBILITY
 * ---------------------------------------------------------
 *
 * This file is ONLY the orchestration layer between:
 *
 *   parser
 *      ↓
 *   processIncomingTransaction()
 *      ↓
 *   savings service OR loan service
 *
 * It does NOT implement financial persistence itself.
 *
 * Existing financial services remain authoritative:
 *
 *   createSavingsDeposit()
 *   createLoanRepayment()
 *
 * FLOW
 * ---------------------------------------------------------
 *
 * Android SMS
 *     ↓
 * /api/sms/process
 *     ↓
 * parseBankSms()
 *     ↓
 * ParsedBankSms
 *     ↓
 * processIncomingTransaction()
 *     ↓
 * ┌───────────────────────────────┐
 * │ transactionType === savings   │
 * │        ↓                      │
 * │ find member by SMS name       │
 * │        ↓                      │
 * │ get fixed savings account     │
 * │        ↓                      │
 * │ createSavingsDeposit()        │
 * └───────────────────────────────┘
 *
 * OR
 *
 * ┌───────────────────────────────┐
 * │ transactionType === loan      │
 * │        ↓                      │
 * │ find member by SMS name       │
 * │        ↓                      │
 * │ find exactly one active loan  │
 * │        ↓                      │
 * │ createLoanRepayment()         │
 * └───────────────────────────────┘
 *
 * IMPORTANT
 * ---------------------------------------------------------
 *
 * The bank account number identifies the GEO-SHUA payment
 * destination only.
 *
 * It is NOT used as:
 *
 *   - member ID
 *   - savings account ID
 *   - loan ID
 *   - loan number
 *
 * The sender name identifies the GEO-SHUA member.
 *
 * The bank transaction reference is passed as the external
 * financial transaction reference.
 *
 * Financial persistence, idempotency, balances and MongoDB
 * transactions remain inside the existing domain services.
 */

import {
  getMemberAccount,
  getMembers,
} from "@/lib/members/service";

import {
  createSavingsDeposit,
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

export type ProcessIncomingTransactionResult =
  | {
      status: "processed";
      type: "savings";
      transaction: ParsedBankSms;
      member: ResolvedMember;
      savingsTransaction: SavingsTransaction;
    }
  | {
      status: "processed";
      type: "loan";
      transaction: ParsedBankSms;
      member: ResolvedMember;
      loan: ResolvedLoan;
      repayment: Awaited<
        ReturnType<
          typeof createLoanRepayment
        >
      >;
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
 * all become:
 *
 *   FRANCIS MWANGI KAMAU
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
   MEMBER NAME
========================================================= */

/**
 * Build the canonical member name from the existing
 * member structure.
 *
 * Your current member service stores names primarily as:
 *
 *   firstName
 *   middleName
 *   lastName
 *
 * Older records may also expose:
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
   RESOLVE MEMBER
========================================================= */

/**
 * Resolve a GEO-SHUA member from the sender name contained
 * in the bank SMS.
 *
 * IMPORTANT
 * ---------------------------------------------------------
 *
 * getMembers() searches individual fields:
 *
 *   firstName
 *   middleName
 *   lastName
 *   phone
 *   email
 *   etc.
 *
 * Therefore asking it to search for:
 *
 *   "FRANCIS MWANGI KAMAU"
 *
 * can return zero records even when the member exists as:
 *
 *   firstName  = FRANCIS
 *   middleName = MWANGI
 *   lastName   = KAMAU
 *
 * We therefore:
 *
 * 1. split the bank name into tokens;
 * 2. search the existing member service using each token;
 * 3. collect candidates;
 * 4. perform an exact normalized FULL NAME comparison.
 *
 * There is still:
 *
 * - no fuzzy matching
 * - no partial financial matching
 * - no guessing
 */
async function resolveMemberBySmsName(
  senderName: string,
): Promise<ResolvedMember> {
  const cleanName =
    normalizeName(senderName);

  if (!cleanName) {
    throw new Error(
      "Bank SMS sender name is required.",
    );
  }

  /* -------------------------------------------------------
     NAME TOKENS
  ------------------------------------------------------- */

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

  if (tokens.length === 0) {
    throw new Error(
      "Bank SMS sender name is required.",
    );
  }

  /* -------------------------------------------------------
     COLLECT MEMBER CANDIDATES
  ------------------------------------------------------- */

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
   * Search using:
   *
   *   1. complete sender name
   *   2. each individual name token
   *
   * The complete search helps older/legacy records while
   * token searches handle the normal first/middle/last-name
   * structure.
   */
  const searchTerms =
    Array.from(
      new Set([
        senderName,
        ...tokens,
      ]),
    );

  for (
    const searchTerm of searchTerms
  ) {
    const result =
      await getMembers({
        page: 1,
        limit: 100,
        search: searchTerm,
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
        candidate,
      );
    }
  }

  /* -------------------------------------------------------
     NO CANDIDATES
  ------------------------------------------------------- */

  if (
    candidates.size === 0
  ) {
    throw new Error(
      `No GEO-SHUA member could be found for bank sender "${senderName}".`,
    );
  }

  /* -------------------------------------------------------
     EXACT FULL-NAME MATCH
  ------------------------------------------------------- */

  const exactMatches =
    Array.from(
      candidates.values(),
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
            },
          );

        if (!candidateName) {
          return false;
        }

        return (
          normalizeName(
            candidateName,
          ) === cleanName
        );
      },
    );

  /* -------------------------------------------------------
     NO EXACT MATCH
  ------------------------------------------------------- */

  if (
    exactMatches.length === 0
  ) {
    /*
     * This is deliberately different from the
     * "no candidates" error.
     *
     * It means the member service found people matching
     * some part of the name, but none matched the complete
     * registered name exactly.
     */
    throw new Error(
      `Bank sender "${senderName}" did not exactly match a registered GEO-SHUA member.`,
    );
  }

  /* -------------------------------------------------------
     MULTIPLE EXACT MATCHES
  ------------------------------------------------------- */

  if (
    exactMatches.length > 1
  ) {
    throw new Error(
      `Multiple GEO-SHUA members match bank sender "${senderName}". Automatic processing is blocked.`,
    );
  }

  /* -------------------------------------------------------
     RESOLVED MEMBER
  ------------------------------------------------------- */

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

  if (!memberId) {
    throw new Error(
      `Resolved member "${senderName}" has no valid member ID.`,
    );
  }

  /* -------------------------------------------------------
     MEMBER STATUS
  ------------------------------------------------------- */

  if (
    typeof member.status ===
      "string" &&
    member.status
      .trim()
      .toLowerCase() !==
      "active"
  ) {
    throw new Error(
      `Member "${senderName}" is not active and cannot receive automatic financial processing.`,
    );
  }

  /* -------------------------------------------------------
     CANONICAL NAME
  ------------------------------------------------------- */

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
   RESOLVE SAVINGS ACCOUNT
========================================================= */

/**
 * Every GEO-SHUA member should already have exactly one
 * fixed savings account because createMember() creates it
 * automatically.
 *
 * We retrieve that existing account here.
 *
 * We DO NOT create a second account.
 */
async function resolveSavingsAccount(
  memberId: string,
) {
  const account =
    await getMemberAccount(
      memberId,
    );

  if (!account) {
    throw new Error(
      `Member "${memberId}" does not have a savings account.`,
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

  return account;
}

/* =========================================================
   RESOLVE ACTIVE LOAN
========================================================= */

/**
 * Find exactly one active loan for the resolved member.
 *
 * We never choose between multiple loans.
 */
async function resolveActiveLoan(
  memberId: string,
  memberName: string,
): Promise<ResolvedLoan> {
  const result =
    await getLoans({
      page: 1,
      limit: 100,
      memberId,
      status: "active",
    });

  const loans =
    result.loans || [];

  if (
    loans.length === 0
  ) {
    throw new Error(
      `No active GEO-SHUA loan could be found for member "${memberName}".`,
    );
  }

  if (
    loans.length > 1
  ) {
    const loanNumbers =
      loans
        .map(
          (loan) =>
            loan.loanNumber,
        )
        .filter(Boolean)
        .join(", ");

    throw new Error(
      `Member "${memberName}" has multiple active loans${
        loanNumbers
          ? ` (${loanNumbers})`
          : ""
      }. Automatic SMS repayment is blocked.`,
    );
  }

  const loan =
    loans[0];

  if (!loan) {
    throw new Error(
      `Unable to resolve the active loan for member "${memberName}".`,
    );
  }

  return loan;
}

/* =========================================================
   PROCESS SAVINGS
========================================================= */

/**
 * Pass the parsed transaction to the existing savings
 * domain service.
 *
 * This function performs NO MongoDB writes itself.
 */
async function processSavingsTransaction(
  transaction: ParsedBankSms,
  member: ResolvedMember,
  options: ProcessIncomingTransactionOptions,
): Promise<{
  savingsTransaction: SavingsTransaction;
}> {
  const account =
    await resolveSavingsAccount(
      member.id,
    );

  /*
   * SMS is already a supported savings transaction source.
   */
  const source =
    "sms" as SavingsTransaction["source"];

  /*
   * IMPORTANT:
   *
   * createSavingsDeposit() owns:
   *
   * - duplicate detection
   * - ledger insertion
   * - account validation
   * - balance calculation
   * - cached balance update
   * - MongoDB transaction handling
   */
  const savingsTransaction =
    await createSavingsDeposit({
      savingsAccountId:
        account._id,

      memberId:
        member.id,

      memberName:
        member.name,

      amount:
        transaction.amount,

      source,

      /*
       * Immutable bank transaction reference.
       */
      reference:
        transaction.reference,

      /*
       * Deterministic SMS identifier.
       *
       * The bank reference remains the primary financial
       * identity.
       */
      smsId:
        `${transaction.reference}:${transaction.smsDate}`,

      /*
       * Preserve the external bank reference.
       */
      sourceReference:
        transaction.reference,

      /*
       * Bank transaction date.
       */
      transactionAt:
        transaction.transactionDate.toISOString(),

      /*
       * Your current SavingsTransactionRecordedBy type
       * contains name/email, not id.
       */
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
    savingsTransaction,
  };
}

/* =========================================================
   PROCESS LOAN
========================================================= */

/**
 * Pass the parsed transaction to the existing loan
 * financial service.
 *
 * This function performs NO MongoDB writes itself.
 */
async function processLoanTransaction(
  transaction: ParsedBankSms,
  member: ResolvedMember,
  options: ProcessIncomingTransactionOptions,
): Promise<{
  loan: ResolvedLoan;
  repayment: Awaited<
    ReturnType<
      typeof createLoanRepayment
    >
  >;
}> {
  const loan =
    await resolveActiveLoan(
      member.id,
      member.name,
    );

  /*
   * createLoanRepayment() owns:
   *
   * - idempotency
   * - repayment insertion
   * - outstanding balance calculation
   * - loan projection update
   * - audit
   * - MongoDB transaction handling
   */
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
   MAIN ORCHESTRATOR
========================================================= */

/**
 * Process one parsed/classified bank transaction.
 *
 * This is intentionally an orchestration function.
 *
 * It does NOT implement financial persistence.
 *
 * It simply:
 *
 *   1. validates the parser result
 *   2. rejects unknown destinations
 *   3. resolves the GEO-SHUA member
 *   4. routes savings → createSavingsDeposit()
 *   5. routes loan → createLoanRepayment()
 *
 * Existing services remain the only financial persistence
 * boundaries.
 */
export async function processIncomingTransaction(
  parsedTransaction: ParsedBankSms,
  options: ProcessIncomingTransactionOptions = {},
): Promise<ProcessIncomingTransactionResult> {
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
    typeof parsedTransaction.accountNumber !==
      "string" ||
    !parsedTransaction.accountNumber.trim()
  ) {
    throw new Error(
      "Parsed bank transaction account number is required.",
    );
  }

  if (
    parsedTransaction.transactionType !==
      "savings" &&
    parsedTransaction.transactionType !==
      "loan" &&
    parsedTransaction.transactionType !==
      "unknown"
  ) {
    throw new Error(
      "Parsed bank transaction type is invalid.",
    );
  }

  if (
    !(parsedTransaction.transactionDate instanceof Date) ||
    Number.isNaN(
      parsedTransaction.transactionDate.getTime(),
    )
  ) {
    throw new Error(
      "Parsed bank transaction date is invalid.",
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
      `Bank account "${parsedTransaction.accountNumber}" is not configured for GEO-SHUA savings or loan payments.`,
    );
  }

  /* =======================================================
     RESOLVE MEMBER
  ======================================================= */

  const member =
    await resolveMemberBySmsName(
      parsedTransaction.senderName,
    );

  /* =======================================================
     ROUTE
  ======================================================= */

  switch (
    parsedTransaction.transactionType
  ) {
    /* =====================================================
       SAVINGS
    ===================================================== */

    case "savings": {
      const {
        savingsTransaction,
      } =
        await processSavingsTransaction(
          parsedTransaction,
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

        savingsTransaction,
      };
    }

    /* =====================================================
       LOAN
    ===================================================== */

    case "loan": {
      const {
        loan,
        repayment,
      } =
        await processLoanTransaction(
          parsedTransaction,
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

    /* =====================================================
       SAFETY FALLBACK
    ===================================================== */

    default:
      throw new Error(
        `Bank account "${parsedTransaction.accountNumber}" is not configured for GEO-SHUA savings or loan payments.`,
      );
  }
}
