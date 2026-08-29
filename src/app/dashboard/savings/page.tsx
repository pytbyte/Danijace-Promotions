"use client";

import {
  AlertCircle,
  ArrowDownLeft,
  ArrowUpRight,
  FileEdit,
  Loader2,
  RefreshCw,
  RotateCcw,
  Users,
  Wallet,
  X,
} from "lucide-react";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import TopBar from "@/components/dashboard/TopBar";
import SavingsForm from "@/components/dashboard/savings/SavingsForm";
import SavingsHeader from "@/components/dashboard/savings/SavingsHeader";
import SavingsSearch, {
  type SavingsSearchFilters,
} from "@/components/dashboard/savings/SavingsSearch";
import SavingsTable from "@/components/dashboard/savings/SavingsTable";
import SavingsTransactionCard from "@/components/dashboard/savings/SavingsTransactionCard";

import type { SavingsTransaction } from "@/lib/savings/types";

/* =========================================================
   CONSTANTS
========================================================= */

const SUMMARY_ENDPOINT = "/api/savings/summary";
const TRANSACTIONS_ENDPOINT = "/api/savings/transactions";

const API_PAGE_LIMIT = 100;

const DEFAULT_FILTERS: SavingsSearchFilters = {
  search: "",
  type: "",
  source: "",
  status: "",
};

/* =========================================================
   TYPES
========================================================= */

type SummaryData = {
  totalBalance: number;
  totalDeposits: number;
  totalAdjustments: number;
  totalReversals: number;
  memberCount: number;
};

type SummaryApiResponse = {
  success?: boolean;
  data?: Partial<SummaryData> | null;
  error?: string;
};

type TransactionPageData = {
  transactions?: unknown;
  total?: unknown;
  page?: unknown;
  limit?: unknown;
  totalPages?: unknown;
};

type TransactionsApiResponse = {
  success?: boolean;
  data?: TransactionPageData | unknown[] | null;
  transactions?: unknown;
  total?: unknown;
  page?: unknown;
  limit?: unknown;
  totalPages?: unknown;
  error?: string;
};

type TransactionPageResult = {
  transactions: SavingsTransaction[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
};

type ActionApiResponse = {
  success?: boolean;
  message?: string;
  error?: string;
  transaction?: unknown;
  data?: unknown;
};

type ActionType = "adjust" | "reverse";

/* =========================================================
   DEFAULT SUMMARY
========================================================= */

const DEFAULT_SUMMARY: SummaryData = {
  totalBalance: 0,
  totalDeposits: 0,
  totalAdjustments: 0,
  totalReversals: 0,
  memberCount: 0,
};

/* =========================================================
   HELPERS
========================================================= */

function safeNumber(value: unknown): number {
  if (
    typeof value === "number" &&
    Number.isFinite(value)
  ) {
    return value;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();

    if (!trimmed) {
      return 0;
    }

    const parsed = Number(trimmed);

    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return 0;
}

function safePositiveInteger(
  value: unknown,
  fallback: number
): number {
  const number = safeNumber(value);

  if (
    Number.isInteger(number) &&
    number > 0
  ) {
    return number;
  }

  return fallback;
}

function normalizeDate(value: unknown): string {
  if (
    typeof value === "string" &&
    value.trim()
  ) {
    const date = new Date(value);

    if (!Number.isNaN(date.getTime())) {
      return date.toISOString();
    }
  }

  if (
    typeof value === "number" &&
    Number.isFinite(value)
  ) {
    const date = new Date(value);

    if (!Number.isNaN(date.getTime())) {
      return date.toISOString();
    }
  }

  if (
    value &&
    typeof value === "object"
  ) {
    const objectValue =
      value as {
        $date?: unknown;
      };

    if (
      typeof objectValue.$date === "string" &&
      objectValue.$date.trim()
    ) {
      const date = new Date(
        objectValue.$date
      );

      if (!Number.isNaN(date.getTime())) {
        return date.toISOString();
      }
    }

    if (
      typeof objectValue.$date === "number" &&
      Number.isFinite(objectValue.$date)
    ) {
      const date = new Date(
        objectValue.$date
      );

      if (!Number.isNaN(date.getTime())) {
        return date.toISOString();
      }
    }
  }

  return new Date(0).toISOString();
}

function normalizeTransaction(
  value: unknown
): SavingsTransaction | null {
  if (
    !value ||
    typeof value !== "object"
  ) {
    return null;
  }

  const raw =
    value as Record<string, unknown>;

  if (
    typeof raw.id !== "string" ||
    !raw.id.trim()
  ) {
    return null;
  }

  if (
    typeof raw.memberId !== "string" ||
    !raw.memberId.trim()
  ) {
    return null;
  }

  return {
    ...raw,

    id: raw.id,

    memberId: raw.memberId,

    memberName:
      typeof raw.memberName === "string"
        ? raw.memberName
        : "",

    amount: safeNumber(
      raw.amount
    ),

    transactionAt:
      normalizeDate(
        raw.transactionAt
      ),

    createdAt:
      normalizeDate(
        raw.createdAt
      ),

    updatedAt:
      normalizeDate(
        raw.updatedAt
      ),
  } as SavingsTransaction;
}

function extractTransactions(
  result: TransactionsApiResponse
): SavingsTransaction[] {
  let source: unknown[] = [];

  if (
    Array.isArray(result.data)
  ) {
    source = result.data;
  } else if (
    result.data &&
    typeof result.data === "object" &&
    !Array.isArray(result.data)
  ) {
    const data =
      result.data as TransactionPageData;

    if (
      Array.isArray(
        data.transactions
      )
    ) {
      source =
        data.transactions;
    }
  }

  if (
    source.length === 0 &&
    Array.isArray(
      result.transactions
    )
  ) {
    source =
      result.transactions;
  }

  return source
    .map(normalizeTransaction)
    .filter(
      (
        transaction
      ): transaction is SavingsTransaction =>
        transaction !== null
    );
}

function extractPagination(
  result: TransactionsApiResponse
): {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
} {
  let total: unknown;
  let page: unknown;
  let limit: unknown;
  let totalPages: unknown;

  if (
    result.data &&
    typeof result.data === "object" &&
    !Array.isArray(result.data)
  ) {
    const data =
      result.data as TransactionPageData;

    total = data.total;
    page = data.page;
    limit = data.limit;
    totalPages =
      data.totalPages;
  }

  if (
    total === undefined
  ) {
    total = result.total;
  }

  if (
    page === undefined
  ) {
    page = result.page;
  }

  if (
    limit === undefined
  ) {
    limit = result.limit;
  }

  if (
    totalPages === undefined
  ) {
    totalPages =
      result.totalPages;
  }

  const safeLimit =
    safePositiveInteger(
      limit,
      API_PAGE_LIMIT
    );

  const safeTotal =
    Math.max(
      0,
      Math.floor(
        safeNumber(total)
      )
    );

  const safePage =
    safePositiveInteger(
      page,
      1
    );

  const calculatedTotalPages =
    safeTotal > 0
      ? Math.ceil(
          safeTotal /
            safeLimit
        )
      : 1;

  const safeTotalPages =
    Math.max(
      1,
      safePositiveInteger(
        totalPages,
        calculatedTotalPages
      )
    );

  return {
    total: safeTotal,
    page: safePage,
    limit: safeLimit,
    totalPages:
      safeTotalPages,
  };
}

function sortTransactions(
  transactions: SavingsTransaction[]
): SavingsTransaction[] {
  return [
    ...transactions,
  ].sort(
    (a, b) => {
      const aTime =
        new Date(
          a.transactionAt
        ).getTime();

      const bTime =
        new Date(
          b.transactionAt
        ).getTime();

      const aValid =
        !Number.isNaN(
          aTime
        );

      const bValid =
        !Number.isNaN(
          bTime
        );

      if (
        !aValid &&
        !bValid
      ) {
        return 0;
      }

      if (!aValid) {
        return 1;
      }

      if (!bValid) {
        return -1;
      }

      return bTime - aTime;
    }
  );
}

function deduplicateTransactions(
  transactions: SavingsTransaction[]
): SavingsTransaction[] {
  const map =
    new Map<
      string,
      SavingsTransaction
    >();

  for (
    const transaction of
      transactions
  ) {
    if (
      !map.has(
        transaction.id
      )
    ) {
      map.set(
        transaction.id,
        transaction
      );
    }
  }

  return Array.from(
    map.values()
  );
}

function isAbortError(
  error: unknown
): boolean {
  return (
    error instanceof
      DOMException &&
    error.name ===
      "AbortError"
  );
}

function getErrorMessage(
  error: unknown,
  fallback: string
): string {
  if (
    error instanceof
    Error
  ) {
    return error.message;
  }

  if (
    typeof error === "string" &&
    error.trim()
  ) {
    return error;
  }

  return fallback;
}

function formatKES(
  value: number
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
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }
  ).format(amount);
}

