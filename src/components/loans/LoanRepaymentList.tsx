"use client";

import {
  ArrowDownLeft,
  Smartphone,
  User,
  Wallet,
} from "lucide-react";

import type { LoanRepayment } from "@/lib/loans/types";

/* =========================================================
   TYPES
========================================================= */

type LoanRepaymentListProps = {
  repayments: LoanRepayment[];

  loading?: boolean;

  onSelectRepayment?: (
    repayment: LoanRepayment
  ) => void;
};

/* =========================================================
   HELPERS
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
  value: string | Date | number
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
   SOURCE
========================================================= */

function getSourceLabel(
  source: string
): string {
  switch (
    source
  ) {
    case "sms":
      return "SMS";

    case "manual":
      return "Manual";

    case "system":
      return "System";

    case "mpesa":
      return "M-Pesa";

    default:
      return source || "Unknown";
  }
}

function getSourceIcon(
  source: string
) {
  switch (
    source
  ) {
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

    default:
      return (
        <Wallet
          size={13}
          strokeWidth={1.8}
        />
      );
  }
}

/* =========================================================
   STATUS
========================================================= */

function statusClass(
  status: string
): string {
  switch (
    status
  ) {
    case "confirmed":
    case "completed":
      return "bg-emerald-500/10 text-emerald-400";

    case "pending":
      return "bg-yellow-500/10 text-yellow-400";

    case "reversed":
    case "cancelled":
      return "bg-red-500/10 text-red-400";

    default:
      return "bg-white/[0.05] text-white/40";
  }
}

