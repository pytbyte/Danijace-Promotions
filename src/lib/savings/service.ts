/**
 * Savings service.
 *
 * IMPORTANT FINANCIAL RULES
 * -------------------------
 * 1. Savings transactions are immutable financial records.
 * 2. Existing transaction amounts must never be changed.
 * 3. Corrections are represented by new adjustment transactions.
 * 4. Reversals are represented by new reversal transactions.
 * 5. Original transactions may have their status changed to
 *    "reversed" as metadata when a reversal is created.
 * 6. The transaction ledger is authoritative for balances.
 * 7. savings_accounts.balance is only a cached balance.
 * 8. Duplicate external transactions must be idempotent.
 * 9. No permanent deletion is provided by this service.
 */

import type {
  Collection,
  ClientSession,
} from "mongodb";

import clientPromise from "@/lib/mongodb";

import type {
  SavingsAccount,
  SavingsTransaction,
} from "./types";

import {
  normalizeSavingsTransaction,
  validateSavingsAccount,
  validateSavingsTransaction,
} from "./validation";

/* =========================================================
   CONSTANTS
========================================================= */

const DB_NAME =
  process.env.MONGODB_DB || "geo-shua";

const ACCOUNT_COLLECTION =
  "savings_accounts";

const TRANSACTION_COLLECTION =
  "savings_transactions";

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

/* =========================================================
   MONGODB DOCUMENT TYPES
========================================================= */

/**
 * We use the application's string ID as MongoDB _id.
 *
 * This avoids maintaining two different identities for the
 * same financial record.
 *
 * Example:
 *
 * application:
 *   id = "550e8400-e29b-41d4-a716-446655440000"
 *
 * MongoDB:
 *   _id = "550e8400-e29b-41d4-a716-446655440000"
 */
type SavingsAccountDocument =
  Omit<SavingsAccount, "id"> & {
    _id: string;
  };

type SavingsTransactionDocument =
  Omit<SavingsTransaction, "id"> & {
    _id: string;
  };

/* =========================================================
   PUBLIC TYPES
========================================================= */

export type GetSavingsTransactionsOptions = {
  page?: number;
  limit?: number;

  memberId?: string;
  savingsAccountId?: string;
  saccoId?: string;

  type?: SavingsTransaction["type"];
  source?: SavingsTransaction["source"];
  status?: SavingsTransaction["status"];
};

export type PaginatedSavingsTransactions = {
  transactions: SavingsTransaction[];

  total: number;

  page: number;

  limit: number;

  totalPages: number;
};

export type CreateSavingsDepositInput = {
  savingsAccountId: string;

  memberId: string;

  saccoId: string;

  memberName: string;

  saccoName: string;

  amount: number;

  source: SavingsTransaction["source"];

  reference?: string;

  smsId?: string;

  sourceReference?: string;

  transactionAt?: string;

  recordedBy?: SavingsTransaction["recordedBy"];
};

export type CreateSavingsAdjustmentInput = {
  originalTransactionId: string;

  amount: number;

  reason: string;

  recordedBy?: SavingsTransaction["recordedBy"];
};

export type ReverseSavingsTransactionInput = {
  transactionId: string;

  reason: string;

  recordedBy?: SavingsTransaction["recordedBy"];
};

/* =========================================================
   DATABASE HELPERS
========================================================= */

async function getDatabase() {
  const client = await clientPromise;

  return client.db(DB_NAME);
}

async function getAccountCollection(): Promise<
  Collection<SavingsAccountDocument>
> {
  const db = await getDatabase();

  return db.collection<SavingsAccountDocument>(
    ACCOUNT_COLLECTION
  );
}

async function getTransactionCollection(): Promise<
  Collection<SavingsTransactionDocument>
> {
  const db = await getDatabase();

  return db.collection<SavingsTransactionDocument>(
    TRANSACTION_COLLECTION
  );
}

/* =========================================================
   ERROR HELPERS
========================================================= */

function getFirstValidationError(
  errors: Record<string, string>
): string {
  return (
    Object.values(errors)[0] ||
    "Invalid savings data"
  );
}

function isDuplicateKeyError(
  error: unknown
): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === 11000
  );
}

function requireNonEmpty(
  value: string | undefined,
  message: string
): string {
  if (
    typeof value !== "string" ||
    !value.trim()
  ) {
    throw new Error(message);
  }

  return value.trim();
}

