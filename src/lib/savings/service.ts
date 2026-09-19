/**
 * GEO-SHUA
 * Savings Domain Service
 *
 * Production-safe savings ledger.
 *
 * FINANCIAL MODEL
 * ---------------------------------------------------------
 *
 * Deposit:
 *   Positive ledger entry.
 *
 * Adjustment:
 *   Withdrawal/correction.
 *   Public input is positive.
 *   Stored ledger amount is negative.
 *
 * Reversal:
 *   Cancels a confirmed deposit.
 *   Stored ledger amount is negative.
 *
 * IMPORTANT
 * ---------------------------------------------------------
 *
 * 1. The ledger is authoritative.
 * 2. savingsAccounts.balance is only a cache.
 * 3. Financial transactions are append-only.
 * 4. Existing transaction amounts are never edited.
 * 5. Withdrawals are represented by adjustment transactions.
 * 6. Reversals are represented by separate reversal transactions.
 * 7. Pending transactions do not affect balance.
 * 8. Financial mutations use MongoDB transactions.
 * 9. Account ownership is validated before mutations.
 * 10. Withdrawal amounts are stored as negative values.
 * 11. MongoDB ObjectIds never leak through the public API.
 * 12. Legacy string/number dates are safely normalized on read.
 */

import { randomUUID } from "crypto";

import {
  ObjectId,
  type ClientSession,
  type Collection,
  type Db,
  type OptionalId,
} from "mongodb";

import clientPromise from "@/lib/mongodb";
import {
  queueSavingsDepositSms,
} from "@/lib/sms/outbox/notifications";

import type {
  SavingsAccount,
  SavingsTransaction,
} from "./types";

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

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

const SAVINGS_ACCOUNT_TYPE =
  "savings";

/* =========================================================
   INTERNAL DOCUMENT TYPES
========================================================= */

type SavingsAccountDocument = {
  _id: ObjectId;
  memberId: ObjectId;
  accountNumber: string;
  accountType: string;
  balance: number;
  isActive: boolean;
  status: string;
  createdAt: Date | string | number;
  updatedAt: Date | string | number;
};

type SavingsTransactionDocument = {
  _id: string;
  savingsAccountId: ObjectId;
  memberId: ObjectId;
  memberName: string;
  type: SavingsTransaction["type"];
  amount: number;
  source: SavingsTransaction["source"];
  status: SavingsTransaction["status"];
  reference?: string;
  smsId?: string;
  sourceReference?: string;
  reason?: string;
  relatedTransactionId?: string;
  transactionAt: Date | string | number;
  recordedBy?: SavingsTransaction["recordedBy"];
  synced: boolean;
  createdAt: Date | string | number;
  updatedAt: Date | string | number;
};

type NewSavingsAccountDocument =
  OptionalId<SavingsAccountDocument>;

/* =========================================================
   PUBLIC INPUT TYPES
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

export type GetOrCreateSavingsAccountInput = {
  memberId: string;
  memberName?: string;
};

/* =========================================================
   COLLECTIONS
========================================================= */

async function getCollections(): Promise<{
  db: Db;
  accounts: Collection<
    OptionalId<SavingsAccountDocument>
  >;
  transactions: Collection<
    SavingsTransactionDocument
  >;
}> {
  const client =
    await clientPromise;

  const db =
    client.db(DB_NAME);

  return {
    db,

    accounts:
      db.collection<
        OptionalId<SavingsAccountDocument>
      >(
        ACCOUNT_COLLECTION,
      ),

    transactions:
      db.collection<SavingsTransactionDocument>(
        TRANSACTION_COLLECTION,
      ),
  };
}

/* =========================================================
   DATE NORMALIZATION
========================================================= */

function toIsoDate(
  value: Date | string | number,
  fieldName: string,
): string {
  const date =
    value instanceof Date
      ? value
      : new Date(value);

  if (
    Number.isNaN(
      date.getTime(),
    )
  ) {
    throw new Error(
      `Invalid ${fieldName}.`,
    );
  }

  return date.toISOString();
}

