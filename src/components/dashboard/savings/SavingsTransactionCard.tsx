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

type SavingsTransactionCardProps = {
  transaction: SavingsTransaction;
  onAdjust?: (
    transaction: SavingsTransaction
  ) => void;
  onReverse?: (
    transaction: SavingsTransaction
  ) => void;
};

function formatKES(
  amount: number
): string {
  if (!Number.isFinite(amount)) {
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
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
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

function getTransactionLabel(
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
      return type;
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
      return source;
  }
}

function getStatusLabel(
  status: SavingsTransaction["status"]
): string {
  switch (status) {
    case "confirmed":
      return "Confirmed";

    case "pending":
      return "Pending";

    case "reversed":
      return "Reversed";

    default:
      return status;
  }
}

function getTypeIcon(
  type: SavingsTransaction["type"]
) {
  switch (type) {
    case "deposit":
      return (
        <ArrowDownLeft
          size={17}
          strokeWidth={1.8}
        />
      );

    case "adjustment":
      return (
        <FileEdit
          size={17}
          strokeWidth={1.8}
        />
      );

    case "reversal":
      return (
        <RotateCcw
          size={17}
          strokeWidth={1.8}
        />
      );

    default:
      return (
        <Wallet
          size={17}
          strokeWidth={1.8}
        />
      );
  }
}

function getSourceIcon(
  source: SavingsTransaction["source"]
) {
  if (
    source === "sms"
  ) {
    return (
      <Smartphone
        size={13}
        strokeWidth={1.8}
      />
    );
  }

  return (
    <User
      size={13}
      strokeWidth={1.8}
    />
  );
}

function isReversible(
  transaction: SavingsTransaction
): boolean {
  return (
    transaction.status ===
      "confirmed" &&
    transaction.type !==
      "reversal"
  );
}

function isAdjustable(
  transaction: SavingsTransaction
): boolean {
  return (
    transaction.status ===
      "confirmed" &&
    transaction.type !==
      "reversal"
  );
}

export default function SavingsTransactionCard({
  transaction,
  onAdjust,
  onReverse,
}: SavingsTransactionCardProps) {
  const amount =
    Number(transaction.amount);

  const positive =
    amount > 0;

  const amountLabel =
    `${positive ? "+" : ""}${formatKES(amount)}`;

  const canAdjust =
    isAdjustable(transaction) &&
    Boolean(onAdjust);

  const canReverse =
    isReversible(transaction) &&
    Boolean(onReverse);

  return (
    <article
      className="
        rounded-2xl
        border
        border-white/[0.08]
        bg-[#0b0b0b]
        p-4
        transition
        hover:border-white/[0.12]
        sm:p-5
      "
    >
      {/* =====================================================
          TOP
      ===================================================== */}

      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div
            className={`
              flex
              h-10
              w-10
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
            <p className="truncate text-sm font-semibold text-white">
              {getTransactionLabel(
                transaction.type
              )}
            </p>

            <p className="mt-0.5 truncate text-xs text-white/35">
              {formatDate(
                transaction.transactionAt
              )}
            </p>
          </div>
        </div>

        <div className="shrink-0 text-right">
          <p
            className={`
              text-sm
              font-semibold
              ${
                positive
                  ? "text-emerald-400"
                  : "text-red-400"
              }
            `}
          >
            {amountLabel}
          </p>

          <p className="mt-1 text-[10px] text-white/25">
            {getStatusLabel(
              transaction.status
            )}
          </p>
        </div>
      </div>

      {/* =====================================================
          DETAILS
      ===================================================== */}

      <div className="mt-4 grid grid-cols-2 gap-3 border-t border-white/[0.06] pt-4">
        <div className="min-w-0">
          <p className="text-[9px] font-semibold uppercase tracking-[0.15em] text-white/20">
            Member
          </p>

          <p className="mt-1 truncate text-xs text-white/60">
            {transaction.memberName ||
              "Unknown member"}
          </p>
        </div>

        <div className="min-w-0 text-right">
          <p className="text-[9px] font-semibold uppercase tracking-[0.15em] text-white/20">
            Source
          </p>

          <div className="mt-1 flex items-center justify-end gap-1 text-xs text-white/60">
            {getSourceIcon(
              transaction.source
            )}

            <span>
              {getSourceLabel(
                transaction.source
              )}
            </span>
          </div>
        </div>

        {transaction.reference && (
          <div className="min-w-0">
            <p className="text-[9px] font-semibold uppercase tracking-[0.15em] text-white/20">
              Reference
            </p>

            <p className="mt-1 truncate font-mono text-[11px] text-white/45">
              {transaction.reference}
            </p>
          </div>
        )}

        {transaction.smsId && (
          <div className="min-w-0 text-right">
            <p className="text-[9px] font-semibold uppercase tracking-[0.15em] text-white/20">
              SMS ID
            </p>

            <p className="mt-1 truncate font-mono text-[11px] text-white/35">
              {transaction.smsId}
            </p>
          </div>
        )}

        {transaction.reason && (
          <div className="col-span-2 min-w-0">
            <p className="text-[9px] font-semibold uppercase tracking-[0.15em] text-white/20">
              Reason
            </p>

            <p className="mt-1 break-words text-xs leading-5 text-white/45">
              {transaction.reason}
            </p>
          </div>
        )}
      </div>

      {/* =====================================================
          ACTIONS
      ===================================================== */}

      {(canAdjust || canReverse) && (
        <div className="mt-4 flex items-center justify-end gap-2 border-t border-white/[0.06] pt-3">
          {canAdjust && (
            <button
              type="button"
              onClick={() =>
                onAdjust?.(
                  transaction
                )
              }
              className="
                inline-flex
                h-9
                items-center
                gap-1.5
                rounded-lg
                px-3
                text-xs
                font-medium
                text-white/45
                transition
                hover:bg-white/[0.05]
                hover:text-white
              "
            >
              <FileEdit
                size={14}
                strokeWidth={1.8}
              />

              <span>Adjust</span>
            </button>
          )}

          {canReverse && (
            <button
              type="button"
              onClick={() =>
                onReverse?.(
                  transaction
                )
              }
              className="
                inline-flex
                h-9
                items-center
                gap-1.5
                rounded-lg
                px-3
                text-xs
                font-medium
                text-red-400/70
                transition
                hover:bg-red-500/[0.08]
                hover:text-red-400
              "
            >
              <RotateCcw
                size={14}
                strokeWidth={1.8}
              />

              <span>Reverse</span>
            </button>
          )}
        </div>
      )}
    </article>
  );
}