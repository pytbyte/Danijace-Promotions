"use client";

import {
  ArrowDownLeft,
  ArrowUpRight,
  FileEdit,
  RotateCcw,
  Smartphone,
  User,
  Wallet,
} from "lucide-react";

import type { SavingsTransaction } from "@/lib/savings/types";

/* =========================================================
   TYPES
========================================================= */

/**
 * Props accepted by the SavingsTable component.
 *
 * transactions:
 *   The savings ledger transactions to display.
 *
 * loading:
 *   Indicates whether transactions are currently being loaded.
 *
 * onAdjust:
 *   Creates a new adjustment ledger entry.
 *   It does NOT modify the original transaction.
 *
 * onReverse:
 *   Creates a new reversal ledger entry.
 *   It does NOT delete or modify the original transaction.
 */
type SavingsTableProps = {
  transactions: SavingsTransaction[];

  loading?: boolean;

  onAdjust?: (
    transaction: SavingsTransaction
  ) => void;

  onReverse?: (
    transaction: SavingsTransaction
  ) => void;
};

/* =========================================================
   FORMATTERS
========================================================= */

/**
 * Format an amount as Kenyan Shillings.
 *
 * Defensive handling is important here because financial
 * values should never result in "NaN" being displayed.
 */
function formatKES(
  amount: number
): string {
  if (
    typeof amount !== "number" ||
    !Number.isFinite(amount)
  ) {
    return "KES 0.00";
  }

  return new Intl.NumberFormat(
    "en-KE",
    {
      style: "currency",
      currency: "KES",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }
  ).format(amount);
}

/**
 * Format a transaction date.
 *
 * If the supplied value is invalid, we show a safe fallback
 * instead of allowing an invalid date to break the UI.
 */
function formatDate(
  value: string
): string {
  if (
    typeof value !== "string" ||
    !value.trim()
  ) {
    return "Unknown date";
  }

  const date =
    new Date(value);

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return "Unknown date";
  }

  return new Intl.DateTimeFormat(
    "en-KE",
    {
      dateStyle: "medium",
      timeStyle: "short",
    }
  ).format(date);
}

/* =========================================================
   LABELS
========================================================= */

/**
 * Convert the internal transaction type into a
 * human-readable label.
 */
function getTypeLabel(
  type: SavingsTransaction["type"]
): string {
  switch (type) {
    case "deposit":
      return "Deposit";

    case "adjustment":
      return "Adjustment";

    case "reversal":
      return "Reversal";

    default:
      return "Transaction";
  }
}

/**
 * Convert the internal source value into a
 * human-readable label.
 */
function getSourceLabel(
  source: SavingsTransaction["source"]
): string {
  switch (source) {
    case "sms":
      return "SMS";

    case "manual":
      return "Manual";

    case "system":
      return "System";

    default:
      return "Unknown";
  }
}

/* =========================================================
   ICONS
========================================================= */

/**
 * Return the appropriate icon for a transaction type.
 */
function getTypeIcon(
  type: SavingsTransaction["type"]
) {
  switch (type) {
    case "deposit":
      return (
        <ArrowDownLeft
          size={16}
          strokeWidth={1.8}
        />
      );

    case "adjustment":
      return (
        <FileEdit
          size={16}
          strokeWidth={1.8}
        />
      );

    case "reversal":
      return (
        <RotateCcw
          size={16}
          strokeWidth={1.8}
        />
      );

    default:
      return (
        <Wallet
          size={16}
          strokeWidth={1.8}
        />
      );
  }
}

/**
 * Return the appropriate icon for the transaction source.
 */
function getSourceIcon(
  source: SavingsTransaction["source"]
) {
  switch (source) {
    case "sms":
      return (
        <Smartphone
          size={13}
          strokeWidth={1.8}
        />
      );

    case "manual":
      return (
        <User
          size={13}
          strokeWidth={1.8}
        />
      );

    case "system":
      return (
        <Wallet
          size={13}
          strokeWidth={1.8}
        />
      );

    default:
      return (
        <User
          size={13}
          strokeWidth={1.8}
        />
      );
  }
}

/* =========================================================
   STATUS BADGE
========================================================= */

