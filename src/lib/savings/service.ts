/**
 * =========================================================
 * GEO-SHUA
 * SAVINGS SERVICE
 * =========================================================
 *
 * PRODUCTION FINANCIAL LEDGER
 *
 * IMPORTANT:
 * ---------------------------------------------------------
 * - Savings has NO saccoId.
 * - One member has exactly one fixed savings account.
 * - savingsAccounts.balance is a CACHE only.
 * - The transaction ledger is authoritative.
 * - Financial transactions are append-only.
 * - Existing financial amounts are never modified.
 * - Corrections use NEW adjustment transactions.
 * - Reversals use NEW reversal transactions.
 * - No permanent financial deletion.
 *
 * MongoDB:
 *
 * savingsAccounts
 *   _id      -> ObjectId
 *   memberId -> ObjectId
 *
 * savings_transactions
 *   _id      -> application UUID string
 *
 * =========================================================
 */

import type {
  ClientSession,
  Collection,
  CreateIndexesOptions,
  Document,
  Filter,
  IndexDescription,
} from "mongodb";

import {
  ObjectId,
} from "mongodb";

import {
  randomUUID,
} from "node:crypto";

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
  process.env.MONGODB_DB ||
  "geo-shua";

const ACCOUNT_COLLECTION =
  "savingsAccounts";

const TRANSACTION_COLLECTION =
  "savings_transactions";

const DEFAULT_PAGE =
  1;

const DEFAULT_LIMIT =
  25;

const MAX_LIMIT =
  100;

/* =========================================================
   DATABASE DOCUMENT TYPES
========================================================= */

type SavingsAccountDocument =
  Omit<
    SavingsAccount,
    "id" | "memberId"
  > & {
    _id: ObjectId;
    memberId: ObjectId;
  };

type SavingsTransactionDocument =
  Omit<
    SavingsTransaction,
    "id"
  > & {
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
  memberName: string;
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
   INDEX INITIALIZATION
========================================================= */

let indexesPromise:
  Promise<void> | null = null;

/* =========================================================
   DATABASE
========================================================= */

async function getDatabase() {
  const client =
    await clientPromise;

  return client.db(DB_NAME);
}

async function getAccountCollection(): Promise<
  Collection<SavingsAccountDocument>
> {
  const db =
    await getDatabase();

  return db.collection<SavingsAccountDocument>(
    ACCOUNT_COLLECTION
  );
}

async function getTransactionCollection(): Promise<
  Collection<SavingsTransactionDocument>
> {
  const db =
    await getDatabase();

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
    "Invalid savings data."
  );
}

function isDuplicateKeyError(
  error: unknown
): boolean {
  if (
    typeof error !== "object" ||
    error === null
  ) {
    return false;
  }

  if (!("code" in error)) {
    return false;
  }

  return (
    (error as {
      code?: unknown;
    }).code === 11000
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

function requireFiniteNumber(
  value: number,
  message: string
): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value)
  ) {
    throw new Error(message);
  }

  return value;
}

function requirePositiveNumber(
  value: number,
  message: string
): number {
  const number =
    requireFiniteNumber(
      value,
      message
    );

  if (number <= 0) {
    throw new Error(message);
  }

  return number;
}

function requireNonZeroNumber(
  value: number,
  message: string
): number {
  const number =
    requireFiniteNumber(
      value,
      message
    );

  if (number === 0) {
    throw new Error(message);
  }

  return number;
}

/* =========================================================
   OBJECT ID
========================================================= */

function requireObjectId(
  value: string,
  message: string
): ObjectId {
  const clean =
    requireNonEmpty(
      value,
      message
    );

  if (!ObjectId.isValid(clean)) {
    throw new Error(message);
  }

  return new ObjectId(clean);
}

/* =========================================================
   DATE
========================================================= */

function normalizeTransactionDate(
  value: string | undefined,
  fallback: string
): string {
  if (
    typeof value !== "string" ||
    !value.trim()
  ) {
    return fallback;
  }

  const date =
    new Date(value);

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    throw new Error(
      "Transaction date must be a valid date."
    );
  }

  return date.toISOString();
}

/* =========================================================
   STATUS HELPERS
========================================================= */

function isConfirmedStatus(
  status: SavingsTransaction["status"]
): boolean {
  return status === "confirmed";
}

function isPendingStatus(
  status: SavingsTransaction["status"]
): boolean {
  return status === "pending";
}

function isReversedStatus(
  status: SavingsTransaction["status"]
): boolean {
  return status === "reversed";
}

/* =========================================================
   DOCUMENT CONVERSION
========================================================= */

