"use client";

import { useState } from "react";

import {
  Banknote,
  CalendarDays,
  Eye,
  Loader2,
  Smartphone,
  X,
} from "lucide-react";

import type { Loan } from "@/lib/loans/types";

import LoanCard from "@/components/loans/LoanCard";

/* =========================================================
   TYPES
========================================================= */

type LoanTableProps = {
  loans: Loan[];
  loading?: boolean;
  onSelectLoan?: (loan: Loan) => void;
  onDelete?: (loan: Loan) => void;
};

type LoanTransaction = {
  id?: string;
  _id?: string;

  loanId?: string;
  memberId?: string;

  amount?: number | string;

  transactionReference?: string;
  reference?: string;

  transactionDate?: string | Date;
  transactionAt?: string | Date;
  createdAt?: string | Date;

  source?: string;
  rawMessage?: string;
  status?: string;
};

type TransactionsResponse = {
  success?: boolean;

  data?:
    | LoanTransaction[]
    | {
        transactions?: LoanTransaction[];
        repayments?: LoanTransaction[];
        items?: LoanTransaction[];
        data?: LoanTransaction[];
      };

  transactions?: LoanTransaction[];
  repayments?: LoanTransaction[];

  error?: string;
};

/* =========================================================
   FORMATTERS
========================================================= */

function formatKES(
  amount: number | string | undefined,
): string {
  const numeric =
    typeof amount === "number"
      ? amount
      : typeof amount === "string"
        ? Number(amount)
        : 0;

  if (!Number.isFinite(numeric)) {
    return "KES 0.00";
  }

  return new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(numeric);
}