/* =========================================================
   DOCUMENT CONVERSION
========================================================= */

function toSavingsAccount(
  document: SavingsAccountDocument
): SavingsAccount {
  const {
    _id,
    ...data
  } = document;

  return {
    ...data,
    id: _id,
  };
}

function toSavingsTransaction(
  document: SavingsTransactionDocument
): SavingsTransaction {
  const {
    _id,
    ...data
  } = document;

  return {
    ...data,
    id: _id,
  };
}

/* =========================================================
   INDEXES
========================================================= */

/**
 * Create all indexes required by the savings ledger.
 *
 * MongoDB createIndex is idempotent.
 */
async function ensureIndexes(): Promise<void> {
  const accounts =
    await getAccountCollection();

  const transactions =
    await getTransactionCollection();

  /**
   * One fixed savings account per member
   * within a SACCO.
   */
  await accounts.createIndex(
    {
      saccoId: 1,
      memberId: 1,
    },
    {
      unique: true,
      name:
        "unique_sacco_member_savings_account",
    }
  );

  /**
   * Account transaction history.
   */
  await transactions.createIndex(
    {
      savingsAccountId: 1,
      transactionAt: -1,
      _id: -1,
    },
    {
      name: "account_transaction_history",
    }
  );

  /**
   * Member transaction history.
   */
  await transactions.createIndex(
    {
      saccoId: 1,
      memberId: 1,
      transactionAt: -1,
      _id: -1,
    },
    {
      name: "member_transaction_history",
    }
  );

  /**
   * SACCO transaction history.
   */
  await transactions.createIndex(
    {
      saccoId: 1,
      transactionAt: -1,
      _id: -1,
    },
    {
      name: "sacco_transaction_history",
    }
  );

  /**
   * Prevent duplicate external references.
   *
   * A reference is unique within:
   *
   * SACCO + source + reference
   */
  await transactions.createIndex(
    {
      saccoId: 1,
      source: 1,
      reference: 1,
    },
    {
      unique: true,

      partialFilterExpression: {
        reference: {
          $exists: true,
          $type: "string",
        },
      },

      name:
        "unique_external_savings_reference",
    }
  );

  /**
   * Prevent the same SMS from creating multiple
   * savings transactions within a SACCO.
   */
  await transactions.createIndex(
    {
      saccoId: 1,
      smsId: 1,
    },
    {
      unique: true,

      partialFilterExpression: {
        smsId: {
          $exists: true,
          $type: "string",
        },
      },

      name: "unique_savings_sms",
    }
  );

  /**
   * Find adjustments/reversals related to an
   * original transaction quickly.
   */
  await transactions.createIndex(
    {
      relatedTransactionId: 1,
      type: 1,
    },
    {
      name:
        "related_transaction_lookup",
    }
  );
}

/* =========================================================
   TRANSACTIONAL BALANCE CALCULATION
========================================================= */

/**
 * Calculate the authoritative savings balance
 * from the transaction ledger.
 *
 * IMPORTANT:
 *
 * A reversed original transaction is excluded because
 * its replacement reversal transaction carries the
 * opposite financial effect.
 */
async function calculateLedgerBalance(
  savingsAccountId: string,
  session?: ClientSession
): Promise<number> {
  const transactions =
    await getTransactionCollection();

  const result =
    await transactions
      .aggregate<{
        _id: null;
        balance: number;
      }>(
        [
          {
            $match: {
              savingsAccountId,
              status: {
                $ne: "reversed",
              },
            },
          },

          {
            $group: {
              _id: null,

              balance: {
                $sum: "$amount",
              },
            },
          },
        ],
        {
          session,
        }
      )
      .toArray();

  return result[0]?.balance ?? 0;
}

/**
 * Update the cached balance.
 *
 * The ledger remains authoritative.
 */
async function updateCachedAccountBalance(
  savingsAccountId: string,
  session?: ClientSession
): Promise<number> {
  const balance =
    await calculateLedgerBalance(
      savingsAccountId,
      session
    );

  const accounts =
    await getAccountCollection();

  await accounts.updateOne(
    {
      _id: savingsAccountId,
    },
    {
      $set: {
        balance,

        updatedAt:
          new Date().toISOString(),
      },
    },
    {
      session,
    }
  );

  return balance;
}

/* =========================================================
   GET SAVINGS ACCOUNT
========================================================= */

/**
 * Find the fixed savings account belonging
 * to a member.
 */
