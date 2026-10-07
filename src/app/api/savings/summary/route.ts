/**
 * =========================================================
 * DANIJACE PROMOTIONS
 * SAVINGS SUMMARY API
 * =========================================================
 *
 * GET /api/savings/summary
 *
 * Production financial dashboard summary.
 *
 * FINANCIAL MODEL
 * ---------------------------------------------------------
 *
 * Deposit:
 *   Positive ledger entry.
 *
 * Adjustment:
 *   Withdrawal/correction.
 *   Public amount is positive.
 *   Stored amount SHOULD be negative.
 *
 * Reversal:
 *   Cancellation of a deposit.
 *   Stored amount SHOULD be negative.
 *
 * Dashboard:
 *
 *   Gross Deposits
 *        -
 *   Withdrawals / Adjustments
 *        -
 *   Reversals
 *        =
 *   Current Balance
 *
 * IMPORTANT
 * ---------------------------------------------------------
 *
 * 1. Savings has NO saccoId.
 * 2. savings_transactions is authoritative.
 * 3. savingsAccounts.balance is only a cache.
 * 4. Pending transactions do NOT affect totals.
 * 5. Original transaction amounts are never changed.
 * 6. Reversals are separate ledger transactions.
 * 7. Adjustments are separate ledger transactions.
 * 8. Dashboard deduction values are positive magnitudes.
 * 9. Legacy positive adjustment/reversal records are handled
 *    safely using $abs.
 * 10. Balance is reconstructed from financial categories.
 * 11. Reversed deposits remain part of gross deposits.
 *
 * =========================================================
 */

import { NextResponse } from "next/server";

import clientPromise from "@/lib/mongodb";

/* =========================================================
   CONSTANTS
========================================================= */

const DB_NAME =
  process.env.MONGODB_DB ||
  "danijace-promotions";

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
   AGGREGATION RESULT
========================================================= */

type LedgerSummary = {
  _id: null;

  /*
   * Gross deposits.
   *
   * Always exposed as a positive magnitude.
   */
  totalDeposits: number;

  /*
   * Withdrawals / adjustments.
   *
   * Always exposed as a positive magnitude.
   */
  totalAdjustments: number;

  /*
   * Reversals.
   *
   * Always exposed as a positive magnitude.
   */
  totalReversals: number;
};

/* =========================================================
   SAFE NUMBER
========================================================= */

function safeNumber(
  value: unknown,
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
    /* =====================================================
       DATABASE
    ===================================================== */

    const client =
      await clientPromise;

    const db =
      client.db(DB_NAME);

    const accounts =
      db.collection(
        ACCOUNT_COLLECTION,
      );

    const transactions =
      db.collection(
        TRANSACTION_COLLECTION,
      );

    /* =====================================================
       AUTHORITATIVE LEDGER SUMMARY
    ===================================================== */

    const result =
      await transactions
        .aggregate<LedgerSummary>([
          /* -------------------------------------------------
             ONLY FINANCIAL TRANSACTIONS
          ------------------------------------------------- */

          /*
           * Pending transactions must never affect the
           * dashboard.
           *
           * We intentionally include every non-pending
           * status here, including:
           *
           *   confirmed
           *   reversed
           *
           * because reversed deposits remain part of gross
           * deposits and are cancelled by their separate
           * reversal transaction.
           */
          {
            $match: {
              status: {
                $ne: "pending",
              },
            },
          },

          /* -------------------------------------------------
             GROUP FINANCIAL CATEGORIES
          ------------------------------------------------- */

          {
            $group: {
              _id: null,

              /* =============================================
                 GROSS DEPOSITS
              ============================================= */

              totalDeposits: {
                $sum: {
                  $cond: [
                    {
                      $eq: [
                        "$type",
                        "deposit",
                      ],
                    },

                    /*
                     * Deposits should be positive.
                     *
                     * $abs also protects the dashboard from
                     * malformed legacy negative deposits.
                     */
                    {
                      $abs: "$amount",
                    },

                    0,
                  ],
                },
              },

              /* =============================================
                 WITHDRAWALS / ADJUSTMENTS
              ============================================= */

              totalAdjustments: {
                $sum: {
                  $cond: [
                    {
                      $eq: [
                        "$type",
                        "adjustment",
                      ],
                    },

                    /*
                     * Adjustments are deductions regardless of
                     * whether an old record stored the amount
                     * as positive or negative.
                     *
                     * Therefore the dashboard uses magnitude.
                     */
                    {
                      $abs: "$amount",
                    },

                    0,
                  ],
                },
              },

              /* =============================================
                 REVERSALS
              ============================================= */

              totalReversals: {
                $sum: {
                  $cond: [
                    {
                      $eq: [
                        "$type",
                        "reversal",
                      ],
                    },

                    /*
                     * Reversals are deductions regardless of
                     * the historical sign of the stored amount.
                     */
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
       NORMALIZE FINANCIAL VALUES
    ===================================================== */

    const totalDeposits =
      safeNumber(
        ledger?.totalDeposits,
      );

    const totalAdjustments =
      safeNumber(
        ledger?.totalAdjustments,
      );

    const totalReversals =
      safeNumber(
        ledger?.totalReversals,
      );

    /* =====================================================
       AUTHORITATIVE DASHBOARD BALANCE
    ===================================================== */

    /*
     * Financial formula:
     *
     *   Deposits
     *      -
     *   Withdrawals
     *      -
     *   Reversals
     *      =
     *   Current Balance
     *
     * This deliberately does NOT use:
     *
     *   $sum: "$amount"
     *
     * because historical records may contain adjustments or
     * reversals with inconsistent signs.
     *
     * The transaction TYPE determines the financial meaning.
     */

    const totalBalance =
      totalDeposits -
      totalAdjustments -
      totalReversals;

    /* =====================================================
       MEMBER COUNT
    ===================================================== */

    /*
     * One active savings account represents one member.
     *
     * Supports:
     *
     *   Modern:
     *     isActive: true
     *
     *   Legacy:
     *     status: "active"
     *
     * We deliberately avoid counting transactions because
     * one member can have many transactions.
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

    /* =====================================================
       FINAL SUMMARY
    ===================================================== */

    const summary: SavingsSummary = {
      totalBalance:
        safeNumber(
          totalBalance,
        ),

      totalDeposits:
        totalDeposits,

      totalAdjustments:
        totalAdjustments,

      totalReversals:
        totalReversals,

      memberCount:
        Math.max(
          0,
          Math.floor(
            memberCount,
          ),
        ),
    };

    /* =====================================================
       RESPONSE
    ===================================================== */

    return NextResponse.json(
      {
        success: true,
        data: summary,
      },
      {
        status: 200,
        headers: {
          "Cache-Control":
            "no-store, no-cache, must-revalidate, proxy-revalidate",
        },
      },
    );
  } catch (error) {
    console.error(
      "[GET /api/savings/summary]",
      error,
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
      },
    );
  }
}