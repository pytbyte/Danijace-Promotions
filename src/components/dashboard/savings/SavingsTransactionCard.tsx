"use client";

import {
  ArrowDownLeft,
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

function formatKES(amount: number): string {
  if (!Number.isFinite(amount)) {
    return "KES 0.00";
  }

  return new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

function formatDate(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Unknown date";
  }

  return new Intl.DateTimeFormat("en-KE", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

function formatTime(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat("en-KE", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
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
          size={18}
          strokeWidth={1.8}
        />
      );

    case "adjustment":
      return (
        <FileEdit
          size={18}
          strokeWidth={1.8}
        />
      );

    case "reversal":
      return (
        <RotateCcw
          size={18}
          strokeWidth={1.8}
        />
      );

    default:
      return (
        <Wallet
          size={18}
          strokeWidth={1.8}
        />
      );
  }
}

function getSourceIcon(
  source: SavingsTransaction["source"]
) {
  if (source === "sms") {
    return (
      <Smartphone
        size={12}
        strokeWidth={1.8}
      />
    );
  }

  return (
    <User
      size={12}
      strokeWidth={1.8}
    />
  );
}

function isReversible(
  transaction: SavingsTransaction
): boolean {
  return (
    transaction.status === "confirmed" &&
    transaction.type !== "reversal"
  );
}

function isAdjustable(
  transaction: SavingsTransaction
): boolean {
  return (
    transaction.status === "confirmed" &&
    transaction.type !== "reversal"
  );
}

export default function SavingsTransactionCard({
  transaction,
  onAdjust,
  onReverse,
}: SavingsTransactionCardProps) {
  const amount = Number(transaction.amount);
  const positive = amount > 0;

  const canAdjust =
    isAdjustable(transaction) &&
    Boolean(onAdjust);

  const canReverse =
    isReversible(transaction) &&
    Boolean(onReverse);

  return (
    <article
      className="
        relative
        min-h-[290px]
        overflow-hidden
        rounded-[24px]
        border
        border-slate-200
        bg-white
        p-5
        shadow-sm
        transition
        active:scale-[0.995]
        sm:p-6
      "
    >
      {/* =====================================================
          SUBTLE ACCENT
      ===================================================== */}

      <div
        className="
          pointer-events-none
          absolute
          -right-16
          -top-16
          h-36
          w-36
          rounded-full
          bg-blue-500/[0.06]
          blur-2xl
        "
      />

      {/* =====================================================
          HEADER
      ===================================================== */}

      <div className="relative flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <div
            className="
              flex
              h-11
              w-11
              shrink-0
              items-center
              justify-center
              rounded-2xl
              border
              border-blue-100
              bg-blue-50
              text-blue-600
            "
          >
            {getTypeIcon(transaction.type)}
          </div>

          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="truncate text-sm font-semibold text-black">
                {getTransactionLabel(
                  transaction.type
                )}
              </p>

              <span
                className={`
                  hidden
                  rounded-full
                  px-2
                  py-0.5
                  text-[9px]
                  font-medium
                  sm:inline-flex
                  ${
                    transaction.status === "confirmed"
                      ? "bg-emerald-50 text-emerald-600"
                      : transaction.status === "pending"
                        ? "bg-amber-50 text-amber-600"
                        : "bg-red-50 text-red-600"
                  }
                `}
              >
                {getStatusLabel(
                  transaction.status
                )}
              </span>
            </div>

            <p className="mt-1 text-[11px] text-black/40">
              {formatDate(
                transaction.transactionAt
              )}{" "}
              ·{" "}
              {formatTime(
                transaction.transactionAt
              )}
            </p>
          </div>
        </div>

        {/* ===================================================
            AMOUNT
        =================================================== */}

        <div className="shrink-0 text-right">
          <p
            className={`
              text-lg
              font-semibold
              tracking-tight
              ${
                positive
                  ? "text-emerald-600"
                  : "text-red-600"
              }
            `}
          >
            {positive ? "+" : ""}
            {formatKES(amount)}
          </p>

          <span
            className={`
              mt-1
              inline-flex
              rounded-full
              px-2
              py-0.5
              text-[9px]
              font-medium
              sm:hidden
              ${
                transaction.status === "confirmed"
                  ? "bg-emerald-50 text-emerald-600"
                  : transaction.status === "pending"
                    ? "bg-amber-50 text-amber-600"
                    : "bg-red-50 text-red-600"
              }
            `}
          >
            {getStatusLabel(
              transaction.status
            )}
          </span>
        </div>
      </div>

      {/* =====================================================
          MEMBER
      ===================================================== */}

      <div
        className="
          relative
          mt-5
          rounded-2xl
          border
          border-slate-200
          bg-slate-50
          px-4
          py-3
        "
      >
        <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-black/35">
          Member
        </p>

        <p className="mt-1 truncate text-sm font-medium text-black/80">
          {transaction.memberName ||
            "Unknown member"}
        </p>
      </div>

      {/* =====================================================
          METADATA
      ===================================================== */}

      <div className="relative mt-4 grid grid-cols-2 gap-x-4 gap-y-4">
        <div className="min-w-0">
          <p className="text-[9px] font-semibold uppercase tracking-[0.15em] text-black/30">
            Source
          </p>

          <div className="mt-1.5 flex items-center gap-1.5 text-xs text-black/55">
            <span className="text-blue-600/70">
              {getSourceIcon(
                transaction.source
              )}
            </span>

            <span>
              {getSourceLabel(
                transaction.source
              )}
            </span>
          </div>
        </div>

        {transaction.reference ? (
          <div className="min-w-0 text-right">
            <p className="text-[9px] font-semibold uppercase tracking-[0.15em] text-black/30">
              Reference
            </p>

            <p className="mt-1.5 truncate font-mono text-[10px] text-black/50">
              {transaction.reference}
            </p>
          </div>
        ) : (
          <div className="text-right">
            <p className="text-[9px] font-semibold uppercase tracking-[0.15em] text-black/30">
              Transaction
            </p>

            <p className="mt-1.5 text-xs text-black/40">
              Savings ledger
            </p>
          </div>
        )}

        {transaction.smsId && (
          <div className="col-span-2 min-w-0">
            <p className="text-[9px] font-semibold uppercase tracking-[0.15em] text-black/30">
              SMS ID
            </p>

            <p className="mt-1.5 truncate font-mono text-[10px] text-black/40">
              {transaction.smsId}
            </p>
          </div>
        )}

        {transaction.reason && (
          <div className="col-span-2 min-w-0">
            <p className="text-[9px] font-semibold uppercase tracking-[0.15em] text-black/30">
              Reason
            </p>

            <p className="mt-1 text-xs leading-5 text-black/50">
              {transaction.reason}
            </p>
          </div>
        )}
      </div>

      {/* =====================================================
          ACTIONS
      ===================================================== */}

      {(canAdjust || canReverse) && (
        <div
          className="
            relative
            mt-5
            flex
            items-center
            justify-end
            gap-2
            border-t
            border-slate-200
            pt-3
          "
        >
          {canAdjust && (
            <button
              type="button"
              onClick={() =>
                onAdjust?.(transaction)
              }
              className="
                inline-flex
                h-9
                items-center
                gap-1.5
                rounded-xl
                border
                border-slate-200
                px-3
                text-xs
                font-medium
                text-black/50
                transition
                hover:border-blue-200
                hover:bg-blue-50
                hover:text-blue-600
                active:scale-[0.98]
              "
            >
              <FileEdit
                size={14}
                strokeWidth={1.8}
              />

              <span>Withdraw</span>
            </button>
          )}

          {canReverse && (
            <button
              type="button"
              onClick={() =>
                onReverse?.(transaction)
              }
              className="
                inline-flex
                h-9
                items-center
                gap-1.5
                rounded-xl
                border
                border-red-100
                px-3
                text-xs
                font-medium
                text-red-600/70
                transition
                hover:border-red-200
                hover:bg-red-50
                hover:text-red-600
                active:scale-[0.98]
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