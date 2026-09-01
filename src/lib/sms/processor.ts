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
 * The bank transaction reference is passed unchanged as
 * the external financial transaction reference.
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

export type ProcessIncomingTransactionResult =
  | {
      status: "processed";
      type: "savings";
      transaction: ParsedBankSms;
      member: {
        id: string;
        name: string;
      };
      savingsTransaction: SavingsTransaction;
    }
  | {
      status: "processed";
      type: "loan";
      transaction: ParsedBankSms;
      member: {
        id: string;
        name: string;
      };
      loan: Awaited<
        ReturnType<typeof getLoans>
      >["loans"][number];
      repayment: Awaited<
        ReturnType<typeof createLoanRepayment>
      >;
    };

/* =========================================================
   NAME NORMALIZATION
========================================================= */

/**
 * Normalize names for EXACT member matching.
 *
 * We do not perform fuzzy matching.
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
 * Build the application's canonical member name.
 *
 * GEO-SHUA members are normally composed from:
 *
 *   firstName
 *   middleName
 *   lastName
 *
 * Older records may also expose name/fullName.
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
  const composed = [
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
 * Resolve the GEO-SHUA member from the bank SMS sender name.
 *
 * IMPORTANT:
 *
 * - No fuzzy matching
 * - No partial matching
 * - No guessing
 * - Multiple exact matches are blocked
 */
async function resolveMemberBySmsName(
  senderName: string,
) {
  const cleanName =
    normalizeName(
      senderName,
    );

  if (!cleanName) {
    throw new Error(
      "Bank SMS sender name is required.",
    );
  }

  /*
   * Ask the existing member service for likely matches.
   */
  const result =
    await getMembers({
      page: 1,
      limit: 100,
      search: senderName,
    });

  if (
    !result.members ||
    result.members.length === 0
  ) {
    throw new Error(
      `No GEO-SHUA member could be found for bank sender "${senderName}".`,
    );
  }

  /*
   * getMembers() search is intentionally broader.
   *
   * We therefore perform our own exact normalized
   * comparison before any financial operation.
   */
  const exactMatches =
    result.members.filter(
      (member) => {
        const memberName =
          getMemberName(
            member as {
              firstName?: string;
              middleName?: string;
              lastName?: string;
              name?: string;
              fullName?: string;
            },
          );

        return (
          normalizeName(
            memberName,
          ) === cleanName
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

  /*
   * Never guess between two people with the same name.
   */
  if (
    exactMatches.length > 1
  ) {
    throw new Error(
      `Multiple GEO-SHUA members match bank sender "${senderName}". Automatic processing is blocked.`,
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

  /*
   * Financial SMS processing should only operate on
   * active members.
   */
  if (
    typeof member.status === "string" &&
    member.status.toLowerCase() !==
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

  if (!canonicalName) {
    throw new Error(
      `Resolved member "${senderName}" has no valid member name.`,
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
 * Every GEO-SHUA member has exactly one fixed savings account.
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
 * Find exactly one active loan belonging to the member.
 *
 * We deliberately do not guess when multiple loans exist.
 */
async function resolveActiveLoan(
  memberId: string,
  memberName: string,
) {
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
   SAVE INCOMING SAVINGS TRANSACTION
========================================================= */

/**
 * Pass the parsed transaction to the EXISTING savings
 * financial service.
 *
 * No MongoDB writes happen here directly.
 */
async function processSavingsTransaction(
  transaction: ParsedBankSms,
  member: {
    id: string;
    name: string;
  },
  options: ProcessIncomingTransactionOptions,
) {
  const account =
    await resolveSavingsAccount(
      member.id,
    );

  /*
   * The existing savings service already supports:
   *
   * source
   * reference
   * smsId
   * sourceReference
   * transactionAt
   * recordedBy
   *
   * We simply map the parsed bank transaction into
   * that existing input.
   */
  const source =
    "sms" as SavingsTransaction["source"];

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
       * Bank reference is the primary external
       * transaction identity.
       */
      reference:
        transaction.reference,

      /*
       * Additional deterministic SMS identity.
       *
       * The bank reference remains the authoritative
       * external financial reference.
       */
      smsId:
        `${transaction.reference}:${transaction.smsDate}`,

      /*
       * Preserve the bank transaction reference as
       * the source reference too.
       */
      sourceReference:
        transaction.reference,

      transactionAt:
        transaction.transactionDate.toISOString(),

      /*
       * IMPORTANT:
       *
       * SavingsTransactionRecordedBy does NOT contain
       * an "id" property.
       *
       * Therefore only pass the fields supported by
       * the existing savings domain type.
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
   PROCESS INCOMING LOAN PAYMENT
========================================================= */

/**
 * Pass the parsed transaction to the EXISTING loan
 * financial service.
 *
 * No MongoDB writes happen here directly.
 */
async function processLoanTransaction(
  transaction: ParsedBankSms,
  member: {
    id: string;
    name: string;
  },
  options: ProcessIncomingTransactionOptions,
) {
  const loan =
    await resolveActiveLoan(
      member.id,
      member.name,
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
   MAIN ORCHESTRATOR
========================================================= */

/**
 * Process one parsed/classified bank transaction.
 *
 * This function intentionally remains small.
 *
 * It does NOT implement:
 *
 * - MongoDB writes
 * - savings ledger logic
 * - loan ledger logic
 * - balance calculations
 * - duplicate indexes
 * - repayment calculations
 *
 * Existing financial services remain responsible for all of
 * those operations.
 */
export async function processIncomingTransaction(
  parsedTransaction: ParsedBankSms,
  options: ProcessIncomingTransactionOptions = {},
): Promise<ProcessIncomingTransactionResult> {
  /* =======================================================
     VALIDATE INPUT
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
     ROUTE UNKNOWN ACCOUNT BEFORE MEMBER LOOKUP
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

    default:
      throw new Error(
        `Bank account "${parsedTransaction.accountNumber}" is not configured for GEO-SHUA savings or loan payments.`,
      );
  }
}