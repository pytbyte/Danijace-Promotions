/**
 * GEO-SHUA
 * Member Financial Projection
 *
 * =========================================================
 * PURPOSE
 * =========================================================
 *
 * Read-only financial summary used by member-facing views.
 *
 * IMPORTANT:
 *
 * - This file does NOT mutate financial records.
 * - Savings transactions remain authoritative for savings
 *   ledger calculations.
 * - Loan records remain authoritative for current loan
 *   projections.
 * - No financial calculation is performed in React.
 * - MongoDB ObjectId/string normalization happens at the
 *   persistence boundary.
 *
 * =========================================================
 * OUTPUT
 * =========================================================
 *
 * For each requested member:
 *
 * {
 *   savingsBalance,
 *   totalDeposits,
 *   totalWithdrawals,
 *   loan?
 * }
 *
 * =========================================================
 */

import { ObjectId } from "mongodb";

import clientPromise from "@/lib/mongodb";

import type {
  MemberFinancialSummary,
  MemberLoanSummary,
} from "@/lib/members/financial-types";

/* =========================================================
   CONSTANTS
========================================================= */

const DB_NAME =
  process.env.MONGODB_DB || "geo-shua";

const SAVINGS_ACCOUNTS_COLLECTION =
  "savingsAccounts";

const SAVINGS_TRANSACTIONS_COLLECTION =
  "savings_transactions";

const LOANS_COLLECTION =
  "loans";

/* =========================================================
   INTERNAL DOCUMENT TYPES
========================================================= */

type SavingsAccountDocument = {
  _id?: ObjectId;

  /**
   * New records should use ObjectId.
   *
   * The financial projection also tolerates string member IDs
   * because historical data may have been written before the
   * persistence boundary was standardized.
   */
  memberId: ObjectId | string;

  accountNumber: string;

  accountType: "fixed";

  balance: number;

  status: "active" | "inactive";
};

type SavingsTransactionDocument = {
  _id?: ObjectId;

  savingsAccountId:
    | ObjectId
    | string;

  memberId:
    | ObjectId
    | string;

  memberName: string;

  amount: number;

  type:
    | "deposit"
    | "adjustment"
    | "reversal";

  source:
    | "sms"
    | "manual"
    | "system";

  status:
    | "pending"
    | "confirmed"
    | "reversed";

  transactionAt: string | Date;

  createdAt: string | Date;
};

type LoanDocument = {
  _id?: ObjectId;

  loanNumber: string;

  memberId: ObjectId | string;

  memberNumber: string;

  memberName: string;

  type:
    | "emergency"
    | "regular";

  principal: number;

  totalDue: number;

  amountPaid: number;

  totalFines: number;

  outstandingBalance: number;

  firstDueDate: string | Date;

  fineStatus:
    | "active"
    | "stopped";

  status:
    | "pending"
    | "active"
    | "completed"
    | "cancelled";

  updatedAt: string | Date;

  createdAt: string | Date;
};

/* =========================================================
   HELPERS
========================================================= */

function toObjectId(
  value: string,
): ObjectId | null {
  if (!ObjectId.isValid(value)) {
    return null;
  }

  return new ObjectId(value);
}

function toFiniteNumber(
  value: unknown,
): number {
  if (
    typeof value === "number" &&
    Number.isFinite(value)
  ) {
    return value;
  }

  /**
   * Be defensive about historical MongoDB records where
   * numeric values may have been persisted as strings.
   */
  if (typeof value === "string") {
    const parsed = Number(value);

    return Number.isFinite(parsed)
      ? parsed
      : 0;
  }

  return 0;
}

function toIsoString(
  value: string | Date,
): string {
  const date =
    value instanceof Date
      ? value
      : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toISOString();
}

function money(
  value: number,
): number {
  return Math.round(
    (value + Number.EPSILON) * 100,
  ) / 100;
}

/**
 * Normalize either an ObjectId or a string member ID into
 * the public string representation used by the application.
 */
function normalizeMemberId(
  value: ObjectId | string,
): string {
  return value instanceof ObjectId
    ? value.toString()
    : String(value);
}

/* =========================================================
   DATABASE
========================================================= */

async function getCollections() {
  const client = await clientPromise;

  const db = client.db(DB_NAME);

  return {
    savingsAccounts:
      db.collection<SavingsAccountDocument>(
        SAVINGS_ACCOUNTS_COLLECTION,
      ),

    savingsTransactions:
      db.collection<SavingsTransactionDocument>(
        SAVINGS_TRANSACTIONS_COLLECTION,
      ),

    loans:
      db.collection<LoanDocument>(
        LOANS_COLLECTION,
      ),
  };
}

/* =========================================================
   EMPTY SUMMARY
========================================================= */

function emptyFinancialSummary():
  MemberFinancialSummary {
  return {
    savingsBalance: 0,
    totalDeposits: 0,
    totalWithdrawals: 0,
  };
}

/* =========================================================
   MEMBER FINANCIAL SUMMARIES
========================================================= */

