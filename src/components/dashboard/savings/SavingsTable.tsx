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

function StatusBadge({
  status,
}: {
  status: SavingsTransaction["status"];
}) {
  const className =
    status === "confirmed"
      ? "bg-emerald-500/10 text-emerald-400"
      : status === "pending"
        ? "bg-yellow-500/10 text-yellow-400"
        : "bg-red-500/10 text-red-400";

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
 * These actions DO NOT edit/delete the existing record.
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

function isReversible(
  transaction: SavingsTransaction
): boolean {
  return (
    transaction.type === "deposit" &&
    transaction.status === "confirmed"
  );
}

/* =========================================================
   LOADING
========================================================= */

function LoadingRows() {
  return (
    <>
      {Array.from(
        { length: 6 },
        (_, index) => (
          <tr key={index}>
            <td
              colSpan={8}
              className="px-4 py-4"
            >
              <div className="h-10 animate-pulse rounded-xl bg-white/[0.04]" />
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

function EmptyState() {
  return (
    <tr>
      <td
        colSpan={8}
        className="px-6 py-16 text-center"
      >
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-yellow-500/10 text-yellow-400">
          <Wallet
            size={21}
            strokeWidth={1.8}
          />
        </div>

        <p className="mt-4 text-sm font-medium text-white/60">
          No savings transactions found
        </p>

        <p className="mt-1 text-xs text-white/25">
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
  const amount =
    Number(
      transaction.amount
    );

  const positive =
    Number.isFinite(amount) &&
    amount > 0;

  const adjustable =
    isAdjustable(
      transaction
    ) &&
    Boolean(onAdjust);

  const reversible =
    isReversible(
      transaction
    ) &&
    Boolean(onReverse);

  return (
    <tr
      className="
        border-b
        border-white/[0.04]
        transition
        last:border-b-0
        hover:bg-white/[0.015]
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
                  ? "bg-emerald-500/10 text-emerald-400"
                  : "bg-red-500/10 text-red-400"
              }
            `}
          >
            {getTypeIcon(
              transaction.type
            )}
          </div>

          <div className="min-w-0">
            <p className="text-xs font-medium text-white">
              {getTypeLabel(
                transaction.type
              )}
            </p>

            <p className="mt-0.5 max-w-[180px] truncate text-[10px] text-white/25">
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
        <p className="truncate text-xs font-medium text-white/70">
          {transaction.memberName ||
            "Unknown member"}
        </p>

        <p className="mt-0.5 truncate font-mono text-[10px] text-white/20">
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
                ? "text-emerald-400"
                : "text-red-400"
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
        <div className="inline-flex items-center gap-1.5 text-xs text-white/50">
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
            <p className="truncate font-mono text-[10px] text-white/45">
              {transaction.reference}
            </p>

            {transaction.sourceReference && (
              <p className="mt-1 truncate font-mono text-[9px] text-white/20">
                {transaction.sourceReference}
              </p>
            )}
          </div>
        ) : (
          <span className="text-xs text-white/15">
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
        <p className="text-xs text-white/50">
          {formatDate(
            transaction.transactionAt
          )}
        </p>

        {transaction.relatedTransactionId && (
          <p className="mt-1 max-w-[150px] truncate font-mono text-[9px] text-white/20">
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
                text-white/40
                transition
                hover:bg-white/[0.05]
                hover:text-white
                focus:outline-none
                focus:ring-1
                focus:ring-white/20
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
                text-red-400/60
                transition
                hover:bg-red-500/[0.08]
                hover:text-red-400
                focus:outline-none
                focus:ring-1
                focus:ring-red-500/30
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

          {!adjustable &&
            !reversible && (
              <span className="px-2.5 text-xs text-white/10">
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
        border-white/[0.08]
        bg-[#0b0b0b]
      "
    >
      {/* =====================================================
          HEADER
      ===================================================== */}

      <div className="border-b border-white/[0.06] px-4 py-4 sm:px-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-white">
              Transactions
            </h2>

            <p className="mt-0.5 text-xs text-white/30">
              Immutable savings ledger
            </p>
          </div>

          {!loading && (
            <span className="text-xs text-white/25">
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
          TABLE
      ===================================================== */}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[1050px] border-collapse text-left">
          <thead>
            <tr className="border-b border-white/[0.06]">
              <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/25">
                Transaction
              </th>

              <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/25">
                Member
              </th>

              <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/25">
                Amount
              </th>

              <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/25">
                Source
              </th>

              <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/25">
                Reference
              </th>

              <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/25">
                Status
              </th>

              <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/25">
                Date
              </th>

              <th className="px-4 py-3 text-right text-[10px] font-semibold uppercase tracking-[0.14em] text-white/25">
                Actions
              </th>
            </tr>
          </thead>

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
    </section>
  );
}