function formatDate(
  value?: string | number | Date | null,
): string {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return "—";
  }

  const date =
    value instanceof Date
      ? value
      : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return new Intl.DateTimeFormat("en-KE", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

/* =========================================================
   STATUS
========================================================= */

function getStatusClass(
  status: Loan["status"],
): string {
  switch (status) {
    case "active":
      return "bg-emerald-50 text-emerald-700";

    case "pending":
      return "bg-yellow-50 text-yellow-700";

    case "completed":
      return "bg-blue-50 text-blue-700";

    case "cancelled":
      return "bg-red-50 text-red-700";

    default:
      return "bg-slate-100 text-black/70";
  }
}

/* =========================================================
   REPAYMENT
========================================================= */

function isRepayable(loan: Loan): boolean {
  return (
    loan.status === "active" &&
    Number.isFinite(loan.outstandingBalance) &&
    loan.outstandingBalance > 0
  );
}

/* =========================================================
   TRANSACTION EXTRACTION
========================================================= */

function extractTransactions(
  response: TransactionsResponse,
): LoanTransaction[] {
  if (Array.isArray(response.transactions)) {
    return response.transactions;
  }

  if (Array.isArray(response.repayments)) {
    return response.repayments;
  }

  if (Array.isArray(response.data)) {
    return response.data;
  }

  if (
    response.data &&
    typeof response.data === "object"
  ) {
    if (
      Array.isArray(response.data.transactions)
    ) {
      return response.data.transactions;
    }

    if (
      Array.isArray(response.data.repayments)
    ) {
      return response.data.repayments;
    }

    if (Array.isArray(response.data.items)) {
      return response.data.items;
    }

    if (Array.isArray(response.data.data)) {
      return response.data.data;
    }
  }

  return [];
}

/* =========================================================
   LOADING ROWS
========================================================= */

function LoadingRows() {
  return (
    <>
      {Array.from({ length: 3 }, (_, index) => (
        <tr
          key={index}
          className="border-b border-slate-200 bg-white"
        >
          <td
            colSpan={7}
            className="px-4 py-3"
          >
            <div className="h-[48px] animate-pulse rounded-xl bg-slate-100" />
          </td>
        </tr>
      ))}
    </>
  );
}

/* =========================================================
   EMPTY STATE
========================================================= */

function EmptyState() {
  return (
    <tr className="bg-white">
      <td
        colSpan={7}
        className="px-6 py-12 text-center"
      >
        <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-2xl border border-yellow-200 bg-yellow-50 text-yellow-600">
          <Banknote
            size={20}
            strokeWidth={1.7}
          />
        </div>

        <p className="mt-4 text-sm font-medium text-black">
          No loans found
        </p>

        <p className="mt-1 text-xs text-black/50">
          Loans matching the current view will
          appear here.
        </p>
      </td>
    </tr>
  );
}

/* =========================================================
   TRANSACTION HISTORY MODAL
========================================================= */

function LoanTransactionModal({
  loan,
  transactions,
  loading,
  error,
  onClose,
}: {
  loan: Loan | null;
  transactions: LoanTransaction[];
  loading: boolean;
  error: string;
  onClose: () => void;
}) {
  if (!loan) {
    return null;
  }

  return (
    <div
      className="
        fixed
        inset-0
        z-[100]
        flex
        items-center
        justify-center
        bg-black/70
        p-4
        backdrop-blur-sm
      "
      role="dialog"
      aria-modal="true"
      aria-labelledby="loan-history-title"
    >
      <div
        className="
          flex
          max-h-[85dvh]
          w-full
          max-w-3xl
          flex-col
          overflow-hidden
          rounded-2xl
          border
          border-white/[0.08]
          bg-[#0b0b0b]
          shadow-[0_25px_100px_rgba(0,0,0,0.55)]
        "
      >
        {/* HEADER */}

        <div className="flex items-start justify-between gap-4 border-b border-white/[0.07] px-4 py-4 sm:px-5">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-yellow-500/10 text-yellow-400">
                <Banknote
                  size={15}
                  strokeWidth={1.8}
                />
              </div>

              <span className="text-[9px] font-medium uppercase tracking-[0.18em] text-yellow-500/60">
                Loan History
              </span>
            </div>

            <h2
              id="loan-history-title"
              className="mt-2 truncate text-lg font-semibold text-white"
            >
              {loan.loanNumber || "Loan"}
            </h2>

            <p className="mt-1 truncate text-xs text-white/30">
              {loan.memberName || "Unknown member"}
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="
              flex
              h-9
              w-9
              shrink-0
              items-center
              justify-center
              rounded-lg
              text-white/35
              transition
              hover:bg-white/[0.06]
              hover:text-white
            "
            aria-label="Close transaction history"
          >
            <X
              size={17}
              strokeWidth={1.8}
            />
          </button>
        </div>

        {/* SUMMARY */}

        <div className="grid grid-cols-2 gap-2 border-b border-white/[0.06] p-4 sm:grid-cols-4">
          <HistorySummary
            label="Principal"
            value={formatKES(loan.principal)}
          />

          <HistorySummary
            label="Paid"
            value={formatKES(loan.amountPaid)}
          />

          <HistorySummary
            label="Fines"
            value={formatKES(loan.totalFines)}
          />

          <HistorySummary
            label="Balance"
            value={formatKES(
              loan.outstandingBalance,
            )}
          />
        </div>

        {/* CONTENT */}

        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
          {loading ? (
            <div className="flex min-h-[220px] items-center justify-center">
              <div className="flex flex-col items-center">
                <Loader2
                  size={24}
                  className="animate-spin text-yellow-400"
                />

                <p className="mt-3 text-xs text-white/30">
                  Loading transaction history...
                </p>
              </div>
            </div>
          ) : error ? (
            <div className="flex min-h-[220px] items-center justify-center">
              <div className="max-w-md text-center">
                <p className="text-sm font-medium text-red-300">
                  Unable to load transactions
                </p>

                <p className="mt-2 text-xs leading-5 text-red-300/50">
                  {error}
                </p>
              </div>
            </div>
          ) : transactions.length === 0 ? (
            <div className="flex min-h-[220px] items-center justify-center">
              <div className="text-center">
                <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-2xl bg-white/[0.04] text-white/25">
                  <Banknote
                    size={19}
                    strokeWidth={1.6}
                  />
                </div>

                <p className="mt-4 text-sm font-medium text-white/50">
                  No transactions recorded
                </p>

                <p className="mt-1 text-xs text-white/20">
                  Repayments for this loan will
                  appear here.
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {transactions.map(
                (transaction, index) => {
                  const amount = Number(
                    transaction.amount,
                  );

                  const transactionId =
                    transaction.id ||
                    transaction._id ||
                    `transaction-${index}`;

                  const reference =
                    transaction.transactionReference ||
                    transaction.reference ||
                    "No reference";

                  const transactionDate =
                    transaction.transactionDate ||
                    transaction.transactionAt ||
                    transaction.createdAt;

                  return (
                    <div
                      key={transactionId}
                      className="
                        rounded-xl
                        border
                        border-white/[0.06]
                        bg-white/[0.02]
                        p-3
                        transition
                        hover:bg-white/[0.035]
                      "
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex min-w-0 items-start gap-3">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-400">
                            <Banknote
                              size={15}
                              strokeWidth={1.8}
                            />
                          </div>

                          <div className="min-w-0">
                            <p className="text-xs font-medium text-white/70">
                              Repayment
                            </p>

                            <p className="mt-1 truncate font-mono text-[10px] text-white/30">
                              {reference}
                            </p>
                          </div>
                        </div>

                        <div className="text-left sm:text-right">
                          <p className="text-sm font-semibold text-emerald-400">
                            {formatKES(
                              Number.isFinite(amount)
                                ? amount
                                : 0,
                            )}
                          </p>

                          <p className="mt-1 text-[10px] text-white/25">
                            {formatDate(
                              transactionDate,
                            )}
                          </p>
                        </div>
                      </div>

                      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-white/[0.05] pt-2.5 text-[10px] text-white/20">
                        <span>
                          Source:{" "}
                          {transaction.source ||
                            "Unknown"}
                        </span>

                        {transaction.status && (
                          <span>
                            Status:{" "}
                            {transaction.status}
                          </span>
                        )}

                        {transaction.id && (
                          <span className="font-mono">
                            ID: {transaction.id}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                },
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* =========================================================
   HISTORY SUMMARY
========================================================= */

function HistorySummary({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="min-w-0 rounded-xl border border-white/[0.05] bg-white/[0.02] p-3">
      <p className="truncate text-[9px] uppercase tracking-[0.12em] text-white/20">
        {label}
      </p>

      <p className="mt-1 truncate text-xs font-semibold text-white/65">
        {value}
      </p>
    </div>
  );
}

/* =========================================================
   DESKTOP LOAN ROW
========================================================= */

function LoanRow({
  loan,
  onSelectLoan,
  onViewHistory,
}: {
  loan: Loan;
  onSelectLoan?: (loan: Loan) => void;
  onViewHistory: (loan: Loan) => void;
}) {
  const repayable = isRepayable(loan);

  return (
    <tr
      className="
        border-b
        border-slate-200
        bg-white
        transition
        last:border-b-0
        hover:bg-slate-50
      "
    >
      {/* LOAN */}

      <td className="px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold text-black">
            {loan.loanNumber || "—"}
          </p>

          <p className="mt-1 flex items-center gap-1 text-[9px] text-black/60">
            <CalendarDays
              size={10}
              strokeWidth={1.7}
            />

            {formatDate(loan.disbursementDate)}
          </p>
        </div>
      </td>

      {/* MEMBER */}

      <td className="max-w-[190px] px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-xs font-medium text-black">
            {loan.memberName || "Unknown member"}
          </p>

          <p className="mt-1 truncate font-mono text-[9px] text-black/60">
            {loan.memberNumber || "—"}
          </p>
        </div>
      </td>

      {/* TYPE */}

      <td className="px-4 py-3">
        <span className="capitalize text-xs text-black">
          {loan.type || "—"}
        </span>
      </td>

      {/* PRINCIPAL */}

      <td className="whitespace-nowrap px-4 py-3">
        <span className="text-xs font-medium text-black">
          {formatKES(loan.principal)}
        </span>
      </td>

      {/* BALANCE */}

      <td className="whitespace-nowrap px-4 py-3">
        <span className="text-xs font-semibold text-black">
          {formatKES(
            loan.outstandingBalance,
          )}
        </span>
      </td>

      {/* STATUS */}

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
            ${getStatusClass(loan.status)}
          `}
        >
          {loan.status}
        </span>
      </td>

      {/* ACTIONS */}

      <td className="px-4 py-3">
        <div className="flex items-center justify-end gap-1">
          <button
            type="button"
            onClick={() => onViewHistory(loan)}
            className="
              inline-flex
              h-8
              w-8
              items-center
              justify-center
              rounded-lg
              text-black/60
              transition
              hover:bg-slate-100
              hover:text-black
              focus:outline-none
              focus:ring-1
              focus:ring-slate-300
            "
            aria-label={`View transaction history for ${
              loan.loanNumber || "loan"
            }`}
            title="View transaction history"
          >
            <Eye
              size={15}
              strokeWidth={1.8}
            />
          </button>

          {repayable &&
            onSelectLoan && (
              <button
                type="button"
                onClick={() => onSelectLoan(loan)}
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
                title={`Record repayment for ${
                  loan.loanNumber
                }`}
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
   MAIN LOAN TABLE
========================================================= */

export default function LoanTable({
  loans,
  loading = false,
  onSelectLoan,
  onDelete,
}: LoanTableProps) {
  const safeLoans = Array.isArray(loans)
    ? loans
    : [];

  const [selectedLoan, setSelectedLoan] =
    useState<Loan | null>(null);

  const [transactions, setTransactions] =
    useState<LoanTransaction[]>([]);

  const [historyLoading, setHistoryLoading] =
    useState(false);

  const [historyError, setHistoryError] =
    useState("");

  const [historyOpen, setHistoryOpen] =
    useState(false);

  /* =======================================================
     OPEN HISTORY
  ======================================================== */

  async function handleViewHistory(
    loan: Loan,
  ) {
    setSelectedLoan(loan);
    setTransactions([]);
    setHistoryError("");
    setHistoryOpen(true);
    setHistoryLoading(true);

    try {
      const response = await fetch(
        `/api/loans/${encodeURIComponent(
          loan.id,
        )}/repayments`,
        {
          method: "GET",
          cache: "no-store",
          headers: {
            Accept: "application/json",
          },
        },
      );

      const raw = await response.text();

      let result: TransactionsResponse | null =
        null;

      try {
        result = JSON.parse(
          raw,
        ) as TransactionsResponse;
      } catch {
        throw new Error(
          `The transaction history server returned invalid JSON (${response.status}).`,
        );
      }

      if (
        !response.ok ||
        result.success === false
      ) {
        throw new Error(
          result.error ||
            `Unable to load loan transaction history. Server returned ${response.status}.`,
        );
      }

      setTransactions(
        extractTransactions(result),
      );
    } catch (error) {
      console.error(
        "Failed to load loan transaction history:",
        error,
      );

      setHistoryError(
        error instanceof Error
          ? error.message
          : "Unable to load transaction history.",
      );
    } finally {
      setHistoryLoading(false);
    }
  }

  /* =======================================================
     CLOSE HISTORY
  ======================================================== */

  function handleCloseHistory() {
    setHistoryOpen(false);
    setSelectedLoan(null);
    setTransactions([]);
    setHistoryError("");
  }

  /* =======================================================
     RENDER
  ======================================================== */

  return (
    <>
      <section
        className="
          overflow-hidden
          rounded-2xl
          border
          border-slate-200
          bg-white
        "
      >
        {/* SECTION HEADER */}

        <div className="border-b border-slate-200 bg-white px-4 py-4 sm:px-5">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-black">
                Loans
              </h2>

              <p className="mt-0.5 text-xs text-black/60">
                Loan portfolio
              </p>
            </div>

            {!loading && (
              <span className="shrink-0 text-xs text-black/60">
                {safeLoans.length}{" "}
                {safeLoans.length === 1
                  ? "loan"
                  : "loans"}
              </span>
            )}
          </div>
        </div>

        {/* =================================================
            DESKTOP
        ================================================= */}

        <div className="hidden overflow-x-auto bg-white lg:block">
          <div className="min-w-[1050px] bg-white">
            {/* HEADER */}

            <table className="w-full border-collapse bg-white text-left">
              <thead>
                <tr className="border-b border-slate-200 bg-white">
                  <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-black">
                    Loan
                  </th>

                  <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-black">
                    Member
                  </th>

                  <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-black">
                    Type
                  </th>

                  <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-black">
                    Principal
                  </th>

                  <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-black">
                    Balance
                  </th>

                  <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-black">
                    Status
                  </th>

                  <th className="px-4 py-3 text-right text-[10px] font-semibold uppercase tracking-[0.14em] text-black">
                    Actions
                  </th>
                </tr>
              </thead>
            </table>

            {/* BODY */}

            <div className="h-[200px] overflow-y-auto overscroll-contain bg-white scrollbar-thin scrollbar-track-transparent scrollbar-thumb-slate-300 hover:scrollbar-thumb-slate-400">
              <table className="w-full border-collapse bg-white text-left">
                <tbody className="bg-white">
                  {loading ? (
                    <LoadingRows />
                  ) : safeLoans.length === 0 ? (
                    <EmptyState />
                  ) : (
                    safeLoans.map((loan) => (
                      <LoanRow
                        key={loan.id}
                        loan={loan}
                        onSelectLoan={onSelectLoan}
                        onViewHistory={
                          handleViewHistory
                        }
                      />
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* =================================================
            MOBILE — ONE RICH CARD PER VIEW
        ================================================= */}

        <div className="bg-white lg:hidden">
          {loading ? (
            <div className="bg-white p-4">
              <div className="flex min-h-[420px] items-center justify-center rounded-2xl border border-slate-200 bg-slate-50">
                <div className="flex items-center gap-2 text-xs text-black/60">
                  <Loader2
                    size={16}
                    className="animate-spin text-yellow-600"
                  />

                  Loading loans...
                </div>
              </div>
            </div>
          ) : safeLoans.length === 0 ? (
            <div className="flex min-h-[220px] items-center justify-center bg-white p-6 text-center">
              <div>
                <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-2xl border border-yellow-200 bg-yellow-50 text-yellow-600">
                  <Smartphone
                    size={19}
                    strokeWidth={1.7}
                  />
                </div>

                <p className="mt-4 text-sm font-medium text-black">
                  No loans found
                </p>

                <p className="mt-1 text-xs text-black/60">
                  Loan records will appear here.
                </p>
              </div>
            </div>
          ) : (
            <div
              className="
                flex
                snap-x
                snap-mandatory
                gap-4
                overflow-x-auto
                bg-white
                px-4
                py-4
                scroll-smooth
                overscroll-x-contain
                touch-pan-x
                scrollbar-none
              "
            >
              {safeLoans.map((loan) => (
                <div
                  key={loan.id}
                  className="
                    w-full
                    min-w-full
                    shrink-0
                    snap-start
                  "
                >
                  <LoanCard
                    loan={loan}
                    onView={() => handleViewHistory(loan)}
                    onRepay={() => onSelectLoan?.(loan)}
                    onDelete={() => onDelete?.(loan)}
                  />

                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                      <p className="text-[8px] uppercase tracking-[0.12em] text-black/50">
                        Disbursed
                      </p>

                      <p className="mt-1 text-[10px] font-medium text-black">
                        {formatDate(
                          loan.disbursementDate,
                        )}
                      </p>
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                      <p className="text-[8px] uppercase tracking-[0.12em] text-black/50">
                        First Due
                      </p>

                      <p className="mt-1 text-[10px] font-medium text-black">
                        {formatDate(
                          loan.firstDueDate,
                        )}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {!loading &&
            safeLoans.length > 1 && (
              <div className="border-t border-slate-200 bg-white px-4 py-2.5">
                <div className="flex items-center justify-center gap-1.5">
                  {safeLoans
                    .slice(
                      0,
                      Math.min(
                        safeLoans.length,
                        8,
                      ),
                    )
                    .map((loan) => (
                      <span
                        key={`loan-indicator-${loan.id}`}
                        className="
                          h-1
                          w-4
                          rounded-full
                          bg-slate-300
                        "
                      />
                    ))}
                </div>

                <p className="mt-1 text-center text-[9px] text-black/50">
                  Swipe left for more loans
                </p>
              </div>
            )}
        </div>
      </section>

      {/* TRANSACTION HISTORY MODAL */}

      {historyOpen && (
        <LoanTransactionModal
          loan={selectedLoan}
          transactions={transactions}
          loading={historyLoading}
          error={historyError}
          onClose={handleCloseHistory}
        />
      )}
    </>
  );
}