/**
 * Get financial summaries for multiple members.
 *
 * This function is intentionally batch-oriented.
 *
 * If the member page contains 25 members, we do NOT make
 * 25 savings queries + 25 loan queries.
 *
 * Instead:
 *
 *   members
 *      ↓
 *   one savings aggregation
 *      ↓
 *   one loan query
 *      ↓
 *   merge in memory
 *
 * Financial records are never modified.
 */
export async function getMemberFinancialSummaries(
  memberIds: string[],
): Promise<
  Record<string, MemberFinancialSummary>
> {
  const uniqueIds = [
    ...new Set(
      memberIds
        .filter(
          (id): id is string =>
            typeof id === "string" &&
            id.trim().length > 0,
        )
        .map((id) => id.trim()),
    ),
  ];

  if (uniqueIds.length === 0) {
    return {};
  }

  const objectIds = uniqueIds
    .map(toObjectId)
    .filter(
      (id): id is ObjectId =>
        id !== null,
    );

  const {
    savingsTransactions,
    loans,
  } = await getCollections();

  /* =======================================================
     INITIAL RESULT
  ======================================================= */

  const summaries: Record<
    string,
    MemberFinancialSummary
  > = {};

  for (const memberId of uniqueIds) {
    summaries[memberId] =
      emptyFinancialSummary();
  }

  /* =======================================================
     SAVINGS LEDGER
  ======================================================= */

  /**
   * IMPORTANT:
   *
   * We support both:
   *
   *   memberId: ObjectId(...)
   *
   * and legacy:
   *
   *   memberId: "..."
   *
   * records.
   *
   * New records should always use ObjectId, but this prevents
   * existing valid savings history from disappearing from
   * financial projections because of an old storage format.
   */

  const memberIdMatch: Record<
    string,
    unknown
  >[] = [];

  if (objectIds.length > 0) {
    memberIdMatch.push({
      memberId: {
        $in: objectIds,
      },
    });
  }

  memberIdMatch.push({
    memberId: {
      $in: uniqueIds,
    },
  });

  /**
   * Only confirmed ledger entries affect the balance.
   *
   * Pending:
   *   ignored
   *
   * Reversed original transaction:
   *   ignored because its status is "reversed"
   *
   * Confirmed reversal transaction:
   *   included because it is an actual compensating
   *   ledger entry.
   *
   * The amount itself is authoritative and remains signed.
   */
  const savingsTotals =
    await savingsTransactions
      .aggregate<{
        _id: string;

        balance: number;

        totalDeposits: number;

        totalWithdrawals: number;
      }>([
        {
          $match: {
            $and: [
              {
                $or: memberIdMatch,
              },

              {
                status: "confirmed",
              },
            ],
          },
        },

        /**
         * Normalize ObjectId and string member IDs into the
         * same string key.
         *
         * ObjectId:
         *
         *   ObjectId("abc...")
         *
         * becomes:
         *
         *   "abc..."
         */
        {
          $group: {
            _id: {
              $toString: "$memberId",
            },

            /**
             * Authoritative savings balance.
             *
             * Positive deposits increase the balance.
             * Negative adjustments/reversals reduce it.
             */
            balance: {
              $sum: {
                $convert: {
                  input: "$amount",
                  to: "double",
                  onError: 0,
                  onNull: 0,
                },
              },
            },

            /**
             * Only positive deposit transactions are counted
             * as deposits.
             */
            totalDeposits: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $eq: [
                          "$type",
                          "deposit",
                        ],
                      },

                      {
                        $gt: [
                          {
                            $convert: {
                              input:
                                "$amount",
                              to: "double",
                              onError: 0,
                              onNull: 0,
                            },
                          },
                          0,
                        ],
                      },
                    ],
                  },

                  {
                    $convert: {
                      input: "$amount",
                      to: "double",
                      onError: 0,
                      onNull: 0,
                    },
                  },

                  0,
                ],
              },
            },

            /**
             * Savings does not have a dedicated withdrawal
             * transaction type.
             *
             * Negative confirmed ledger movements are therefore
             * exposed as positive outflows.
             */
            totalWithdrawals: {
              $sum: {
                $cond: [
                  {
                    $lt: [
                      {
                        $convert: {
                          input: "$amount",
                          to: "double",
                          onError: 0,
                          onNull: 0,
                        },
                      },
                      0,
                    ],
                  },

                  {
                    $multiply: [
                      {
                        $convert: {
                          input: "$amount",
                          to: "double",
                          onError: 0,
                          onNull: 0,
                        },
                      },
                      -1,
                    ],
                  },

                  0,
                ],
              },
            },
          },
        },
      ])
      .toArray();

  /* =======================================================
     APPLY SAVINGS TOTALS
  ======================================================= */

  for (const row of savingsTotals) {
    const memberId =
      String(row._id);

    if (!summaries[memberId]) {
      continue;
    }

    summaries[memberId] = {
      ...summaries[memberId],

      savingsBalance: money(
        toFiniteNumber(
          row.balance,
        ),
      ),

      totalDeposits: money(
        toFiniteNumber(
          row.totalDeposits,
        ),
      ),

      totalWithdrawals: money(
        toFiniteNumber(
          row.totalWithdrawals,
        ),
      ),
    };
  }

  /* =======================================================
     LOANS
  ======================================================= */

  /**
   * We only need the member's currently relevant loan
   * for the compact member directory card.
   *
   * Open loans:
   *
   *   active
   *   pending
   *
   * Completed/cancelled loans are not presented as the
   * current loan.
   */

  const loanMemberMatch: Record<
    string,
    unknown
  >[] = [];

  if (objectIds.length > 0) {
    loanMemberMatch.push({
      memberId: {
        $in: objectIds,
      },
    });
  }

  loanMemberMatch.push({
    memberId: {
      $in: uniqueIds,
    },
  });

  const openLoans =
    await loans
      .find(
        {
          $and: [
            {
              $or: loanMemberMatch,
            },

            {
              status: {
                $in: [
                  "pending",
                  "active",
                ],
              },
            },
          ],
        },

        {
          projection: {
            loanNumber: 1,
            memberId: 1,
            memberNumber: 1,
            memberName: 1,
            type: 1,
            principal: 1,
            totalDue: 1,
            amountPaid: 1,
            totalFines: 1,
            outstandingBalance: 1,
            firstDueDate: 1,
            fineStatus: 1,
            status: 1,
            updatedAt: 1,
            createdAt: 1,
          },
        },
      )
      .sort({
        createdAt: -1,
        _id: -1,
      })
      .toArray();

  /* =======================================================
     SELECT CURRENT LOAN
  ======================================================= */

  /**
   * The loan service normally prevents multiple open loans.
   *
   * We still protect the projection against historical or
   * corrupted data by keeping the newest open loan per member.
   */
  const selectedLoans =
    new Map<
      string,
      LoanDocument
    >();

  for (const loan of openLoans) {
    const memberId =
      normalizeMemberId(
        loan.memberId,
      );

    if (
      !selectedLoans.has(memberId)
    ) {
      selectedLoans.set(
        memberId,
        loan,
      );
    }
  }

  /* =======================================================
     APPLY LOAN TOTALS
  ======================================================= */

  for (
    const [
      memberId,
      loan,
    ] of selectedLoans
  ) {
    if (!summaries[memberId]) {
      continue;
    }

    const loanSummary:
      MemberLoanSummary = {
      loanNumber:
        loan.loanNumber,

      status:
        loan.status,

      principal: money(
        toFiniteNumber(
          loan.principal,
        ),
      ),

      totalDue: money(
        toFiniteNumber(
          loan.totalDue,
        ),
      ),

      amountPaid: money(
        toFiniteNumber(
          loan.amountPaid,
        ),
      ),

      totalFines: money(
        toFiniteNumber(
          loan.totalFines,
        ),
      ),

      outstandingBalance: money(
        Math.max(
          0,
          toFiniteNumber(
            loan.outstandingBalance,
          ),
        ),
      ),

      firstDueDate:
        toIsoString(
          loan.firstDueDate,
        ),

      fineStatus:
        loan.fineStatus,
    };

    summaries[memberId] = {
      ...summaries[memberId],
      loan: loanSummary,
    };
  }

  return summaries;
}

