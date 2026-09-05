
"use client";

import {
  ArrowUpRight,
  Banknote,
  CalendarDays,
  CheckCircle2,
  Clock3,
  CreditCard,
  ShieldAlert,
  UserRound,
} from "lucide-react";

import type { Loan } from "@/lib/loans/types";

interface LoanCardProps {
  loan: Loan;
  onView?: () => void;
  onRepay?: () => void;
}

/* =========================================================
   FORMATTERS
========================================================= */

function formatKES(value: number): string {
  const amount = Number.isFinite(value) ? value : 0;

  return new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatDate(value: Date | string | number): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return new Intl.DateTimeFormat("en-KE", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

/* =========================================================
   HELPERS
========================================================= */

function calculateProgress(loan: Loan): number {
  const paid = Number.isFinite(loan.amountPaid)
    ? Math.max(0, loan.amountPaid)
    : 0;

  const outstanding = Number.isFinite(
    loan.outstandingBalance,
  )
    ? Math.max(0, loan.outstandingBalance)
    : 0;

  const liability = paid + outstanding;

  if (liability <= 0) {
    return 0;
  }

  return Math.min(
    100,
    Math.max(0, (paid / liability) * 100),
  );
}

function getStatusLabel(loan: Loan): string {
  switch (loan.status) {
    case "active":
      return "Active";

    case "completed":
      return "Completed";

    case "pending":
      return "Pending";

    case "cancelled":
      return "Cancelled";

    default:
      return loan.status;
  }
}

function getStatusClasses(loan: Loan): string {
  switch (loan.status) {
    case "active":
      return "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400";

    case "completed":
      return "bg-blue-500/10 text-blue-600 dark:text-blue-400";

    case "pending":
      return "bg-amber-500/10 text-amber-600 dark:text-amber-400";

    case "cancelled":
      return "bg-red-500/10 text-red-600 dark:text-red-400";

    default:
      return "bg-muted text-muted-foreground";
  }
}

function getInitials(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (parts.length === 0) {
    return "?";
  }

  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }

  return (
    parts[0][0] +
    parts[parts.length - 1][0]
  ).toUpperCase();
}

/* =========================================================
   FINE HELPERS
========================================================= */

function formatFineRate(rate: number): string {
  if (!Number.isFinite(rate) || rate < 0) {
    return "0%";
  }

  return `${(rate * 100).toFixed(2).replace(/\.00$/, "")}%`;
}

function formatCycleDays(days: number): string {
  if (!Number.isInteger(days) || days <= 0) {
    return "7 days";
  }

  return `${days} ${days === 1 ? "day" : "days"}`;
}

/* =========================================================
   COMPONENT
========================================================= */

export default function LoanCard({
  loan,
  onView,
  onRepay,
}: LoanCardProps) {
  const progress = calculateProgress(loan);

  const outstanding = Number.isFinite(
    loan.outstandingBalance,
  )
    ? Math.max(0, loan.outstandingBalance)
    : 0;

  const amountPaid = Number.isFinite(loan.amountPaid)
    ? Math.max(0, loan.amountPaid)
    : 0;

  const totalFines = Number.isFinite(loan.totalFines)
    ? Math.max(0, loan.totalFines)
    : 0;

  const fineRate = formatFineRate(loan.fineRate);

  const repaymentCycle = formatCycleDays(
    loan.repaymentCycleDays,
  );

  const isRepayable =
    loan.status === "active" &&
    outstanding > 0;

  const isCompleted = loan.status === "completed";

  return (
    <article
      className="
        w-full
        overflow-hidden
        rounded-[28px]
        border
        border-sky-200/70
        bg-sky-50/70
        shadow-[0_8px_30px_rgba(14,165,233,0.08)]
        transition
        dark:border-sky-900/40
        dark:bg-slate-950
        dark:shadow-[0_8px_30px_rgba(0,0,0,0.25)]
      "
    >
      {/* =====================================================
          HEADER
      ====================================================== */}

      <div
        className="
          border-b
          border-sky-200/60
          px-5
          pb-4
          pt-5
          dark:border-sky-900/30
        "
      >
        <div className="flex items-start justify-between gap-3">
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
                bg-sky-500/10
                text-sm
                font-bold
                text-sky-600
                ring-1
                ring-sky-500/10
                dark:text-sky-400
              "
            >
              {getInitials(loan.memberName)}
            </div>

            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-foreground">
                {loan.memberName}
              </p>

              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {loan.memberNumber}
              </p>
            </div>
          </div>

          <span
            className={`
              shrink-0
              rounded-full
              px-2.5
              py-1
              text-[11px]
              font-semibold
              ${getStatusClasses(loan)}
            `}
          >
            {getStatusLabel(loan)}
          </span>
        </div>

        <div className="mt-4 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p
              className="
                text-[11px]
                font-medium
                uppercase
                tracking-[0.12em]
                text-muted-foreground
              "
            >
              {loan.loanNumber}
            </p>

            <p className="mt-1 text-sm font-semibold capitalize text-foreground">
              {loan.type} loan
            </p>
          </div>

          <div
            className="
              flex
              shrink-0
              items-center
              gap-1.5
              text-xs
              text-muted-foreground
            "
          >
            <CreditCard className="h-3.5 w-3.5 text-sky-600 dark:text-sky-400" />

            <span>
              {Number.isFinite(loan.interestRate)
                ? `${loan.interestRate}%`
                : "—"}{" "}
              interest
            </span>
          </div>
        </div>
      </div>

      {/* =====================================================
          OUTSTANDING BALANCE
      ====================================================== */}

      <div className="px-5 py-5">
        <div
          className="
            rounded-[22px]
            border
            border-sky-200/60
            bg-sky-100/60
            p-4
            dark:border-sky-900/30
            dark:bg-sky-950/40
          "
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-medium text-muted-foreground">
                Outstanding balance
              </p>

              <p
                className="
                  mt-1
                  text-[28px]
                  font-bold
                  tracking-tight
                  text-sky-950
                  dark:text-sky-100
                "
              >
                {formatKES(outstanding)}
              </p>
            </div>

            <div
              className="
                flex
                h-10
                w-10
                shrink-0
                items-center
                justify-center
                rounded-xl
                bg-sky-500/10
                text-sky-600
                dark:text-sky-400
              "
            >
              <Banknote className="h-5 w-5" />
            </div>
          </div>

          {/* Progress */}

          <div className="mt-4">
            <div className="mb-1.5 flex items-center justify-between text-[11px]">
              <span className="text-muted-foreground">
                Repayment progress
              </span>

              <span className="font-semibold text-sky-700 dark:text-sky-300">
                {Math.round(progress)}%
              </span>
            </div>

            <div className="h-1.5 overflow-hidden rounded-full bg-sky-200/70 dark:bg-sky-900/50">
              <div
                className="
                  h-full
                  rounded-full
                  bg-sky-500
                  transition-all
                  duration-500
                "
                style={{
                  width: `${progress}%`,
                }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* =====================================================
          FINANCIAL SUMMARY
      ====================================================== */}

      <div
        className="
          mx-5
          grid
          grid-cols-2
          gap-2
        "
      >
        <div
          className="
            rounded-2xl
            border
            border-sky-200/50
            bg-white/50
            px-4
            py-3.5
            dark:border-sky-900/25
            dark:bg-slate-900/60
          "
        >
          <p className="text-[11px] text-muted-foreground">
            Principal
          </p>

          <p className="mt-1 text-sm font-semibold text-foreground">
            {formatKES(loan.principal)}
          </p>
        </div>

        <div
          className="
            rounded-2xl
            border
            border-sky-200/50
            bg-white/50
            px-4
            py-3.5
            dark:border-sky-900/25
            dark:bg-slate-900/60
          "
        >
          <p className="text-[11px] text-muted-foreground">
            Amount paid
          </p>

          <p className="mt-1 text-sm font-semibold text-foreground">
            {formatKES(amountPaid)}
          </p>
        </div>

        <div
          className="
            rounded-2xl
            border
            border-sky-200/50
            bg-white/50
            px-4
            py-3.5
            dark:border-sky-900/25
            dark:bg-slate-900/60
          "
        >
          <p className="text-[11px] text-muted-foreground">
            Interest
          </p>

          <p className="mt-1 text-sm font-semibold text-foreground">
            {formatKES(loan.interestAmount)}
          </p>
        </div>

        <div
          className="
            rounded-2xl
            border
            border-sky-200/50
            bg-white/50
            px-4
            py-3.5
            dark:border-sky-900/25
            dark:bg-slate-900/60
          "
        >
          <p className="text-[11px] text-muted-foreground">
            Total due
          </p>

          <p className="mt-1 text-sm font-semibold text-foreground">
            {formatKES(loan.totalDue)}
          </p>
        </div>
      </div>

      {/* =====================================================
          DATES
      ====================================================== */}

      <div className="px-5 py-5">
        <div
          className="
            rounded-2xl
            border
            border-sky-200/50
            bg-white/40
            px-4
            py-3.5
            dark:border-sky-900/25
            dark:bg-slate-900/40
          "
        >
          <div className="grid grid-cols-2 gap-4">
            <div className="flex min-w-0 items-start gap-2.5">
              <CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-sky-600 dark:text-sky-400" />

              <div className="min-w-0">
                <p className="text-[11px] text-muted-foreground">
                  Disbursed
                </p>

                <p className="mt-0.5 truncate text-xs font-medium text-foreground">
                  {formatDate(loan.disbursementDate)}
                </p>
              </div>
            </div>

            <div className="flex min-w-0 items-start gap-2.5">
              <Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-sky-600 dark:text-sky-400" />

              <div className="min-w-0">
                <p className="text-[11px] text-muted-foreground">
                  First due
                </p>

                <p className="mt-0.5 truncate text-xs font-medium text-foreground">
                  {formatDate(loan.firstDueDate)}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* =====================================================
          FINES
      ====================================================== */}

      {totalFines > 0 && (
        <div className="px-5 pb-4">
          <div
            className="
              rounded-2xl
              border
              border-amber-300/40
              bg-amber-500/10
              px-3.5
              py-3
              dark:border-amber-500/20
            "
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2.5">
                <ShieldAlert className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />

                <div className="min-w-0">
                  <p className="text-xs font-semibold text-foreground">
                    Fines
                  </p>

                  <p className="text-[11px] text-muted-foreground">
                    {loan.fineStatus === "stopped"
                      ? `Future fines stopped · ${fineRate} per ${repaymentCycle} cycle`
                      : `${fineRate} per completed ${repaymentCycle} cycle`}
                  </p>
                </div>
              </div>

              <span className="shrink-0 text-sm font-semibold text-amber-700 dark:text-amber-400">
                {formatKES(totalFines)}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================
          FINE POLICY
      ====================================================== */}

      {totalFines <= 0 && (
        <div className="px-5 pb-4">
          <div
            className="
              flex
              items-center
              gap-2.5
              rounded-2xl
              border
              border-sky-200/50
              bg-sky-500/5
              px-3.5
              py-3
              dark:border-sky-900/25
              dark:bg-sky-950/20
            "
          >
            <ShieldAlert className="h-4 w-4 shrink-0 text-sky-600 dark:text-sky-400" />

            <p className="text-[11px] text-muted-foreground">
              Fine policy:{" "}
              <span className="font-semibold text-foreground">
                {fineRate}
              </span>{" "}
              per completed{" "}
              <span className="font-semibold text-foreground">
                {repaymentCycle}
              </span>{" "}
              repayment cycle.
              {loan.fineStatus === "stopped" &&
                " Future fines are stopped."}
            </p>
          </div>
        </div>
      )}

      {/* =====================================================
          GUARANTOR
      ====================================================== */}

      <div
        className="
          border-t
          border-sky-200/50
          px-5
          py-4
          dark:border-sky-900/25
        "
      >
        <div className="flex items-center gap-3">
          <div
            className="
              flex
              h-9
              w-9
              shrink-0
              items-center
              justify-center
              rounded-xl
              bg-sky-500/10
              text-sky-600
              dark:text-sky-400
            "
          >
            <UserRound className="h-4 w-4" />
          </div>

          <div className="min-w-0 flex-1">
            <p className="text-[11px] text-muted-foreground">
              Guarantor
            </p>

            <p className="truncate text-xs font-semibold text-foreground">
              {loan.guarantor?.name || "Not provided"}
            </p>
          </div>

          {loan.guarantor?.phone && (
            <span className="shrink-0 text-[11px] text-muted-foreground">
              {loan.guarantor.phone}
            </span>
          )}
        </div>
      </div>

      {/* =====================================================
          ACTIONS
      ====================================================== */}

      <div className="grid grid-cols-2 gap-3 px-5 pb-5 pt-1">
        <button
          type="button"
          onClick={onView}
          className="
            inline-flex
            h-11
            items-center
            justify-center
            gap-2
            rounded-2xl
            border
            border-sky-200
            bg-white/60
            px-4
            text-sm
            font-semibold
            text-foreground
            transition
            hover:bg-white
            active:scale-[0.98]
            dark:border-sky-900/40
            dark:bg-slate-900/70
            dark:hover:bg-slate-900
          "
        >
          <ArrowUpRight className="h-4 w-4 text-sky-600 dark:text-sky-400" />
          View
        </button>

        <button
          type="button"
          onClick={onRepay}
          disabled={!isRepayable || isCompleted}
          className="
            inline-flex
            h-11
            items-center
            justify-center
            gap-2
            rounded-2xl
            bg-sky-600
            px-4
            text-sm
            font-semibold
            text-white
            shadow-sm
            shadow-sky-500/20
            transition
            hover:bg-sky-700
            active:scale-[0.98]
            disabled:cursor-not-allowed
            disabled:opacity-40
          "
        >
          {isCompleted ? (
            <CheckCircle2 className="h-4 w-4" />
          ) : (
            <Banknote className="h-4 w-4" />
          )}

          {isCompleted ? "Completed" : "Repay"}
        </button>
      </div>
    </article>
  );
}