export async function getSavingsAccount(
  saccoId: string,
  memberId: string
): Promise<SavingsAccount | null> {
  const cleanSaccoId =
    requireNonEmpty(
      saccoId,
      "SACCO ID is required"
    );

  const cleanMemberId =
    requireNonEmpty(
      memberId,
      "Member ID is required"
    );

  await ensureIndexes();

  const collection =
    await getAccountCollection();

  const account =
    await collection.findOne({
      saccoId: cleanSaccoId,
      memberId: cleanMemberId,
    });

  if (!account) {
    return null;
  }

  return toSavingsAccount(account);
}

/* =========================================================
   GET ACCOUNT BY ID
========================================================= */

export async function getSavingsAccountById(
  id: string
): Promise<SavingsAccount | null> {
  const cleanId =
    requireNonEmpty(
      id,
      "Savings account ID is required"
    );

  const collection =
    await getAccountCollection();

  const account =
    await collection.findOne({
      _id: cleanId,
    });

  if (!account) {
    return null;
  }

  return toSavingsAccount(account);
}

/* =========================================================
   CREATE / GET ACCOUNT
========================================================= */

/**
 * Get an existing fixed savings account or create one.
 *
 * This operation is idempotent.
 */
export async function getOrCreateSavingsAccount(
  data: Pick<
    SavingsAccount,
    | "memberId"
    | "saccoId"
    | "memberName"
    | "saccoName"
  >
): Promise<SavingsAccount> {
  const memberId =
    requireNonEmpty(
      data.memberId,
      "Member ID is required"
    );

  const saccoId =
    requireNonEmpty(
      data.saccoId,
      "SACCO ID is required"
    );

  const memberName =
    requireNonEmpty(
      data.memberName,
      "Member name is required"
    );

  const saccoName =
    requireNonEmpty(
      data.saccoName,
      "SACCO name is required"
    );

  await ensureIndexes();

  const collection =
    await getAccountCollection();

  /**
   * First attempt to find the account.
   */
  const existing =
    await collection.findOne({
      saccoId,
      memberId,
    });

  if (existing) {
    /**
     * We deliberately do not silently overwrite
     * historical account information.
     *
     * Member/SACCO names are cached display values.
     */
    return toSavingsAccount(existing);
  }

  const now =
    new Date().toISOString();

  const account: SavingsAccount = {
    id: crypto.randomUUID(),

    memberId,

    saccoId,

    memberName,

    saccoName,

    balance: 0,

    isActive: true,

    createdAt: now,

    updatedAt: now,
  };

  const validation =
    validateSavingsAccount(account);

  if (!validation.valid) {
    throw new Error(
      getFirstValidationError(
        validation.errors
      )
    );
  }

  const document:
    SavingsAccountDocument = {
    _id: account.id,

    memberId:
      account.memberId,

    saccoId:
      account.saccoId,

    memberName:
      account.memberName,

    saccoName:
      account.saccoName,

    balance:
      account.balance,

    isActive:
      account.isActive,

    createdAt:
      account.createdAt,

    updatedAt:
      account.updatedAt,
  };

  try {
    await collection.insertOne(
      document
    );

    return account;
  } catch (error) {
    /**
     * Another request may have created the
     * same fixed account between findOne
     * and insertOne.
     */
    if (isDuplicateKeyError(error)) {
      const existing =
        await collection.findOne({
          saccoId,
          memberId,
        });

      if (existing) {
        return toSavingsAccount(
          existing
        );
      }
    }

    throw error;
  }
}

/* =========================================================
   GET TRANSACTION BY ID
========================================================= */

export async function getSavingsTransactionById(
  id: string
): Promise<SavingsTransaction | null> {
  const cleanId =
    requireNonEmpty(
      id,
      "Transaction ID is required"
    );

  const collection =
    await getTransactionCollection();

  const transaction =
    await collection.findOne({
      _id: cleanId,
    });

  if (!transaction) {
    return null;
  }

  return toSavingsTransaction(
    transaction
  );
}

/* =========================================================
   FIND DUPLICATE EXTERNAL TRANSACTION
========================================================= */