/* =========================================================
   SUMMARY CARD
========================================================= */

function SummaryCard({
  label,
  value,
  icon,
  loading,
  valueClassName = "text-white",
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  loading: boolean;
  valueClassName?: string;
}) {
  return (
    <div
      className="
        rounded-2xl
        border
        border-white/[0.08]
        bg-[#0b0b0b]
        p-4
        sm:p-5
      "
    >
      <div className="flex items-start justify-between gap-3">
        <div
          className="
            flex
            h-9
            w-9
            shrink-0
            items-center
            justify-center
            rounded-xl
            bg-yellow-500/10
            text-yellow-400
          "
        >
          {icon}
        </div>
      </div>

      <p className="mt-4 text-[10px] font-medium uppercase tracking-[0.14em] text-white/25">
        {label}
      </p>

      {loading ? (
        <div className="mt-2 h-6 w-28 animate-pulse rounded-lg bg-white/[0.05]" />
      ) : (
        <p
          className={`
            mt-2
            truncate
            text-lg
            font-semibold
            ${valueClassName}
          `}
        >
          {value}
        </p>
      )}
    </div>
  );
}

/* =========================================================
   ACTION MODAL
========================================================= */

function SavingsActionModal({
  action,
  transaction,
  amount,
  reason,
  loading,
  error,
  onAmountChange,
  onReasonChange,
  onClose,
  onSubmit,
}: {
  action: ActionType | null;
  transaction: SavingsTransaction | null;
  amount: string;
  reason: string;
  loading: boolean;
  error: string | null;
  onAmountChange: (
    value: string
  ) => void;
  onReasonChange: (
    value: string
  ) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  if (
    !action ||
    !transaction
  ) {
    return null;
  }

  const isAdjustment =
    action === "adjust";

  const title =
    isAdjustment
      ? "Adjust savings transaction"
      : "Reverse savings transaction";

  const description =
    isAdjustment
      ? "Create a new signed ledger adjustment. The original transaction will remain unchanged."
      : "Create a new reversal entry. The original transaction will remain unchanged.";

  const canSubmit =
    reason.trim().length > 0 &&
    (!isAdjustment ||
      (amount.trim().length > 0 &&
        Number.isFinite(
          Number(amount)
        ) &&
        Number(amount) !== 0));

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
        px-4
        py-6
        backdrop-blur-sm
      "
      role="dialog"
      aria-modal="true"
      aria-labelledby="savings-action-title"
    >
      <div
        className="
          w-full
          max-w-lg
          overflow-hidden
          rounded-2xl
          border
          border-white/[0.09]
          bg-[#0b0b0b]
          shadow-2xl
        "
      >
        {/* HEADER */}

        <div
          className="
            flex
            items-start
            justify-between
            gap-4
            border-b
            border-white/[0.07]
            px-5
            py-4
          "
        >
          <div>
            <h2
              id="savings-action-title"
              className="text-sm font-semibold text-white"
            >
              {title}
            </h2>

            <p className="mt-1 text-xs leading-5 text-white/35">
              {description}
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="
              flex
              h-8
              w-8
              shrink-0
              items-center
              justify-center
              rounded-lg
              text-white/35
              transition
              hover:bg-white/[0.05]
              hover:text-white
              disabled:cursor-not-allowed
              disabled:opacity-40
            "
            aria-label="Close"
          >
            <X
              size={17}
            />
          </button>
        </div>

        {/* BODY */}

        <div className="space-y-5 p-5">
          {/* ORIGINAL */}

          <div
            className="
              rounded-xl
              border
              border-white/[0.07]
              bg-black/30
              p-4
            "
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-[10px] uppercase tracking-[0.12em] text-white/25">
                  Original transaction
                </p>

                <p className="mt-1 truncate text-xs font-medium text-white/65">
                  {transaction.id}
                </p>

                <p className="mt-1 text-xs text-white/30">
                  {transaction.memberName ||
                    transaction.memberId}
                </p>
              </div>

              <p
                className={`
                  shrink-0
                  text-sm
                  font-semibold
                  ${
                    transaction.amount >=
                    0
                      ? "text-emerald-400"
                      : "text-red-400"
                  }
                `}
              >
                {formatKES(
                  transaction.amount
                )}
              </p>
            </div>
          </div>

          {/* ADJUSTMENT AMOUNT */}

          {isAdjustment && (
            <div>
              <label
                htmlFor="adjustment-amount"
                className="mb-2 block text-[11px] font-medium text-white/50"
              >
                Adjustment amount
              </label>

              <input
                id="adjustment-amount"
                type="number"
                inputMode="decimal"
                step="0.01"
                value={amount}
                onChange={(event) =>
                  onAmountChange(
                    event.target.value
                  )
                }
                disabled={loading}
                placeholder="e.g. 200 or -200"
                className="
                  h-11
                  w-full
                  rounded-xl
                  border
                  border-white/[0.08]
                  bg-black/40
                  px-3
                  text-sm
                  text-white
                  outline-none
                  transition
                  placeholder:text-white/20
                  focus:border-yellow-500/40
                  disabled:cursor-not-allowed
                  disabled:opacity-50
                "
              />

              <p className="mt-1.5 text-[10px] leading-4 text-white/25">
                Positive increases the balance. Negative decreases
                the balance. Zero is not allowed.
              </p>
            </div>
          )}

          {/* REASON */}

          <div>
            <label
              htmlFor="savings-action-reason"
              className="mb-2 block text-[11px] font-medium text-white/50"
            >
              {isAdjustment
                ? "Adjustment reason"
                : "Reversal reason"}
            </label>

            <textarea
              id="savings-action-reason"
              value={reason}
              onChange={(event) =>
                onReasonChange(
                  event.target.value
                )
              }
              disabled={loading}
              maxLength={500}
              rows={4}
              placeholder={
                isAdjustment
                  ? "Explain why this financial correction is required..."
                  : "Explain why this transaction must be reversed..."
              }
              className="
                w-full
                resize-none
                rounded-xl
                border
                border-white/[0.08]
                bg-black/40
                px-3
                py-3
                text-sm
                leading-5
                text-white
                outline-none
                transition
                placeholder:text-white/20
                focus:border-yellow-500/40
                disabled:cursor-not-allowed
                disabled:opacity-50
              "
            />

            <div className="mt-1 flex justify-end">
              <span className="text-[10px] text-white/20">
                {reason.length}/500
              </span>
            </div>
          </div>

          {/* WARNING */}

          <div
            className="
              rounded-xl
              border
              border-yellow-500/10
              bg-yellow-500/[0.04]
              px-3
              py-3
            "
          >
            <p className="text-[11px] leading-5 text-yellow-400/60">
              This operation creates a new financial ledger entry.
              The original transaction will not be deleted or have
              its amount changed.
            </p>
          </div>

          {/* ERROR */}

          {error && (
            <div
              role="alert"
              className="
                flex
                items-start
                gap-2.5
                rounded-xl
                border
                border-red-500/15
                bg-red-500/[0.05]
                px-3
                py-3
              "
            >
              <AlertCircle
                size={15}
                className="
                  mt-0.5
                  shrink-0
                  text-red-400
                "
              />

              <p className="text-xs leading-5 text-red-400/80">
                {error}
              </p>
            </div>
          )}
        </div>

        {/* FOOTER */}

        <div
          className="
            flex
            flex-col-reverse
            gap-2
            border-t
            border-white/[0.07]
            px-5
            py-4
            sm:flex-row
            sm:justify-end
          "
        >
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="
              h-10
              rounded-xl
              border
              border-white/[0.08]
              bg-white/[0.02]
              px-4
              text-xs
              font-medium
              text-white/50
              transition
              hover:bg-white/[0.05]
              hover:text-white
              disabled:cursor-not-allowed
              disabled:opacity-40
            "
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={onSubmit}
            disabled={
              loading ||
              !canSubmit
            }
            className={`
              inline-flex
              h-10
              items-center
              justify-center
              gap-2
              rounded-xl
              px-4
              text-xs
              font-semibold
              transition
              disabled:cursor-not-allowed
              disabled:opacity-40
              ${
                isAdjustment
                  ? "bg-yellow-500 text-black hover:bg-yellow-400"
                  : "bg-red-500 text-white hover:bg-red-400"
              }
            `}
          >
            {loading ? (
              <>
                <Loader2
                  size={14}
                  className="animate-spin"
                />

                Processing...
              </>
            ) : isAdjustment ? (
              <>
                <FileEdit
                  size={14}
                />

                Create Adjustment
              </>
            ) : (
              <>
                <RotateCcw
                  size={14}
                />

                Reverse Transaction
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

/* =========================================================
   PAGE
========================================================= */

export default function SavingsPage() {
  /* =======================================================
     FILTERS
  ======================================================= */

  const [
    filters,
    setFilters,
  ] = useState<SavingsSearchFilters>(
    DEFAULT_FILTERS
  );

  /* =======================================================
     FORM
  ======================================================= */

  const [
    formOpen,
    setFormOpen,
  ] = useState(false);

  /* =======================================================
     TRANSACTIONS
  ======================================================= */

  const [
    transactions,
    setTransactions,
  ] = useState<
    SavingsTransaction[]
  >([]);

  const [
    transactionsLoading,
    setTransactionsLoading,
  ] = useState(true);

  const [
    transactionsError,
    setTransactionsError,
  ] = useState<
    string | null
  >(null);

  const [
    transactionsTotal,
    setTransactionsTotal,
  ] = useState(0);

  /* =======================================================
     SUMMARY
  ======================================================= */

  const [
    summary,
    setSummary,
  ] = useState<SummaryData>(
    DEFAULT_SUMMARY
  );

  const [
    summaryLoading,
    setSummaryLoading,
  ] = useState(true);

  const [
    summaryError,
    setSummaryError,
  ] = useState<
    string | null
  >(null);

  /* =======================================================
     REFRESH
  ======================================================= */

  const [
    refreshing,
    setRefreshing,
  ] = useState(false);

  const requestSequence =
    useRef(0);

  /* =======================================================
     ACTION MODAL
  ======================================================= */

  const [
    action,
    setAction,
  ] = useState<
    ActionType | null
  >(null);

  const [
    actionTransaction,
    setActionTransaction,
  ] = useState<
    SavingsTransaction | null
  >(null);

  const [
    actionAmount,
    setActionAmount,
  ] = useState("");

  const [
    actionReason,
    setActionReason,
  ] = useState("");

  const [
    actionLoading,
    setActionLoading,
  ] = useState(false);

  const [
    actionError,
    setActionError,
  ] = useState<
    string | null
  >(null);

  /* =======================================================
     LOAD SUMMARY
  ======================================================= */

  const loadSummary =
    useCallback(
      async (
        signal?: AbortSignal
      ) => {
        setSummaryLoading(
          true
        );
        setSummaryError(
          null
        );

        try {
          const response =
            await fetch(
              SUMMARY_ENDPOINT,
              {
                method:
                  "GET",
                cache:
                  "no-store",
                credentials:
                  "same-origin",
                headers: {
                  Accept:
                    "application/json",
                },
                signal,
              }
            );

          let result:
            | SummaryApiResponse
            | null =
            null;

          try {
            result =
              (await response.json()) as SummaryApiResponse;
          } catch {
            result =
              null;
          }

          if (
            !response.ok
          ) {
            throw new Error(
              result?.error ||
                `Failed to load savings summary (${response.status}).`
            );
          }

          if (
            result?.success ===
            false
          ) {
            throw new Error(
              result.error ||
                "Failed to load savings summary."
            );
          }

          const data =
            result?.data ||
            {};

          setSummary({
            totalBalance:
              safeNumber(
                data.totalBalance
              ),

            totalDeposits:
              safeNumber(
                data.totalDeposits
              ),

            totalAdjustments:
              safeNumber(
                data.totalAdjustments
              ),

            totalReversals:
              safeNumber(
                data.totalReversals
              ),

            memberCount:
              safeNumber(
                data.memberCount
              ),
          });
        } catch (
          error
        ) {
          if (
            isAbortError(
              error
            )
          ) {
            return;
          }

          console.error(
            "Savings summary loading error:",
            error
          );

          setSummaryError(
            getErrorMessage(
              error,
              "Failed to load savings summary."
            )
          );
        } finally {
          if (
            !signal?.aborted
          ) {
            setSummaryLoading(
              false
            );
          }
        }
      },
      []
    );

  /* =======================================================
     FETCH ONE TRANSACTION PAGE
  ======================================================= */

  const fetchTransactionPage =
    useCallback(
      async (
        page: number,
        signal?: AbortSignal
      ): Promise<TransactionPageResult> => {
        const params =
          new URLSearchParams();

        params.set(
          "page",
          String(page)
        );

        params.set(
          "limit",
          String(
            API_PAGE_LIMIT
          )
        );

        const response =
          await fetch(
            `${TRANSACTIONS_ENDPOINT}?${params.toString()}`,
            {
              method:
                "GET",
              cache:
                "no-store",
              credentials:
                "same-origin",
              headers: {
                Accept:
                  "application/json",
              },
              signal,
            }
          );

        let result:
          | TransactionsApiResponse
          | null =
          null;

        try {
          result =
            (await response.json()) as TransactionsApiResponse;
        } catch {
          result =
            null;
        }

        if (
          !response.ok
        ) {
          throw new Error(
            result?.error ||
              `Failed to load savings transactions (${response.status}).`
          );
        }

        if (
          result?.success ===
          false
        ) {
          throw new Error(
            result.error ||
              "Failed to load savings transactions."
          );
        }

        const normalized =
          extractTransactions(
            result || {}
          );

        const pagination =
          extractPagination(
            result || {}
          );

        return {
          transactions:
            normalized,
          ...pagination,
        };
      },
      []
    );

  /* =======================================================
     LOAD TRANSACTIONS
  ======================================================= */

  const loadTransactions =
    useCallback(
      async (
        signal?: AbortSignal
      ) => {
        setTransactionsLoading(
          true
        );
        setTransactionsError(
          null
        );

        try {
          const firstPage =
            await fetchTransactionPage(
              1,
              signal
            );

          if (
            signal?.aborted
          ) {
            return;
          }

          let allTransactions =
            [
              ...firstPage.transactions,
            ];

          if (
            firstPage.totalPages >
            1
          ) {
            const remainingPages =
              Array.from(
                {
                  length:
                    firstPage.totalPages -
                    1,
                },
                (
                  _,
                  index
                ) =>
                  index + 2
              );

            const pageResults =
              await Promise.all(
                remainingPages.map(
                  (
                    page
                  ) =>
                    fetchTransactionPage(
                      page,
                      signal
                    )
                )
              );

            if (
              signal?.aborted
            ) {
              return;
            }

            for (
              const pageResult of
                pageResults
            ) {
              allTransactions =
                allTransactions.concat(
                  pageResult.transactions
                );
            }
          }

          const uniqueTransactions =
            deduplicateTransactions(
              allTransactions
            );

          const sortedTransactions =
            sortTransactions(
              uniqueTransactions
            );

          setTransactions(
            sortedTransactions
          );

          setTransactionsTotal(
            firstPage.total >
              0
              ? firstPage.total
              : sortedTransactions.length
          );
        } catch (
          error
        ) {
          if (
            isAbortError(
              error
            )
          ) {
            return;
          }

          console.error(
            "Savings transaction loading error:",
            error
          );

          setTransactionsError(
            getErrorMessage(
              error,
              "Failed to load savings transactions."
            )
          );

          setTransactions(
            []
          );

          setTransactionsTotal(
            0
          );
        } finally {
          if (
            !signal?.aborted
          ) {
            setTransactionsLoading(
              false
            );
          }
        }
      },
      [
        fetchTransactionPage,
      ]
    );

  /* =======================================================
     LOAD ALL DATA
  ======================================================= */

  const loadData =
    useCallback(
      async (
        signal?: AbortSignal
      ) => {
        await Promise.all([
          loadSummary(
            signal
          ),
          loadTransactions(
            signal
          ),
        ]);
      },
      [
        loadSummary,
        loadTransactions,
      ]
    );

  /* =======================================================
     INITIAL LOAD
  ======================================================= */

  useEffect(() => {
    const controller =
      new AbortController();

    void loadData(
      controller.signal
    );

    return () => {
      controller.abort();
    };
  }, [loadData]);

  /* =======================================================
     REFRESH
  ======================================================= */

  const handleRefresh =
    useCallback(
      async () => {
        if (
          refreshing
        ) {
          return;
        }

        const sequence =
          ++requestSequence.current;

        setRefreshing(
          true
        );

        const controller =
          new AbortController();

        try {
          await loadData(
            controller.signal
          );
        } finally {
          if (
            sequence ===
            requestSequence.current
          ) {
            setRefreshing(
              false
            );
          }
        }
      },
      [
        loadData,
        refreshing,
      ]
    );

  /* =======================================================
     FORM
  ======================================================= */

  const handleAddSavings =
    useCallback(() => {
      setFormOpen(
        true
      );
    }, []);

  const handleCloseForm =
    useCallback(() => {
      setFormOpen(
        false
      );
    }, []);

  /* =======================================================
     SAVINGS SUCCESS
  ======================================================= */

  const handleSavingsSuccess =
    useCallback(
      async (
        transaction: SavingsTransaction
      ) => {
        const normalized =
          normalizeTransaction(
            transaction
          );

        if (
          normalized
        ) {
          setTransactions(
            (
              current
            ) => {
              const withoutExisting =
                current.filter(
                  (
                    item
                  ) =>
                    item.id !==
                    normalized.id
                );

              return sortTransactions(
                [
                  normalized,
                  ...withoutExisting,
                ]
              );
            }
          );
        }

        setFormOpen(
          false
        );

        await loadData();
      },
      [loadData]
    );

  /* =======================================================
     OPEN ADJUSTMENT
  ======================================================= */

  const handleAdjust =
    useCallback(
      (
        transaction: SavingsTransaction
      ) => {
        /*
         * Do not allow adjustment of a transaction
         * already marked reversed.
         */
        if (
          transaction.status ===
          "reversed"
        ) {
          return;
        }

        /*
         * Reversal transactions should not themselves
         * be adjusted.
         */
        if (
          transaction.type ===
          "reversal"
        ) {
          return;
        }

        setAction(
          "adjust"
        );

        setActionTransaction(
          transaction
        );

        setActionAmount(
          ""
        );

        setActionReason(
          ""
        );

        setActionError(
          null
        );

        setActionLoading(
          false
        );
      },
      []
    );

  /* =======================================================
     OPEN REVERSAL
  ======================================================= */

  const handleReverse =
    useCallback(
      (
        transaction: SavingsTransaction
      ) => {
        /*
         * A reversed transaction cannot be
         * reversed again.
         */
        if (
          transaction.status ===
          "reversed"
        ) {
          return;
        }

        /*
         * A reversal cannot itself be reversed.
         */
        if (
          transaction.type ===
          "reversal"
        ) {
          return;
        }

        setAction(
          "reverse"
        );

        setActionTransaction(
          transaction
        );

        setActionAmount(
          ""
        );

        setActionReason(
          ""
        );

        setActionError(
          null
        );

        setActionLoading(
          false
        );
      },
      []
    );

  /* =======================================================
     CLOSE ACTION MODAL
  ======================================================= */

  const handleCloseAction =
    useCallback(() => {
      if (
        actionLoading
      ) {
        return;
      }

      setAction(
        null
      );

      setActionTransaction(
        null
      );

      setActionAmount(
        ""
      );

      setActionReason(
        ""
      );

      setActionError(
        null
      );
    }, [actionLoading]);

  /* =======================================================
     EXECUTE ADJUSTMENT / REVERSAL
  ======================================================= */

  const handleSubmitAction =
    useCallback(
      async () => {
        if (
          actionLoading ||
          !action ||
          !actionTransaction
        ) {
          return;
        }

        const reason =
          actionReason.trim();

        if (!reason) {
          setActionError(
            action ===
              "adjust"
              ? "Adjustment reason is required."
              : "Reversal reason is required."
          );

          return;
        }

        if (
          reason.length >
          500
        ) {
          setActionError(
            action ===
              "adjust"
              ? "Adjustment reason must not exceed 500 characters."
              : "Reversal reason must not exceed 500 characters."
          );

          return;
        }

        let numericAmount:
          number | null =
          null;

        if (
          action ===
          "adjust"
        ) {
          const trimmedAmount =
            actionAmount.trim();

          if (
            !trimmedAmount
          ) {
            setActionError(
              "Adjustment amount is required."
            );

            return;
          }

          numericAmount =
            Number(
              trimmedAmount
            );

          if (
            !Number.isFinite(
              numericAmount
            )
          ) {
            setActionError(
              "Adjustment amount must be a valid number."
            );

            return;
          }

          if (
            numericAmount ===
            0
          ) {
            setActionError(
              "Adjustment amount cannot be zero."
            );

            return;
          }
        }

        /*
         * Capture the transaction ID before beginning
         * the asynchronous operation.
         */
        const transactionId =
          actionTransaction.id;

        setActionLoading(
          true
        );

        setActionError(
          null
        );

        try {
          const endpoint =
            action ===
            "adjust"
              ? `${TRANSACTIONS_ENDPOINT}/${encodeURIComponent(
                  transactionId
                )}/adjust`
              : `${TRANSACTIONS_ENDPOINT}/${encodeURIComponent(
                  transactionId
                )}/reverse`;

          /*
           * Reversal deliberately does NOT send amount.
           *
           * The backend calculates:
           *
           * original.amount * -1
           */
          const body =
            action ===
            "adjust"
              ? {
                  amount:
                    numericAmount,
                  reason,
                }
              : {
                  reason,
                };

          const response =
            await fetch(
              endpoint,
              {
                method:
                  "POST",
                credentials:
                  "same-origin",
                cache:
                  "no-store",
                headers: {
                  Accept:
                    "application/json",
                  "Content-Type":
                    "application/json",
                },
                body:
                  JSON.stringify(
                    body
                  ),
              }
            );

          let result:
            ActionApiResponse =
            {};

          try {
            result =
              (await response.json()) as ActionApiResponse;
          } catch {
            result =
              {};
          }

          if (
            !response.ok
          ) {
            throw new Error(
              result.error ||
                result.message ||
                (
                  action ===
                  "adjust"
                    ? `Failed to create savings adjustment (${response.status}).`
                    : `Failed to reverse savings transaction (${response.status}).`
                )
            );
          }

          if (
            result.success ===
            false
          ) {
            throw new Error(
              result.error ||
                (
                  action ===
                  "adjust"
                    ? "Failed to create savings adjustment."
                    : "Failed to reverse savings transaction."
                )
            );
          }

          /*
           * Close only after the server has confirmed
           * successful creation.
           */
          setAction(
            null
          );

          setActionTransaction(
            null
          );

          setActionAmount(
            ""
          );

          setActionReason(
            ""
          );

          setActionError(
            null
          );

          /*
           * Reload authoritative ledger and summary.
           *
           * We intentionally do not manufacture a local
           * transaction from the response because the
           * server remains authoritative.
           */
          await loadData();
        } catch (
          error
        ) {
          console.error(
            `Savings ${action} operation error:`,
            error
          );

          setActionError(
            getErrorMessage(
              error,
              action ===
                "adjust"
                ? "Failed to create savings adjustment."
                : "Failed to reverse savings transaction."
            )
          );
        } finally {
          setActionLoading(
            false
          );
        }
      },
      [
        action,
        actionAmount,
        actionLoading,
        actionReason,
        actionTransaction,
        loadData,
      ]
    );

  /* =======================================================
     FILTER TRANSACTIONS
  ======================================================= */

  const filteredTransactions =
    useMemo(
      () => {
        const search =
          filters.search
            .trim()
            .toLowerCase();

        return transactions.filter(
          (
            transaction
          ) => {
            if (
              search
            ) {
              const searchable =
                [
                  transaction.id,
                  transaction.memberId,
                  transaction.memberName,
                  transaction.reference,
                  transaction.sourceReference,
                  transaction.smsId,
                  transaction.reason,
                ]
                  .filter(
                    (
                      value
                    ) =>
                      typeof value ===
                      "string"
                  )
                  .join(
                    " "
                  )
                  .toLowerCase();

              if (
                !searchable.includes(
                  search
                )
              ) {
                return false;
              }
            }

            if (
              filters.type &&
              transaction.type !==
                filters.type
            ) {
              return false;
            }

            if (
              filters.source &&
              transaction.source !==
                filters.source
            ) {
              return false;
            }

            if (
              filters.status &&
              transaction.status !==
                filters.status
            ) {
              return false;
            }

            return true;
          }
        );
      },
      [
        transactions,
        filters,
      ]
    );

  /* =======================================================
     ERROR
  ======================================================= */

  const hasDataError =
    Boolean(
      summaryError ||
      transactionsError
    );

  /* =======================================================
     RENDER
  ======================================================= */

  return (
    <>
      <TopBar />

      <main
        className="
          min-h-screen
          bg-[#050505]
          px-4
          pb-10
          pt-24
          text-white
          sm:px-6
          lg:px-8
        "
      >
        <div
          className="
            mx-auto
            w-full
            max-w-7xl
            space-y-6
          "
        >
          {/* =================================================
              HEADER
          ================================================= */}

          <div
            className="
              flex
              items-start
              justify-between
              gap-4
            "
          >
            <div className="min-w-0 flex-1">
              <SavingsHeader
                onAddSavings={
                  handleAddSavings
                }
              />
            </div>

            <button
              type="button"
              onClick={
                handleRefresh
              }
              disabled={
                refreshing ||
                transactionsLoading ||
                summaryLoading
              }
              className="
                mt-1
                inline-flex
                h-10
                shrink-0
                items-center
                gap-2
                rounded-xl
                border
                border-white/[0.08]
                bg-[#0b0b0b]
                px-3
                text-xs
                font-medium
                text-white/45
                transition
                hover:border-white/[0.14]
                hover:bg-white/[0.03]
                hover:text-white
                disabled:cursor-not-allowed
                disabled:opacity-40
              "
              aria-label="Refresh savings"
            >
              <RefreshCw
                size={14}
                strokeWidth={
                  1.8
                }
                className={
                  refreshing
                    ? "animate-spin"
                    : ""
                }
              />

              <span className="hidden sm:inline">
                Refresh
              </span>
            </button>
          </div>

          {/* =================================================
              ERROR
          ================================================= */}

          {hasDataError && (
            <div
              role="alert"
              className="
                flex
                items-start
                gap-3
                rounded-2xl
                border
                border-red-500/15
                bg-red-500/[0.05]
                px-4
                py-3
              "
            >
              <AlertCircle
                size={17}
                className="
                  mt-0.5
                  shrink-0
                  text-red-400
                "
              />

              <div className="min-w-0">
                <p className="text-xs font-medium text-red-400">
                  Savings data could not be loaded completely.
                </p>

                {summaryError && (
                  <p className="mt-1 text-[11px] text-red-400/60">
                    Summary:{" "}
                    {
                      summaryError
                    }
                  </p>
                )}

                {transactionsError && (
                  <p className="mt-1 text-[11px] text-red-400/60">
                    Transactions:{" "}
                    {
                      transactionsError
                    }
                  </p>
                )}
              </div>

              <button
                type="button"
                onClick={
                  handleRefresh
                }
                disabled={
                  refreshing
                }
                className="
                  ml-auto
                  shrink-0
                  rounded-lg
                  px-2.5
                  py-1.5
                  text-[11px]
                  font-medium
                  text-red-400
                  transition
                  hover:bg-red-500/10
                  disabled:cursor-not-allowed
                  disabled:opacity-40
                "
              >
                Retry
              </button>
            </div>
          )}

          {/* =================================================
              SUMMARY
          ================================================= */}

          <section
            aria-label="Savings summary"
            className="
              grid
              grid-cols-2
              gap-3
              lg:grid-cols-5
            "
          >
            <SummaryCard
              label="Balance"
              value={formatKES(
                summary.totalBalance
              )}
              icon={
                <Wallet
                  size={17}
                  strokeWidth={
                    1.8
                  }
                />
              }
              loading={
                summaryLoading
              }
              valueClassName="text-emerald-400"
            />

            <SummaryCard
              label="Deposits"
              value={formatKES(
                summary.totalDeposits
              )}
              icon={
                <ArrowDownLeft
                  size={17}
                  strokeWidth={
                    1.8
                  }
                />
              }
              loading={
                summaryLoading
              }
              valueClassName="text-emerald-400"
            />

            <SummaryCard
              label="Adjustments"
              value={formatKES(
                summary.totalAdjustments
              )}
              icon={
                <FileEdit
                  size={17}
                  strokeWidth={
                    1.8
                  }
                />
              }
              loading={
                summaryLoading
              }
            />

            <SummaryCard
              label="Reversals"
              value={formatKES(
                summary.totalReversals
              )}
              icon={
                <RotateCcw
                  size={17}
                  strokeWidth={
                    1.8
                  }
                />
              }
              loading={
                summaryLoading
              }
              valueClassName="text-red-400"
            />

            <SummaryCard
              label="Members"
              value={String(
                summary.memberCount
              )}
              icon={
                <Users
                  size={17}
                  strokeWidth={
                    1.8
                  }
                />
              }
              loading={
                summaryLoading
              }
            />
          </section>

          {/* =================================================
              SEARCH
          ================================================= */}

          <SavingsSearch
            value={filters}
            onChange={
              setFilters
            }
          />

          {/* =================================================
              TRANSACTION COUNT
          ================================================= */}

          {!transactionsLoading &&
            !transactionsError && (
              <div
                className="
                  flex
                  items-center
                  justify-between
                  gap-3
                "
              >
                <div className="flex items-center gap-2">
                  <Wallet
                    size={15}
                    strokeWidth={
                      1.8
                    }
                    className="text-yellow-400/70"
                  />

                  <span className="text-xs text-white/30">
                    Showing{" "}
                    <span className="font-medium text-white/55">
                      {
                        filteredTransactions.length
                      }
                    </span>{" "}
                    of{" "}
                    <span className="font-medium text-white/55">
                      {
                        transactionsTotal
                      }
                    </span>{" "}
                    transactions
                  </span>
                </div>

                {filteredTransactions.length !==
                  transactions.length && (
                  <button
                    type="button"
                    onClick={() =>
                      setFilters(
                        DEFAULT_FILTERS
                      )
                    }
                    className="
                      text-[11px]
                      font-medium
                      text-yellow-400/70
                      transition
                      hover:text-yellow-400
                    "
                  >
                    Clear filters
                  </button>
                )}
              </div>
            )}

          {/* =================================================
              DESKTOP TABLE
          ================================================= */}

          <div className="hidden md:block">
            <SavingsTable
              transactions={
                filteredTransactions
              }
              loading={
                transactionsLoading
              }
              onAdjust={
                handleAdjust
              }
              onReverse={
                handleReverse
              }
            />
          </div>

          {/* =================================================
              MOBILE TRANSACTIONS
          ================================================= */}

          <div className="md:hidden">
            {transactionsLoading ? (
              <div
                className="
                  flex
                  snap-x
                  snap-mandatory
                  gap-3
                  overflow-x-auto
                  overscroll-x-contain
                  pb-2
                  [scrollbar-width:none]
                  [-ms-overflow-style:none]
                  [&::-webkit-scrollbar]:hidden
                "
              >
                {Array.from(
                  {
                    length: 5,
                  },
                  (_, index) => (
                    <div
                      key={index}
                      className="
                        h-[190px]
                        w-[calc(100vw-2rem)]
                        max-w-[calc(100vw-2rem)]
                        shrink-0
                        snap-center
                        animate-pulse
                        rounded-2xl
                        border
                        border-white/[0.08]
                        bg-[#0b0b0b]
                      "
                    />
                  )
                )}
              </div>
            ) : transactionsError ? (
              <section
                className="
                  rounded-2xl
                  border
                  border-red-500/15
                  bg-[#0b0b0b]
                  px-6
                  py-12
                  text-center
                "
              >
                <div
                  className="
                    mx-auto
                    flex
                    h-12
                    w-12
                    items-center
                    justify-center
                    rounded-2xl
                    bg-red-500/10
                    text-red-400
                  "
                >
                  <AlertCircle
                    size={21}
                    strokeWidth={
                      1.8
                    }
                  />
                </div>

                <p className="mt-4 text-sm font-medium text-white/60">
                  Failed to load transactions
                </p>

                <p className="mt-1 text-xs leading-5 text-white/25">
                  {transactionsError}
                </p>

                <button
                  type="button"
                  onClick={
                    handleRefresh
                  }
                  disabled={
                    refreshing
                  }
                  className="
                    mt-5
                    inline-flex
                    items-center
                    gap-2
                    rounded-xl
                    bg-yellow-500
                    px-4
                    py-2.5
                    text-xs
                    font-semibold
                    text-black
                    transition
                    hover:bg-yellow-400
                    disabled:cursor-not-allowed
                    disabled:opacity-50
                  "
                >
                  {refreshing ? (
                    <Loader2
                      size={14}
                      className="animate-spin"
                    />
                  ) : (
                    <RefreshCw
                      size={14}
                    />
                  )}

                  Try Again
                </button>
              </section>
            ) : filteredTransactions.length ===
              0 ? (
              <section
                className="
                  rounded-2xl
                  border
                  border-white/[0.08]
                  bg-[#0b0b0b]
                  px-6
                  py-14
                  text-center
                "
              >
                <div
                  className="
                    mx-auto
                    flex
                    h-12
                    w-12
                    items-center
                    justify-center
                    rounded-2xl
                    bg-yellow-500/10
                    text-yellow-400
                  "
                >
                  <Wallet
                    size={21}
                    strokeWidth={1.8}
                  />
                </div>

                <p className="mt-4 text-sm font-medium text-white/60">
                  No savings transactions found
                </p>

                <p className="mt-1 text-xs text-white/25">
                  Transactions matching the current filters
                  will appear here.
                </p>

                {transactions.length >
                  0 && (
                  <button
                    type="button"
                    onClick={() =>
                      setFilters(
                        DEFAULT_FILTERS
                      )
                    }
                    className="
                      mt-4
                      text-xs
                      font-medium
                      text-yellow-400/70
                      transition
                      hover:text-yellow-400
                    "
                  >
                    Clear filters
                  </button>
                )}
              </section>
            ) : (
              <div
                className="
                  -mx-4
                  overflow-hidden
                  sm:-mx-6
                "
              >
                <div
                  className="
                    flex
                    snap-x
                    snap-mandatory
                    gap-3
                    overflow-x-auto
                    overscroll-x-contain
                    px-4
                    pb-3
                    sm:px-6
                    [scrollbar-width:none]
                    [-ms-overflow-style:none]
                    [&::-webkit-scrollbar]:hidden
                  "
                  style={{
                    WebkitOverflowScrolling:
                      "touch",
                  }}
                >
                  {filteredTransactions.map(
                    (
                      transaction
                    ) => (
                      <div
                        key={
                          transaction.id
                        }
                        className="
                          w-[calc(100vw-2rem)]
                          max-w-[calc(100vw-2rem)]
                          shrink-0
                          snap-center
                          sm:w-[calc(100vw-3rem)]
                          sm:max-w-[calc(100vw-3rem)]
                        "
                      >
                        <SavingsTransactionCard
                          transaction={
                            transaction
                          }
                          onAdjust={
                            handleAdjust
                          }
                          onReverse={
                            handleReverse
                          }
                        />
                      </div>
                    )
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </main>

      {/* =====================================================
          ADD SAVINGS
      ===================================================== */}

      <SavingsForm
        open={
          formOpen
        }
        onClose={
          handleCloseForm
        }
        onSuccess={
          handleSavingsSuccess
        }
      />

      {/* =====================================================
          ADJUST / REVERSE MODAL
      ===================================================== */}

      <SavingsActionModal
        action={
          action
        }
        transaction={
          actionTransaction
        }
        amount={
          actionAmount
        }
        reason={
          actionReason
        }
        loading={
          actionLoading
        }
        error={
          actionError
        }
        onAmountChange={
          setActionAmount
        }
        onReasonChange={
          setActionReason
        }
        onClose={
          handleCloseAction
        }
        onSubmit={
          handleSubmitAction
        }
      />
    </>
  );
}