/**
 * Displays the current transaction status.
 *
 * Financial records are treated as immutable.
 * A reversal is represented by another ledger entry rather
 * than modifying the original transaction.
 */
function StatusBadge({
  status,
}: {
  status: SavingsTransaction["status"];
}) {
  const className =
    status === "confirmed"
      ? "bg-emerald-50 text-emerald-600"
      : status === "pending"
        ? "bg-yellow-50 text-yellow-600"
        : "bg-red-50 text-red-600";

  const label =
    status === "confirmed"
      ? "Confirmed"
      : status === "pending"
        ? "Pending"
        : "Reversed";

  return (
    <span
      className={`
        inline-flex
        items-center
        rounded-full
        px-2
        py-1
        text-[10px]
        font-medium
        ${className}
      `}
    >
      {label}
    </span>
  );
}

/* =========================================================
   ACTION RULES
========================================================= */

/**
 * Financial records are immutable.
 *
 * These actions DO NOT edit or delete the existing record.
 * They create a new adjustment/reversal ledger entry.
 *
 * Only confirmed deposits can currently be directly
 * adjusted or reversed.
 */
function isAdjustable(
  transaction: SavingsTransaction
): boolean {
  return (
    transaction.type === "deposit" &&
    transaction.status === "confirmed"
  );
}

/**
 * Determine whether a transaction can be reversed.
 *
 * At the moment, only confirmed deposits are reversible.
 */
function isReversible(
  transaction: SavingsTransaction
): boolean {
  return (
    transaction.type === "deposit" &&
    transaction.status === "confirmed"
  );
}

/* =========================================================
   LOADING ROWS
========================================================= */

/**
 * Loading state for the transaction body.
 *
 * We deliberately render FIVE rows because the table is
 * designed to display five entries at a time.
 */
function LoadingRows() {
  return (
    <>
      {Array.from(
        { length: 5 },
        (_, index) => (
          <tr key={index}>
            <td
              colSpan={8}
              className="px-4 py-4"
            >
              <div className="h-10 animate-pulse rounded-xl bg-slate-100" />
            </td>
          </tr>
        )
      )}
    </>
  );
}

/* =========================================================
   EMPTY STATE
========================================================= */

/**
 * Displayed when there are no transactions to show.
 */
function EmptyState() {
  return (
    <tr>
      <td
        colSpan={8}
        className="px-6 py-16 text-center"
      >
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-yellow-50 text-yellow-600">
          <Wallet
            size={21}
            strokeWidth={1.8}
          />
        </div>

        <p className="mt-4 text-sm font-medium text-black/70">
          No savings transactions found
        </p>

        <p className="mt-1 text-xs text-black/40">
          Transactions matching the current
          filters will appear here.
        </p>
      </td>
    </tr>
  );
}

/* =========================================================
   TRANSACTION ROW
========================================================= */

/**
 * Represents one immutable savings ledger transaction.
 */