function statusLabel(
  status: string
): string {
  switch (
    status
  ) {
    case "confirmed":
      return "Confirmed";

    case "completed":
      return "Completed";

    case "pending":
      return "Pending";

    case "reversed":
      return "Reversed";

    case "cancelled":
      return "Cancelled";

    default:
      return status || "Unknown";
  }
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
   EMPTY
========================================================= */

function EmptyState() {
  return (
    <tr>
      <td
        colSpan={7}
        className="px-6 py-14 text-center"
      >
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-yellow-500/10 text-yellow-400">
          <ArrowDownLeft
            size={20}
            strokeWidth={1.8}
          />
        </div>

        <p className="mt-4 text-sm font-medium text-white/60">
          No repayments found
        </p>

        <p className="mt-1 text-xs text-white/25">
          Loan repayments will appear here
          after they are recorded.
        </p>
      </td>
    </tr>
  );
}

/* =========================================================
   REPAYMENT ROW
========================================================= */

function RepaymentRow({
  repayment,
  onSelect,
}: {
  repayment: LoanRepayment;

  onSelect?: (
    repayment: LoanRepayment
  ) => void;
}) {
  /*
   * These property aliases make the component tolerant
   * of the common repayment shapes used in the loan domain.
   *
   * The backend remains authoritative.
   */

  const repaymentRecord =
    repayment as LoanRepayment & {
      id?: string;

      loanId?: string;
      loanNumber?: string;

      memberId?: string;
      memberName?: string;
      memberNumber?: string;

      amount?: number;

      transactionReference?: string;
      reference?: string;

      transactionDate?: string | Date;
      createdAt?: string;
      updatedAt?: string;

      source?: string;

      status?: string;
    };

  const amount =
    Number(
      repaymentRecord.amount
    );

  const reference =
    repaymentRecord.transactionReference ||
    repaymentRecord.reference ||
    "";

  const date =
    repaymentRecord.transactionDate ||
    repaymentRecord.createdAt ||
    repaymentRecord.updatedAt ||
    "";

  const source =
    repaymentRecord.source ||
    "unknown";

  const status =
    repaymentRecord.status ||
    "confirmed";

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

      <td className="px-4 py-4">
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold text-white">
            {repaymentRecord.loanNumber ||
              repaymentRecord.loanId ||
              "—"}
          </p>

          {repaymentRecord.id && (
            <p className="mt-1 truncate font-mono text-[9px] text-white/20">
              {repaymentRecord.id}
            </p>
          )}
        </div>
      </td>

      {/* ===================================================
          MEMBER
      =================================================== */}

      <td className="max-w-[190px] px-4 py-4">
        <div className="min-w-0">
          <p className="truncate text-xs font-medium text-white/75">
            {repaymentRecord.memberName ||
              "Unknown member"}
          </p>

          <p className="mt-0.5 truncate font-mono text-[10px] text-white/20">
            {repaymentRecord.memberNumber ||
              repaymentRecord.memberId ||
              "—"}
          </p>
        </div>
      </td>

      {/* ===================================================
          AMOUNT
      =================================================== */}

      <td className="whitespace-nowrap px-4 py-4">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400">
            <ArrowDownLeft
              size={14}
              strokeWidth={1.8}
            />
          </div>

          <span className="text-xs font-semibold text-emerald-400">
            {formatKES(amount)}
          </span>
        </div>
      </td>

      {/* ===================================================
          SOURCE
      =================================================== */}

      <td className="px-4 py-4">
        <div className="inline-flex items-center gap-1.5 text-xs text-white/50">
          {getSourceIcon(source)}

          <span>
            {getSourceLabel(source)}
          </span>
        </div>
      </td>

      {/* ===================================================
          REFERENCE
      =================================================== */}

      <td className="max-w-[180px] px-4 py-4">
        {reference ? (
          <span className="block truncate font-mono text-[10px] text-white/45">
            {reference}
          </span>
        ) : (
          <span className="text-xs text-white/15">
            —
          </span>
        )}
      </td>

      {/* ===================================================
          DATE
      =================================================== */}

      <td className="whitespace-nowrap px-4 py-4">
        <span className="text-xs text-white/50">
          {formatDate(date)}
        </span>
      </td>

      {/* ===================================================
          STATUS / VIEW
      =================================================== */}

      <td className="px-4 py-4">
        <div className="flex items-center justify-end gap-2">
          <span
            className={`
              inline-flex
              items-center
              rounded-full
              px-2
              py-1
              text-[10px]
              font-medium
              ${statusClass(status)}
            `}
          >
            {statusLabel(status)}
          </span>

          {onSelect && (
            <button
              type="button"
              onClick={() =>
                onSelect(
                  repayment
                )
              }
              className="
                inline-flex
                h-8
                w-8
                items-center
                justify-center
                rounded-lg
                bg-white/[0.05]
                text-white/40
                transition
                hover:bg-white/[0.09]
                hover:text-white
              "
              aria-label="View repayment"
            >
              <ArrowDownLeft
                size={14}
                strokeWidth={1.8}
              />
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

/* =========================================================
   MAIN COMPONENT
========================================================= */

export default function LoanRepaymentList({
  repayments,
  loading = false,
  onSelectRepayment,
}: LoanRepaymentListProps) {
  const safeRepayments =
    Array.isArray(
      repayments
    )
      ? repayments
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
      {/* ===================================================
          HEADER
      =================================================== */}

      <div className="border-b border-white/[0.06] px-4 py-4 sm:px-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-white">
              Loan Repayments
            </h2>

            <p className="mt-0.5 text-xs text-white/30">
              Immutable loan repayment ledger
            </p>
          </div>

          {!loading && (
            <span className="text-xs text-white/25">
              {safeRepayments.length}{" "}
              {safeRepayments.length ===
              1
                ? "repayment"
                : "repayments"}
            </span>
          )}
        </div>
      </div>

      {/* ===================================================
          HORIZONTAL TABLE WRAPPER
      =================================================== */}

      <div className="overflow-x-auto">
        <div className="min-w-[1000px]">

          {/* =================================================
              STATIC HEADER
          ================================================= */}

          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-white/[0.06]">
                <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/25">
                  Loan
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
                  Date
                </th>

                <th className="px-4 py-3 text-right text-[10px] font-semibold uppercase tracking-[0.14em] text-white/25">
                  Status
                </th>
              </tr>
            </thead>
          </table>

          {/* =================================================
              SCROLLABLE BODY

              EXACT HEIGHT = 200px

              Only three repayment rows should normally be
              visible before vertical scrolling begins.
          ================================================= */}

          <div className="h-[200px] overflow-y-auto overscroll-contain scrollbar-thin scrollbar-track-transparent scrollbar-thumb-white/10 hover:scrollbar-thumb-white/20">
            <table className="w-full border-collapse text-left">
              <tbody>
                {loading ? (
                  <LoadingRows />
                ) : safeRepayments.length ===
                  0 ? (
                  <EmptyState />
                ) : (
                  safeRepayments.map(
                    (repayment) => (
                      <RepaymentRow
                        key={
                          repayment.id
                        }
                        repayment={
                          repayment
                        }
                        onSelect={
                          onSelectRepayment
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
