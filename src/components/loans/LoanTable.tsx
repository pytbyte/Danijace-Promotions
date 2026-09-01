"use client";

import {
  ArrowUpRight,
  Banknote,
  CalendarDays,
  Eye,
  Smartphone,
} from "lucide-react";

import LoanCard from "@/components/loans/LoanCard";

import type { Loan } from "@/lib/loans/types";

/* =========================================================
   TYPES
========================================================= */

type LoanTableProps = {
  loans: Loan[];

  loading?: boolean;

  /**
   * Opens the loan history/details modal.
   */
  onViewLoan?: (
    loan: Loan
  ) => void;

  /**
   * Opens the repayment form.
   */
  onRepay?: (
    loan: Loan
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
  value:
    | string
    | number
    | Date
): string {
  const date =
    value instanceof Date
      ? value
      : new Date(value);

  if (
    Number.isNaN(
      date.getTime()
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
    }
  ).format(date);
}

/* =========================================================
   STATUS
========================================================= */

function getStatusClass(
  status: Loan["status"]
): string {
  switch (status) {
    case "active":
      return "bg-emerald-500/10 text-emerald-400";

    case "pending":
      return "bg-yellow-500/10 text-yellow-400";

    case "completed":
      return "bg-blue-500/10 text-blue-400";

    case "cancelled":
      return "bg-red-500/10 text-red-400";

    default:
      return "bg-white/[0.05] text-white/40";
  }
}

/* =========================================================
   REPAYABLE
========================================================= */

function isRepayable(
  loan: Loan
): boolean {
  return (
    loan.status === "active" &&
    Number.isFinite(
      loan.outstandingBalance
    ) &&
    loan.outstandingBalance > 0
  );
}

/* =========================================================
   LOADING
========================================================= */

function LoadingRows() {
  return (
    <>
      {Array.from(
        {
          length: 3,
        },
        (_, index) => (
          <tr
            key={index}
          >
            <td
              colSpan={7}
              className="px-4 py-3"
            >
              <div className="h-[48px] animate-pulse rounded-xl bg-white/[0.04]" />
            </td>
          </tr>
        )
      )}
    </>
  );
}

/* =========================================================
   EMPTY
========================================================= */

function EmptyState() {
  return (
    <tr>
      <td
        colSpan={7}
        className="px-6 py-12 text-center"
      >
        <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-2xl bg-yellow-500/10 text-yellow-400">
          <Banknote
            size={20}
            strokeWidth={1.7}
          />
        </div>

        <p className="mt-4 text-sm font-medium text-white/60">
          No loans found
        </p>

        <p className="mt-1 text-xs text-white/25">
          Loans matching the current view
          will appear here.
        </p>
      </td>
    </tr>
  );
}

/* =========================================================
   LOAN ROW
========================================================= */

function LoanRow({
  loan,
  onViewLoan,
  onRepay,
}: {
  loan: Loan;

  onViewLoan?: (
    loan: Loan
  ) => void;

  onRepay?: (
    loan: Loan
  ) => void;
}) {
  const repayable =
    isRepayable(loan);

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
      {/* ===================================================
          LOAN
      =================================================== */}

      <td className="px-4 py-3">
        <div className="min-w-0">

          <p className="truncate text-xs font-semibold text-white">
            {loan.loanNumber || "—"}
          </p>

          <p className="mt-1 flex items-center gap-1 text-[9px] text-white/20">
            <CalendarDays
              size={10}
              strokeWidth={1.7}
            />

            {formatDate(
              loan.disbursementDate
            )}
          </p>

        </div>
      </td>

      {/* ===================================================
          MEMBER
      =================================================== */}

      <td className="max-w-[190px] px-4 py-3">
        <div className="min-w-0">

          <p className="truncate text-xs font-medium text-white/70">
            {loan.memberName ||
              "Unknown member"}
          </p>

          <p className="mt-1 truncate font-mono text-[9px] text-white/20">
            {loan.memberNumber ||
              "—"}
          </p>

        </div>
      </td>

      {/* ===================================================
          TYPE
      =================================================== */}

      <td className="px-4 py-3">
        <span className="capitalize text-xs text-white/45">
          {loan.type || "—"}
        </span>
      </td>

      {/* ===================================================
          PRINCIPAL
      =================================================== */}

      <td className="whitespace-nowrap px-4 py-3">
        <span className="text-xs text-white/60">
          {formatKES(
            loan.principal
          )}
        </span>
      </td>

      {/* ===================================================
          BALANCE
      =================================================== */}

      <td className="whitespace-nowrap px-4 py-3">
        <span className="text-xs font-semibold text-white/80">
          {formatKES(
            loan.outstandingBalance
          )}
        </span>
      </td>

      {/* ===================================================
          STATUS
      =================================================== */}

      <td className="px-4 py-3">
        <span
          className={`
            inline-flex
            items-center
            rounded-full
            px-2.5
            py-1
            text-[9px]
            font-medium
            capitalize
            ${getStatusClass(
              loan.status
            )}
          `}
        >
          {loan.status}
        </span>
      </td>

      {/* ===================================================
          ACTIONS
      =================================================== */}

      <td className="px-4 py-3">
        <div className="flex items-center justify-end gap-1">

          {/* EYE / HISTORY */}

          <button
            type="button"
            onClick={() =>
              onViewLoan?.(loan)
            }
            disabled={
              !onViewLoan
            }
            className="
              flex
              h-8
              w-8
              shrink-0
              items-center
              justify-center
              rounded-lg
              text-white/30
              transition
              hover:bg-white/[0.06]
              hover:text-white
              disabled:cursor-default
              disabled:hover:bg-transparent
              disabled:hover:text-white/30
            "
            aria-label={`View transactions for ${loan.loanNumber}`}
            title="View loan transactions"
          >
            <Eye
              size={15}
              strokeWidth={1.8}
            />
          </button>

          {/* REPAY */}

          {repayable &&
            onRepay && (
              <button
                type="button"
                onClick={() =>
                  onRepay(
                    loan
                  )
                }
                className="
                  inline-flex
                  h-8
                  items-center
                  gap-1.5
                  rounded-lg
                  bg-yellow-500
                  px-2.5
                  text-[10px]
                  font-semibold
                  text-black
                  transition
                  hover:bg-yellow-400
                  active:scale-[0.98]
                "
                aria-label={`Record repayment for ${loan.loanNumber}`}
                title="Record repayment"
              >
                <Banknote
                  size={13}
                  strokeWidth={2}
                />

                Repay
              </button>
            )}

        </div>
      </td>
    </tr>
  );
}

