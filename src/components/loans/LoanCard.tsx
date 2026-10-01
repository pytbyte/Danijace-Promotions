"use client";

import {
  ArrowUpRight,
  Banknote,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock3,
  CreditCard,
  Loader2,
  Pencil,
  ShieldAlert,
  Trash2,
  UserRound,
} from "lucide-react";

import {
  useState,
} from "react";

import type {
  Loan,
  WeeklyRepaymentBreakdownPeriod,
} from "@/lib/loans/types";

/* =========================================================
   PROPS
========================================================= */

interface LoanCardProps {
  loan: Loan;
  onView?: () => void;
  onEdit?: () => void;
  onRepay?: () => void;
  onDelete: () => void;
}

/* =========================================================
   FORMATTERS
========================================================= */

function formatKES(
  value: number,
): string {
  const amount =
    Number.isFinite(value)
      ? value
      : 0;

  return new Intl.NumberFormat(
    "en-KE",
    {
      style: "currency",
      currency: "KES",
      maximumFractionDigits: 0,
    },
  ).format(amount);
}

function formatDate(
  value: Date | string | number,
): string {
  const date =
    new Date(value);

  if (
    Number.isNaN(
      date.getTime(),
    )
  ) {
    return "—";
  }

  return new Intl.DateTimeFormat(
    "en-KE",
    {
      day: "2-digit",
      month: "short",
      year: "numeric",
    },
  ).format(date);
}

/**
 * Financial dates are CalendarDate values:
 *
 * YYYY-MM-DD
 *
 * Always format them through UTC so timezone conversion
 * cannot move the displayed date backwards or forwards.
 */
function formatCalendarDate(
  value: string,
): string {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})$/.exec(
      value,
    );

  if (!match) {
    return "—";
  }

  const year =
    Number(match[1]);

  const month =
    Number(match[2]);

  const day =
    Number(match[3]);

  const date =
    new Date(
      Date.UTC(
        year,
        month - 1,
        day,
      ),
    );

  if (
    Number.isNaN(
      date.getTime(),
    )
  ) {
    return "—";
  }

  return new Intl.DateTimeFormat(
    "en-KE",
    {
      day: "2-digit",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    },
  ).format(date);
}

/* =========================================================
   HELPERS
========================================================= */

function calculateProgress(
  loan: Loan,
): number {
  const paid =
    Number.isFinite(
      loan.amountPaid,
    )
      ? Math.max(
          0,
          loan.amountPaid,
        )
      : 0;

  const outstanding =
    Number.isFinite(
      loan.outstandingBalance,
    )
      ? Math.max(
          0,
          loan.outstandingBalance,
        )
      : 0;

  const liability =
    paid + outstanding;

  if (
    liability <= 0
  ) {
    return 0;
  }

  return Math.min(
    100,
    Math.max(
      0,
      (paid / liability) * 100,
    ),
  );
}