async function findExistingExternalTransaction(
  data: {
    saccoId: string;
    source: SavingsTransaction["source"];
    reference?: string;
    smsId?: string;
    session?: ClientSession;
  }
): Promise<SavingsTransaction | null> {
  const collection =
    await getTransactionCollection();

  /**
   * SMS ID is the strongest source identity.
   */
  if (data.smsId?.trim()) {
    const existing =
      await collection.findOne(
        {
          saccoId:
            data.saccoId,

          smsId:
            data.smsId.trim(),
        },
        {
          session:
            data.session,
        }
      );

    if (existing) {
      return toSavingsTransaction(
        existing
      );
    }
  }

  /**
   * External transaction reference.
   */
  if (data.reference?.trim()) {
    const existing =
      await collection.findOne(
        {
          saccoId:
            data.saccoId,

          source:
            data.source,

          reference:
            data.reference.trim(),
        },
        {
          session:
            data.session,
        }
      );

    if (existing) {
      return toSavingsTransaction(
        existing
      );
    }
  }

  return null;
}

/* =========================================================
   CREATE DEPOSIT
========================================================= */

/**
 * Record a new savings deposit.
 *
 * A deposit is always a new transaction.
 *
 * No existing transaction is modified.
 */
export async function createSavingsDeposit(
  data: CreateSavingsDepositInput
): Promise<SavingsTransaction> {
  await ensureIndexes();

  const savingsAccountId =
    requireNonEmpty(
      data.savingsAccountId,
      "Savings account ID is required"
    );

  const memberId =
    requireNonEmpty(
      data.memberId,
      "Member ID is required"
    );

  const saccoId =
    requireNonEmpty(
      data.saccoId,
      "SACCO ID is required"
    );

  const memberName =
    requireNonEmpty(
      data.memberName,
      "Member name is required"
    );

  const saccoName =
    requireNonEmpty(
      data.saccoName,
      "SACCO name is required"
    );

  /**
   * Get the fixed account.
   */
  const account =
    await getSavingsAccountById(
      savingsAccountId
    );

  if (!account) {
    throw new Error(
      "Savings account not found."
    );
  }

  /**
   * Verify ownership.
   */
  if (
    account.memberId !==
    memberId
  ) {
    throw new Error(
      "Savings account does not belong to this member."
    );
  }

  /**
   * Verify SACCO ownership.
   */
  if (
    account.saccoId !==
    saccoId
  ) {
    throw new Error(
      "Savings account does not belong to this SACCO."
    );
  }

  /**
   * Inactive accounts cannot receive
   * new savings deposits.
   */
  if (!account.isActive) {
    throw new Error(
      "Savings account is inactive."
    );
  }

  /**
   * A deposit must have a positive amount.
   *
   * Validation will perform the detailed
   * monetary checks.
   */
  const now =
    new Date().toISOString();

  const transaction:
    SavingsTransaction = {
    id: crypto.randomUUID(),

    savingsAccountId,

    memberId,

    saccoId,

    memberName,

    saccoName,

    amount: data.amount,

    type: "deposit",

    source: data.source,

    status: "confirmed",

    reference:
      data.reference?.trim() ||
      undefined,

    smsId:
      data.smsId?.trim() ||
      undefined,

    sourceReference:
      data.sourceReference?.trim() ||
      undefined,

    recordedBy:
      data.recordedBy,

    transactionAt:
      data.transactionAt ||
      now,

    createdAt:
      now,

    updatedAt:
      now,

    synced: true,
  };

  const normalized =
    normalizeSavingsTransaction(
      transaction
    );

  const validation =
    validateSavingsTransaction(
      normalized
    );

  if (!validation.valid) {
    throw new Error(
      getFirstValidationError(
        validation.errors
      )
    );
  }

  const transactions =
    await getTransactionCollection();

  /**
   * Check duplicates before starting the
   * transaction.
   */
  const duplicate =
    await findExistingExternalTransaction({
      saccoId,

      source:
        normalized.source,

      reference:
        normalized.reference,

      smsId:
        normalized.smsId,
    });

  if (duplicate) {
    return duplicate;
  }

  const client =
    await clientPromise;

  const session =
    client.startSession();

  try {
    let created:
      SavingsTransaction | null =
      null;

    await session.withTransaction(
      async () => {
        /**
         * Repeat duplicate check inside
         * the transaction to handle races.
         */
        const duplicateInsideTransaction =
          await findExistingExternalTransaction({
            saccoId,

            source:
              normalized.source,

            reference:
              normalized.reference,

            smsId:
              normalized.smsId,

            session,
          });

        if (duplicateInsideTransaction) {
          created =
            duplicateInsideTransaction;

          return;
        }

        const document:
          SavingsTransactionDocument = {
          _id:
            normalized.id,

          savingsAccountId:
            normalized.savingsAccountId,

          memberId:
            normalized.memberId,

          saccoId:
            normalized.saccoId,

          memberName:
            normalized.memberName,

          saccoName:
            normalized.saccoName,

          amount:
            normalized.amount,

          type:
            normalized.type,

          source:
            normalized.source,

          status:
            normalized.status,

          reference:
            normalized.reference,

          smsId:
            normalized.smsId,

          sourceReference:
            normalized.sourceReference,

          relatedTransactionId:
            normalized.relatedTransactionId,

          reason:
            normalized.reason,

          recordedBy:
            normalized.recordedBy,

          transactionAt:
            normalized.transactionAt,

          createdAt:
            normalized.createdAt,

          updatedAt:
            normalized.updatedAt,

          synced:
            normalized.synced,
        };

        await transactions.insertOne(
          document,
          {
            session,
          }
        );

        await updateCachedAccountBalance(
          savingsAccountId,
          session
        );

        created =
          normalized;
      }
    );

    if (!created) {
      throw new Error(
        "Savings deposit could not be created."
      );
    }

    return created;
  } catch (error) {
    /**
     * Unique indexes are the final protection
     * against duplicate financial records.
     */
    if (isDuplicateKeyError(error)) {
      const duplicate =
        await findExistingExternalTransaction({
          saccoId,

          source:
            normalized.source,

          reference:
            normalized.reference,

          smsId:
            normalized.smsId,
        });

      if (duplicate) {
        return duplicate;
      }
    }

    throw error;
  } finally {
    await session.endSession();
  }
}