/* =========================================================
   SINGLE MEMBER
========================================================= */

/**
 * Convenience wrapper for a single member.
 *
 * Useful for member profile pages.
 */
export async function getMemberFinancialSummary(
  memberId: string,
): Promise<MemberFinancialSummary> {
  const summaries =
    await getMemberFinancialSummaries([
      memberId,
    ]);

  return (
    summaries[memberId] ??
    emptyFinancialSummary()
  );
}

/* =========================================================
   ACTIVE SAVINGS ACCOUNT
========================================================= */

/**
 * Get the member's active fixed savings account.
 *
 * This is intentionally separate from the ledger balance.
 *
 * savingsAccounts.balance is a cached projection.
 *
 * The financial summary above calculates the authoritative
 * balance from the transaction ledger.
 */
export async function getMemberSavingsAccount(
  memberId: string,
) {
  const objectId =
    toObjectId(memberId);

  if (!objectId) {
    return null;
  }

  const {
    savingsAccounts,
  } = await getCollections();

  const account =
    await savingsAccounts.findOne(
      {
        $or: [
          {
            memberId: objectId,
          },
          {
            memberId: memberId,
          },
        ],

        accountType: "fixed",

        status: "active",
      },
      {
        projection: {
          _id: 1,
          memberId: 1,
          accountNumber: 1,
          accountType: 1,
          balance: 1,
          status: 1,
        },
      },
    );

  if (!account) {
    return null;
  }

  return {
    id:
      account._id?.toString() ?? "",

    memberId:
      normalizeMemberId(
        account.memberId,
      ),

    accountNumber:
      account.accountNumber,

    accountType:
      account.accountType,

    balance: money(
      toFiniteNumber(
        account.balance,
      ),
    ),

    status:
      account.status,
  };
}