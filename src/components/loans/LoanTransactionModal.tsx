"use client";

import {
  ArrowDownLeft,
  Banknote,
  CheckCircle2,
  CircleAlert,
  Clock3,
  Smartphone,
  UserRound,
  X,
  XCircle,
} from "lucide-react";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import type { Loan } from "@/lib/loans/types";

/* =========================================================
   TYPES
========================================================= */

type LoanTransaction = {
  id?: string;

  loanId?: string;

  amount?: number | string;

  transactionReference?: string;

  reference?: string;

  transactionDate?: string;

  createdAt?: string;

  updatedAt?: string;

  source?: string;

  status?: string;

  rawMessage?: string;

  description?: string;
};

type LoanTransactionResponse = {
  success?: boolean;

  data?: LoanTransaction[];

  transactions?: LoanTransaction[];

  count?: number;

  error?: string;
};

type LoanTransactionModalProps = {
  loan: Loan | null;

  open: boolean;

  onClose: () => void;
};

/* =========================================================
   HELPERS
========================================================= */

function formatKES(
  value: unknown,
): string {
  const amount =
    typeof value === "number"
      ? value
      : Number(value);

  if (
    !Number.isFinite(amount)
  ) {
    return "KES 0.00";
  }

  return `KES ${amount.toLocaleString(
    "en-KE",
    {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    },
  )}`;
}

function formatDate(
  value: unknown,
): string {
  if (
    typeof value !== "string" &&
    !(value instanceof Date)
  ) {
    return "Unknown date";
  }

  const date =
    value instanceof Date
      ? value
      : new Date(value);

  if (
    Number.isNaN(
      date.getTime(),
    )
  ) {
    return "Unknown date";
  }

  return new Intl.DateTimeFormat(
    "en-KE",
    {
      dateStyle: "medium",
      timeStyle: "short",
    },
  ).format(date);
}

function getReference(
  transaction: LoanTransaction,
): string {
  return (
    transaction.transactionReference ||
    transaction.reference ||
    "—"
  );
}