function getStatusLabel(
  loan: Loan,
): string {
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

function getStatusClasses(
  loan: Loan,
): string {
  switch (loan.status) {
    case "active":
      return [
        "bg-emerald-50",
        "text-black",
        "border",
        "border-emerald-200",
      ].join(" ");

    case "completed":
      return [
        "bg-blue-50",
        "text-black",
        "border",
        "border-blue-200",
      ].join(" ");

    case "pending":
      return [
        "bg-amber-50",
        "text-black",
        "border",
        "border-amber-200",
      ].join(" ");

    case "cancelled":
      return [
        "bg-red-50",
        "text-black",
        "border",
        "border-red-200",
      ].join(" ");

    default:
      return [
        "bg-slate-100",
        "text-black",
        "border",
        "border-slate-200",
      ].join(" ");
  }
}

function getInitials(
  name: string,
): string {
  const parts =
    name
      .trim()
      .split(/\s+/)
      .filter(Boolean);

  if (
    parts.length === 0
  ) {
    return "?";
  }

  if (
    parts.length === 1
  ) {
    return parts[0]
      .slice(0, 2)
      .toUpperCase();
  }

  return (
    parts[0][0] +
    parts[
      parts.length - 1
    ][0]
  ).toUpperCase();
}

/* =========================================================
   FINE HELPERS
========================================================= */

function formatFineRate(
  rate: number,
): string {
  if (
    !Number.isFinite(rate) ||
    rate < 0
  ) {
    return "0%";
  }

  return `${(rate * 100)
    .toFixed(2)
    .replace(/\.00$/, "")}%`;
}

function formatCycleDays(
  days: number,
): string {
  if (
    !Number.isInteger(days) ||
    days <= 0
  ) {
    return "7 days";
  }

  return `${days} ${
    days === 1
      ? "day"
      : "days"
  }`;
}

/* =========================================================
   WEEKLY BREAKDOWN HELPERS
========================================================= */

function getPeriodStatusLabel(
  period: WeeklyRepaymentBreakdownPeriod,
): string {
  switch (period.status) {
    case "paid":
      return "Paid";

    case "partial":
      return "Partial";

    case "current":
      return "Current";

    case "unpaid":
      return "Unpaid";

    default:
      return "Unpaid";
  }
}

function getPeriodStatusClasses(
  period: WeeklyRepaymentBreakdownPeriod,
): string {
  switch (period.status) {
    case "paid":
      return [
        "bg-emerald-50",
        "text-emerald-700",
        "border-emerald-200",
      ].join(" ");

    case "partial":
      return [
        "bg-amber-50",
        "text-amber-700",
        "border-amber-200",
      ].join(" ");

    case "current":
      return [
        "bg-sky-50",
        "text-sky-700",
        "border-sky-200",
      ].join(" ");

    case "unpaid":
      return [
        "bg-red-50",
        "text-red-700",
        "border-red-200",
      ].join(" ");

    default:
      return [
        "bg-slate-50",
        "text-slate-700",
        "border-slate-200",
      ].join(" ");
  }
}

/* =========================================================
   COMPONENT
========================================================= */

export default function LoanCard({
  loan,
  onView,
  onEdit,
  onRepay,
  onDelete,
}: LoanCardProps) {
  const [
    isDeleteModalOpen,
    setIsDeleteModalOpen,
  ] = useState(false);

  const [
    isDeleting,
    setIsDeleting,
  ] = useState(false);

  const [
    isWeeklyBreakdownOpen,
    setIsWeeklyBreakdownOpen,
  ] = useState(false);

  const [
    isAllocationDetailsOpen,
    setIsAllocationDetailsOpen,
  ] = useState(false);

  const progress =
    calculateProgress(loan);

  const outstanding =
    Number.isFinite(
      loan.outstandingBalance,
    )
      ? Math.max(
          0,
          loan.outstandingBalance,
        )
      : 0;

  const amountPaid =
    Number.isFinite(
      loan.amountPaid,
    )
      ? Math.max(
          0,
          loan.amountPaid,
        )
      : 0;

  const totalFines =
    Number.isFinite(
      loan.totalFines,
    )
      ? Math.max(
          0,
          loan.totalFines,
        )
      : 0;

  const fineRate =
    formatFineRate(
      loan.fineRate,
    );

  const repaymentCycle =
    formatCycleDays(
      loan.repaymentCycleDays,
    );

  const isRepayable =
    loan.status === "active" &&
    outstanding > 0;

  const isCompleted =
    loan.status === "completed";

  /* =======================================================
     WEEKLY REPAYMENT DATA

     These values come from the loan service.

     Important:
     - Period balances remain the real accounting values.
     - Display fallback below is presentation-only.
     - Fines are never included.
  ======================================================= */

  const weeklyBreakdown =
    loan.weeklyRepaymentBreakdown;

  const weeklyRepaymentBalance =
    typeof loan.weeklyRepaymentBalance ===
      "number" &&
    Number.isFinite(
      loan.weeklyRepaymentBalance,
    )
      ? Math.max(
          0,
          loan.weeklyRepaymentBalance,
        )
      : 0;

  const allocations =
    weeklyBreakdown?.allocations ??
    [];

  const surpluses =
    weeklyBreakdown?.surpluses ??
    [];

  /* =======================================================
     ACTUAL CURRENT PERIOD

     Never replace a real period balance with the next
     installment value. The period itself must continue
     showing its true accounting state.

     Example:

       Installment 1
       Paid
       Remaining: Ksh 0

     That remains Ksh 0 even when the loan still has
     another installment outstanding.
  ======================================================= */

  const currentPeriod =
    weeklyBreakdown?.periods.find(
      (period) =>
        period.status ===
        "current",
    );

  const currentPeriodBalance =
    currentPeriod &&
    Number.isFinite(
      currentPeriod.balance,
    )
      ? Math.max(
          0,
          currentPeriod.balance,
        )
      : null;

  /*
   * The service's currentBalance is the actual current
   * installment balance.
   *
   * Prefer the actual current period when available because
   * it directly represents the period being displayed.
   */
  const actualCurrentBalance =
    currentPeriodBalance !== null
      ? currentPeriodBalance
      : weeklyBreakdown
          ? Math.max(
              0,
              Number(
                weeklyBreakdown.currentBalance ??
                  0,
              ),
            )
          : 0;

  /*
   * Installment amount used for the next-installment
   * display fallback.
   */
  const installmentAmount =
    weeklyBreakdown &&
    Number.isFinite(
      weeklyBreakdown.installmentAmount,
    )
      ? Math.max(
          0,
          weeklyBreakdown.installmentAmount,
        )
      : Number.isFinite(
            loan.installmentAmount,
          )
        ? Math.max(
            0,
            loan.installmentAmount,
          )
        : 0;

  /*
   * When:
   *
   *   actual current balance = 0
   *   outstanding loan balance > 0
   *   installment amount > 0
   *
   * the current installment has been paid and the next
   * installment should be displayed.
   *
   * This is ONLY a display fallback.
   *
   * It does not change period.balance, allocations,
   * accounting, or the underlying loan data.
   */
  const isNextInstallmentDisplay =
    Boolean(
      weeklyBreakdown &&
        actualCurrentBalance <= 0 &&
        outstanding > 0 &&
        installmentAmount > 0,
    );

  const displayCurrentBalance =
    isNextInstallmentDisplay
      ? installmentAmount
      : actualCurrentBalance;

  /*
   * Previous completed unpaid installments remain part of
   * the weekly amount.
   */
  const completedBalance =
    weeklyBreakdown &&
    Number.isFinite(
      weeklyBreakdown.completedBalance,
    )
      ? Math.max(
          0,
          weeklyBreakdown.completedBalance,
        )
      : 0;

  /*
   * This is the amount shown in the card.
   *
   * We intentionally do NOT use weeklyBreakdown.totalBalance
   * here because that value represents the actual accounting
   * balance and can correctly be zero when the current period
   * has just been paid.
   *
   * For display:
   *
   *   previous unpaid balance
   *   +
   *   current/next installment
   */
  const displayWeeklyBalance =
    weeklyBreakdown
      ? Math.max(
          0,
          completedBalance +
            displayCurrentBalance,
        )
      : weeklyRepaymentBalance;

  /* =======================================================
     DELETE
  ======================================================= */

  async function handleDelete() {
    if (isDeleting) {
      return;
    }

    setIsDeleting(true);

    try {
      const response =
        await fetch(
          `/api/loans/${encodeURIComponent(
            loan.id,
          )}`,
          {
            method: "DELETE",
            headers: {
              Accept:
                "application/json",
            },
            cache: "no-store",
          },
        );

      let result: {
        success?: boolean;
        data?: {
          message?: string;
        };
        error?: string;
      } | null = null;

      try {
        result =
          await response.json();
      } catch {
        result = null;
      }

      if (!response.ok) {
        throw new Error(
          result?.error ||
            `Failed to delete loan. HTTP ${response.status}.`,
        );
      }

      if (!result?.success) {
        throw new Error(
          result?.error ||
            "Loan deletion failed.",
        );
      }

      setIsDeleteModalOpen(
        false,
      );

      onDelete();
    } catch (error) {
      console.error(
        "Loan deletion error:",
        error,
      );

      window.alert(
        error instanceof Error
          ? error.message
          : "Failed to delete loan. Please try again.",
      );
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <article
      className="
        w-full
        overflow-hidden
        rounded-[28px]
        border
        border-white/10
        bg-white
        text-black
        shadow-[0_10px_35px_rgba(0,0,0,0.25)]
        transition
      "
    >
      {/* =====================================================
          HEADER
      ====================================================== */}

      <div
        className="
          border-b
          border-slate-200
          bg-white
          px-5
          pb-4
          pt-5
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
                border
                border-sky-200
                bg-sky-50
                text-sm
                font-bold
                text-sky-700
              "
            >
              {getInitials(
                loan.memberName,
              )}
            </div>

            <div className="min-w-0">
              <p
                className="
                  truncate
                  text-sm
                  font-semibold
                  text-black
                "
              >
                {loan.memberName}
              </p>

              <p
                className="
                  mt-0.5
                  truncate
                  text-xs
                  text-black/50
                "
              >
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
                text-black/50
              "
            >
              {loan.loanNumber}
            </p>

            <p
              className="
                mt-1
                text-sm
                font-semibold
                capitalize
                text-black
              "
            >
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
              text-black/60
            "
          >
            <CreditCard className="h-3.5 w-3.5 text-sky-600" />

            <span>
              {Number.isFinite(
                loan.interestRate,
              )
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

      <div className="bg-white px-5 py-5">
        <div
          className="
            rounded-[22px]
            border
            border-slate-200
            bg-slate-50
            p-4
          "
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <p
                className="
                  text-xs
                  font-medium
                  text-black/60
                "
              >
                Outstanding balance
              </p>

              <p
                className="
                  mt-1
                  text-[28px]
                  font-bold
                  tracking-tight
                  text-black
                "
              >
                {formatKES(
                  outstanding,
                )}
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
                border
                border-sky-200
                bg-sky-50
                text-sky-700
              "
            >
              <Banknote className="h-5 w-5" />
            </div>
          </div>

          <div className="mt-4">
            <div
              className="
                mb-1.5
                flex
                items-center
                justify-between
                text-[11px]
              "
            >
              <span className="text-black/60">
                Repayment progress
              </span>

              <span className="font-semibold text-sky-700">
                {Math.round(
                  progress,
                )}
                %
              </span>
            </div>

            <div
              className="
                h-1.5
                overflow-hidden
                rounded-full
                bg-slate-200
              "
            >
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
          WEEKLY INSTALLMENT BALANCE
      ====================================================== */}

      <div className="bg-white px-5 pb-5">
        <div
          className="
            overflow-hidden
            rounded-[22px]
            border
            border-red-200
            bg-red-50
          "
        >
          <div className="p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-xs font-medium text-red-600/70">
                  {isNextInstallmentDisplay
                    ? "Next installment"
                    : "Weekly installment balance"}
                </p>

                <p className="mt-1 text-[26px] font-bold tracking-tight text-red-600">
                  {formatKES(
                    displayWeeklyBalance,
                  )}
                </p>

                <p className="mt-1 text-[11px] text-red-600/70">
                  {isNextInstallmentDisplay
                    ? completedBalance > 0
                      ? "Unpaid previous weeks + next installment"
                      : "Current installment is paid · showing the next installment"
                    : "Current installment + unpaid previous weeks"}
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
                  border
                  border-red-200
                  bg-white
                  text-red-600
                "
              >
                <Banknote className="h-5 w-5" />
              </div>
            </div>
          </div>

          {weeklyBreakdown ? (
            <button
              type="button"
              onClick={() =>
                setIsWeeklyBreakdownOpen(
                  (current) => !current,
                )
              }
              aria-expanded={
                isWeeklyBreakdownOpen
              }
              aria-controls={`weekly-repayment-breakdown-${loan.id}`}
              className="
                flex
                w-full
                items-center
                justify-between
                gap-3
                border-t
                border-red-200
                bg-white/70
                px-4
                py-3
                text-left
                transition
                hover:bg-white
                active:bg-white
              "
            >
              <div className="min-w-0">
                <p className="text-xs font-semibold text-black">
                  Repayment breakdown
                </p>

                <p className="mt-0.5 text-[11px] text-black/50">
                  {isWeeklyBreakdownOpen
                    ? "Hide payment and installment details"
                    : "Show payment and installment details"}
                </p>
              </div>

              <div
                className="
                  flex
                  h-8
                  w-8
                  shrink-0
                  items-center
                  justify-center
                  rounded-xl
                  border
                  border-slate-200
                  bg-white
                  text-black/60
                "
              >
                {isWeeklyBreakdownOpen ? (
                  <ChevronUp className="h-4 w-4" />
                ) : (
                  <ChevronDown className="h-4 w-4" />
                )}
              </div>
            </button>
          ) : (
            <div
              className="
                border-t
                border-red-200
                bg-white/60
                px-4
                py-3
              "
            >
              <p className="text-[11px] text-black/50">
                Repayment breakdown is not available.
              </p>
            </div>
          )}

          {weeklyBreakdown &&
            isWeeklyBreakdownOpen && (
              <div
                id={`weekly-repayment-breakdown-${loan.id}`}
                className="
                  border-t
                  border-red-200
                  bg-white
                  px-4
                  pb-4
                  pt-4
                "
              >
                {/* =================================================
                    SUMMARY
                ================================================== */}

                <div className="grid grid-cols-3 gap-2">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
                    <p className="text-[10px] text-black/50">
                      Installment
                    </p>

                    <p className="mt-1 text-xs font-semibold text-black">
                      {formatKES(
                        installmentAmount,
                      )}
                    </p>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
                    <p className="text-[10px] text-black/50">
                      Previous
                    </p>

                    <p className="mt-1 text-xs font-semibold text-red-600">
                      {formatKES(
                        completedBalance,
                      )}
                    </p>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
                    <p className="text-[10px] text-black/50">
                      {isNextInstallmentDisplay
                        ? "Next"
                        : "Current"}
                    </p>

                    <p className="mt-1 text-xs font-semibold text-red-600">
                      {formatKES(
                        displayCurrentBalance,
                      )}
                    </p>
                  </div>
                </div>

                {/* =================================================
                    PERIODS
                ================================================== */}

                <div className="mt-5 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold text-black">
                      Repayment periods
                    </p>

                    <p className="mt-0.5 text-[10px] text-black/45">
                      {formatCycleDays(
                        weeklyBreakdown.cycleDays,
                      )}{" "}
                      cycle
                    </p>
                  </div>

                  <span className="text-[10px] text-black/45">
                    {
                      weeklyBreakdown.periods
                        .length
                    }{" "}
                    periods
                  </span>
                </div>

                <div className="mt-2 space-y-2">
                  {weeklyBreakdown.periods.map(
                    (period) => {
                      const allocated =
                        Math.max(
                          0,
                          Number.isFinite(
                            period.allocated,
                          )
                            ? period.allocated
                            : 0,
                        );

                      const balance =
                        Math.max(
                          0,
                          Number.isFinite(
                            period.balance,
                          )
                            ? period.balance
                            : 0,
                        );

                      const installment =
                        Math.max(
                          0,
                          Number.isFinite(
                            period.installment,
                          )
                            ? period.installment
                            : 0,
                        );

                      const allocationPercent =
                        installment > 0
                          ? Math.min(
                              100,
                              Math.max(
                                0,
                                (allocated /
                                  installment) *
                                  100,
                              ),
                            )
                          : 0;

                      const isCurrent =
                        period.status ===
                        "current";

                      const isPaid =
                        period.status ===
                        "paid";

                      return (
                        <div
                          key={
                            period.periodNumber
                          }
                          className={`
                            rounded-2xl
                            border
                            px-3.5
                            py-3
                            ${
                              isCurrent
                                ? "border-red-200 bg-red-50/50"
                                : "border-slate-200 bg-white"
                            }
                          `}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <p className="text-xs font-semibold text-black">
                                  Installment{" "}
                                  {
                                    period.periodNumber
                                  }
                                </p>

                                <span
                                  className={`
                                    rounded-full
                                    border
                                    px-2
                                    py-0.5
                                    text-[9px]
                                    font-semibold
                                    ${getPeriodStatusClasses(
                                      period,
                                    )}
                                  `}
                                >
                                  {getPeriodStatusLabel(
                                    period,
                                  )}
                                </span>
                              </div>

                              <p className="mt-1 text-[10px] text-black/45">
                                {formatCalendarDate(
                                  period.periodStart,
                                )}{" "}
                                –{" "}
                                {formatCalendarDate(
                                  period.periodEnd,
                                )}
                              </p>
                            </div>

                            <div className="shrink-0 text-right">
                              <p
                                className={`
                                  text-xs
                                  font-bold
                                  ${
                                    balance > 0
                                      ? "text-red-600"
                                      : "text-emerald-600"
                                  }
                                `}
                              >
                                {formatKES(
                                  balance,
                                )}
                              </p>

                              <p className="mt-0.5 text-[9px] text-black/40">
                                remaining
                              </p>
                            </div>
                          </div>

                          <div className="mt-3">
                            <div className="mb-1 flex items-center justify-between text-[9px]">
                              <span className="text-black/45">
                                Paid toward installment
                              </span>

                              <span className="font-medium text-black/60">
                                {formatKES(
                                  allocated,
                                )}{" "}
                                /{" "}
                                {formatKES(
                                  installment,
                                )}
                              </span>
                            </div>

                            <div className="h-1.5 overflow-hidden rounded-full bg-slate-200">
                              <div
                                className={`
                                  h-full
                                  rounded-full
                                  transition-all
                                  ${
                                    isPaid
                                      ? "bg-emerald-500"
                                      : "bg-amber-400"
                                  }
                                `}
                                style={{
                                  width: `${allocationPercent}%`,
                                }}
                              />
                            </div>
                          </div>

                          <div className="mt-2.5 space-y-1 text-[9px]">
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-black/40">
                                Installment
                              </span>

                              <span className="font-medium text-black/60">
                                {formatKES(
                                  installment,
                                )}
                              </span>
                            </div>

                            <div className="flex items-center justify-between gap-3">
                              <span className="text-black/40">
                                Allocated
                              </span>

                              <span className="font-medium text-sky-700">
                                {formatKES(
                                  allocated,
                                )}
                              </span>
                            </div>

                            <div className="flex items-center justify-between gap-3">
                              <span className="text-black/40">
                                Remaining
                              </span>

                              <span
                                className={`
                                  font-semibold
                                  ${
                                    balance > 0
                                      ? "text-red-600"
                                      : "text-emerald-600"
                                  }
                                `}
                              >
                                {formatKES(
                                  balance,
                                )}
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    },
                  )}
                </div>

                {/* =================================================
                    PAYMENT ALLOCATIONS
                ================================================== */}

                {allocations.length > 0 && (
                  <div className="mt-4">
                    <button
                      type="button"
                      onClick={() =>
                        setIsAllocationDetailsOpen(
                          (value) => !value,
                        )
                      }
                      aria-expanded={
                        isAllocationDetailsOpen
                      }
                      className="
                        flex
                        w-full
                        items-center
                        justify-between
                        gap-3
                        rounded-2xl
                        border
                        border-slate-200
                        bg-slate-50
                        px-3.5
                        py-3
                        text-left
                        transition
                        hover:bg-slate-100
                      "
                    >
                      <div>
                        <p className="text-xs font-semibold text-black">
                          Payment allocation details
                        </p>

                        <p className="mt-0.5 text-[10px] text-black/45">
                          {allocations.length}{" "}
                          allocation
                          {allocations.length ===
                          1
                            ? ""
                            : "s"}{" "}
                          across the repayment periods
                        </p>
                      </div>

                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-black/60">
                        {isAllocationDetailsOpen ? (
                          <ChevronUp className="h-4 w-4" />
                        ) : (
                          <ChevronDown className="h-4 w-4" />
                        )}
                      </div>
                    </button>

                    {isAllocationDetailsOpen && (
                      <div className="mt-2 space-y-2">
                        {allocations.map(
                          (allocation) => {
                            const paymentAmount =
                              Math.max(
                                0,
                                Number.isFinite(
                                  allocation.paymentAmount,
                                )
                                  ? allocation.paymentAmount
                                  : 0,
                              );

                            const amountApplied =
                              Math.max(
                                0,
                                Number.isFinite(
                                  allocation.amountApplied,
                                )
                                  ? allocation.amountApplied
                                  : 0,
                              );

                            const remainingPayment =
                              Math.max(
                                0,
                                Number.isFinite(
                                  allocation.remainingPayment,
                                )
                                  ? allocation.remainingPayment
                                  : 0,
                              );

                            const beforeRemaining =
                              Math.max(
                                0,
                                Number.isFinite(
                                  allocation.beforeRemaining,
                                )
                                  ? allocation.beforeRemaining
                                  : 0,
                              );

                            const afterRemaining =
                              Math.max(
                                0,
                                Number.isFinite(
                                  allocation.afterRemaining,
                                )
                                  ? allocation.afterRemaining
                                  : 0,
                              );

                            return (
                              <div
                                key={`${allocation.allocationNumber}-${allocation.paymentSequence}`}
                                className="rounded-2xl border border-slate-200 bg-white px-3.5 py-3"
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <div className="flex min-w-0 items-center gap-2">
                                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-[9px] font-bold text-black/60">
                                      {
                                        allocation.paymentSequence
                                      }
                                    </span>

                                    <div className="min-w-0">
                                      <p className="text-xs font-semibold text-black">
                                        Payment{" "}
                                        {
                                          allocation.paymentSequence
                                        }
                                      </p>

                                      <p className="mt-0.5 text-[10px] text-black/45">
                                        {formatCalendarDate(
                                          allocation.paymentDate,
                                        )}
                                      </p>
                                    </div>
                                  </div>

                                  <div className="shrink-0 text-right">
                                    <p className="text-xs font-bold text-sky-700">
                                      {formatKES(
                                        paymentAmount,
                                      )}
                                    </p>

                                    <p className="mt-0.5 text-[9px] text-black/40">
                                      payment
                                    </p>
                                  </div>
                                </div>

                                <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
                                  <div className="flex items-center justify-between gap-3">
                                    <div>
                                      <p className="text-[9px] text-black/40">
                                        Applied to
                                      </p>

                                      <p className="mt-0.5 text-[11px] font-semibold text-black">
                                        Installment{" "}
                                        {
                                          allocation.periodNumber
                                        }
                                      </p>
                                    </div>

                                    <div className="text-right">
                                      <p className="text-xs font-bold text-sky-700">
                                        +
                                        {formatKES(
                                          amountApplied,
                                        )}
                                      </p>

                                      <p className="mt-0.5 text-[9px] text-black/40">
                                        applied
                                      </p>
                                    </div>
                                  </div>

                                  <p className="mt-1 text-[9px] text-black/40">
                                    {formatCalendarDate(
                                      allocation.periodStart,
                                    )}{" "}
                                    –{" "}
                                    {formatCalendarDate(
                                      allocation.periodEnd,
                                    )}
                                  </p>
                                </div>

                                <div className="mt-2 grid grid-cols-3 items-center gap-2">
                                  <div className="rounded-xl bg-slate-50 px-2.5 py-2">
                                    <p className="text-[8px] text-black/40">
                                      Before
                                    </p>

                                    <p className="mt-0.5 text-[10px] font-semibold text-black">
                                      {formatKES(
                                        beforeRemaining,
                                      )}
                                    </p>
                                  </div>

                                  <div className="rounded-xl bg-sky-50 px-2.5 py-2 text-center">
                                    <p className="text-[8px] text-sky-700/60">
                                      Applied
                                    </p>

                                    <p className="mt-0.5 text-[10px] font-bold text-sky-700">
                                      -
                                      {formatKES(
                                        amountApplied,
                                      )}
                                    </p>
                                  </div>

                                  <div className="rounded-xl bg-red-50 px-2.5 py-2 text-right">
                                    <p className="text-[8px] text-red-600/50">
                                      After
                                    </p>

                                    <p className="mt-0.5 text-[10px] font-semibold text-red-600">
                                      {formatKES(
                                        afterRemaining,
                                      )}
                                    </p>
                                  </div>
                                </div>

                                {allocation.carriedForward &&
                                  remainingPayment >
                                    0 && (
                                    <div className="mt-2 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2">
                                      <p className="text-[9px] font-semibold text-sky-700">
                                        Payment continues to next installment
                                      </p>

                                      <p className="mt-0.5 text-[9px] leading-4 text-sky-700/70">
                                        {formatKES(
                                          remainingPayment,
                                        )}{" "}
                                        remained after this
                                        allocation and was
                                        carried forward.
                                      </p>
                                    </div>
                                  )}
                              </div>
                            );
                          },
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* =================================================
                    FUTURE CREDIT
                ================================================== */}

                {surpluses.length > 0 && (
                  <div className="mt-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-3.5 py-3">
                    <div className="flex items-start gap-2.5">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-xs font-semibold text-emerald-800">
                            Future credit
                          </p>

                          <p className="text-xs font-bold text-emerald-700">
                            {formatKES(
                              surpluses.reduce(
                                (
                                  total,
                                  surplus,
                                ) =>
                                  total +
                                  Math.max(
                                    0,
                                    Number.isFinite(
                                      surplus.unusedCredit,
                                    )
                                      ? surplus.unusedCredit
                                      : 0,
                                  ),
                                0,
                              ),
                            )}
                          </p>
                        </div>

                        <p className="mt-1 text-[10px] leading-4 text-emerald-700/70">
                          These payments exceeded the
                          currently displayed installments.
                          The unused amount is kept as future
                          credit and does not reduce the
                          weekly balance.
                        </p>

                        <div className="mt-2 space-y-1.5">
                          {surpluses.map(
                            (surplus) => (
                              <div
                                key={`${surplus.paymentSequence}-${surplus.paymentDate}`}
                                className="flex items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-white/70 px-3 py-2"
                              >
                                <div>
                                  <p className="text-[9px] font-medium text-black/55">
                                    Payment{" "}
                                    {
                                      surplus.paymentSequence
                                    }
                                  </p>

                                  <p className="text-[9px] text-black/40">
                                    {formatCalendarDate(
                                      surplus.paymentDate,
                                    )}
                                  </p>
                                </div>

                                <span className="text-[10px] font-semibold text-emerald-700">
                                  +
                                  {formatKES(
                                    surplus.unusedCredit,
                                  )}
                                </span>
                              </div>
                            ),
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* =================================================
                    NO PAYMENT INFORMATION
                ================================================== */}

                {allocations.length === 0 &&
                  surpluses.length === 0 && (
                    <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 px-3.5 py-3">
                      <p className="text-xs font-semibold text-black">
                        No repayments allocated yet
                      </p>

                      <p className="mt-1 text-[10px] leading-4 text-black/45">
                        The displayed balance currently comes
                        entirely from the unpaid repayment
                        installments.
                      </p>
                    </div>
                  )}

                {/* =================================================
                    FINAL CALCULATION
                ================================================== */}

                <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-3.5 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[10px] font-medium text-red-600/70">
                        Weekly balance
                      </p>

                      <p className="mt-1 text-[11px] font-semibold text-black">
                        {formatKES(
                          completedBalance,
                        )}{" "}
                        previous +{" "}
                        {formatKES(
                          displayCurrentBalance,
                        )}{" "}
                        {isNextInstallmentDisplay
                          ? "next"
                          : "current"}
                      </p>
                    </div>

                    <p className="shrink-0 text-base font-bold text-red-600">
                      {formatKES(
                        displayWeeklyBalance,
                      )}
                    </p>
                  </div>

                  <div className="mt-2 flex items-center justify-between gap-3 border-t border-red-200/70 pt-2">
                    <span className="text-[9px] text-red-600/60">
                      {
                        weeklyBreakdown.periods
                          .length
                      }{" "}
                      repayment periods
                    </span>

                    <span className="text-[9px] font-medium text-red-600/60">
                      {allocations.length}{" "}
                      payment allocations
                    </span>
                  </div>

                  <p className="mt-2 text-[9px] leading-4 text-red-600/60">
                    Fines are excluded from this weekly
                    installment balance.
                  </p>
                </div>
              </div>
            )}
        </div>
      </div>

      {/* =====================================================
          FINANCIAL SUMMARY
      ====================================================== */}

      <div className="mx-5 grid grid-cols-2 gap-2 bg-white">
        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3.5">
          <p className="text-[11px] text-black/50">
            Principal
          </p>

          <p className="mt-1 text-sm font-semibold text-black">
            {formatKES(
              loan.principal,
            )}
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3.5">
          <p className="text-[11px] text-black/50">
            Amount paid
          </p>

          <p className="mt-1 text-sm font-semibold text-black">
            {formatKES(
              amountPaid,
            )}
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3.5">
          <p className="text-[11px] text-black/50">
            Interest
          </p>

          <p className="mt-1 text-sm font-semibold text-black">
            {formatKES(
              loan.interestAmount,
            )}
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3.5">
          <p className="text-[11px] text-black/50">
            Total due
          </p>

          <p className="mt-1 text-sm font-semibold text-black">
            {formatKES(
              loan.principal +
                loan.interestAmount,
            )}
          </p>
        </div>
      </div>

      {/* =====================================================
          DATES
      ====================================================== */}

      <div className="bg-white px-5 py-5">
        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3.5">
          <div className="grid grid-cols-2 gap-4">
            <div className="flex min-w-0 items-start gap-2.5">
              <CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-sky-600" />

              <div className="min-w-0">
                <p className="text-[11px] text-black/50">
                  Disbursed
                </p>

                <p className="mt-0.5 truncate text-xs font-medium text-black">
                  {formatDate(
                    loan.disbursementDate,
                  )}
                </p>
              </div>
            </div>

            <div className="flex min-w-0 items-start gap-2.5">
              <Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-sky-600" />

              <div className="min-w-0">
                <p className="text-[11px] text-black/50">
                  End date
                </p>

                <p className="mt-0.5 truncate text-xs font-medium text-black">
                  {formatDate(
                    loan.endDate,
                  )}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* =====================================================
          FINES
      ====================================================== */}
      {/*
            {totalFines > 0 && (
              <div className="bg-white px-5 pb-4">
                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-3.5 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <ShieldAlert className="h-4 w-4 shrink-0 text-amber-600" />

                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-black">
                          Fines
                        </p>

                        <p className="text-[11px] text-black/60">
                          {loan.fineStatus ===
                          "stopped"
                            ? `Future fines stopped · ${fineRate} per ${repaymentCycle} cycle`
                            : `${fineRate} per completed ${repaymentCycle} cycle`}
                        </p>
                      </div>
                    </div>

                    <span className="shrink-0 text-sm font-semibold text-amber-700">
                      {formatKES(
                        totalFines,
                      )}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {totalFines <= 0 && (
              <div className="bg-white px-5 pb-4">
                <div className="flex items-center gap-2.5 rounded-2xl border border-slate-200 bg-sky-50 px-3.5 py-3">
                  <ShieldAlert className="h-4 w-4 shrink-0 text-sky-600" />

                  <p className="text-[11px] text-black/60">
                    Fine policy:{" "}
                    <span className="font-semibold text-black">
                      {fineRate}
                    </span>{" "}
                    per completed{" "}
                    <span className="font-semibold text-black">
                      {repaymentCycle}
                    </span>{" "}
                    repayment cycle.

                    {loan.fineStatus ===
                      "stopped" &&
                      " Future fines are stopped."}
                  </p>
                </div>
              </div>
            )}
      */}
      {/* =====================================================
          GUARANTOR
      ====================================================== */}

      <div className="border-t border-slate-200 bg-white px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-sky-200 bg-sky-50 text-sky-700">
            <UserRound className="h-4 w-4" />
          </div>

          <div className="min-w-0 flex-1">
            <p className="text-[11px] text-black/50">
              Guarantor
            </p>

            <p className="truncate text-xs font-semibold text-black">
              {loan.guarantor?.name ||
                "Not provided"}
            </p>
          </div>

          {loan.guarantor?.phone && (
            <span className="shrink-0 text-[11px] text-black/60">
              {loan.guarantor.phone}
            </span>
          )}
        </div>
      </div>

      {/* =====================================================
          ACTIONS
      ====================================================== */}

      <div className="grid grid-cols-2 gap-2.5 bg-white px-5 pb-5 pt-1">
        <button
          type="button"
          onClick={onView}
          disabled={isDeleting}
          className="
            inline-flex
            h-11
            items-center
            justify-center
            gap-1.5
            rounded-2xl
            border
            border-slate-200
            bg-white
            px-3
            text-sm
            font-semibold
            text-black
            transition
            hover:bg-slate-50
            active:scale-[0.98]
            disabled:cursor-not-allowed
            disabled:opacity-40
          "
        >
          <ArrowUpRight className="h-4 w-4 text-sky-600" />
          View
        </button>

        <button
          type="button"
          onClick={onEdit}
          disabled={isDeleting}
          className="
            inline-flex
            h-11
            items-center
            justify-center
            gap-1.5
            rounded-2xl
            border
            border-amber-200
            bg-amber-50
            px-3
            text-sm
            font-semibold
            text-black
            transition
            hover:bg-amber-100
            active:scale-[0.98]
            disabled:cursor-not-allowed
            disabled:opacity-40
          "
        >
          <Pencil className="h-4 w-4" />
          Edit
        </button>

        <button
          type="button"
          onClick={onRepay}
          disabled={
            !isRepayable ||
            isCompleted ||
            isDeleting
          }
          className="
            inline-flex
            h-11
            items-center
            justify-center
            gap-1.5
            rounded-2xl
            bg-sky-600
            px-3
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

          {isCompleted
            ? "Done"
            : "Repay"}
        </button>

        <button
          type="button"
          onClick={() =>
            setIsDeleteModalOpen(
              true,
            )
          }
          disabled={isDeleting}
          className="
            inline-flex
            h-11
            items-center
            justify-center
            gap-1.5
            rounded-2xl
            border
            border-red-200
            bg-red-50
            px-3
            text-sm
            font-semibold
            text-black
            transition
            hover:bg-red-100
            active:scale-[0.98]
            disabled:cursor-not-allowed
            disabled:opacity-40
          "
        >
          <Trash2 className="h-4 w-4 text-red-600" />
          Delete
        </button>
      </div>

      {/* =====================================================
          DELETE CONFIRMATION MODAL
      ====================================================== */}

      {isDeleteModalOpen && (
        <div
          className="
            fixed
            inset-0
            z-[100]
            flex
            items-center
            justify-center
            bg-slate-950/60
            p-4
            backdrop-blur-sm
          "
          role="dialog"
          aria-modal="true"
          aria-labelledby={`delete-loan-title-${loan.id}`}
          aria-describedby={`delete-loan-description-${loan.id}`}
          onMouseDown={(event) => {
            if (
              event.target ===
                event.currentTarget &&
              !isDeleting
            ) {
              setIsDeleteModalOpen(
                false,
              );
            }
          }}
        >
          <div className="w-full max-w-md overflow-hidden rounded-[28px] border border-slate-200 bg-white text-black shadow-[0_25px_80px_rgba(15,23,42,0.25)]">
            <div className="bg-white px-6 pb-5 pt-6">
              <div className="flex items-start gap-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-red-200 bg-red-50 text-red-600">
                  <Trash2 className="h-5 w-5" />
                </div>

                <div className="min-w-0 flex-1">
                  <h2
                    id={`delete-loan-title-${loan.id}`}
                    className="text-base font-bold tracking-tight text-black"
                  >
                    Delete loan?
                  </h2>

                  <p
                    id={`delete-loan-description-${loan.id}`}
                    className="mt-1 text-sm leading-5 text-black/60"
                  >
                    This action permanently
                    removes this loan and its
                    associated records.
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-white px-6">
              <div className="rounded-[22px] border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-sky-200 bg-sky-50 text-xs font-bold text-sky-700">
                    {getInitials(
                      loan.memberName,
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-black">
                      {loan.memberName}
                    </p>

                    <p className="mt-0.5 truncate text-xs text-black/50">
                      {loan.loanNumber}
                    </p>
                  </div>

                  <div className="shrink-0 text-right">
                    <p className="text-[10px] font-medium uppercase tracking-[0.1em] text-black/50">
                      Outstanding
                    </p>

                    <p className="mt-0.5 text-sm font-bold text-sky-700">
                      {formatKES(
                        outstanding,
                      )}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-white px-6 py-5">
              <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3.5">
                <div className="flex items-start gap-3">
                  <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />

                  <div>
                    <p className="text-xs font-semibold text-red-700">
                      Permanent deletion
                    </p>

                    <p className="mt-1 text-[11px] leading-5 text-red-600/80">
                      The loan, repayments,
                      fines, waivers,
                      assessments, and
                      audit records will be
                      permanently deleted.
                      This cannot be undone.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex flex-col-reverse gap-2.5 border-t border-slate-200 bg-slate-50 px-6 py-4 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() =>
                  setIsDeleteModalOpen(
                    false,
                  )
                }
                disabled={isDeleting}
                className="
                  inline-flex
                  h-11
                  items-center
                  justify-center
                  rounded-2xl
                  border
                  border-slate-200
                  bg-white
                  px-5
                  text-sm
                  font-semibold
                  text-black
                  transition
                  hover:bg-slate-50
                  active:scale-[0.98]
                  disabled:cursor-not-allowed
                  disabled:opacity-40
                "
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={
                  handleDelete
                }
                disabled={
                  isDeleting
                }
                className="
                  inline-flex
                  h-11
                  items-center
                  justify-center
                  gap-2
                  rounded-2xl
                  bg-red-600
                  px-5
                  text-sm
                  font-semibold
                  text-white
                  shadow-sm
                  shadow-red-500/20
                  transition
                  hover:bg-red-700
                  active:scale-[0.98]
                  disabled:cursor-not-allowed
                  disabled:opacity-60
                "
              >
                {isDeleting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Deleting...
                  </>
                ) : (
                  <>
                    <Trash2 className="h-4 w-4" />
                    Delete Loan
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </article>
  );
}