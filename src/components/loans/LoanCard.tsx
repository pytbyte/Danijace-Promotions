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
import { useState } from "react";

import type {
Loan,
WeeklyRepaymentBreakdownPeriod,
} from "@/lib/loans/types";

/* =========================================================
TYPES
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

function formatKES(value: number): string {
const amount = Number.isFinite(value) ? value : 0;

return new Intl.NumberFormat("en-KE", {
style: "currency",
currency: "KES",
maximumFractionDigits: 0,
}).format(amount);
}

function formatCalendarDate(value: string): string {
const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);

if (!match) {
return "—";
}

const year = Number(match[1]);
const month = Number(match[2]);
const day = Number(match[3]);

const date = new Date(Date.UTC(year, month - 1, day));

if (Number.isNaN(date.getTime())) {
return "—";
}

return new Intl.DateTimeFormat("en-KE", {
day: "2-digit",
month: "short",
year: "numeric",
timeZone: "UTC",
}).format(date);
}

/* =========================================================
MONEY / GENERAL HELPERS
========================================================= */

function safeMoney(value: unknown): number {
return typeof value === "number" && Number.isFinite(value)
? Math.max(0, value)
: 0;
}

function calculateProgress(loan: Loan): number {
const paid = safeMoney(loan.amountPaid);
const outstanding = safeMoney(loan.outstandingBalance);
const total = paid + outstanding;

if (total <= 0) {
return 0;
}

return Math.min(100, Math.max(0, (paid / total) * 100));
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

function formatFineRate(rate: number): string {
if (!Number.isFinite(rate) || rate < 0) {
return "0%";
}

return `${(rate * 100)
    .toFixed(2)
    .replace(/\.00$/, "")}%`;
}

function formatCycleDays(days: number): string {
if (!Number.isInteger(days) || days <= 0) {
return "7 days";
}

return `${days} ${days === 1 ? "day" : "days"}`;
}

/* =========================================================
LOAN STATUS
========================================================= */

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
return "border-emerald-200 bg-emerald-50 text-emerald-700";


case "completed":
  return "border-blue-200 bg-blue-50 text-blue-700";

case "pending":
  return "border-amber-200 bg-amber-50 text-amber-700";

case "cancelled":
  return "border-red-200 bg-red-50 text-red-700";

default:
  return "border-slate-200 bg-slate-100 text-slate-600";


}
}

/* =========================================================
PERIOD STATUS
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
return "border-emerald-200 bg-emerald-50 text-emerald-700";


case "partial":
  return "border-amber-200 bg-amber-50 text-amber-700";

case "current":
  return "border-sky-200 bg-sky-50 text-sky-700";

case "unpaid":
  return "border-red-200 bg-red-50 text-red-700";

default:
  return "border-slate-200 bg-slate-50 text-slate-600";


}
}

/* =========================================================
SMALL UI COMPONENTS
========================================================= */

function Metric({
label,
value,
valueClassName = "text-black",
}: {
label: string;
value: string;
valueClassName?: string;
}) {
return ( <div className="min-w-0"> <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-black/40">
{label} </p>


  <p
    className={`mt-1 truncate text-sm font-semibold ${valueClassName}`}
  >
    {value}
  </p>
</div>


);
}

/* =========================================================
REPAYMENT PERIOD
========================================================= */