/* =========================================================
   GET TRANSACTIONS
========================================================= */

export async function getSavingsTransactions(
  options:
    GetSavingsTransactionsOptions = {}
): Promise<PaginatedSavingsTransactions> {
  const collection =
    await getTransactionCollection();

  const requestedPage =
    Number(options.page);

  const requestedLimit =
    Number(options.limit);

  const page =
    Number.isFinite(requestedPage) &&
    requestedPage > 0
      ? Math.floor(requestedPage)
      : DEFAULT_PAGE;

  const limit =
    Number.isFinite(requestedLimit) &&
    requestedLimit > 0
      ? Math.min(
          MAX_LIMIT,
          Math.floor(requestedLimit)
        )
      : DEFAULT_LIMIT;

  const filter:
    Record<string, unknown> = {};

  if (options.memberId) {
    filter.memberId =
      options.memberId.trim();
  }

  if (options.savingsAccountId) {
    filter.savingsAccountId =
      options.savingsAccountId.trim();
  }

  if (options.saccoId) {
    filter.saccoId =
      options.saccoId.trim();
  }

  if (options.type) {
    filter.type =
      options.type;
  }

  if (options.source) {
    filter.source =
      options.source;
  }

  if (options.status) {
    filter.status =
      options.status;
  }

  const total =
    await collection.countDocuments(
      filter
    );

  if (total === 0) {
    return {
      transactions: [],

      total: 0,

      page: 1,

      limit,

      totalPages: 0,
    };
  }

  const totalPages =
    Math.ceil(
      total / limit
    );

  const safePage =
    Math.min(
      page,
      totalPages
    );

  const skip =
    (safePage - 1) * limit;

  const transactions =
    await collection
      .find(filter)
      .sort({
        transactionAt: -1,
        _id: -1,
      })
      .skip(skip)
      .limit(limit)
      .toArray();

  return {
    transactions:
      transactions.map(
        toSavingsTransaction
      ),

    total,

    page: safePage,

    limit,

    totalPages,
  };
}

/* =========================================================
   GET BALANCE
========================================================= */

/**
 * Return the authoritative savings balance.
 *
 * This reads directly from the ledger.
 *
 * The cached account.balance is deliberately
 * not used here.
 */
export async function getSavingsBalance(
  savingsAccountId: string
): Promise<number> {
  const cleanId =
    requireNonEmpty(
      savingsAccountId,
      "Savings account ID is required"
    );

  /**
   * Make sure the account exists.
   */
  const account =
    await getSavingsAccountById(
      cleanId
    );

  if (!account) {
    throw new Error(
      "Savings account not found."
    );
  }

  return calculateLedgerBalance(
    cleanId
  );
}

/* =========================================================
   CREATE ADJUSTMENT
========================================================= */