/* =========================================================
   TABLE
========================================================= */

export default function LoanTable({
  loans,
  loading = false,
  onViewLoan,
  onRepay,
}: LoanTableProps) {
  const safeLoans =
    Array.isArray(loans)
      ? loans
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

          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-white">
              Loans
            </h2>

            <p className="mt-0.5 text-xs text-white/30">
              Loan portfolio
            </p>
          </div>

          {!loading && (
            <span className="shrink-0 text-xs text-white/25">
              {safeLoans.length}{" "}
              {safeLoans.length ===
              1
                ? "loan"
                : "loans"}
            </span>
          )}

        </div>

      </div>

      {/* =====================================================
          DESKTOP
      ===================================================== */}

      <div className="hidden overflow-x-auto lg:block">

        <div className="min-w-[1050px]">

          {/* STATIC HEADER */}

          <table className="w-full border-collapse text-left">

            <colgroup>
              <col className="w-[20%]" />
              <col className="w-[19%]" />
              <col className="w-[11%]" />
              <col className="w-[14%]" />
              <col className="w-[14%]" />
              <col className="w-[10%]" />
              <col className="w-[12%]" />
            </colgroup>

            <thead>
              <tr className="border-b border-white/[0.06]">

                <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/25">
                  Loan
                </th>

                <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/25">
                  Member
                </th>

                <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/25">
                  Type
                </th>

                <th className="px-4 py-3 text-right text-[10px] font-semibold uppercase tracking-[0.14em] text-white/25">
                  Principal
                </th>

                <th className="px-4 py-3 text-right text-[10px] font-semibold uppercase tracking-[0.14em] text-white/25">
                  Balance
                </th>

                <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/25">
                  Status
                </th>

                <th className="px-4 py-3 text-right text-[10px] font-semibold uppercase tracking-[0.14em] text-white/25">
                  Actions
                </th>

              </tr>
            </thead>

          </table>

          {/* =================================================
              SCROLLING BODY

              EXACTLY 3 LOAN ROWS VISIBLE
          ================================================= */}

          <div className="h-[180px] overflow-y-auto overscroll-contain scrollbar-thin scrollbar-track-transparent scrollbar-thumb-white/10 hover:scrollbar-thumb-white/20">

            <table className="w-full border-collapse text-left">

              <colgroup>
                <col className="w-[20%]" />
                <col className="w-[19%]" />
                <col className="w-[11%]" />
                <col className="w-[14%]" />
                <col className="w-[14%]" />
                <col className="w-[10%]" />
                <col className="w-[12%]" />
              </colgroup>

              <tbody>

                {loading ? (
                  <LoadingRows />
                ) : safeLoans.length ===
                  0 ? (
                  <EmptyState />
                ) : (
                  safeLoans.map(
                    (
                      loan
                    ) => (
                      <LoanRow
                        key={
                          loan.id
                        }
                        loan={
                          loan
                        }
                        onViewLoan={
                          onViewLoan
                        }
                        onRepay={
                          onRepay
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

      {/* =====================================================
          MOBILE

          ONE CARD IN VIEW
      ===================================================== */}

      <div className="lg:hidden">

        <div
          className="
            flex
            w-full
            snap-x
            snap-mandatory
            overflow-x-auto
            overflow-y-hidden
            scroll-smooth
            overscroll-x-contain
            touch-pan-x
            [scrollbar-width:none]
            [-ms-overflow-style:none]
            [&::-webkit-scrollbar]:hidden
          "
          style={{
            WebkitOverflowScrolling:
              "touch",
          }}
        >

          {loading ? (

            <div className="w-full min-w-full shrink-0 p-4">

              <div className="h-[180px] animate-pulse rounded-2xl bg-white/[0.04]" />

            </div>

          ) : safeLoans.length === 0 ? (

            <div className="w-full min-w-full shrink-0 p-6 text-center">

              <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-2xl bg-yellow-500/10 text-yellow-400">
                <Smartphone
                  size={19}
                  strokeWidth={1.7}
                />
              </div>

              <p className="mt-4 text-sm font-medium text-white/60">
                No loans found
              </p>

              <p className="mt-1 text-xs text-white/25">
                Loan records will appear here.
              </p>

            </div>

          ) : (

            safeLoans.map(
              (
                loan
              ) => (
                <div
                  key={
                    loan.id
                  }
                  className="
                    w-full
                    min-w-full
                    shrink-0
                    snap-start
                    p-4
                  "
                >

                  <LoanCard
                    loan={
                      loan
                    }
                    onClick={() =>
                      onViewLoan?.(
                        loan
                      )
                    }
                  />

                  {isRepayable(
                    loan
                  ) &&
                    onRepay && (
                      <button
                        type="button"
                        onClick={() =>
                          onRepay(
                            loan
                          )
                        }
                        className="
                          mt-2
                          flex
                          h-10
                          w-full
                          items-center
                          justify-center
                          gap-2
                          rounded-xl
                          border
                          border-yellow-500/15
                          bg-yellow-500/[0.06]
                          text-xs
                          font-semibold
                          text-yellow-400
                          transition
                          hover:border-yellow-500/25
                          hover:bg-yellow-500/10
                        "
                      >
                        <Banknote
                          size={
                            15
                          }
                          strokeWidth={
                            1.8
                          }
                        />

                        Record Repayment
                      </button>
                    )}

                </div>
              )
            )

          )}

        </div>

        {/* MOBILE INDICATORS */}

        {!loading &&
          safeLoans.length >
            1 && (
            <div className="border-t border-white/[0.05] px-4 py-2.5">

              <div className="flex items-center justify-center gap-1.5">

                {safeLoans
                  .slice(
                    0,
                    Math.min(
                      safeLoans.length,
                      8
                    )
                  )
                  .map(
                    (
                      loan,
                      index
                    ) => (
                      <span
                        key={
                          `loan-dot-${loan.id || index}`
                        }
                        className="
                          h-1
                          w-4
                          rounded-full
                          bg-white/10
                        "
                      />
                    )
                  )}

              </div>

              <p className="mt-1 text-center text-[9px] text-white/15">
                Swipe left for more loans
              </p>

            </div>
          )}

      </div>

    </section>
  );
}