/* =========================================================
   PUBLIC MAPPERS
========================================================= */

function toPublicSavingsAccount(
  account: SavingsAccountDocument,
): SavingsAccount {
  return {
    id:
      account._id.toString(),

    memberId:
      account.memberId.toString(),

    accountNumber:
      account.accountNumber,

    accountType:
      account.accountType,

    balance:
      Number.isFinite(account.balance)
        ? account.balance
        : 0,

    isActive:
      account.isActive !== false,

    status:
      account.status,

    createdAt:
      toIsoDate(
        account.createdAt,
        "createdAt",
      ),

    updatedAt:
      toIsoDate(
        account.updatedAt,
        "updatedAt",
      ),
  } as SavingsAccount;
}

function toPublicSavingsTransaction(
  transaction: SavingsTransactionDocument,
): SavingsTransaction {
  return {
    id:
      transaction._id,

    savingsAccountId:
      transaction.savingsAccountId.toString(),

    memberId:
      transaction.memberId.toString(),

    memberName:
      transaction.memberName,

    type:
      transaction.type,

    amount:
      transaction.amount,

    source:
      transaction.source,

    status:
      transaction.status,

    reference:
      transaction.reference,

    smsId:
      transaction.smsId,

    sourceReference:
      transaction.sourceReference,

    reason:
      transaction.reason,

    relatedTransactionId:
      transaction.relatedTransactionId,

    transactionAt:
      toIsoDate(
        transaction.transactionAt,
        "transactionAt",
      ),

    recordedBy:
      transaction.recordedBy,

    synced:
      transaction.synced,

    createdAt:
      toIsoDate(
        transaction.createdAt,
        "createdAt",
      ),

    updatedAt:
      toIsoDate(
        transaction.updatedAt,
        "updatedAt",
      ),
  } as SavingsTransaction;
}

/* =========================================================
   VALIDATION HELPERS
========================================================= */

function requirePositiveNumber(
  value: number,
  message =
    "Amount must be greater than zero.",
): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value <= 0
  ) {
    throw new Error(message);
  }

  return value;
}

function requireReason(
  reason: string,
): string {
  const normalized =
    typeof reason === "string"
      ? reason.trim()
      : "";

  if (!normalized) {
    throw new Error(
      "A reason is required.",
    );
  }

  if (normalized.length > 500) {
    throw new Error(
      "Reason cannot exceed 500 characters.",
    );
  }

  return normalized;
}

function toObjectId(
  value: string,
  fieldName: string,
): ObjectId {
  if (
    typeof value !== "string" ||
    !ObjectId.isValid(value)
  ) {
    throw new Error(
      `Invalid ${fieldName}.`,
    );
  }

  return new ObjectId(value);
}

function normalizeDate(
  value?: string,
): Date {
  if (!value) {
    return new Date();
  }

  const date =
    new Date(value);

  if (
    Number.isNaN(
      date.getTime(),
    )
  ) {
    throw new Error(
      "Invalid transaction date.",
    );
  }

  return date;
}

/* =========================================================
   LEDGER BALANCE
========================================================= */

async function calculateLedgerBalance(
  transactions: Collection<SavingsTransactionDocument>,
  savingsAccountId: ObjectId,
  session?: ClientSession,
): Promise<number> {
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
                $ne: "pending",
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
        },
      )
      .toArray();

  return Number(
    result[0]?.balance ?? 0,
  );
}

/* =========================================================
   ACCOUNT LOCK
========================================================= */