function RepaymentPeriod({
period,
}: {
period: WeeklyRepaymentBreakdownPeriod;
}) {
/*

* =======================================================
* HISTORICAL FACTS
* =======================================================
*
* These values describe what actually happened during
* the original contractual installment period.
*
* They MUST NOT be reconstructed from current allocation.
  */

const installment = safeMoney(period.installment);

const paidDuringPeriod = safeMoney(
period.historical.paidDuringPeriod,
);

const historicalShortfall = safeMoney(
period.historical.shortfall,
);

/*

* =======================================================
* HISTORICAL FINE
* =======================================================
*
* The persisted fine snapshot is authoritative.
*
* Do not calculate or reconstruct the fine in the UI.
  */

const historicalFine = period.historical.fine;

const fineAmount = safeMoney(
historicalFine?.amount,
);

const fineRate = safeMoney(
historicalFine?.rate,
);

const fineExpectedInstallment = safeMoney(
historicalFine?.expectedInstallment,
);

const finePaymentsDuringPeriod = safeMoney(
historicalFine?.paymentsDuringPeriod,
);

const fineInstallmentShortfall = safeMoney(
historicalFine?.installmentShortfall,
);

/*

* =======================================================
* CURRENT ALLOCATION STATE
* =======================================================
*
* These values represent the current FIFO allocation
* state.
*
* Later repayments MAY change these values.
*
* They must NEVER overwrite the historical values above.
  */

const allocated = safeMoney(
period.current.allocated,
);

const balance = safeMoney(
period.current.balance,
);

const allocationPercent =
installment > 0
? Math.min(
100,
Math.max(
0,
(allocated / installment) * 100,
),
)
: 0;

const isCurrent = period.status === "current";
const isPaid = balance <= 0;

return (
<div
className={`relative
        overflow-hidden
        rounded-2xl
        border
        ${
          isCurrent
            ? "border-sky-200 bg-sky-50/40"
            : "border-slate-200 bg-white"
        }
      `}
>
{isCurrent && ( <div className="absolute inset-y-0 left-0 w-1 bg-sky-500" />
)}


  {/* =====================================================
      PERIOD HEADER
  ====================================================== */}

  <div className="flex items-start justify-between gap-3 px-4 pb-3 pt-4">
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-bold text-black">
          Installment {period.periodNumber}
        </span>

        <span
          className={`
            rounded-full
            border
            px-2
            py-0.5
            text-[9px]
            font-semibold
            ${getPeriodStatusClasses(period)}
          `}
        >
          {getPeriodStatusLabel(period)}
        </span>
      </div>

      <p className="mt-1 text-[10px] text-black/40">
        {formatCalendarDate(period.periodStart)}
        {" — "}
        {formatCalendarDate(period.periodEnd)}
      </p>
    </div>

    <div className="shrink-0 text-right">
      <p
        className={`
          text-sm
          font-bold
          ${
            balance > 0
              ? "text-red-600"
              : "text-emerald-600"
          }
        `}
      >
        {formatKES(balance)}
      </p>

      <p className="mt-0.5 text-[9px] text-black/35">
        current balance
      </p>
    </div>
  </div>

  {/* =====================================================
      CURRENT ALLOCATION PROGRESS
  ====================================================== */}

  <div className="px-4">
    <div className="mb-1.5 flex items-center justify-between">
      <span className="text-[9px] font-medium text-black/45">
        Current allocation
      </span>

      <span className="text-[9px] font-semibold text-black/55">
        {formatKES(allocated)} / {formatKES(installment)}
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
              : "bg-sky-500"
          }
        `}
        style={{
          width: `${allocationPercent}%`,
        }}
      />
    </div>
  </div>

  {/* =====================================================
      INSTALLMENT FINANCIAL STATEMENT
  ====================================================== */}

  <div className="mx-4 mb-4 mt-4 overflow-hidden rounded-xl border border-slate-200 bg-slate-50/80">
    {/* Historical facts */}

    <div className="grid grid-cols-3 divide-x divide-slate-200">
      <div className="px-2.5 py-2.5">
        <p className="text-[8px] uppercase tracking-[0.06em] text-black/35">
          Expected
        </p>

        <p className="mt-1 text-[10px] font-semibold text-black">
          {formatKES(installment)}
        </p>
      </div>

      <div className="px-2.5 py-2.5">
        <p className="text-[8px] uppercase tracking-[0.06em] text-black/35">
          Paid then
        </p>

        <p className="mt-1 text-[10px] font-semibold text-sky-700">
          {formatKES(paidDuringPeriod)}
        </p>
      </div>

      <div className="px-2.5 py-2.5">
        <p className="text-[8px] uppercase tracking-[0.06em] text-black/35">
          Period debt
        </p>

        <p
          className={`
            mt-1
            text-[10px]
            font-semibold
            ${
              historicalShortfall > 0
                ? "text-red-600"
                : "text-emerald-600"
            }
          `}
        >
          {formatKES(historicalShortfall)}
        </p>
      </div>
    </div>

    {/* Current state */}

    <div className="border-t border-slate-200">
      <div className="grid grid-cols-3 divide-x divide-slate-200">
        <div className="px-2.5 py-2.5">
          <p className="text-[8px] uppercase tracking-[0.06em] text-black/35">
            Allocated
          </p>

          <p className="mt-1 text-[10px] font-semibold text-sky-700">
            {formatKES(allocated)}
          </p>
        </div>

        <div className="px-2.5 py-2.5">
          <p className="text-[8px] uppercase tracking-[0.06em] text-black/35">
            Balance
          </p>

          <p
            className={`
              mt-1
              text-[10px]
              font-semibold
              ${
                balance > 0
                  ? "text-red-600"
                  : "text-emerald-600"
              }
            `}
          >
            {formatKES(balance)}
          </p>
        </div>

        {/* =================================================
            FINE FOR THIS SPECIFIC INSTALLMENT
        ================================================== */}

        <div
          className={`
            px-2.5
            py-2.5
            ${
              fineAmount > 0
                ? "bg-amber-50/80"
                : "bg-white/30"
            }
          `}
        >
          <div className="flex items-center gap-1">
            <ShieldAlert
              className={`
                h-3 w-3
                ${
                  fineAmount > 0
                    ? "text-amber-600"
                    : "text-black/25"
                }
              `}
            />

            <p
              className={`
                text-[8px]
                uppercase
                tracking-[0.06em]
                ${
                  fineAmount > 0
                    ? "text-amber-700/70"
                    : "text-black/35"
                }
              `}
            >
              Fine
            </p>
          </div>

          <p
            className={`
              mt-1
              text-[10px]
              font-bold
              ${
                fineAmount > 0
                  ? "text-amber-700"
                  : "text-black/40"
              }
            `}
          >
            {formatKES(fineAmount)}
          </p>
        </div>
      </div>
    </div>

    {/* =====================================================
        HISTORICAL FINE SNAPSHOT
    ====================================================== */}

    {historicalFine && fineAmount > 0 && (
      <div className="border-t border-amber-200 bg-amber-50/50 px-3 py-2.5">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <p className="text-[8px] uppercase tracking-[0.06em] text-amber-700/50">
              Fine rate
            </p>

            <p className="mt-0.5 text-[9px] font-semibold text-amber-800">
              {formatFineRate(fineRate)}
            </p>
          </div>

          <div>
            <p className="text-[8px] uppercase tracking-[0.06em] text-amber-700/50">
              Fine assessed
            </p>

            <p className="mt-0.5 text-[9px] font-semibold text-amber-800">
              {formatKES(fineAmount)}
            </p>
          </div>

          <div>
            <p className="text-[8px] uppercase tracking-[0.06em] text-amber-700/50">
              Fine expected
            </p>

            <p className="mt-0.5 text-[9px] font-semibold text-amber-800">
              {formatKES(fineExpectedInstallment)}
            </p>
          </div>

          <div>
            <p className="text-[8px] uppercase tracking-[0.06em] text-amber-700/50">
              Paid in period
            </p>

            <p className="mt-0.5 text-[9px] font-semibold text-amber-800">
              {formatKES(finePaymentsDuringPeriod)}
            </p>
          </div>

          <div className="col-span-2">
            <p className="text-[8px] uppercase tracking-[0.06em] text-amber-700/50">
              Historical shortfall
            </p>

            <p className="mt-0.5 text-[9px] font-semibold text-amber-800">
              {formatKES(fineInstallmentShortfall)}
            </p>
          </div>
        </div>
      </div>
    )}
  </div>
</div>


);
}

/* =========================================================
PAYMENT ALLOCATION
========================================================= */

function PaymentAllocation({
allocation,
}: {
allocation: {
allocationNumber: number;
paymentSequence: number;
paymentAmount: number;
amountApplied: number;
remainingPayment: number;
beforeRemaining: number;
afterRemaining: number;
carriedForward?: boolean;
paymentDate: string;
periodNumber: number;
periodStart: string;
periodEnd: string;
};
}) {
const paymentAmount = safeMoney(
allocation.paymentAmount,
);

const amountApplied = safeMoney(
allocation.amountApplied,
);

const beforeRemaining = safeMoney(
allocation.beforeRemaining,
);

const afterRemaining = safeMoney(
allocation.afterRemaining,
);

const remainingPayment = safeMoney(
allocation.remainingPayment,
);

return ( <div className="rounded-2xl border border-slate-200 bg-white">
{/* Payment header */}


  <div className="flex items-center justify-between gap-3 px-4 py-3">
    <div className="flex min-w-0 items-center gap-2.5">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-[9px] font-bold text-black/60">
        {allocation.paymentSequence}
      </div>

      <div className="min-w-0">
        <p className="text-[11px] font-semibold text-black">
          Payment {allocation.paymentSequence}
        </p>

        <p className="mt-0.5 text-[9px] text-black/40">
          {formatCalendarDate(
            allocation.paymentDate,
          )}
        </p>
      </div>
    </div>

    <div className="shrink-0 text-right">
      <p className="text-xs font-bold text-sky-700">
        {formatKES(paymentAmount)}
      </p>

      <p className="mt-0.5 text-[8px] uppercase tracking-wide text-black/35">
        payment
      </p>
    </div>
  </div>

  {/* Allocation details */}

  <div className="border-t border-slate-200 px-4 py-3">
    <div className="flex items-center justify-between gap-3">
      <div>
        <p className="text-[8px] uppercase tracking-wide text-black/35">
          Applied to
        </p>

        <p className="mt-0.5 text-[11px] font-semibold text-black">
          Installment {allocation.periodNumber}
        </p>
      </div>

      <p className="text-xs font-bold text-sky-700">
        +{formatKES(amountApplied)}
      </p>
    </div>

    <p className="mt-1 text-[9px] text-black/40">
      {formatCalendarDate(
        allocation.periodStart,
      )}
      {" — "}
      {formatCalendarDate(
        allocation.periodEnd,
      )}
    </p>

    <div className="mt-3 grid grid-cols-3 gap-1.5">
      <div className="rounded-lg bg-slate-50 px-2 py-1.5">
        <p className="text-[8px] text-black/35">
          Before
        </p>

        <p className="mt-0.5 text-[9px] font-semibold">
          {formatKES(beforeRemaining)}
        </p>
      </div>

      <div className="rounded-lg bg-sky-50 px-2 py-1.5 text-center">
        <p className="text-[8px] text-sky-700/50">
          Applied
        </p>

        <p className="mt-0.5 text-[9px] font-bold text-sky-700">
          {formatKES(amountApplied)}
        </p>
      </div>

      <div className="rounded-lg bg-red-50 px-2 py-1.5 text-right">
        <p className="text-[8px] text-red-600/40">
          After
        </p>

        <p className="mt-0.5 text-[9px] font-semibold text-red-600">
          {formatKES(afterRemaining)}
        </p>
      </div>
    </div>

    {allocation.carriedForward &&
      remainingPayment > 0 && (
        <div className="mt-2 flex items-center justify-between gap-3 rounded-lg border border-sky-200 bg-sky-50 px-2.5 py-2">
          <span className="text-[9px] font-medium text-sky-700">
            Carried forward
          </span>

          <span className="text-[9px] font-bold text-sky-700">
            {formatKES(remainingPayment)}
          </span>
        </div>
      )}
  </div>
</div>


);
}

/* =========================================================
MAIN COMPONENT
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

const [isDeleting, setIsDeleting] =
useState(false);

const [
isWeeklyBreakdownOpen,
setIsWeeklyBreakdownOpen,
] = useState(false);

const [
isAllocationDetailsOpen,
setIsAllocationDetailsOpen,
] = useState(false);

/* =======================================================
LOAN VALUES
======================================================== */

const progress = calculateProgress(loan);

const outstanding = safeMoney(
loan.outstandingBalance,
);

const amountPaid = safeMoney(
loan.amountPaid,
);

const interestAmount = safeMoney(
loan.interestAmount,
);

const principal = safeMoney(
loan.principal,
);

const totalDue =
principal + interestAmount;

const fineRate = formatFineRate(
loan.fineRate,
);

const repaymentCycle = formatCycleDays(
loan.repaymentCycleDays,
);

const isRepayable =
loan.status === "active" &&
outstanding > 0;

const isCompleted =
loan.status === "completed";

/* =======================================================
WEEKLY BREAKDOWN
======================================================== */

const weeklyBreakdown =
loan.weeklyRepaymentBreakdown;

const persistedWeeklyBalance =
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
weeklyBreakdown?.allocations ?? [];

const surpluses =
weeklyBreakdown?.surpluses ?? [];

const installmentAmount =
weeklyBreakdown &&
Number.isFinite(
weeklyBreakdown.installmentAmount,
)
? Math.max(
0,
weeklyBreakdown.installmentAmount,
)
: safeMoney(loan.installmentAmount);

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

const currentBalance =
weeklyBreakdown &&
Number.isFinite(
weeklyBreakdown.currentBalance,
)
? Math.max(
0,
weeklyBreakdown.currentBalance,
)
: 0;

/*

* Weekly repayment balance is ONLY unpaid
* contractual installment debt.
*
* Fines are completely separate.
  */

const displayWeeklyBalance =
weeklyBreakdown
? Math.max(
0,
completedBalance +
currentBalance,
)
: persistedWeeklyBalance;

/*

* Authoritative aggregate fine.
*
* This comes from the loan-level aggregate,
* not from recalculating period fines in the UI.
  */

const totalFines = safeMoney(
loan.totalFines,
);

const futureCredit =
surpluses.reduce(
(
total: number,
surplus,
) =>
total +
safeMoney(
surplus.unusedCredit,
),
0,
);

/* =======================================================
DELETE
======================================================== */

async function handleDelete() {
if (isDeleting) {
return;
}


setIsDeleting(true);

try {
  const response = await fetch(
    `/api/loans/${encodeURIComponent(
      loan.id,
    )}`,
    {
      method: "DELETE",
      headers: {
        Accept: "application/json",
      },
      cache: "no-store",
    },
  );

  let result: {
    success?: boolean;
    error?: string;
  } | null = null;

  try {
    result = await response.json();
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

  setIsDeleteModalOpen(false);
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

return ( <article className="w-full overflow-hidden rounded-[30px] border border-slate-200 bg-white text-black shadow-[0_18px_55px_rgba(15,23,42,0.10)]">
{/* =====================================================
HEADER
====================================================== */}


  <header className="border-b border-slate-200 px-5 pb-4 pt-5">
    <div className="flex items-start justify-between gap-4">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-sky-50 text-sm font-bold text-sky-700 ring-1 ring-sky-100">
          {getInitials(loan.memberName)}
        </div>

        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="truncate text-sm font-bold text-black">
              {loan.memberName}
            </h2>

            <span
              className={`
                shrink-0
                rounded-full
                border
                px-2
                py-0.5
                text-[9px]
                font-semibold
                ${getStatusClasses(loan)}
              `}
            >
              {getStatusLabel(loan)}
            </span>
          </div>

          <p className="mt-1 truncate text-[10px] text-black/40">
            {loan.memberNumber}
          </p>
        </div>
      </div>

      <div className="shrink-0 text-right">
        <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-black/35">
          {loan.loanNumber}
        </p>

        <p className="mt-1 text-xs font-semibold capitalize text-black">
          {loan.type} loan
        </p>
      </div>
    </div>

    <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3">
      <div className="flex items-center gap-1.5 text-[10px] text-black/45">
        <CreditCard className="h-3.5 w-3.5 text-sky-500" />

        <span>
          {Number.isFinite(
            loan.interestRate,
          )
            ? `${loan.interestRate}%`
            : "—"}{" "}
          interest
        </span>
      </div>

      <span className="text-[10px] text-black/40">
        {repaymentCycle} cycle
      </span>
    </div>
  </header>

  {/* =====================================================
      PRIMARY BALANCE
  ====================================================== */}

  <section className="px-5 pb-4 pt-5">
    <div className="rounded-[24px] bg-slate-950 p-5 text-white shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-white/45">
            Outstanding
          </p>

          <p className="mt-2 text-[30px] font-bold tracking-tight">
            {formatKES(outstanding)}
          </p>
        </div>

        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 text-white">
          <Banknote className="h-5 w-5" />
        </div>
      </div>

      <div className="mt-5">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[10px] text-white/45">
            Repayment progress
          </span>

          <span className="text-[10px] font-bold text-white">
            {Math.round(progress)}%
          </span>
        </div>

        <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-sky-400 transition-all duration-500"
            style={{
              width: `${progress}%`,
            }}
          />
        </div>
      </div>
    </div>
  </section>

  {/* =====================================================
      WEEKLY BALANCE
  ====================================================== */}

  <section className="px-5 pb-5">
    <div className="overflow-hidden rounded-[24px] border border-red-100 bg-white">
      <div className="px-5 pb-4 pt-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-red-500/70">
              Weekly repayment
            </p>

            <p className="mt-1 text-[25px] font-bold tracking-tight text-red-600">
              {formatKES(
                displayWeeklyBalance,
              )}
            </p>

            <p className="mt-1 text-[10px] text-black/40">
              Current unpaid contractual balance
            </p>
          </div>

          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-50 text-red-600">
            <Banknote className="h-5 w-5" />
          </div>
        </div>

        {weeklyBreakdown && (
          <div className="mt-5 grid grid-cols-3 border-t border-slate-100 pt-4">
            <Metric
              label="Previous"
              value={formatKES(
                completedBalance,
              )}
              valueClassName="text-red-600"
            />

            <Metric
              label="Current"
              value={formatKES(
                currentBalance,
              )}
              valueClassName="text-red-600"
            />

            <Metric
              label="Total fines"
              value={formatKES(
                totalFines,
              )}
              valueClassName={
                totalFines > 0
                  ? "text-amber-600"
                  : "text-black/40"
              }
            />
          </div>
        )}
      </div>

      {weeklyBreakdown ? (
        <>
          {/* =================================================
              BREAKDOWN TOGGLE
          ================================================== */}

          <button
            type="button"
            onClick={() =>
              setIsWeeklyBreakdownOpen(
                (value) => !value,
              )
            }
            aria-expanded={
              isWeeklyBreakdownOpen
            }
            className="
              flex
              w-full
              items-center
              justify-between
              border-t
              border-slate-200
              bg-slate-50/70
              px-5
              py-3.5
              text-left
              transition
              hover:bg-slate-50
            "
          >
            <div>
              <p className="text-xs font-semibold text-black">
                Repayment schedule
              </p>

              <p className="mt-0.5 text-[9px] text-black/40">
                {weeklyBreakdown.periods.length}{" "}
                periods ·{" "}
                {allocations.length}{" "}
                allocations
              </p>
            </div>

            <div className="flex h-8 w-8 items-center justify-center rounded-xl border border-slate-200 bg-white text-black/50">
              {isWeeklyBreakdownOpen ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </div>
          </button>

          {isWeeklyBreakdownOpen && (
            <div className="border-t border-slate-200 bg-white px-4 py-4">
              {/* =============================================
                  INSTALLMENT SCHEDULE
              ============================================== */}

              <div>
                <div className="mb-3 flex items-end justify-between gap-3 px-1">
                  <div>
                    <p className="text-xs font-bold text-black">
                      Installments
                    </p>

                    <p className="mt-0.5 text-[9px] text-black/40">
                      Historical facts, current state
                      and installment fine
                    </p>
                  </div>

                  <span className="text-[9px] text-black/40">
                    {formatKES(
                      installmentAmount,
                    )}{" "}
                    / cycle
                  </span>
                </div>

                <div className="space-y-2.5">
                  {weeklyBreakdown.periods.map(
                    (period) => (
                      <RepaymentPeriod
                        key={
                          period.periodNumber
                        }
                        period={period}
                      />
                    ),
                  )}
                </div>
              </div>

              {/* =============================================
                  FINE SUMMARY
              ============================================== */}

              <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50/70 px-4 py-3">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-2">
                    <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-white text-amber-600 ring-1 ring-amber-200">
                      <ShieldAlert className="h-4 w-4" />
                    </div>

                    <div>
                      <p className="text-xs font-semibold text-amber-800">
                        Total assessed fines
                      </p>

                      <p className="mt-0.5 text-[9px] text-amber-700/60">
                        {fineRate} per{" "}
                        {repaymentCycle}
                      </p>
                    </div>
                  </div>

                  <p className="text-sm font-bold text-amber-700">
                    {formatKES(totalFines)}
                  </p>
                </div>

                {loan.fineStatus ===
                  "stopped" && (
                  <div className="mt-3 border-t border-amber-200 pt-2.5">
                    <p className="text-[9px] text-amber-700/70">
                      Fine accrual is stopped.
                      Existing assessed fines
                      remain recorded.
                    </p>
                  </div>
                )}
              </div>

              {/* =============================================
                  PAYMENT ALLOCATIONS
              ============================================== */}

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
                      rounded-2xl
                      border
                      border-slate-200
                      bg-slate-50
                      px-4
                      py-3
                      text-left
                      transition
                      hover:bg-slate-100
                    "
                  >
                    <div>
                      <p className="text-xs font-semibold text-black">
                        Payment history
                      </p>

                      <p className="mt-0.5 text-[9px] text-black/40">
                        {allocations.length}{" "}
                        payment allocation
                        {allocations.length ===
                        1
                          ? ""
                          : "s"}
                      </p>
                    </div>

                    <div className="flex h-8 w-8 items-center justify-center rounded-xl border border-slate-200 bg-white text-black/50">
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
                        (allocation) => (
                          <PaymentAllocation
                            key={`${allocation.allocationNumber}-${allocation.paymentSequence}`}
                            allocation={
                              allocation
                            }
                          />
                        ),
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* =============================================
                  FUTURE CREDIT
              ============================================== */}

              {surpluses.length > 0 && (
                <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-emerald-600" />

                      <span className="text-xs font-semibold text-emerald-800">
                        Future credit
                      </span>
                    </div>

                    <span className="text-xs font-bold text-emerald-700">
                      {formatKES(
                        futureCredit,
                      )}
                    </span>
                  </div>

                  <div className="mt-2 space-y-1.5">
                    {surpluses.map(
                      (surplus) => (
                        <div
                          key={`${surplus.paymentSequence}-${surplus.paymentDate}`}
                          className="flex items-center justify-between rounded-lg bg-white/70 px-3 py-2"
                        >
                          <span className="text-[9px] text-black/45">
                            Payment{" "}
                            {
                              surplus.paymentSequence
                            }
                            {" · "}
                            {formatCalendarDate(
                              surplus.paymentDate,
                            )}
                          </span>

                          <span className="text-[9px] font-bold text-emerald-700">
                            +
                            {formatKES(
                              safeMoney(
                                surplus.unusedCredit,
                              ),
                            )}
                          </span>
                        </div>
                      ),
                    )}
                  </div>
                </div>
              )}

              {/* =============================================
                  NO REPAYMENTS
              ============================================== */}

              {allocations.length === 0 &&
                surpluses.length === 0 && (
                  <div className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-center">
                    <p className="text-xs font-semibold text-black">
                      No repayments yet
                    </p>

                    <p className="mt-1 text-[9px] text-black/40">
                      No payment has been allocated
                      to this loan.
                    </p>
                  </div>
                )}
            </div>
          )}
        </>
      ) : (
        <div className="border-t border-slate-200 px-5 py-3">
          <p className="text-[9px] text-black/40">
            Detailed repayment breakdown is not
            available.
          </p>
        </div>
      )}
    </div>
  </section>

  {/* =====================================================
      FINANCIAL SUMMARY
  ====================================================== */}

  <section className="border-t border-slate-100 px-5 py-5">
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-slate-200 bg-slate-200">
      <div className="bg-white px-4 py-3.5">
        <Metric
          label="Principal"
          value={formatKES(principal)}
        />
      </div>

      <div className="bg-white px-4 py-3.5">
        <Metric
          label="Amount paid"
          value={formatKES(amountPaid)}
          valueClassName="text-sky-700"
        />
      </div>

      <div className="bg-white px-4 py-3.5">
        <Metric
          label="Interest"
          value={formatKES(interestAmount)}
        />
      </div>

      <div className="bg-white px-4 py-3.5">
        <Metric
          label="Total due"
          value={formatKES(totalDue)}
        />
      </div>
    </div>
  </section>

  {/* =====================================================
      DATES
  ====================================================== */}

  <section className="px-5 pb-4">
    <div className="grid grid-cols-2 gap-3">
      <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3.5 py-3">
        <div className="flex items-start gap-2">
          <CalendarDays className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sky-600" />

          <div className="min-w-0">
            <p className="text-[9px] uppercase tracking-wide text-black/35">
              Disbursed
            </p>

            <p className="mt-1 truncate text-[10px] font-semibold text-black">
              {formatCalendarDate(
                loan.disbursementDate,
              )}
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3.5 py-3">
        <div className="flex items-start gap-2">
          <Clock3 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sky-600" />

          <div className="min-w-0">
            <p className="text-[9px] uppercase tracking-wide text-black/35">
              End date
            </p>

            <p className="mt-1 truncate text-[10px] font-semibold text-black">
              {formatCalendarDate(
                loan.endDate,
              )}
            </p>
          </div>
        </div>
      </div>
    </div>
  </section>

  {/* =====================================================
      GUARANTOR
  ====================================================== */}

  <section className="border-t border-slate-100 px-5 py-4">
    <div className="flex items-center gap-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sky-50 text-sky-700 ring-1 ring-sky-100">
        <UserRound className="h-4 w-4" />
      </div>

      <div className="min-w-0 flex-1">
        <p className="text-[9px] uppercase tracking-wide text-black/35">
          Guarantor
        </p>

        <p className="mt-0.5 truncate text-xs font-semibold text-black">
          {loan.guarantor?.name ||
            "Not provided"}
        </p>
      </div>

      {loan.guarantor?.phone && (
        <span className="shrink-0 text-[10px] text-black/50">
          {loan.guarantor.phone}
        </span>
      )}
    </div>
  </section>

  {/* =====================================================
      ACTIONS
  ====================================================== */}

  <footer className="grid grid-cols-2 gap-2.5 border-t border-slate-100 bg-slate-50/60 px-5 pb-5 pt-4">
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
        rounded-xl
        border
        border-slate-200
        bg-white
        px-3
        text-sm
        font-semibold
        text-black
        shadow-sm
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
        rounded-xl
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
        rounded-xl
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

      {isCompleted ? "Done" : "Repay"}
    </button>

    <button
      type="button"
      onClick={() =>
        setIsDeleteModalOpen(true)
      }
      disabled={isDeleting}
      className="
        inline-flex
        h-11
        items-center
        justify-center
        gap-1.5
        rounded-xl
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
  </footer>

  {/* =====================================================
      DELETE MODAL
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
          setIsDeleteModalOpen(false);
        }
      }}
    >
      <div className="w-full max-w-md overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_25px_80px_rgba(15,23,42,0.25)]">
        <div className="px-6 pb-5 pt-6">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-red-50 text-red-600 ring-1 ring-red-100">
              <Trash2 className="h-5 w-5" />
            </div>

            <div className="min-w-0">
              <h2
                id={`delete-loan-title-${loan.id}`}
                className="text-base font-bold text-black"
              >
                Delete loan?
              </h2>

              <p
                id={`delete-loan-description-${loan.id}`}
                className="mt-1 text-sm leading-5 text-black/55"
              >
                This permanently removes the loan
                and its associated records.
              </p>
            </div>
          </div>
        </div>

        <div className="px-6">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sky-50 text-xs font-bold text-sky-700 ring-1 ring-sky-100">
                {getInitials(
                  loan.memberName,
                )}
              </div>

              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-black">
                  {loan.memberName}
                </p>

                <p className="mt-0.5 truncate text-xs text-black/45">
                  {loan.loanNumber}
                </p>
              </div>

              <div className="text-right">
                <p className="text-[8px] uppercase tracking-wide text-black/40">
                  Outstanding
                </p>

                <p className="mt-1 text-sm font-bold text-sky-700">
                  {formatKES(
                    outstanding,
                  )}
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="px-6 py-5">
          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3.5">
            <div className="flex items-start gap-3">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />

              <div>
                <p className="text-xs font-semibold text-red-700">
                  Permanent deletion
                </p>

                <p className="mt-1 text-[10px] leading-5 text-red-600/75">
                  The loan, repayments, fines,
                  waivers, assessments and audit
                  records will be permanently
                  deleted.
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-col-reverse gap-2.5 border-t border-slate-200 bg-slate-50 px-6 py-4 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={() =>
              setIsDeleteModalOpen(false)
            }
            disabled={isDeleting}
            className="
              inline-flex
              h-11
              items-center
              justify-center
              rounded-xl
              border
              border-slate-200
              bg-white
              px-5
              text-sm
              font-semibold
              text-black
              transition
              hover:bg-slate-50
              disabled:cursor-not-allowed
              disabled:opacity-40
            "
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={handleDelete}
            disabled={isDeleting}
            className="
              inline-flex
              h-11
              items-center
              justify-center
              gap-2
              rounded-xl
              bg-red-600
              px-5
              text-sm
              font-semibold
              text-white
              shadow-sm
              shadow-red-500/20
              transition
              hover:bg-red-700
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