/**
 * Create a financial adjustment against
 * an existing transaction.
 *
 * The original transaction is never financially
 * modified.
 */
export async function createSavingsAdjustment(
  data: CreateSavingsAdjustmentInput
): Promise<SavingsTransaction> {
  await ensureIndexes();

  const originalTransactionId =
    requireNonEmpty(
      data.originalTransactionId,
      "Original transaction ID is required"
    );

  const reason =
    requireNonEmpty(
      data.reason,
      "Adjustment reason is required"
    );

  /**
   * Get original transaction.
   */
  const original =
    await getSavingsTransactionById(
      originalTransactionId
    );

  if (!original) {
    throw new Error(
      "Original savings transaction not found."
    );
  }

  /**
   * A reversed transaction cannot be
   * adjusted again.
   */
  if (
    original.status ===
    "reversed"
  ) {
    throw new Error(
      "A reversed transaction cannot be adjusted."
    );
  }

  /**
   * A reversal is itself a correction mechanism.
   *
   * We do not create an adjustment against
   * a reversal.
   */
  if (
    original.type ===
    "reversal"
  ) {
    throw new Error(
      "A reversal transaction cannot be adjusted."
    );
  }

  /**
   * Confirm the account still exists and
   * is active.
   */
  const account =
    await getSavingsAccountById(
      original.savingsAccountId
    );

  if (!account) {
    throw new Error(
      "Savings account not found."
    );
  }

  if (!account.isActive) {
    throw new Error(
      "Savings account is inactive."
    );
  }

  /**
   * Only one direct adjustment is allowed
   * against a transaction.
   *
   * This prevents repeatedly changing the
   * financial meaning of the same record.
   */
  const transactions =
    await getTransactionCollection();

  const existingAdjustment =
    await transactions.findOne({
      type: "adjustment",

      relatedTransactionId:
        original.id,
    });

  if (existingAdjustment) {
    throw new Error(
      "This transaction already has an adjustment."
    );
  }

  const now =
    new Date().toISOString();

  const adjustment:
    SavingsTransaction = {
    id: crypto.randomUUID(),

    savingsAccountId:
      original.savingsAccountId,

    memberId:
      original.memberId,

    saccoId:
      original.saccoId,

    memberName:
      original.memberName,

    saccoName:
      original.saccoName,

    amount:
      data.amount,

    type: "adjustment",

    source: "system",

    status: "confirmed",

    relatedTransactionId:
      original.id,

    reason,

    recordedBy:
      data.recordedBy,

    transactionAt:
      now,

    createdAt:
      now,

    updatedAt:
      now,

    synced: true,
  };

  const normalized =
    normalizeSavingsTransaction(
      adjustment
    );

  const validation =
    validateSavingsTransaction(
      normalized
    );

  if (!validation.valid) {
    throw new Error(
      getFirstValidationError(
        validation.errors
      )
    );
  }

  const client =
    await clientPromise;

  const session =
    client.startSession();

  try {
    let created:
      SavingsTransaction | null =
      null;

    await session.withTransaction(
      async () => {
        /**
         * Recheck that another request did not
         * create an adjustment concurrently.
         */
        const existing =
          await transactions.findOne(
            {
              type:
                "adjustment",

              relatedTransactionId:
                original.id,
            },
            {
              session,
            }
          );

        if (existing) {
          throw new Error(
            "This transaction already has an adjustment."
          );
        }

        const document:
          SavingsTransactionDocument = {
          _id:
            normalized.id,

          savingsAccountId:
            normalized.savingsAccountId,

          memberId:
            normalized.memberId,

          saccoId:
            normalized.saccoId,

          memberName:
            normalized.memberName,

          saccoName:
            normalized.saccoName,

          amount:
            normalized.amount,

          type:
            normalized.type,

          source:
            normalized.source,

          status:
            normalized.status,

          reference:
            normalized.reference,

          smsId:
            normalized.smsId,

          sourceReference:
            normalized.sourceReference,

          relatedTransactionId:
            normalized.relatedTransactionId,

          reason:
            normalized.reason,

          recordedBy:
            normalized.recordedBy,

          transactionAt:
            normalized.transactionAt,

          createdAt:
            normalized.createdAt,

          updatedAt:
            normalized.updatedAt,

          synced:
            normalized.synced,
        };

        await transactions.insertOne(
          document,
          {
            session,
          }
        );

        await updateCachedAccountBalance(
          original.savingsAccountId,
          session
        );

        created =
          normalized;
      }
    );

    if (!created) {
      throw new Error(
        "Adjustment could not be created."
      );
    }

    return created;
  } finally {
    await session.endSession();
  }
}