async function lockSavingsAccount(
  accounts: Collection<
    OptionalId<SavingsAccountDocument>
  >,
  accountId: ObjectId,
  session: ClientSession,
): Promise<SavingsAccountDocument> {
  const account =
    await accounts.findOne(
      {
        _id: accountId,
      },
      {
        session,
      },
    );

  if (!account) {
    throw new Error(
      "Savings account not found.",
    );
  }

  if (
    account.isActive === false
  ) {
    throw new Error(
      "Savings account is inactive.",
    );
  }

  await accounts.updateOne(
    {
      _id: accountId,
    },
    {
      $set: {
        updatedAt: new Date(),
      },
    },
    {
      session,
    },
  );

  return account as SavingsAccountDocument;
}

/* =========================================================
   ACCOUNT OWNERSHIP
========================================================= */

function assertAccountOwnership(
  account: SavingsAccountDocument,
  memberId: ObjectId,
): void {
  if (
    account.memberId.toString() !==
    memberId.toString()
  ) {
    throw new Error(
      "Savings account does not belong to this member.",
    );
  }
}

/* =========================================================
   UPDATE CACHED BALANCE
========================================================= */

async function updateCachedBalance(
  accounts: Collection<
    OptionalId<SavingsAccountDocument>
  >,
  transactions: Collection<SavingsTransactionDocument>,
  accountId: ObjectId,
  session: ClientSession,
): Promise<number> {
  const balance =
    await calculateLedgerBalance(
      transactions,
      accountId,
      session,
    );

  await accounts.updateOne(
    {
      _id: accountId,
    },
    {
      $set: {
        balance,
        updatedAt: new Date(),
      },
    },
    {
      session,
    },
  );

  return balance;
}

/* =========================================================
   INDEXES
========================================================= */

export async function ensureSavingsIndexes(): Promise<void> {
  const {
    accounts,
    transactions,
  } =
    await getCollections();

  await accounts.createIndex(
    {
      memberId: 1,
    },
    {
      unique: true,
      name:
        "savings_account_member_unique",
    },
  );

  await accounts.createIndex(
    {
      accountNumber: 1,
    },
    {
      unique: true,
      name:
        "savings_account_number_unique",
    },
  );

  await transactions.createIndex(
    {
      savingsAccountId: 1,
      transactionAt: -1,
      _id: -1,
    },
    {
      name:
        "savings_transaction_account_history",
    },
  );

  await transactions.createIndex(
    {
      memberId: 1,
      transactionAt: -1,
      _id: -1,
    },
    {
      name:
        "savings_transaction_member_history",
    },
  );

  await transactions.createIndex(
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
        "savings_transaction_source_reference_unique",
    },
  );

  await transactions.createIndex(
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
        "savings_transaction_sms_unique",
    },
  );

  await transactions.createIndex(
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
        "savings_transaction_related_unique",
    },
  );
}

/* =========================================================
   GET ACCOUNT BY MEMBER
========================================================= */

export async function getSavingsAccount(
  memberId: string,
): Promise<SavingsAccount | null> {
  const {
    accounts,
  } =
    await getCollections();

  const memberObjectId =
    toObjectId(
      memberId,
      "memberId",
    );

  const account =
    await accounts.findOne({
      memberId:
        memberObjectId,
    });

  if (!account) {
    return null;
  }

  return toPublicSavingsAccount(
    account as SavingsAccountDocument,
  );
}

/* =========================================================
   GET ACCOUNT BY ID
========================================================= */

export async function getSavingsAccountById(
  savingsAccountId: string,
): Promise<SavingsAccount | null> {
  const {
    accounts,
  } =
    await getCollections();

  const accountObjectId =
    toObjectId(
      savingsAccountId,
      "savingsAccountId",
    );

  const account =
    await accounts.findOne({
      _id:
        accountObjectId,
    });

  if (!account) {
    return null;
  }

  return toPublicSavingsAccount(
    account as SavingsAccountDocument,
  );
}

/* =========================================================
   GET OR CREATE ACCOUNT
========================================================= */