function getSourceLabel(
  source: unknown,
): string {
  if (
    typeof source !== "string" ||
    !source.trim()
  ) {
    return "Unknown";
  }

  switch (
    source
      .trim()
      .toLowerCase()
  ) {
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
  status: unknown,
): string {
  if (
    typeof status !== "string" ||
    !status.trim()
  ) {
    return "Confirmed";
  }

  switch (
    status
      .trim()
      .toLowerCase()
  ) {
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

function getStatusClass(
  status: unknown,
): string {
  if (
    typeof status !== "string"
  ) {
    return "bg-emerald-500/10 text-emerald-400";
  }

  switch (
    status
      .trim()
      .toLowerCase()
  ) {
    case "pending":
      return "bg-yellow-500/10 text-yellow-400";

    case "reversed":
      return "bg-red-500/10 text-red-400";

    case "confirmed":
    default:
      return "bg-emerald-500/10 text-emerald-400";
  }
}

/* =========================================================
   MODAL
========================================================= */

export default function LoanTransactionModal({
  loan,
  open,
  onClose,
}: LoanTransactionModalProps) {
  const [
    transactions,
    setTransactions,
  ] = useState<
    LoanTransaction[]
  >([]);

  const [
    loading,
    setLoading,
  ] = useState(false);

  const [
    error,
    setError,
  ] = useState("");

  /* =======================================================
     LOAD TRANSACTIONS
  ======================================================= */

  const loadTransactions =
    useCallback(
      async () => {
        const currentLoan =
          loan;

        /*
         * IMPORTANT:
         *
         * Never access currentLoan.id before
         * checking that currentLoan exists.
         */

        if (!currentLoan) {
          return;
        }

        const loanId =
          typeof currentLoan.id ===
          "string"
            ? currentLoan.id.trim()
            : "";

        if (!loanId) {
          setTransactions(
            [],
          );

          setError(
            "This loan does not have a valid ID.",
          );

          return;
        }

        setLoading(true);
        setError("");

        try {
          const params =
            new URLSearchParams();

          params.set(
            "loanId",
            loanId,
          );

          const response =
            await fetch(
              `/api/loans/repayments?${params.toString()}`,
              {
                method: "GET",

                credentials:
                  "same-origin",

                cache:
                  "no-store",

                headers: {
                  Accept:
                    "application/json",
                },
              },
            );

          const rawResponse =
            await response.text();

          let result:
            | LoanTransactionResponse
            | null =
            null;

          try {
            result =
              JSON.parse(
                rawResponse,
              ) as LoanTransactionResponse;
          } catch {
            result =
              null;
          }

          if (
            !response.ok
          ) {
            throw new Error(
              result?.error ||
                `Failed to load loan transactions (${response.status}).`,
            );
          }

          if (
            result?.success ===
            false
          ) {
            throw new Error(
              result.error ||
                "Failed to load loan transactions.",
            );
          }

          const records =
            Array.isArray(
              result?.data,
            )
              ? result.data
              : Array.isArray(
                    result?.transactions,
                  )
                ? result.transactions
                : [];

          setTransactions(
            records,
          );
        } catch (
          requestError
        ) {
          console.error(
            "Loan transaction history error:",
            requestError,
          );

          setTransactions(
            []);

          setError(
            requestError instanceof Error
              ? requestError.message
              : "Failed to load loan transaction history.",
          );
        } finally {
          setLoading(
            false,
          );
        }
      },
      [loan],
    );

  /* =======================================================
     LOAD WHEN OPEN
  ======================================================= */

  useEffect(() => {
    if (
      !open ||
      !loan
    ) {
      return;
    }

    void loadTransactions();
  }, [
    open,
    loan,
    loadTransactions,
  ]);

  /* =======================================================
     TOTAL REPAYMENTS
  ======================================================= */

  const totalRepayments =
    useMemo(() => {
      return transactions.reduce(
        (
          total,
          transaction,
        ) => {
          const amount =
            Number(
              transaction.amount,
            );

          if (
            !Number.isFinite(
              amount,
            )
          ) {
            return total;
          }

          return (
            total + amount
          );
        },
        0,
      );
    }, [
      transactions,
    ]);

  /* =======================================================
     ESCAPE KEY
  ======================================================= */

  useEffect(() => {
    if (!open) {
      return;
    }

    const handleKeyDown =
      (event: KeyboardEvent) => {
        if (
          event.key ===
          "Escape"
        ) {
          onClose();
        }
      };

    window.addEventListener(
      "keydown",
      handleKeyDown,
    );

    return () => {
      window.removeEventListener(
        "keydown",
        handleKeyDown,
      );
    };
  }, [
    open,
    onClose,
  ]);

  /* =======================================================
     CLOSED
  ======================================================= */

  if (
    !open ||
    !loan
  ) {
    return null;
  }

  /* =======================================================
     UI
  ======================================================= */

  return (
    <div
      className="
        fixed
        inset-0
        z-[100]
        flex
        items-center
        justify-center
        bg-black/75
        p-3
        backdrop-blur-sm
        sm:p-5
      "
      role="dialog"
      aria-modal="true"
      aria-labelledby="loan-history-title"
      onMouseDown={(event) => {
        if (
          event.target ===
          event.currentTarget
        ) {
          onClose();
        }
      }}
    >
      <section
        className="
          flex
          max-h-[90vh]
          w-full
          max-w-4xl
          flex-col
          overflow-hidden
          rounded-2xl
          border
          border-white/[0.08]
          bg-[#0b0b0b]
          shadow-[0_30px_100px_rgba(0,0,0,0.6)]
        "
      >
        {/* =================================================
            HEADER
        ================================================= */}

        <header
          className="
            flex
            shrink-0
            items-start
            justify-between
            gap-4
            border-b
            border-white/[0.06]
            px-4
            py-4
            sm:px-5
          "
        >
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <div
                className="
                  flex
                  h-8
                  w-8
                  shrink-0
                  items-center
                  justify-center
                  rounded-lg
                  bg-yellow-500/10
                  text-yellow-400
                "
              >
                <Banknote
                  size={16}
                  strokeWidth={1.8}
                />
              </div>

              <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-yellow-500/60">
                Loan History
              </span>
            </div>

            <h2
              id="loan-history-title"
              className="mt-2 truncate text-lg font-semibold text-white"
            >
              {loan.loanNumber ||
                "Loan"}
            </h2>

            <p className="mt-1 truncate text-xs text-white/30">
              {loan.memberName ||
                "Unknown member"}{" "}
              ·{" "}
              {loan.memberNumber ||
                "—"}
            </p>
          </div>

          <button
            type="button"
            onClick={
              onClose
            }
            className="
              flex
              h-9
              w-9
              shrink-0
              items-center
              justify-center
              rounded-lg
              text-white/30
              transition
              hover:bg-white/[0.06]
              hover:text-white
            "
            aria-label="Close"
            title="Close"
          >
            <X
              size={18}
              strokeWidth={1.8}
            />
          </button>
        </header>

        {/* =================================================
            LOAN SUMMARY
        ================================================= */}

        <div
          className="
            grid
            shrink-0
            grid-cols-2
            gap-2
            border-b
            border-white/[0.06]
            p-4
            sm:grid-cols-4
          "
        >
          <SummaryBox
            label="Principal"
            value={formatKES(
              loan.principal,
            )}
          />

          <SummaryBox
            label="Paid"
            value={formatKES(
              loan.amountPaid,
            )}
          />

          <SummaryBox
            label="Outstanding"
            value={formatKES(
              loan.outstandingBalance,
            )}
            highlight
          />

          <SummaryBox
            label="Repayments"
            value={formatKES(
              totalRepayments,
            )}
          />
        </div>

        {/* =================================================
            ERROR
        ================================================= */}

        {error && (
          <div className="mx-4 mt-4 shrink-0 rounded-xl border border-red-500/15 bg-red-500/[0.04] p-3">
            <div className="flex items-start gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-red-500/10 text-red-400">
                <CircleAlert
                  size={16}
                  strokeWidth={1.8}
                />
              </div>

              <div className="min-w-0">
                <p className="text-xs font-medium text-red-300">
                  Transaction history unavailable
                </p>

                <p className="mt-1 break-words text-[10px] leading-5 text-red-300/55">
                  {error}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* =================================================
            CONTENT
        ================================================= */}

        <div
          className="
            min-h-0
            flex-1
            overflow-y-auto
            p-4
            scrollbar-thin
            scrollbar-track-transparent
            scrollbar-thumb-white/10
          "
        >
          {loading ? (
            <div className="space-y-2">
              {Array.from(
                {
                  length: 3,
                },
                (
                  _,
                  index,
                ) => (
                  <div
                    key={
                      index
                    }
                    className="
                      h-[88px]
                      animate-pulse
                      rounded-xl
                      border
                      border-white/[0.05]
                      bg-white/[0.025]
                    "
                  />
                ),
              )}
            </div>
          ) : transactions.length ===
            0 ? (
            <div
              className="
                flex
                min-h-[250px]
                items-center
                justify-center
                rounded-xl
                border
                border-dashed
                border-white/[0.08]
                bg-white/[0.012]
                p-6
              "
            >
              <div className="max-w-sm text-center">
                <div
                  className="
                    mx-auto
                    flex
                    h-12
                    w-12
                    items-center
                    justify-center
                    rounded-2xl
                    bg-white/[0.04]
                    text-white/25
                  "
                >
                  <ArrowDownLeft
                    size={21}
                    strokeWidth={1.7}
                  />
                </div>

                <p className="mt-4 text-sm font-medium text-white/55">
                  No repayment transactions
                </p>

                <p className="mt-1 text-xs leading-5 text-white/25">
                  No repayments have been
                  recorded against this loan.
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {transactions.map(
                (
                  transaction,
                  index,
                ) => {
                  const amount =
                    Number(
                      transaction.amount,
                    );

                  const validAmount =
                    Number.isFinite(
                      amount,
                    );

                  const positive =
                    validAmount &&
                    amount > 0;

                  const transactionDate =
                    transaction.transactionDate ||
                    transaction.createdAt ||
                    transaction.updatedAt;

                  const reference =
                    getReference(
                      transaction,
                    );

                  return (
                    <article
                      key={
                        transaction.id ||
                        `${loan.id}-transaction-${index}`
                      }
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
                      {/* TOP ROW */}

                      <div className="flex items-center justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-3">
                          <div
                            className="
                              flex
                              h-9
                              w-9
                              shrink-0
                              items-center
                              justify-center
                              rounded-xl
                              bg-emerald-500/10
                              text-emerald-400
                            "
                          >
                            <ArrowDownLeft
                              size={16}
                              strokeWidth={1.8}
                            />
                          </div>

                          <div className="min-w-0">
                            <p className="truncate text-xs font-medium text-white/75">
                              Loan repayment
                            </p>

                            <p className="mt-0.5 truncate font-mono text-[10px] text-white/25">
                              {reference}
                            </p>
                          </div>
                        </div>

                        <span
                          className={`
                            shrink-0
                            text-xs
                            font-semibold
                            ${
                              positive
                                ? "text-emerald-400"
                                : "text-white/60"
                            }
                          `}
                        >
                          {positive
                            ? "+"
                            : ""}
                          {formatKES(
                            transaction.amount,
                          )}
                        </span>
                      </div>

                      {/* DETAILS */}

                      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                        <TransactionDetail
                          icon={
                            <Smartphone
                              size={12}
                              strokeWidth={1.8}
                            />
                          }
                          label="Source"
                          value={getSourceLabel(
                            transaction.source,
                          )}
                        />

                        <TransactionDetail
                          icon={
                            <Clock3
                              size={12}
                              strokeWidth={1.8}
                            />
                          }
                          label="Date"
                          value={formatDate(
                            transactionDate,
                          )}
                        />

                        <TransactionDetail
                          icon={
                            transaction.status
                              ?.toLowerCase() ===
                            "reversed" ? (
                              <XCircle
                                size={12}
                                strokeWidth={1.8}
                              />
                            ) : (
                              <CheckCircle2
                                size={12}
                                strokeWidth={1.8}
                              />
                            )
                          }
                          label="Status"
                          value={getStatusLabel(
                            transaction.status,
                          )}
                        />

                        <TransactionDetail
                          icon={
                            <UserRound
                              size={12}
                              strokeWidth={1.8}
                            />
                          }
                          label="Reference"
                          value={reference}
                        />
                      </div>

                      {/* STATUS */}

                      <div className="mt-2 flex items-center justify-between gap-2">
                        <span
                          className={`
                            inline-flex
                            rounded-lg
                            px-2
                            py-1
                            text-[9px]
                            font-medium
                            ${getStatusClass(
                              transaction.status,
                            )}
                          `}
                        >
                          {getStatusLabel(
                            transaction.status,
                          )}
                        </span>

                        {transaction.description && (
                          <p className="truncate text-[9px] text-white/20">
                            {
                              transaction.description
                            }
                          </p>
                        )}
                      </div>

                      {/* RAW SMS */}

                      {transaction.rawMessage && (
                        <details className="mt-3 rounded-lg bg-black/20">
                          <summary className="cursor-pointer px-3 py-2 text-[9px] uppercase tracking-[0.12em] text-white/20">
                            Source message
                          </summary>

                          <p className="border-t border-white/[0.04] px-3 py-2.5 text-[10px] leading-5 text-white/35">
                            {
                              transaction.rawMessage
                            }
                          </p>
                        </details>
                      )}
                    </article>
                  );
                },
              )}
            </div>
          )}
        </div>

        {/* =================================================
            FOOTER
        ================================================= */}

        <footer
          className="
            flex
            shrink-0
            items-center
            justify-between
            gap-3
            border-t
            border-white/[0.06]
            px-4
            py-3
            sm:px-5
          "
        >
          <div className="min-w-0">
            <p className="text-[10px] text-white/20">
              {transactions.length.toLocaleString(
                "en-KE",
              )}{" "}
              {transactions.length ===
              1
                ? "transaction"
                : "transactions"}
            </p>
          </div>

          <button
            type="button"
            onClick={
              onClose
            }
            className="
              inline-flex
              h-9
              shrink-0
              items-center
              justify-center
              rounded-lg
              border
              border-white/[0.08]
              bg-white/[0.025]
              px-4
              text-xs
              font-medium
              text-white/50
              transition
              hover:bg-white/[0.05]
              hover:text-white
            "
          >
            Close
          </button>
        </footer>
      </section>
    </div>
  );
}

/* =========================================================
   SUMMARY BOX
========================================================= */

function SummaryBox({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="min-w-0 rounded-xl border border-white/[0.05] bg-white/[0.02] p-3">
      <p className="text-[9px] uppercase tracking-[0.14em] text-white/20">
        {label}
      </p>

      <p
        className={`
          mt-1
          truncate
          text-sm
          font-semibold
          ${
            highlight
              ? "text-yellow-400"
              : "text-white/75"
          }
        `}
      >
        {value}
      </p>
    </div>
  );
}

/* =========================================================
   TRANSACTION DETAIL
========================================================= */

function TransactionDetail({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="min-w-0 rounded-lg bg-black/15 px-2.5 py-2">
      <div className="flex items-center gap-1.5 text-white/20">
        {icon}

        <span className="text-[8px] uppercase tracking-[0.1em]">
          {label}
        </span>
      </div>

      <p className="mt-1 truncate text-[10px] text-white/45">
        {value}
      </p>
    </div>
  );
}