function TransactionRow({
  transaction,
  onAdjust,
  onReverse,
}: {
  transaction: SavingsTransaction;

  onAdjust?: (
    transaction: SavingsTransaction
  ) => void;

  onReverse?: (
    transaction: SavingsTransaction
  ) => void;
}) {
  /**
   * Normalize the amount before performing any
   * financial comparison.
   */
  const amount =
    Number(
      transaction.amount
    );

  /**
   * Positive transactions are displayed as credits.
   */
  const positive =
    Number.isFinite(amount) &&
    amount > 0;

  /**
   * Determine whether the Adjust button should be shown.
   */
  const adjustable =
    isAdjustable(
      transaction
    ) &&
    Boolean(onAdjust);

  /**
   * Determine whether the Reverse button should be shown.
   */
  const reversible =
    isReversible(
      transaction
    ) &&
    Boolean(onReverse);

  return (
    <tr
      className="
        border-b
        border-slate-100
        transition
        last:border-b-0
        hover:bg-slate-50
      "
    >

      {/* =====================================================
          TRANSACTION
      ===================================================== */}

      <td className="px-4 py-4">
        <div className="flex items-center gap-3">

          <div
            className={`
              flex
              h-9
              w-9
              shrink-0
              items-center
              justify-center
              rounded-xl
              ${
                positive
                  ? "bg-emerald-50 text-emerald-600"
                  : "bg-red-50 text-red-600"
              }
            `}
          >
            {getTypeIcon(
              transaction.type
            )}
          </div>

          <div className="min-w-0">

            <p className="text-xs font-medium text-black">
              {getTypeLabel(
                transaction.type
              )}
            </p>

            <p className="mt-0.5 max-w-[180px] truncate text-[10px] text-black/40">
              ID:{" "}
              <span className="font-mono">
                {transaction.id}
              </span>
            </p>

          </div>
        </div>
      </td>

      {/* =====================================================
          MEMBER
      ===================================================== */}

      <td className="max-w-[180px] px-4 py-4">

        <p className="truncate text-xs font-medium text-black/70">
          {transaction.memberName ||
            "Unknown member"}
        </p>

        <p className="mt-0.5 truncate font-mono text-[10px] text-black/35">
          {transaction.memberId}
        </p>

      </td>

      {/* =====================================================
          AMOUNT
      ===================================================== */}

      <td className="px-4 py-4">

        <span
          className={`
            whitespace-nowrap
            text-xs
            font-semibold
            ${
              positive
                ? "text-emerald-600"
                : "text-red-600"
            }
          `}
        >
          {positive
            ? "+"
            : ""}

          {formatKES(
            amount
          )}
        </span>

      </td>

      {/* =====================================================
          SOURCE
      ===================================================== */}

      <td className="px-4 py-4">

        <div className="inline-flex items-center gap-1.5 text-xs text-black/50">

          {getSourceIcon(
            transaction.source
          )}

          <span>
            {getSourceLabel(
              transaction.source
            )}
          </span>

        </div>

      </td>

      {/* =====================================================
          REFERENCE
      ===================================================== */}

      <td className="max-w-[180px] px-4 py-4">

        {transaction.reference ? (

          <div>

            <p className="truncate font-mono text-[10px] text-black/55">
              {transaction.reference}
            </p>

            {transaction.sourceReference && (
              <p className="mt-1 truncate font-mono text-[9px] text-black/35">
                {transaction.sourceReference}
              </p>
            )}

          </div>

        ) : (

          <span className="text-xs text-black/20">
            —
          </span>

        )}

      </td>

      {/* =====================================================
          STATUS
      ===================================================== */}

      <td className="px-4 py-4">

        <StatusBadge
          status={
            transaction.status
          }
        />

      </td>

      {/* =====================================================
          DATE
      ===================================================== */}

      <td className="whitespace-nowrap px-4 py-4">

        <p className="text-xs text-black/50">
          {formatDate(
            transaction.transactionAt
          )}
        </p>

        {transaction.relatedTransactionId && (
          <p className="mt-1 max-w-[150px] truncate font-mono text-[9px] text-black/35">
            Related:{" "}
            {transaction.relatedTransactionId}
          </p>
        )}

      </td>

      {/* =====================================================
          ACTIONS
      ===================================================== */}

      <td className="px-4 py-4">

        <div className="flex items-center justify-end gap-1">

          {/* -------------------------------------------------
              ADJUST
          ------------------------------------------------- */}

          {adjustable && (
            <button
              type="button"
              onClick={() =>
                onAdjust?.(
                  transaction
                )
              }
              className="
                inline-flex
                h-8
                items-center
                gap-1.5
                rounded-lg
                px-2.5
                text-[11px]
                font-medium
                text-black/50
                transition
                hover:bg-slate-100
                hover:text-black
                focus:outline-none
                focus:ring-1
                focus:ring-black/10
              "
              title="Create adjustment"
              aria-label={`Adjust transaction ${transaction.id}`}
            >
              <FileEdit
                size={13}
                strokeWidth={1.8}
              />

              <span>
                Adjust
              </span>
            </button>
          )}

          {/* -------------------------------------------------
              REVERSE
          ------------------------------------------------- */}

          {reversible && (
            <button
              type="button"
              onClick={() =>
                onReverse?.(
                  transaction
                )
              }
              className="
                inline-flex
                h-8
                items-center
                gap-1.5
                rounded-lg
                px-2.5
                text-[11px]
                font-medium
                text-red-600/70
                transition
                hover:bg-red-50
                hover:text-red-600
                focus:outline-none
                focus:ring-1
                focus:ring-red-500/20
              "
              title="Create reversal"
              aria-label={`Reverse transaction ${transaction.id}`}
            >
              <RotateCcw
                size={13}
                strokeWidth={1.8}
              />

              <span>
                Reverse
              </span>
            </button>
          )}

          {/* -------------------------------------------------
              NO ACTIONS
          ------------------------------------------------- */}

          {!adjustable &&
            !reversible && (
              <span className="px-2.5 text-xs text-black/20">
                —
              </span>
            )}

        </div>

      </td>

    </tr>
  );
}