/* =========================================================
   REVERSE TRANSACTION
========================================================= */

/**
 * Reverse a confirmed financial transaction.
 *
 * The original transaction is preserved.
 *
 * A new reversal transaction is created with
 * the exact opposite financial effect.
 *
 * Example:
 *
 * Original deposit:
 *   +1,000
 *
 * Reversal:
 *   -1,000
 *
 * Original adjustment:
 *   -300
 *
 * Reversal:
 *   +300
 */
export async function reverseSavingsTransaction(
  data: ReverseSavingsTransactionInput
): Promise<SavingsTransaction> {
  await ensureIndexes();

  const transactionId =
    requireNonEmpty(
      data.transactionId,
      "Transaction ID is required"
    );

  const reason =
    requireNonEmpty(
      data.reason,
      "Reversal reason is required"
    );

  /**
   * Get original transaction.
   */
  const original =
    await getSavingsTransactionById(
      transactionId
    );

  if (!original) {
    throw new Error(
      "Savings transaction not found."
    );
  }

  /**
   * Cannot reverse something already reversed.
   */
  if (
    original.status ===
    "reversed"
  ) {
    throw new Error(
      "Transaction has already been reversed."
    );
  }

  /**
   * A reversal cannot itself be reversed.
   *
   * If a reversal was created incorrectly,
   * a controlled correction process should be
   * used rather than creating reversal chains.
   */
  if (
    original.type ===
    "reversal"
  ) {
    throw new Error(
      "A reversal transaction cannot be reversed."
    );
  }

  /**
   * Confirm account exists.
   */
  const account =
    await getSavingsAccountById(
      original.savingsAccountId
    );

  if (!account) {
    throw new Error(
      "Savings account not found."
    );
  }

  /**
   * Find any existing reversal.
   */
  const transactions =
    await getTransactionCollection();

  const existingReversal =
    await transactions.findOne({
      type: "reversal",

      relatedTransactionId:
        original.id,
    });

  if (existingReversal) {
    throw new Error(
      "This transaction has already been reversed."
    );
  }

  /**
   * IMPORTANT:
   *
   * The reversal must be the exact opposite
   * of the original amount.
   *
   * Do NOT use Math.abs().
   *
   * +1000 -> -1000
   * -300  -> +300
   */
  const reversalAmount =
    -original.amount;

  const now =
    new Date().toISOString();

  const reversal:
    SavingsTransaction = {
    id: crypto.randomUUID(),

    savingsAccountId:
      original.savingsAccountId,

    memberId:
      original.memberId,

    saccoId:
      original.saccoId,

    memberName:
      original.memberName,

    saccoName:
      original.saccoName,

    amount:
      reversalAmount,

    type: "reversal",

    source: "system",

    status: "confirmed",

    relatedTransactionId:
      original.id,

    reason,

    recordedBy:
      data.recordedBy,

    transactionAt:
      now,

    createdAt:
      now,

    updatedAt:
      now,

    synced: true,
  };

  const normalized =
    normalizeSavingsTransaction(
      reversal
    );

  const validation =
    validateSavingsTransaction(
      normalized
    );

  if (!validation.valid) {
    throw new Error(
      getFirstValidationError(
        validation.errors
      )
    );
  }

  const client =
    await clientPromise;

  const session =
    client.startSession();

  try {
    let created:
      SavingsTransaction | null =
      null;

    await session.withTransaction(
      async () => {
        /**
         * Re-read the original inside the
         * transaction.
         *
         * This protects against two simultaneous
         * reversal requests.
         */
        const currentOriginal =
          await transactions.findOne(
            {
              _id:
                original.id,
            },
            {
              session,
            }
          );

        if (!currentOriginal) {
          throw new Error(
            "Original savings transaction no longer exists."
          );
        }

        /**
         * If another request already reversed it,
         * abort this operation.
         */
        if (
          currentOriginal.status ===
          "reversed"
        ) {
          throw new Error(
            "Transaction has already been reversed."
          );
        }

        /**
         * Check again for an existing reversal
         * inside the transaction.
         */
        const existing =
          await transactions.findOne(
            {
              type:
                "reversal",

              relatedTransactionId:
                original.id,
            },
            {
              session,
            }
          );

        if (existing) {
          throw new Error(
            "This transaction has already been reversed."
          );
        }

        /**
         * Create reversal ledger entry.
         */
        const document:
          SavingsTransactionDocument = {
          _id:
            normalized.id,

          savingsAccountId:
            normalized.savingsAccountId,

          memberId:
            normalized.memberId,

          saccoId:
            normalized.saccoId,

          memberName:
            normalized.memberName,

          saccoName:
            normalized.saccoName,

          amount:
            normalized.amount,

          type:
            normalized.type,

          source:
            normalized.source,

          status:
            normalized.status,

          reference:
            normalized.reference,

          smsId:
            normalized.smsId,

          sourceReference:
            normalized.sourceReference,

          relatedTransactionId:
            normalized.relatedTransactionId,

          reason:
            normalized.reason,

          recordedBy:
            normalized.recordedBy,

          transactionAt:
            normalized.transactionAt,

          createdAt:
            normalized.createdAt,

          updatedAt:
            normalized.updatedAt,

          synced:
            normalized.synced,
        };

        await transactions.insertOne(
          document,
          {
            session,
          }
        );

        /**
         * Mark the original transaction as
         * reversed.
         *
         * This is metadata only.
         *
         * We do NOT modify:
         * - amount
         * - reference
         * - transactionAt
         * - member
         * - SACCO
         */
        const updateResult =
          await transactions.updateOne(
            {
              _id:
                original.id,

              status:
                "confirmed",
            },
            {
              $set: {
                status:
                  "reversed",

                updatedAt:
                  new Date().toISOString(),
              },
            },
            {
              session,
            }
          );

        if (
          updateResult.modifiedCount !==
          1
        ) {
          throw new Error(
            "The original transaction could not be marked as reversed."
          );
        }

        /**
         * Recalculate cached balance from the
         * complete ledger while still inside
         * the transaction.
         */
        await updateCachedAccountBalance(
          original.savingsAccountId,
          session
        );

        created =
          normalized;
      }
    );

    if (!created) {
      throw new Error(
        "Reversal could not be created."
      );
    }

    return created;
  } finally {
    await session.endSession();
  }
}