export async function getOrCreateSavingsAccount(
  input:
    | GetOrCreateSavingsAccountInput
    | string,
): Promise<SavingsAccount> {
  const memberId =
    typeof input === "string"
      ? input
      : input.memberId;

  const {
    accounts,
  } =
    await getCollections();

  const memberObjectId =
    toObjectId(
      memberId,
      "memberId",
    );

  const existing =
    await accounts.findOne({
      memberId:
        memberObjectId,
    });

  if (existing) {
    return toPublicSavingsAccount(
      existing as SavingsAccountDocument,
    );
  }

  const latestAccount =
    await accounts.findOne(
      {
        accountNumber: {
          $regex:
            /^SAV-\d+$/i,
        },
      },
      {
        sort: {
          accountNumber: -1,
        },
      },
    );

  let nextNumber = 1;

  if (
    latestAccount?.accountNumber
  ) {
    const match =
      latestAccount.accountNumber.match(
        /^SAV-(\d+)$/i,
      );

    if (match) {
      nextNumber =
        Number(match[1]) + 1;
    }
  }

  const accountNumber =
    `SAV-${String(nextNumber).padStart(6, "0")}`;

  const now =
    new Date();

  const accountWithoutId:
    NewSavingsAccountDocument =
    {
      memberId:
        memberObjectId,

      accountNumber,

      accountType:
        SAVINGS_ACCOUNT_TYPE,

      balance: 0,

      isActive: true,

      status:
        "active",

      createdAt:
        now,

      updatedAt:
        now,
    };

  const client =
    await clientPromise;

  const session =
    client.startSession();

  try {
    let createdAccount:
      SavingsAccountDocument | null =
      null;

    await session.withTransaction(
      async () => {
        const result =
          await accounts.insertOne(
            accountWithoutId,
            {
              session,
            },
          );

        createdAccount = {
          ...accountWithoutId,

          _id:
            result.insertedId,
        };
      },
    );

    if (!createdAccount) {
      throw new Error(
        "Failed to create savings account.",
      );
    }

    return toPublicSavingsAccount(
      createdAccount,
    );
  } catch (error) {
    if (
      error instanceof Error &&
      (
        error.message.includes(
          "duplicate",
        ) ||
        error.message.includes(
          "E11000",
        )
      )
    ) {
      const concurrent =
        await accounts.findOne({
          memberId:
            memberObjectId,
        });

      if (concurrent) {
        return toPublicSavingsAccount(
          concurrent as SavingsAccountDocument,
        );
      }
    }

    throw error;
  } finally {
    await session.endSession();
  }
}

/* =========================================================
   GET TRANSACTION BY ID
========================================================= */

export async function getSavingsTransactionById(
  id: string,
): Promise<SavingsTransaction | null> {
  const {
    transactions,
  } =
    await getCollections();

  if (
    typeof id !== "string" ||
    !id.trim()
  ) {
    throw new Error(
      "Transaction ID is required.",
    );
  }

  const transaction =
    await transactions.findOne({
      _id:
        id.trim(),
    });

  if (!transaction) {
    return null;
  }

  return toPublicSavingsTransaction(
    transaction,
  );
}

/* =========================================================
   CREATE DEPOSIT
========================================================= */