function toSavingsAccount(
  document: SavingsAccountDocument
): SavingsAccount {
  const {
    _id,
    memberId,
    ...data
  } = document;

  return {
    ...data,

    id:
      _id.toHexString(),

    memberId:
      memberId.toHexString(),

    /*
     * Existing accounts may have been created before
     * isActive became part of the schema.
     */
    isActive:
      typeof document.isActive ===
        "boolean"
        ? document.isActive
        : document.status === "active",
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

function toSavingsTransactionDocument(
  transaction: SavingsTransaction
): SavingsTransactionDocument {
  return {
    _id:
      transaction.id,

    savingsAccountId:
      transaction.savingsAccountId,

    memberId:
      transaction.memberId,

    memberName:
      transaction.memberName,

    amount:
      transaction.amount,

    type:
      transaction.type,

    source:
      transaction.source,

    status:
      transaction.status,

    ...(transaction.reference
      ? {
          reference:
            transaction.reference,
        }
      : {}),

    ...(transaction.smsId
      ? {
          smsId:
            transaction.smsId,
        }
      : {}),

    ...(transaction.sourceReference
      ? {
          sourceReference:
            transaction.sourceReference,
        }
      : {}),

    ...(transaction.relatedTransactionId
      ? {
          relatedTransactionId:
            transaction.relatedTransactionId,
        }
      : {}),

    ...(transaction.reason
      ? {
          reason:
            transaction.reason,
        }
      : {}),

    ...(transaction.recordedBy
      ? {
          recordedBy:
            transaction.recordedBy,
        }
      : {}),

    transactionAt:
      transaction.transactionAt,

    createdAt:
      transaction.createdAt,

    updatedAt:
      transaction.updatedAt,

    synced:
      transaction.synced,
  };
}

/* =========================================================
   INDEX HELPERS
========================================================= */

/**
 * Compare index key specifications only.
 *
 * Example:
 *
 * { memberId: 1 }
 *
 * equals:
 *
 * { memberId: 1 }
 */
function sameIndexKeys(
  a: Document,
  b: Document
): boolean {
  const aKeys =
    Object.keys(a);

  const bKeys =
    Object.keys(b);

  if (
    aKeys.length !==
    bKeys.length
  ) {
    return false;
  }

  for (const key of aKeys) {
    if (
      a[key] !==
      b[key]
    ) {
      return false;
    }
  }

  return true;
}

/**
 * Ensure an index exists.
 *
 * IMPORTANT:
 * ---------------------------------------------------------
 * Existing installations may contain older indexes.
 *
 * If an old index has the SAME key pattern but:
 *
 *   - a different name
 *   - different uniqueness
 *
 * we migrate ONLY the index.
 *
 * Financial documents are NEVER touched.
 *
 * This specifically handles legacy indexes such as:
 *
 * related_transaction_lookup
 *
 * which may currently be:
 *
 * {
 *   relatedTransactionId: 1,
 *   type: 1
 * }
 *
 * but non-unique.
 */
async function ensureIndex<T extends Document>(
  collection: Collection<T>,
  keys: IndexDescription["key"],
  options: CreateIndexesOptions
): Promise<void> {
  const existingIndexes =
    await collection
      .listIndexes()
      .toArray();

  const sameKeyIndexes =
    existingIndexes.filter(
      (index) =>
        index.key &&
        sameIndexKeys(
          index.key,
          keys
        )
    );

  /*
   * Find an exact compatible index.
   */
  const compatible =
    sameKeyIndexes.find(
      (index) => {
        const uniqueRequired =
          options.unique === true;

        const uniqueExisting =
          index.unique === true;

        return (
          uniqueRequired ===
          uniqueExisting
        );
      }
    );

  if (compatible) {
    return;
  }

  /*
   * An equivalent key exists but its properties do not
   * satisfy the required definition.
   *
   * Remove ONLY the conflicting index.
   */
  for (
    const conflicting of sameKeyIndexes
  ) {
    /*
     * Never attempt to drop MongoDB's _id index.
     */
    if (
      conflicting.name ===
      "_id_"
    ) {
      continue;
    }

    if (
      conflicting.name
    ) {
      await collection.dropIndex(
        conflicting.name
      );
    }
  }

  /*
   * Now create the required index.
   */
  await collection.createIndex(
    keys,
    options
  );
}

/* =========================================================
   INDEXES
========================================================= */

async function ensureIndexes(): Promise<void> {
  if (indexesPromise) {
    return indexesPromise;
  }

  indexesPromise =
    (async () => {
      const accounts =
        await getAccountCollection();

      const transactions =
        await getTransactionCollection();

      /* =====================================================
         SAVINGS ACCOUNT INDEXES
      ===================================================== */

      /*
       * ONE MEMBER = ONE SAVINGS ACCOUNT
       */
      await ensureIndex(
        accounts,
        {
          memberId: 1,
        },
        {
          unique: true,
          name:
            "unique_member_savings_account",
        }
      );

      /*
       * UNIQUE SAVINGS ACCOUNT NUMBER
       */
      await ensureIndex(
        accounts,
        {
          accountNumber: 1,
        },
        {
          unique: true,
          name:
            "unique_savings_account_number",
        }
      );

      /* =====================================================
         TRANSACTION INDEXES
      ===================================================== */

      /*
       * ACCOUNT HISTORY
       */
      await ensureIndex(
        transactions,
        {
          savingsAccountId: 1,
          transactionAt: -1,
          _id: -1,
        },
        {
          name:
            "account_transaction_history",
        }
      );

      /*
       * MEMBER HISTORY
       *
       * IMPORTANT:
       *
       * Older versions of the system used:
       *
       * {
       *   saccoId: 1,
       *   memberId: 1,
       *   transactionAt: -1,
       *   _id: -1
       * }
       *
       * Savings no longer has saccoId.
       *
       * Because the old index has a DIFFERENT key pattern,
       * ensureIndex cannot identify it as equivalent.
       *
       * The new correct index is created here.
       *
       * The legacy index can safely remain temporarily because
       * it does not alter financial data.
       */
      await ensureIndex(
        transactions,
        {
          memberId: 1,
          transactionAt: -1,
          _id: -1,
        },
        {
          name:
            "member_transaction_history",
        }
      );

      /*
       * EXTERNAL REFERENCE IDEMPOTENCY
       */
      await ensureIndex(
        transactions,
        {
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

      /*
       * SMS IDEMPOTENCY
       */
      await ensureIndex(
        transactions,
        {
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

          name:
            "unique_savings_sms",
        }
      );

      /*
       * ONE DIRECT ACTION PER ORIGINAL
       *
       * Exactly one:
       *
       *   adjustment
       *
       * OR
       *
       *   reversal
       *
       * for each original transaction.
       *
       * This also fixes the legacy:
       *
       * related_transaction_lookup
       *
       * index if it exists with the same key pattern but
       * without unique:true.
       */
      await ensureIndex(
        transactions,
        {
          relatedTransactionId: 1,
          type: 1,
        },
        {
          unique: true,

          partialFilterExpression: {
            relatedTransactionId: {
              $exists: true,
              $type: "string",
            },

            type: {
              $in: [
                "adjustment",
                "reversal",
              ],
            },
          },

          name:
            "unique_related_savings_action",
        }
      );
    })();

  try {
    await indexesPromise;
  } catch (error) {
    indexesPromise = null;
    throw error;
  }
}

/* =========================================================
   AUTHORITATIVE LEDGER BALANCE
========================================================= */

async function calculateLedgerBalance(
  savingsAccountId: string,
  session?: ClientSession
): Promise<number> {
  const cleanId =
    requireNonEmpty(
      savingsAccountId,
      "Savings account ID is required."
    );

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
              savingsAccountId:
                cleanId,

              /*
               * Pending transactions do not affect balance.
               *
               * Reversal transactions contain the exact opposite
               * amount of the original.
               *
               * Therefore:
               *
               * original + reversal = 0
               */
              status: {
                $ne:
                  "pending",
              },
            },
          },

          {
            $group: {
              _id: null,

              balance: {
                $sum:
                  "$amount",
              },
            },
          },
        ],
        {
          session,
        }
      )
      .toArray();

  return (
    result[0]?.balance ??
    0
  );
}