/* =========================================================
   ACCOUNT STATUS
========================================================= */

/**
 * Deactivate a savings account.
 *
 * This is NOT a deletion.
 *
 * Historical transactions remain untouched.
 */
export async function deactivateSavingsAccount(
  savingsAccountId: string
): Promise<SavingsAccount> {
  const cleanId =
    requireNonEmpty(
      savingsAccountId,
      "Savings account ID is required"
    );

  const accounts =
    await getAccountCollection();

  const existing =
    await accounts.findOne({
      _id: cleanId,
    });

  if (!existing) {
    throw new Error(
      "Savings account not found."
    );
  }

  if (!existing.isActive) {
    return toSavingsAccount(
      existing
    );
  }

  await accounts.updateOne(
    {
      _id: cleanId,

      isActive: true,
    },
    {
      $set: {
        isActive: false,

        updatedAt:
          new Date().toISOString(),
      },
    }
  );

  const updated =
    await accounts.findOne({
      _id: cleanId,
    });

  if (!updated) {
    throw new Error(
      "Savings account could not be retrieved after deactivation."
    );
  }

  return toSavingsAccount(
    updated
  );
}

/* =========================================================
   REACTIVATE ACCOUNT
========================================================= */

/**
 * Reactivate an existing savings account.
 *
 * This does not alter any historical transaction.
 */
export async function reactivateSavingsAccount(
  savingsAccountId: string
): Promise<SavingsAccount> {
  const cleanId =
    requireNonEmpty(
      savingsAccountId,
      "Savings account ID is required"
    );

  const accounts =
    await getAccountCollection();

  const existing =
    await accounts.findOne({
      _id: cleanId,
    });

  if (!existing) {
    throw new Error(
      "Savings account not found."
    );
  }

  if (existing.isActive) {
    return toSavingsAccount(
      existing
    );
  }

  await accounts.updateOne(
    {
      _id: cleanId,

      isActive: false,
    },
    {
      $set: {
        isActive: true,

        updatedAt:
          new Date().toISOString(),
      },
    }
  );

  const updated =
    await accounts.findOne({
      _id: cleanId,
    });

  if (!updated) {
    throw new Error(
      "Savings account could not be retrieved after reactivation."
    );
  }

  return toSavingsAccount(
    updated
  );
}