export async function createSavingsDeposit(
  data: CreateSavingsDepositInput,
): Promise<SavingsTransaction> {
  const amount =
    requirePositiveNumber(
      data.amount,
    );

  const savingsAccountObjectId =
    toObjectId(
      data.savingsAccountId,
      "savingsAccountId",
    );

  const memberObjectId =
    toObjectId(
      data.memberId,
      "memberId",
    );

  const memberName =
    typeof data.memberName ===
    "string"
      ? data.memberName.trim()
      : "";

  if (!memberName) {
    throw new Error(
      "Member name is required.",
    );
  }

  if (!data.source) {
    throw new Error(
      "Transaction source is required.",
    );
  }

  const transactionAt =
    normalizeDate(
      data.transactionAt,
    );

  const reference =
    data.reference?.trim() ||
    undefined;

  const smsId =
    data.smsId?.trim() ||
    undefined;

  const sourceReference =
    data.sourceReference?.trim() ||
    undefined;

  const {
    db,
    accounts,
    transactions,
  } =
    await getCollections();

  /*
   * -------------------------------------------------------
   * Find an existing transaction first.
   *
   * We still queue/ensure its notification below. This is
   * important because the financial transaction may already
   * exist while its SMS outbox record does not.
   * -------------------------------------------------------
   */

  let existingTransaction:
    SavingsTransactionDocument | null =
    null;

  if (smsId) {
    existingTransaction =
      await transactions.findOne({
        smsId,
      });
  }

  if (
    !existingTransaction &&
    reference
  ) {
    existingTransaction =
      await transactions.findOne({
        source:
          data.source,

        reference,
      });
  }

  /*
   * -------------------------------------------------------
   * Create the financial transaction only when it does not
   * already exist.
   * -------------------------------------------------------
   */

  if (!existingTransaction) {
    const client =
      await clientPromise;

    const session =
      client.startSession();

    try {
      let createdTransaction:
        SavingsTransactionDocument | null =
        null;

      await session.withTransaction(
        async () => {
          const account =
            await lockSavingsAccount(
              accounts,
              savingsAccountObjectId,
              session,
            );

          assertAccountOwnership(
            account,
            memberObjectId,
          );

          const now =
            new Date();

          const transaction:
            SavingsTransactionDocument =
            {
              _id:
                randomUUID(),

              savingsAccountId:
                savingsAccountObjectId,

              memberId:
                memberObjectId,

              memberName,

              type:
                "deposit",

              amount,

              source:
                data.source,

              status:
                "confirmed",

              reference,

              smsId,

              sourceReference,

              transactionAt,

              recordedBy:
                data.recordedBy,

              synced:
                false,

              createdAt:
                now,

              updatedAt:
                now,
            };

          try {
            await transactions.insertOne(
              transaction,
              {
                session,
              },
            );

            await updateCachedBalance(
              accounts,
              transactions,
              savingsAccountObjectId,
              session,
            );

            createdTransaction =
              transaction;
          } catch (error) {
            /*
             * Another request may have created the same
             * transaction concurrently.
             *
             * Resolve the duplicate inside the transaction
             * so the operation remains idempotent.
             */
            if (
              error instanceof Error &&
              (
                error.message.includes(
                  "E11000",
                ) ||
                error.message.includes(
                  "duplicate",
                )
              )
            ) {
              const duplicate =
                await transactions.findOne(
                  {
                    $or: [
                      ...(smsId
                        ? [
                            {
                              smsId,
                            },
                          ]
                        : []),

                      ...(reference
                        ? [
                            {
                              source:
                                data.source,

                              reference,
                            },
                          ]
                        : []),
                    ],
                  },
                  {
                    session,
                  },
                );

              if (duplicate) {
                createdTransaction =
                  duplicate;

                return;
              }
            }

            throw error;
          }
        },
      );

      if (!createdTransaction) {
        throw new Error(
          "Failed to create savings deposit.",
        );
      }

      existingTransaction =
        createdTransaction;
    } finally {
      await session.endSession();
    }
  }

  /*
   * -------------------------------------------------------
   * At this point the financial transaction is committed.
   *
   * SMS processing is deliberately outside the MongoDB
   * financial transaction.
   * -------------------------------------------------------
   */

  if (!existingTransaction) {
    throw new Error(
      "Savings transaction could not be resolved.",
    );
  }

  /*
   * -------------------------------------------------------
   * Resolve the member's current phone number.
   *
   * The existing financial transaction is authoritative,
   * so use its memberId rather than the incoming memberId.
   * -------------------------------------------------------
   */

  const member =
    await db
      .collection<{
        _id: ObjectId;
        phone?: string;
      }>("members")
      .findOne(
        {
          _id:
            existingTransaction.memberId,
        },
        {
          projection: {
            phone: 1,
          },
        },
      );

  const recipient =
    typeof member?.phone ===
    "string"
      ? member.phone.trim()
      : "";

  /*
   * -------------------------------------------------------
   * Queue the savings receipt.
   *
   * This happens only after the financial transaction has
   * committed successfully.
   *
   * The outbox uses:
   *
   * savings_deposit:<transactionId>
   *
   * as its idempotency key, so retries cannot create
   * duplicate notification records.
   * -------------------------------------------------------
   */

  if (recipient) {
    try {
      await queueSavingsDepositSms({
        transactionId:
          existingTransaction._id,

        memberId:
          existingTransaction.memberId.toString(),

        recipient,

        memberName:
          existingTransaction.memberName,

        amount:
          existingTransaction.amount,
      });
    } catch (error) {
      /*
       * The financial transaction is already committed.
       *
       * Never roll back or reject a successful deposit because
       * the notification queue failed.
       */
      console.error(
        "Failed to queue savings deposit SMS.",
        {
          transactionId:
            existingTransaction._id,

          memberId:
            existingTransaction.memberId.toString(),

          error,
        },
      );
    }
  } else {
    /*
     * No phone number means there is no valid SMS recipient.
     *
     * The financial transaction remains successful.
     */
    console.warn(
      "Savings deposit SMS not queued: member has no phone number.",
      {
        transactionId:
          existingTransaction._id,

        memberId:
          existingTransaction.memberId.toString(),
      },
    );
  }

  return toPublicSavingsTransaction(
    existingTransaction,
  );
}





