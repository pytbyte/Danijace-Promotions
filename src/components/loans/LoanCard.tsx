"use client";

import {
  ArrowUpRight,
  Banknote,
  CalendarDays,
  CheckCircle2,
  Clock3,
  CreditCard,
  Loader2,
  Pencil,
  ShieldAlert,
  Trash2,
  UserRound,
} from "lucide-react";

import { useState } from "react";

import type { Loan } from "@/lib/loans/types";

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

  const outstanding = Number.isFinite(loan.outstandingBalance)
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

  const [isDeleting, setIsDeleting] =
    useState(false);

  const progress = calculateProgress(loan);

  const outstanding = Number.isFinite(
    loan.outstandingBalance,
  )
    ? Math.max(0, loan.outstandingBalance)
    : 0;

  const amountPaid = Number.isFinite(
    loan.amountPaid,
  )
    ? Math.max(0, loan.amountPaid)
    : 0;

  const totalFines = Number.isFinite(
    loan.totalFines,
  )
    ? Math.max(0, loan.totalFines)
    : 0;

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
     DELETE
  ======================================================= */

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
        data?: {
          message?: string;
        };
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

      /*
       * The API has successfully deleted
       * the loan and its associated records.
       */

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
              {getInitials(loan.memberName)}
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
                border
                border-sky-200
                bg-sky-50
                text-sky-700
              "
            >
              <Banknote className="h-5 w-5" />
            </div>
          </div>

          {/* Progress */}

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
                {Math.round(progress)}%
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

      <div className="bg-white px-5 pb-5">
        <div className="rounded-[22px] border border-red-200 bg-red-50 p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-xs font-medium text-red-600/70">
                Weekly installment balance
              </p>

              <p className="mt-1 text-[26px] font-bold tracking-tight text-red-600">
                {formatKES(
                  Math.max(0, loan.currentInstallmentBalance ?? 0),
                )}
              </p>

              <p className="mt-1 text-[11px] text-red-600/70">
                Unpaid balance from completed repayment weeks
              </p>
            </div>

            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-red-200 bg-white text-red-600">
              <Banknote className="h-5 w-5" />
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
          bg-white
        "
      >
        <div
          className="
            rounded-2xl
            border
            border-slate-200
            bg-white
            px-4
            py-3.5
          "
        >
          <p className="text-[11px] text-black/50">
            Principal
          </p>

          <p className="mt-1 text-sm font-semibold text-black">
            {formatKES(loan.principal)}
          </p>
        </div>

        <div
          className="
            rounded-2xl
            border
            border-slate-200
            bg-white
            px-4
            py-3.5
          "
        >
          <p className="text-[11px] text-black/50">
            Amount paid
          </p>

          <p className="mt-1 text-sm font-semibold text-black">
            {formatKES(amountPaid)}
          </p>
        </div>

        <div
          className="
            rounded-2xl
            border
            border-slate-200
            bg-white
            px-4
            py-3.5
          "
        >
          <p className="text-[11px] text-black/50">
            Interest
          </p>

          <p className="mt-1 text-sm font-semibold text-black">
            {formatKES(loan.interestAmount)}
          </p>
        </div>

        <div
          className="
            rounded-2xl
            border
            border-slate-200
            bg-white
            px-4
            py-3.5
          "
        >
          <p className="text-[11px] text-black/50">
            Total due
          </p>

          <p className="mt-1 text-sm font-semibold text-black">
            {formatKES(loan.installmentAmount)}
          </p>
        </div>
      </div>

      {/* =====================================================
          DATES
      ====================================================== */}

      <div className="bg-white px-5 py-5">
        <div
          className="
            rounded-2xl
            border
            border-slate-200
            bg-slate-50
            px-4
            py-3.5
          "
        >
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

      {totalFines > 0 && (
        <div className="bg-white px-5 pb-4">
          <div
            className="
              rounded-2xl
              border
              border-amber-200
              bg-amber-50
              px-3.5
              py-3
            "
          >
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
        <div className="bg-white px-5 pb-4">
          <div
            className="
              flex
              items-center
              gap-2.5
              rounded-2xl
              border
              border-slate-200
              bg-sky-50
              px-3.5
              py-3
            "
          >
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

      {/* =====================================================
          GUARANTOR
      ====================================================== */}

      <div
        className="
          border-t
          border-slate-200
          bg-white
          px-5
          py-4
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
              border
              border-sky-200
              bg-sky-50
              text-sky-700
            "
          >
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

      <div
        className="
          grid
          grid-cols-2
          gap-2.5
          bg-white
          px-5
          pb-5
          pt-1
        "
      >
        {/* VIEW */}

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

        {/* EDIT */}

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

        {/* REPAY */}

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

        {/* DELETE */}

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
              setIsDeleteModalOpen(false);
            }
          }}
        >
          <div
            className="
              w-full
              max-w-md
              overflow-hidden
              rounded-[28px]
              border
              border-slate-200
              bg-white
              text-black
              shadow-[0_25px_80px_rgba(15,23,42,0.25)]
            "
          >
            {/* Modal Header */}

            <div className="bg-white px-6 pb-5 pt-6">
              <div className="flex items-start gap-4">
                <div
                  className="
                    flex
                    h-12
                    w-12
                    shrink-0
                    items-center
                    justify-center
                    rounded-2xl
                    border
                    border-red-200
                    bg-red-50
                    text-red-600
                  "
                >
                  <Trash2 className="h-5 w-5" />
                </div>

                <div className="min-w-0 flex-1">
                  <h2
                    id={`delete-loan-title-${loan.id}`}
                    className="
                      text-base
                      font-bold
                      tracking-tight
                      text-black
                    "
                  >
                    Delete loan?
                  </h2>

                  <p
                    id={`delete-loan-description-${loan.id}`}
                    className="
                      mt-1
                      text-sm
                      leading-5
                      text-black/60
                    "
                  >
                    This action permanently
                    removes this loan and its
                    associated records.
                  </p>
                </div>
              </div>
            </div>

            {/* Loan Summary */}

            <div className="bg-white px-6">
              <div
                className="
                  rounded-[22px]
                  border
                  border-slate-200
                  bg-slate-50
                  p-4
                "
              >
                <div className="flex items-center gap-3">
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
                      text-xs
                      font-bold
                      text-sky-700
                    "
                  >
                    {getInitials(
                      loan.memberName,
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
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
                      {loan.loanNumber}
                    </p>
                  </div>

                  <div className="shrink-0 text-right">
                    <p
                      className="
                        text-[10px]
                        font-medium
                        uppercase
                        tracking-[0.1em]
                        text-black/50
                      "
                    >
                      Outstanding
                    </p>

                    <p className="mt-0.5 text-sm font-bold text-sky-700">
                      {formatKES(outstanding)}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Warning */}

            <div className="bg-white px-6 py-5">
              <div
                className="
                  rounded-2xl
                  border
                  border-red-200
                  bg-red-50
                  px-4
                  py-3.5
                "
              >
                <div className="flex items-start gap-3">
                  <ShieldAlert
                    className="
                      mt-0.5
                      h-4
                      w-4
                      shrink-0
                      text-red-600
                    "
                  />

                  <div>
                    <p
                      className="
                        text-xs
                        font-semibold
                        text-red-700
                      "
                    >
                      Permanent deletion
                    </p>

                    <p
                      className="
                        mt-1
                        text-[11px]
                        leading-5
                        text-red-600/80
                      "
                    >
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

            {/* Modal Actions */}

            <div
              className="
                flex
                flex-col-reverse
                gap-2.5
                border-t
                border-slate-200
                bg-slate-50
                px-6
                py-4
                sm:flex-row
                sm:justify-end
              "
            >
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
                onClick={handleDelete}
                disabled={isDeleting}
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