/* =========================================================
   TABLE
========================================================= */

export default function SavingsTable({
  transactions,
  loading = false,
  onAdjust,
  onReverse,
}: SavingsTableProps) {

  /**
   * Defensive check.
   *
   * The component should never crash if a parent accidentally
   * passes undefined/null instead of an array.
   */
  const safeTransactions =
    Array.isArray(
      transactions
    )
      ? transactions
      : [];

  return (
    <section
      className="
        overflow-hidden
        rounded-2xl
        border
        border-slate-200
        bg-white
        shadow-sm
      "
    >

      {/* =====================================================
          SECTION HEADER
          
          This is completely independent from the table
          scrolling area.
      ===================================================== */}

      <div className="border-b border-slate-200 px-4 py-4 sm:px-5">

        <div className="flex items-center justify-between gap-3">

          <div>

            <h2 className="text-sm font-semibold text-black">
              Transactions
            </h2>

            <p className="mt-0.5 text-xs text-black/40">
              Immutable savings ledger
            </p>

          </div>

          {!loading && (
            <span className="text-xs text-black/40">

              {safeTransactions.length}{" "}

              {safeTransactions.length ===
              1
                ? "transaction"
                : "transactions"}

            </span>
          )}

        </div>

      </div>

      {/* =====================================================
          TABLE AREA

          IMPORTANT:

          The outer container handles HORIZONTAL scrolling.

          The inner body container handles VERTICAL scrolling.

          This means:
          
          1. The header never moves vertically.
          2. Only transaction rows scroll.
          3. Five rows are visible at a time.
          4. The table can still scroll horizontally on
             smaller screens.
      ===================================================== */}

      <div className="overflow-x-auto">

        {/* ---------------------------------------------------
            Keep the header and body the same minimum width.

            This preserves column alignment when the table is
            wider than the screen.
        --------------------------------------------------- */}

        <div className="min-w-[1050px]">

          {/* =================================================
              STATIC TABLE HEADER
              
              This table is NOT inside the vertical scroll
              container.
          ================================================= */}

          <table className="w-full border-collapse text-left">

            <thead>

              <tr className="border-b border-slate-200">

                <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-black/40">
                  Transaction
                </th>

                <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-black/40">
                  Member
                </th>

                <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-black/40">
                  Amount
                </th>

                <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-black/40">
                  Source
                </th>

                <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-black/40">
                  Reference
                </th>

                <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-black/40">
                  Status
                </th>

                <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-black/40">
                  Date
                </th>

                <th className="px-4 py-3 text-right text-[10px] font-semibold uppercase tracking-[0.14em] text-black/40">
                  Actions
                </th>

              </tr>

            </thead>

          </table>

          {/* =================================================
              SCROLLABLE TABLE BODY

              max-h-[280px] gives us approximately five
              transaction rows.

              overflow-y-auto means:

              - 1–5 records:
                    No vertical scrollbar needed.

              - 6+ records:
                    The body becomes vertically scrollable.

              The header above remains fixed.
          ================================================= */}

          <div className="max-h-[200px] overflow-y-auto">

            <table className="w-full border-collapse text-left">

              <tbody>

                {loading ? (

                  <LoadingRows />

                ) : safeTransactions.length ===
                  0 ? (

                  <EmptyState />

                ) : (

                  safeTransactions.map(
                    (transaction) => (
                      <TransactionRow
                        key={
                          transaction.id
                        }
                        transaction={
                          transaction
                        }
                        onAdjust={
                          onAdjust
                        }
                        onReverse={
                          onReverse
                        }
                      />
                    )
                  )

                )}

              </tbody>

            </table>

          </div>

        </div>

      </div>

    </section>
  );
}