/* =========================================================
   ACCOUNT LOCK / SERIALIZATION
========================================================= */

async function lockSavingsAccount(
  savingsAccountId: string,
  session: ClientSession
): Promise<SavingsAccountDocument> {
  const accountObjectId =
    requireObjectId(
      savingsAccountId,
      "Invalid savings account ID."
    );

  const accounts =
    await getAccountCollection();

  const account =
    await accounts.findOne(
      {
        _id:
          accountObjectId,
      },
      {
        session,
      }
    );

  if (!account) {
    throw new Error(
      "Savings account not found."
    );
  }

  /*
   * Touch the account inside the transaction.
   *
   * This makes the account document the serialization point
   * for concurrent financial mutations.
   */
  const lockResult =
    await accounts.updateOne(
      {
        _id:
          accountObjectId,
      },
      {
        $set: {
          updatedAt:
            new Date().toISOString(),
        },
      },
      {
        session,
      }
    );

  if (
    lockResult.matchedCount !==
    1
  ) {
    throw new Error(
      "Savings account could not be locked."
    );
  }

  return account;
}

/* =========================================================
   UPDATE CACHED BALANCE
========================================================= */

async function updateCachedAccountBalance(
  savingsAccountId: string,
  session: ClientSession
): Promise<number> {
  const accountObjectId =
    requireObjectId(
      savingsAccountId,
      "Invalid savings account ID."
    );

  const accounts =
    await getAccountCollection();

  const balance =
    await calculateLedgerBalance(
      savingsAccountId,
      session
    );

  const result =
    await accounts.updateOne(
      {
        _id:
          accountObjectId,
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

  if (
    result.matchedCount !==
    1
  ) {
    throw new Error(
      "Savings account cached balance could not be updated."
    );
  }

  return balance;
}

/* =========================================================
   ACCOUNT OWNERSHIP
========================================================= */

function validateAccountOwnership(
  account: SavingsAccountDocument,
  memberId: string
): void {
  if (
    account.memberId.toHexString() !==
    memberId
  ) {
    throw new Error(
      "Savings account does not belong to this member."
    );
  }

  const isActive =
    typeof account.isActive ===
      "boolean"
      ? account.isActive
      : account.status === "active";

  if (!isActive) {
    throw new Error(
      "Savings account is inactive."
    );
  }
}

/* =========================================================
   GET ACCOUNT BY MEMBER
========================================================= */

export async function getSavingsAccount(
  memberId: string
): Promise<SavingsAccount | null> {
  const memberObjectId =
    requireObjectId(
      memberId,
      "Invalid member ID."
    );

  await ensureIndexes();

  const collection =
    await getAccountCollection();

  const account =
    await collection.findOne({
      memberId:
        memberObjectId,
    });

  if (!account) {
    return null;
  }

  return toSavingsAccount(
    account
  );
}

/* =========================================================
   GET ACCOUNT BY ID
========================================================= */

export async function getSavingsAccountById(
  id: string
): Promise<SavingsAccount | null> {
  const accountObjectId =
    requireObjectId(
      id,
      "Invalid savings account ID."
    );

  await ensureIndexes();

  const collection =
    await getAccountCollection();

  const account =
    await collection.findOne({
      _id:
        accountObjectId,
    });

  if (!account) {
    return null;
  }

  return toSavingsAccount(
    account
  );
}

/* =========================================================
   GET OR CREATE ACCOUNT
========================================================= */

export async function getOrCreateSavingsAccount(
  data: Pick<
    SavingsAccount,
    "memberId" | "memberName"
  >,
  session?: ClientSession
): Promise<SavingsAccount> {
  const memberId =
    requireNonEmpty(
      data.memberId,
      "Member ID is required."
    );

  const memberName =
    requireNonEmpty(
      data.memberName,
      "Member name is required."
    );

  const memberObjectId =
    requireObjectId(
      memberId,
      "Invalid member ID."
    );

  await ensureIndexes();

  const collection =
    await getAccountCollection();

  /*
   * First check for an existing account.
   */
  const existing =
    await collection.findOne(
      {
        memberId:
          memberObjectId,
      },
      {
        session,
      }
    );

  if (existing) {
    return toSavingsAccount(
      existing
    );
  }

  const now =
    new Date().toISOString();

  /*
   * Find the highest existing SAV number.
   */
  const latestAccount =
    await collection
      .find({
        accountNumber: {
          $regex:
            /^SAV-\d+$/i,
        },
      })
      .sort({
        accountNumber:
          -1,
      })
      .limit(1)
      .next();

  let nextNumber =
    1;

  if (
    latestAccount?.accountNumber
  ) {
    const match =
      latestAccount.accountNumber.match(
        /^SAV-(\d+)$/i
      );

    if (match?.[1]) {
      const parsed =
        Number(match[1]);

      if (
        Number.isSafeInteger(
          parsed
        ) &&
        parsed >= 1
      ) {
        nextNumber =
          parsed + 1;
      }
    }
  }

  const accountNumber =
    `SAV-${String(
      nextNumber
    ).padStart(
      6,
      "0"
    )}`;

  const accountObjectId =
    new ObjectId();

  const account:
    SavingsAccount = {
    id:
      accountObjectId.toHexString(),

    memberId,

    memberName,

    accountNumber,

    accountType:
      "fixed",

    balance:
      0,

    status:
      "active",

    isActive:
      true,

    createdAt:
      now,

    updatedAt:
      now,

    createdBy:
      "system",
  };

  const validation =
    validateSavingsAccount(
      account
    );

  if (!validation.valid) {
    throw new Error(
      getFirstValidationError(
        validation.errors
      )
    );
  }

  const document:
    SavingsAccountDocument = {
    _id:
      accountObjectId,

    memberId:
      memberObjectId,

    memberName,

    accountNumber,

    accountType:
      "fixed",

    balance:
      0,

    status:
      "active",

    isActive:
      true,

    createdAt:
      now,

    updatedAt:
      now,

    createdBy:
      "system",
  };

  try {
    await collection.insertOne(
      document,
      {
        session,
      }
    );

    return account;
  } catch (error) {
    /*
     * Outside an existing transaction we can safely recover
     * from a concurrent creation of the same member account.
     */
    if (
      isDuplicateKeyError(error) &&
      !session
    ) {
      const concurrent =
        await collection.findOne({
          memberId:
            memberObjectId,
        });

      if (concurrent) {
        return toSavingsAccount(
          concurrent
        );
      }
    }

    throw error;
  }
}

/* =========================================================
   GET TRANSACTION
========================================================= */

export async function getSavingsTransactionById(
  id: string
): Promise<SavingsTransaction | null> {
  const cleanId =
    requireNonEmpty(
      id,
      "Transaction ID is required."
    );

  await ensureIndexes();

  const collection =
    await getTransactionCollection();

  const transaction =
    await collection.findOne({
      _id:
        cleanId,
    });

  if (!transaction) {
    return null;
  }

  return toSavingsTransaction(
    transaction
  );
}

/* =========================================================
   FIND EXTERNAL DUPLICATE
========================================================= */

async function findExistingExternalTransaction(
  data: {
    source:
      SavingsTransaction["source"];

    reference?: string;

    smsId?: string;

    session?: ClientSession;
  }
): Promise<SavingsTransaction | null> {
  const collection =
    await getTransactionCollection();

  const smsId =
    data.smsId?.trim();

  if (smsId) {
    const existing =
      await collection.findOne(
        {
          smsId,
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

  const reference =
    data.reference?.trim();

  if (reference) {
    const existing =
      await collection.findOne(
        {
          source:
            data.source,

          reference,
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
   DUPLICATE VALIDATION
========================================================= */

function assertDuplicateMatchesRequest(
  existing: SavingsTransaction,
  requested: {
    savingsAccountId: string;
    memberId: string;
    amount: number;
    source:
      SavingsTransaction["source"];
    reference?: string;
    smsId?: string;
  }
): void {
  const sameAccount =
    existing.savingsAccountId ===
    requested.savingsAccountId;

  const sameMember =
    existing.memberId ===
    requested.memberId;

  const sameAmount =
    existing.amount ===
    requested.amount;

  const sameSource =
    existing.source ===
    requested.source;

  const sameReference =
    !requested.reference ||
    existing.reference ===
      requested.reference;

  const sameSmsId =
    !requested.smsId ||
    existing.smsId ===
      requested.smsId;

  if (
    !sameAccount ||
    !sameMember ||
    !sameAmount ||
    !sameSource ||
    !sameReference ||
    !sameSmsId
  ) {
    throw new Error(
      "Duplicate external transaction identifier conflicts with an existing savings transaction."
    );
  }
}

/* =========================================================
   BUILD DEPOSIT
========================================================= */

function buildSavingsDeposit(
  data: CreateSavingsDepositInput,
  now: string
): SavingsTransaction {
  const transactionAt =
    normalizeTransactionDate(
      data.transactionAt,
      now
    );

  const transaction:
    SavingsTransaction = {
    id:
      randomUUID(),

    savingsAccountId:
      requireNonEmpty(
        data.savingsAccountId,
        "Savings account ID is required."
      ),

    memberId:
      requireNonEmpty(
        data.memberId,
        "Member ID is required."
      ),

    memberName:
      requireNonEmpty(
        data.memberName,
        "Member name is required."
      ),

    amount:
      requirePositiveNumber(
        data.amount,
        "Savings deposit amount must be greater than zero."
      ),

    type:
      "deposit",

    source:
      data.source,

    status:
      "confirmed",

    ...(data.reference?.trim()
      ? {
          reference:
            data.reference.trim(),
        }
      : {}),

    ...(data.smsId?.trim()
      ? {
          smsId:
            data.smsId.trim(),
        }
      : {}),

    ...(data.sourceReference?.trim()
      ? {
          sourceReference:
            data.sourceReference.trim(),
        }
      : {}),

    ...(data.recordedBy
      ? {
          recordedBy:
            data.recordedBy,
        }
      : {}),

    transactionAt,

    createdAt:
      now,

    updatedAt:
      now,

    synced:
      true,
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

  return normalized;
}

/* =========================================================
   CREATE DEPOSIT
========================================================= */

export async function createSavingsDeposit(
  data: CreateSavingsDepositInput
): Promise<SavingsTransaction> {
  await ensureIndexes();

  const savingsAccountId =
    requireNonEmpty(
      data.savingsAccountId,
      "Savings account ID is required."
    );

  const memberId =
    requireNonEmpty(
      data.memberId,
      "Member ID is required."
    );

  const memberName =
    requireNonEmpty(
      data.memberName,
      "Member name is required."
    );

  const amount =
    requirePositiveNumber(
      data.amount,
      "Savings deposit amount must be greater than zero."
    );

  requireObjectId(
    savingsAccountId,
    "Invalid savings account ID."
  );

  requireObjectId(
    memberId,
    "Invalid member ID."
  );

  const now =
    new Date().toISOString();

  const transaction =
    buildSavingsDeposit(
      {
        ...data,
        savingsAccountId,
        memberId,
        memberName,
        amount,
      },
      now
    );

  const transactions =
    await getTransactionCollection();

  const accounts =
    await getAccountCollection();

  const client =
    await clientPromise;

  const session =
    client.startSession();

  try {
    let result:
      SavingsTransaction | null =
      null;

    await session.withTransaction(
      async () => {
        /*
         * 1. IDEMPOTENCY
         */
        const duplicate =
          await findExistingExternalTransaction({
            source:
              transaction.source,

            reference:
              transaction.reference,

            smsId:
              transaction.smsId,

            session,
          });

        if (duplicate) {
          assertDuplicateMatchesRequest(
            duplicate,
            {
              savingsAccountId:
                transaction.savingsAccountId,

              memberId:
                transaction.memberId,

              amount:
                transaction.amount,

              source:
                transaction.source,

              reference:
                transaction.reference,

              smsId:
                transaction.smsId,
            }
          );

          result =
            duplicate;

          return;
        }

        /*
         * 2. SERIALIZE THROUGH ACCOUNT
         */
        const account =
          await lockSavingsAccount(
            savingsAccountId,
            session
          );

        validateAccountOwnership(
          account,
          transaction.memberId
        );

        /*
         * 3. APPEND LEDGER ENTRY
         */
        await transactions.insertOne(
          toSavingsTransactionDocument(
            transaction
          ),
          {
            session,
          }
        );

        /*
         * 4. AUTHORITATIVE BALANCE
         */
        const balance =
          await calculateLedgerBalance(
            savingsAccountId,
            session
          );

        /*
         * 5. UPDATE CACHE
         */
        const cacheResult =
          await accounts.updateOne(
            {
              _id:
                account._id,
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

        if (
          cacheResult.matchedCount !==
          1
        ) {
          throw new Error(
            "Savings account balance cache could not be updated."
          );
        }

        result =
          transaction;
      }
    );

    if (!result) {
      throw new Error(
        "Savings deposit could not be created."
      );
    }

    return result;
  } catch (error) {
    /*
     * Unique indexes protect against concurrent external
     * transaction submissions.
     */
    if (isDuplicateKeyError(error)) {
      const duplicate =
        await findExistingExternalTransaction({
          source:
            transaction.source,

          reference:
            transaction.reference,

          smsId:
            transaction.smsId,
        });

      if (duplicate) {
        assertDuplicateMatchesRequest(
          duplicate,
          {
            savingsAccountId:
              transaction.savingsAccountId,

            memberId:
              transaction.memberId,

            amount:
              transaction.amount,

            source:
              transaction.source,

            reference:
              transaction.reference,

            smsId:
              transaction.smsId,
          }
        );

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
  await ensureIndexes();

  const collection =
    await getTransactionCollection();

  const requestedPage =
    Number(options.page);

  const requestedLimit =
    Number(options.limit);

  const page =
    Number.isFinite(
      requestedPage
    ) &&
    requestedPage > 0
      ? Math.floor(
          requestedPage
        )
      : DEFAULT_PAGE;

  const limit =
    Number.isFinite(
      requestedLimit
    ) &&
    requestedLimit > 0
      ? Math.min(
          MAX_LIMIT,
          Math.floor(
            requestedLimit
          )
        )
      : DEFAULT_LIMIT;

  const filter:
    Filter<SavingsTransactionDocument> =
    {};

  if (
    typeof options.memberId ===
      "string" &&
    options.memberId.trim()
  ) {
    filter.memberId =
      options.memberId.trim();
  }

  if (
    typeof options.savingsAccountId ===
      "string" &&
    options.savingsAccountId.trim()
  ) {
    filter.savingsAccountId =
      options.savingsAccountId.trim();
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
    (safePage - 1) *
    limit;

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

    page:
      safePage,

    limit,

    totalPages,
  };
}

/* =========================================================
   AUTHORITATIVE BALANCE
========================================================= */

export async function getSavingsBalance(
  savingsAccountId: string
): Promise<number> {
  const cleanId =
    requireNonEmpty(
      savingsAccountId,
      "Savings account ID is required."
    );

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
   REBUILD CACHED BALANCE
========================================================= */

export async function rebuildSavingsAccountBalance(
  savingsAccountId: string
): Promise<SavingsAccount> {
  const cleanId =
    requireNonEmpty(
      savingsAccountId,
      "Savings account ID is required."
    );

  const accountObjectId =
    requireObjectId(
      cleanId,
      "Invalid savings account ID."
    );

  await ensureIndexes();

  const accounts =
    await getAccountCollection();

  const client =
    await clientPromise;

  const session =
    client.startSession();

  try {
    let updated:
      SavingsAccount | null =
      null;

    await session.withTransaction(
      async () => {
        await lockSavingsAccount(
          cleanId,
          session
        );

        const balance =
          await calculateLedgerBalance(
            cleanId,
            session
          );

        const result =
          await accounts.updateOne(
            {
              _id:
                accountObjectId,
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

        if (
          result.matchedCount !==
          1
        ) {
          throw new Error(
            "Savings account balance could not be rebuilt."
          );
        }

        const account =
          await accounts.findOne(
            {
              _id:
                accountObjectId,
            },
            {
              session,
            }
          );

        if (!account) {
          throw new Error(
            "Savings account could not be retrieved after rebuilding."
          );
        }

        updated =
          toSavingsAccount(
            account
          );
      }
    );

    if (!updated) {
      throw new Error(
        "Savings account balance could not be rebuilt."
      );
    }

    return updated;
  } finally {
    await session.endSession();
  }
}

/* =========================================================
   CREATE ADJUSTMENT
========================================================= */

export async function createSavingsAdjustment(
  data: CreateSavingsAdjustmentInput
): Promise<SavingsTransaction> {
  await ensureIndexes();

  const originalTransactionId =
    requireNonEmpty(
      data.originalTransactionId,
      "Original transaction ID is required."
    );

  const reason =
    requireNonEmpty(
      data.reason,
      "Adjustment reason is required."
    );

  const amount =
    requireNonZeroNumber(
      data.amount,
      "Adjustment amount must be a non-zero number."
    );

  const transactions =
    await getTransactionCollection();

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
        const original =
          await transactions.findOne(
            {
              _id:
                originalTransactionId,
            },
            {
              session,
            }
          );

        if (!original) {
          throw new Error(
            "Original savings transaction not found."
          );
        }

        if (
          !isConfirmedStatus(
            original.status
          )
        ) {
          throw new Error(
            "Only confirmed transactions can be adjusted."
          );
        }

        if (
          isReversedStatus(
            original.status
          )
        ) {
          throw new Error(
            "A reversed transaction cannot be adjusted."
          );
        }

        if (
          original.type !==
          "deposit"
        ) {
          throw new Error(
            "Only deposit transactions can be adjusted."
          );
        }

        /*
         * Serialize through account.
         */
        const account =
          await lockSavingsAccount(
            original.savingsAccountId,
            session
          );

        validateAccountOwnership(
          account,
          original.memberId
        );

        /*
         * Check for existing adjustment.
         */
        const existing =
          await transactions.findOne(
            {
              type:
                "adjustment",

              relatedTransactionId:
                original._id,
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

        const now =
          new Date().toISOString();

        const adjustment:
          SavingsTransaction = {
          id:
            randomUUID(),

          savingsAccountId:
            original.savingsAccountId,

          memberId:
            original.memberId,

          memberName:
            original.memberName,

          /*
           * Signed delta.
           *
           * Positive:
           * increases savings.
           *
           * Negative:
           * decreases savings.
           */
          amount,

          type:
            "adjustment",

          source:
            "system",

          status:
            "confirmed",

          relatedTransactionId:
            original._id,

          reason,

          ...(data.recordedBy
            ? {
                recordedBy:
                  data.recordedBy,
              }
            : {}),

          transactionAt:
            now,

          createdAt:
            now,

          updatedAt:
            now,

          synced:
            true,
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

        await transactions.insertOne(
          toSavingsTransactionDocument(
            normalized
          ),
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

export async function reverseSavingsTransaction(
  data: ReverseSavingsTransactionInput
): Promise<SavingsTransaction> {
  await ensureIndexes();

  const transactionId =
    requireNonEmpty(
      data.transactionId,
      "Transaction ID is required."
    );

  const reason =
    requireNonEmpty(
      data.reason,
      "Reversal reason is required."
    );

  const transactions =
    await getTransactionCollection();

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
        const original =
          await transactions.findOne(
            {
              _id:
                transactionId,
            },
            {
              session,
            }
          );

        if (!original) {
          throw new Error(
            "Savings transaction not found."
          );
        }

        if (
          isReversedStatus(
            original.status
          )
        ) {
          throw new Error(
            "Transaction has already been reversed."
          );
        }

        if (
          !isConfirmedStatus(
            original.status
          )
        ) {
          throw new Error(
            "Only confirmed transactions can be reversed."
          );
        }

        /*
         * Only original deposits may be directly reversed.
         */
        if (
          original.type !==
          "deposit"
        ) {
          throw new Error(
            "Only deposit transactions can be directly reversed."
          );
        }

        /*
         * Serialize through account.
         */
        const account =
          await lockSavingsAccount(
            original.savingsAccountId,
            session
          );

        validateAccountOwnership(
          account,
          original.memberId
        );

        /*
         * Check whether reversal already exists.
         */
        const existing =
          await transactions.findOne(
            {
              type:
                "reversal",

              relatedTransactionId:
                original._id,
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

        const now =
          new Date().toISOString();

        const reversal:
          SavingsTransaction = {
          id:
            randomUUID(),

          savingsAccountId:
            original.savingsAccountId,

          memberId:
            original.memberId,

          memberName:
            original.memberName,

          /*
           * EXACT OPPOSITE OF ORIGINAL.
           */
          amount:
            -original.amount,

          type:
            "reversal",

          source:
            "system",

          status:
            "confirmed",

          relatedTransactionId:
            original._id,

          reason,

          ...(data.recordedBy
            ? {
                recordedBy:
                  data.recordedBy,
              }
            : {}),

          transactionAt:
            now,

          createdAt:
            now,

          updatedAt:
            now,

          synced:
            true,
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

        /*
         * Insert reversal first.
         */
        await transactions.insertOne(
          toSavingsTransactionDocument(
            normalized
          ),
          {
            session,
          }
        );

        /*
         * Mark original as reversed.
         *
         * Amount is NEVER modified.
         */
        const updateResult =
          await transactions.updateOne(
            {
              _id:
                original._id,

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
   DEACTIVATE ACCOUNT
========================================================= */

export async function deactivateSavingsAccount(
  savingsAccountId: string
): Promise<SavingsAccount> {
  const cleanId =
    requireNonEmpty(
      savingsAccountId,
      "Savings account ID is required."
    );

  await ensureIndexes();

  const client =
    await clientPromise;

  const session =
    client.startSession();

  try {
    let updated:
      SavingsAccount | null =
      null;

    await session.withTransaction(
      async () => {
        const account =
          await lockSavingsAccount(
            cleanId,
            session
          );

        const currentlyActive =
          typeof account.isActive ===
            "boolean"
            ? account.isActive
            : account.status ===
              "active";

        if (!currentlyActive) {
          updated =
            toSavingsAccount(
              account
            );

          return;
        }

        const accounts =
          await getAccountCollection();

        const updatedAt =
          new Date().toISOString();

        const result =
          await accounts.updateOne(
            {
              _id:
                account._id,

              $or: [
                {
                  isActive:
                    true,
                },
                {
                  status:
                    "active",
                },
              ],
            },
            {
              $set: {
                isActive:
                  false,

                status:
                  "inactive",

                updatedAt,
              },
            },
            {
              session,
            }
          );

        if (
          result.matchedCount !==
          1
        ) {
          throw new Error(
            "Savings account could not be deactivated."
          );
        }

        const afterUpdate =
          await accounts.findOne(
            {
              _id:
                account._id,
            },
            {
              session,
            }
          );

        if (!afterUpdate) {
          throw new Error(
            "Savings account could not be retrieved after deactivation."
          );
        }

        updated =
          toSavingsAccount(
            afterUpdate
          );
      }
    );

    if (!updated) {
      throw new Error(
        "Savings account could not be deactivated."
      );
    }

    return updated;
  } finally {
    await session.endSession();
  }
}

/* =========================================================
   REACTIVATE ACCOUNT
========================================================= */

export async function reactivateSavingsAccount(
  savingsAccountId: string
): Promise<SavingsAccount> {
  const cleanId =
    requireNonEmpty(
      savingsAccountId,
      "Savings account ID is required."
    );

  await ensureIndexes();

  const client =
    await clientPromise;

  const session =
    client.startSession();

  try {
    let updated:
      SavingsAccount | null =
      null;

    await session.withTransaction(
      async () => {
        const account =
          await lockSavingsAccount(
            cleanId,
            session
          );

        const currentlyActive =
          typeof account.isActive ===
            "boolean"
            ? account.isActive
            : account.status ===
              "active";

        if (currentlyActive) {
          updated =
            toSavingsAccount(
              account
            );

          return;
        }

        const accounts =
          await getAccountCollection();

        const updatedAt =
          new Date().toISOString();

        const result =
          await accounts.updateOne(
            {
              _id:
                account._id,
            },
            {
              $set: {
                isActive:
                  true,

                status:
                  "active",

                updatedAt,
              },
            },
            {
              session,
            }
          );

        if (
          result.matchedCount !==
          1
        ) {
          throw new Error(
            "Savings account could not be reactivated."
          );
        }

        const afterUpdate =
          await accounts.findOne(
            {
              _id:
                account._id,
            },
            {
              session,
            }
          );

        if (!afterUpdate) {
          throw new Error(
            "Savings account could not be retrieved after reactivation."
          );
        }

        updated =
          toSavingsAccount(
            afterUpdate
          );
      }
    );

    if (!updated) {
      throw new Error(
        "Savings account could not be reactivated."
      );
    }

    return updated;
  } finally {
    await session.endSession();
  }
}