/* =========================================================
   GET TRANSACTIONS
========================================================= */

export async function getSavingsTransactions(
  options:
    GetSavingsTransactionsOptions = {},
): Promise<PaginatedSavingsTransactions> {
  const {
    transactions,
  } =
    await getCollections();

  const requestedPage =
    Number(
      options.page ??
        DEFAULT_PAGE,
    );

  const requestedLimit =
    Number(
      options.limit ??
        DEFAULT_LIMIT,
    );

  const page =
    Number.isFinite(
      requestedPage,
    )
      ? Math.max(
          DEFAULT_PAGE,
          Math.floor(
            requestedPage,
          ),
        )
      : DEFAULT_PAGE;

  const limit =
    Number.isFinite(
      requestedLimit,
    )
      ? Math.min(
          MAX_LIMIT,
          Math.max(
            1,
            Math.floor(
              requestedLimit,
            ),
          ),
        )
      : DEFAULT_LIMIT;

  const filter: Record<
    string,
    unknown
  > = {};

  if (options.memberId) {
    filter.memberId =
      toObjectId(
        options.memberId,
        "memberId",
      );
  }

  if (
    options.savingsAccountId
  ) {
    filter.savingsAccountId =
      toObjectId(
        options.savingsAccountId,
        "savingsAccountId",
      );
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

  const skip =
    (page - 1) *
    limit;

  const [
    documents,
    total,
  ] =
    await Promise.all([
      transactions
        .find(filter)
        .sort({
          transactionAt: -1,
          _id: -1,
        })
        .skip(skip)
        .limit(limit)
        .toArray(),

      transactions.countDocuments(
        filter,
      ),
    ]);

  const totalPages =
    total === 0
      ? 0
      : Math.ceil(
          total / limit,
        );

  return {
    transactions:
      documents.map(
        toPublicSavingsTransaction,
      ),

    total,

    page,

    limit,

    totalPages,
  };
}

/* =========================================================
   GET AUTHORITATIVE BALANCE
========================================================= */

export async function getSavingsBalance(
  savingsAccountId: string,
): Promise<number> {
  const {
    transactions,
  } =
    await getCollections();

  const accountObjectId =
    toObjectId(
      savingsAccountId,
      "savingsAccountId",
    );

  return calculateLedgerBalance(
    transactions,
    accountObjectId,
  );
}

/* =========================================================
   CREATE ADJUSTMENT / WITHDRAWAL
========================================================= */

export async function createSavingsAdjustment(
  data: CreateSavingsAdjustmentInput,
): Promise<SavingsTransaction> {
  const adjustmentAmount =
    requirePositiveNumber(
      data.amount,
    );

  const reason =
    requireReason(
      data.reason,
    );

  const originalId =
    data.originalTransactionId?.trim();

  if (!originalId) {
    throw new Error(
      "Original transaction ID is required.",
    );
  }

  const {
    accounts,
    transactions,
  } =
    await getCollections();

  const original =
    await transactions.findOne({
      _id:
        originalId,
    });

  if (!original) {
    throw new Error(
      "Original transaction not found.",
    );
  }

  if (
    original.type !==
    "deposit"
  ) {
    throw new Error(
      "Only deposits can be adjusted.",
    );
  }

  if (
    original.status !==
    "confirmed"
  ) {
    throw new Error(
      "Only confirmed deposits can be adjusted.",
    );
  }

  if (
    adjustmentAmount >
    original.amount
  ) {
    throw new Error(
      "Adjustment cannot exceed the original deposit amount.",
    );
  }

  const existingAdjustment =
    await transactions.findOne({
      relatedTransactionId:
        originalId,

      type:
        "adjustment",
    });

  if (existingAdjustment) {
    throw new Error(
      "This transaction has already been adjusted.",
    );
  }

  const client =
    await clientPromise;

  const session =
    client.startSession();

  try {
    let createdTransaction:
      SavingsTransactionDocument | null =
      null;

    await session.withTransaction(
      async () => {
        const account =
          await lockSavingsAccount(
            accounts,
            original.savingsAccountId,
            session,
          );

        assertAccountOwnership(
          account,
          original.memberId,
        );

        const now =
          new Date();

        const adjustment:
          SavingsTransactionDocument =
          {
            _id:
              randomUUID(),

            savingsAccountId:
              original.savingsAccountId,

            memberId:
              original.memberId,

            memberName:
              original.memberName,

            type:
              "adjustment",

            amount:
              -adjustmentAmount,

            source:
              "system",

            status:
              "confirmed",

            reason,

            relatedTransactionId:
              originalId,

            transactionAt:
              now,

            recordedBy:
              data.recordedBy,

            synced:
              false,

            createdAt:
              now,

            updatedAt:
              now,
          };

        try {
          await transactions.insertOne(
            adjustment,
            {
              session,
            },
          );
        } catch (error) {
          if (
            error instanceof Error &&
            (
              error.message.includes(
                "E11000",
              ) ||
              error.message.includes(
                "duplicate",
              )
            )
          ) {
            const existing =
              await transactions.findOne(
                {
                  relatedTransactionId:
                    originalId,

                  type:
                    "adjustment",
                },
                {
                  session,
                },
              );

            if (existing) {
              createdTransaction =
                existing;

              return;
            }
          }

          throw error;
        }

        await updateCachedBalance(
          accounts,
          transactions,
          original.savingsAccountId,
          session,
        );

        createdTransaction =
          adjustment;
      },
    );

    if (!createdTransaction) {
      throw new Error(
        "Failed to create savings adjustment.",
      );
    }

    return toPublicSavingsTransaction(
      createdTransaction,
    );
  } finally {
    await session.endSession();
  }
}

/* =========================================================
   REVERSE SAVINGS TRANSACTION
========================================================= */

export async function reverseSavingsTransaction(
  data: ReverseSavingsTransactionInput,
): Promise<SavingsTransaction> {
  const reason =
    requireReason(
      data.reason,
    );

  const transactionId =
    data.transactionId?.trim();

  if (!transactionId) {
    throw new Error(
      "Transaction ID is required.",
    );
  }

  const {
    accounts,
    transactions,
  } =
    await getCollections();

  const original =
    await transactions.findOne({
      _id:
        transactionId,
    });

  if (!original) {
    throw new Error(
      "Transaction not found.",
    );
  }

  if (
    original.type !==
    "deposit"
  ) {
    throw new Error(
      "Only deposits can be reversed.",
    );
  }

  if (
    original.status !==
    "confirmed"
  ) {
    throw new Error(
      "Only confirmed deposits can be reversed.",
    );
  }

  if (
    original.amount <= 0
  ) {
    throw new Error(
      "Invalid original deposit amount.",
    );
  }

  const existingReversal =
    await transactions.findOne({
      relatedTransactionId:
        transactionId,

      type:
        "reversal",
    });

  if (existingReversal) {
    throw new Error(
      "This transaction has already been reversed.",
    );
  }

  const client =
    await clientPromise;

  const session =
    client.startSession();

  try {
    let createdTransaction:
      SavingsTransactionDocument | null =
      null;

    await session.withTransaction(
      async () => {
        const account =
          await lockSavingsAccount(
            accounts,
            original.savingsAccountId,
            session,
          );

        assertAccountOwnership(
          account,
          original.memberId,
        );

        const now =
          new Date();

        const reversal:
          SavingsTransactionDocument =
          {
            _id:
              randomUUID(),

            savingsAccountId:
              original.savingsAccountId,

            memberId:
              original.memberId,

            memberName:
              original.memberName,

            type:
              "reversal",

            amount:
              -Math.abs(
                original.amount,
              ),

            source:
              "system",

            status:
              "confirmed",

            reason,

            relatedTransactionId:
              transactionId,

            transactionAt:
              now,

            recordedBy:
              data.recordedBy,

            synced:
              false,

            createdAt:
              now,

            updatedAt:
              now,
          };

        try {
          await transactions.insertOne(
            reversal,
            {
              session,
            },
          );
        } catch (error) {
          if (
            error instanceof Error &&
            (
              error.message.includes(
                "E11000",
              ) ||
              error.message.includes(
                "duplicate",
              )
            )
          ) {
            const existing =
              await transactions.findOne(
                {
                  relatedTransactionId:
                    transactionId,

                  type:
                    "reversal",
                },
                {
                  session,
                },
              );

            if (existing) {
              createdTransaction =
                existing;

              return;
            }
          }

          throw error;
        }

        await transactions.updateOne(
          {
            _id:
              transactionId,
          },
          {
            $set: {
              status:
                "reversed",

              updatedAt:
                now,
            },
          },
          {
            session,
          },
        );

        await updateCachedBalance(
          accounts,
          transactions,
          original.savingsAccountId,
          session,
        );

        createdTransaction =
          reversal;
      },
    );

    if (!createdTransaction) {
      throw new Error(
        "Failed to reverse savings transaction.",
      );
    }

    return toPublicSavingsTransaction(
      createdTransaction,
    );
  } finally {
    await session.endSession();
  }
}

/* =========================================================
   REBUILD ACCOUNT BALANCE
========================================================= */

export async function rebuildSavingsAccountBalance(
  savingsAccountId: string,
): Promise<number> {
  const {
    accounts,
    transactions,
  } =
    await getCollections();

  const accountObjectId =
    toObjectId(
      savingsAccountId,
      "savingsAccountId",
    );

  const client =
    await clientPromise;

  const session =
    client.startSession();

  try {
    let balance = 0;

    await session.withTransaction(
      async () => {
        await lockSavingsAccount(
          accounts,
          accountObjectId,
          session,
        );

        balance =
          await updateCachedBalance(
            accounts,
            transactions,
            accountObjectId,
            session,
          );
      },
    );

    return balance;
  } finally {
    await session.endSession();
  }
}