/**
 * =========================================================
 * GEO-SHUA
 * SAVINGS SUMMARY API
 * =========================================================
 *
 * GET /api/savings/summary
 *
 * Production financial dashboard summary.
 *
 * IMPORTANT:
 * ---------------------------------------------------------
 * - Savings has NO saccoId.
 * - savings_transactions is the authoritative ledger.
 * - savingsAccounts.balance is only a cache.
 * - Pending transactions do NOT affect financial totals.
 * - Reversal transactions are stored as negative amounts.
 * - Original reversed deposits are excluded from the
 *   deposit total because the reversal offsets them.
 * - Adjustments are signed ledger deltas.
 * - No financial records are modified or deleted here.
 *
 * =========================================================
 */

import {
  NextResponse,
} from "next/server";

import clientPromise from "@/lib/mongodb";

import {
  getSavingsAccount,
} from "@/lib/savings/service";

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

/* =========================================================
   RESPONSE TYPES
========================================================= */

type SavingsSummary = {
  totalBalance: number;
  totalDeposits: number;
  totalAdjustments: number;
  totalReversals: number;
  memberCount: number;
};

/* =========================================================
   SAFE NUMBER
========================================================= */

function safeNumber(
  value: unknown
): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value)
  ) {
    return 0;
  }

  return value;
}

/* =========================================================
   GET
========================================================= */

export async function GET(): Promise<
  NextResponse
> {
  try {
    const client =
      await clientPromise;

    const db =
      client.db(DB_NAME);

    const accounts =
      db.collection(
        ACCOUNT_COLLECTION
      );

    const transactions =
      db.collection(
        TRANSACTION_COLLECTION
      );

    /*
     * =====================================================
     * AUTHORITATIVE LEDGER SUMMARY
     * =====================================================
     *
     * Only confirmed financial transactions participate.
     *
     * Pending transactions are deliberately excluded.
     *
     * A reversal is a negative transaction and therefore
     * naturally reduces the total balance.
     */
    const result =
      await transactions
        .aggregate<{
          _id: null;
          totalBalance: number;
          totalDeposits: number;
          totalAdjustments: number;
          totalReversals: number;
        }>([
          {
            $match: {
              status: {
                $ne: "pending",
              },
            },
          },

          {
            $group: {
              _id: null,

              /*
               * Complete authoritative balance.
               *
               * Deposits:
               *   +amount
               *
               * Adjustments:
               *   signed amount
               *
               * Reversals:
               *   -original amount
               */
              totalBalance: {
                $sum: "$amount",
              },

              /*
               * Deposit total represents confirmed
               * deposit entries still contributing to the
               * ledger.
               *
               * When a deposit has been reversed, the
               * original deposit is marked "reversed".
               *
               * Therefore it is excluded here.
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
                          $eq: [
                            "$status",
                            "confirmed",
                          ],
                        },
                      ],
                    },
                    "$amount",
                    0,
                  ],
                },
              },

              /*
               * Adjustments are signed ledger deltas.
               */
              totalAdjustments: {
                $sum: {
                  $cond: [
                    {
                      $and: [
                        {
                          $eq: [
                            "$type",
                            "adjustment",
                          ],
                        },
                        {
                          $eq: [
                            "$status",
                            "confirmed",
                          ],
                        },
                      ],
                    },
                    "$amount",
                    0,
                  ],
                },
              },

              /*
               * Reversal transactions are stored as negative
               * amounts.
               *
               * The dashboard displays reversal activity as
               * a positive monetary value.
               */
              totalReversals: {
                $sum: {
                  $cond: [
                    {
                      $and: [
                        {
                          $eq: [
                            "$type",
                            "reversal",
                          ],
                        },
                        {
                          $eq: [
                            "$status",
                            "confirmed",
                          ],
                        },
                      ],
                    },
                    {
                      $abs: "$amount",
                    },
                    0,
                  ],
                },
              },
            },
          },
        ])
        .toArray();

    const ledger =
      result[0];

    /* =====================================================
       MEMBER COUNT
    ===================================================== */

    /*
     * One savings account belongs to exactly one member.
     *
     * We therefore count active savings accounts rather
     * than counting transactions.
     *
     * This prevents a member with 20 deposits from being
     * counted 20 times.
     */
    const memberCount =
      await accounts.countDocuments({
        $or: [
          {
            isActive: true,
          },
          {
            isActive: {
              $exists: false,
            },
            status: "active",
          },
        ],
      });

    const summary:
      SavingsSummary = {
      totalBalance:
        safeNumber(
          ledger?.totalBalance
        ),

      totalDeposits:
        safeNumber(
          ledger?.totalDeposits
        ),

      totalAdjustments:
        safeNumber(
          ledger?.totalAdjustments
        ),

      totalReversals:
        safeNumber(
          ledger?.totalReversals
        ),

      memberCount:
        Math.max(
          0,
          Math.floor(
            memberCount
          )
        ),
    };

    return NextResponse.json(
      {
        success: true,
        data: summary,
      },
      {
        status: 200,

        headers: {
          /*
           * The dashboard must always see current database
           * information.
           */
          "Cache-Control":
            "no-store, no-cache, must-revalidate, proxy-revalidate",
        },
      }
    );
  } catch (error) {
    console.error(
      "[GET /api/savings/summary]",
      error
    );

    return NextResponse.json(
      {
        success: false,
        error:
          "Failed to load savings summary.",
      },
      {
        status: 500,

        headers: {
          "Cache-Control":
            "no-store",
        },
      }
    );
  }
}