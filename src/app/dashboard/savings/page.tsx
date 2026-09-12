"use client";

import {
  AlertCircle,
  ArrowDownLeft,
  ArrowRight,
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
  type ReactNode,
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

const TRANSACTIONS_ENDPOINT =
  "/api/savings/transactions";

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

type ActionType =
  | "adjust"
  | "reverse";

type PaginationData = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

type TransactionPage = {
  transactions: SavingsTransaction[];
  pagination: PaginationData;
};

/* =========================================================
   HELPERS
========================================================= */

function safeNumber(
  value: unknown,
): number {
  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : 0;
}

function safePositiveInteger(
  value: unknown,
): number {
  const number = Number(value);

  if (
    !Number.isInteger(number) ||
    number < 0
  ) {
    return 0;
  }

  return number;
}

function normalizeDate(
  value: unknown,
): string {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (
    typeof value === "string"
  ) {
    const date = new Date(value);

    if (
      !Number.isNaN(
        date.getTime(),
      )
    ) {
      return date.toISOString();
    }

    return value;
  }

  if (
    typeof value === "number"
  ) {
    const date = new Date(value);

    if (
      !Number.isNaN(
        date.getTime(),
      )
    ) {
      return date.toISOString();
    }
  }

  return new Date(0).toISOString();
}

/* =========================================================
   TRANSACTION NORMALIZER
========================================================= */

function normalizeTransaction(
  value: unknown,
): SavingsTransaction | null {
  if (
    !value ||
    typeof value !== "object"
  ) {
    return null;
  }

  const raw =
    value as Partial<SavingsTransaction> & {
      _id?: unknown;
    };

  const rawId =
    raw.id ??
    raw._id;

  if (
    rawId === undefined ||
    rawId === null ||
    String(rawId).trim() === ""
  ) {
    return null;
  }

  return {
    ...raw,

    id: String(rawId),

    memberId: String(
      raw.memberId ?? "",
    ),

    memberName: String(
      raw.memberName ??
        "Unknown member",
    ),

    amount: safeNumber(
      raw.amount,
    ),

    reference:
      raw.reference ===
        undefined ||
      raw.reference === null
        ? undefined
        : String(
            raw.reference,
          ),

    smsId:
      raw.smsId === undefined ||
      raw.smsId === null
        ? undefined
        : String(
            raw.smsId,
          ),

    sourceReference:
      raw.sourceReference ===
        undefined ||
      raw.sourceReference === null
        ? undefined
        : String(
            raw.sourceReference,
          ),

    reason:
      raw.reason === undefined ||
      raw.reason === null
        ? undefined
        : String(
            raw.reason,
          ),

    relatedTransactionId:
      raw.relatedTransactionId ===
        undefined ||
      raw.relatedTransactionId === null
        ? undefined
        : String(
            raw.relatedTransactionId,
          ),

    transactionAt:
      normalizeDate(
        raw.transactionAt,
      ),

    createdAt:
      normalizeDate(
        raw.createdAt,
      ),

    updatedAt:
      normalizeDate(
        raw.updatedAt,
      ),
  } as SavingsTransaction;
}

/* =========================================================
   OBJECT HELPERS
========================================================= */

function asRecord(
  value: unknown,
): Record<
  string,
  unknown
> | null {
  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value)
  ) {
    return value as Record<
      string,
      unknown
    >;
  }

  return null;
}

/* =========================================================
   JSON RESPONSE HELPER

   Protects the UI from HTML responses such as a 404 page.
========================================================= */

async function readJsonResponse(
  response: Response,
): Promise<Record<string, unknown>> {
  const text =
    await response.text();

  if (!text.trim()) {
    return {};
  }

  try {
    const parsed =
      JSON.parse(text);

    if (
      parsed &&
      typeof parsed === "object"
    ) {
      return parsed as Record<
        string,
        unknown
      >;
    }

    return {};
  } catch {
    throw new Error(
      `Server returned an invalid response (${response.status}).`,
    );
  }
}

/* =========================================================
   EXTRACT TRANSACTIONS
========================================================= */

function extractTransactions(
  payload: unknown,
): SavingsTransaction[] {
  const root =
    asRecord(payload);

  if (!root) {
    return [];
  }

  const data =
    asRecord(root.data);

  const nestedData =
    data
      ? asRecord(data.data)
      : null;

  const result =
    asRecord(root.result);

  const nestedResult =
    result
      ? asRecord(result.data)
      : null;

  const candidates: unknown[] = [
    root.transactions,
    data?.transactions,
    nestedData?.transactions,
    result?.transactions,
    nestedResult?.transactions,
    root.data,
  ];

  for (
    const candidate of
      candidates
  ) {
    if (
      !Array.isArray(
        candidate,
      )
    ) {
      continue;
    }

    return candidate
      .map(
        normalizeTransaction,
      )
      .filter(
        (
          transaction,
        ): transaction is SavingsTransaction =>
          transaction !==
          null,
      );
  }

  return [];
}

/* =========================================================
   EXTRACT PAGINATION
========================================================= */

function extractPagination(
  payload: unknown,
): PaginationData {
  const fallback: PaginationData = {
    page: 1,
    limit:
      API_PAGE_LIMIT,
    total: 0,
    totalPages: 1,
  };

  const root =
    asRecord(payload);

  if (!root) {
    return fallback;
  }

  const data =
    asRecord(root.data);

  const nestedData =
    data
      ? asRecord(data.data)
      : null;

  const result =
    asRecord(root.result);

  const nestedResult =
    result
      ? asRecord(result.data)
      : null;

  const paginationCandidates:
    unknown[] = [
      root.pagination,
      data?.pagination,
      nestedData?.pagination,
      result?.pagination,
      nestedResult?.pagination,
    ];

  let pagination:
    | Record<
        string,
        unknown
      >
    | null = null;

  for (
    const candidate of
      paginationCandidates
  ) {
    const record =
      asRecord(candidate);

    if (record) {
      pagination = record;
      break;
    }
  }

  if (!pagination) {
    return fallback;
  }

  const page =
    safePositiveInteger(
      pagination.page,
    );

  const limit =
    safePositiveInteger(
      pagination.limit,
    );

  const total =
    safePositiveInteger(
      pagination.total,
    );

  const totalPages =
    safePositiveInteger(
      pagination.totalPages,
    );

  return {
    page:
      page > 0
        ? page
        : 1,

    limit:
      limit > 0
        ? limit
        : API_PAGE_LIMIT,

    total,

    totalPages:
      totalPages > 0
        ? totalPages
        : 1,
  };
}

/* =========================================================
   SORT
========================================================= */

function sortTransactions(
  transactions: SavingsTransaction[],
): SavingsTransaction[] {
  return [
    ...transactions,
  ].sort(
    (a, b) => {
      const dateA =
        new Date(
          a.transactionAt,
        ).getTime();

      const dateB =
        new Date(
          b.transactionAt,
        ).getTime();

      return (
        dateB - dateA
      );
    },
  );
}

/* =========================================================
   DEDUPLICATION
========================================================= */

function deduplicateTransactions(
  transactions: SavingsTransaction[],
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
      !transaction.id
    ) {
      continue;
    }

    map.set(
      transaction.id,
      transaction,
    );
  }

  return Array.from(
    map.values(),
  );
}

/* =========================================================
   ABORT
========================================================= */

function isAbortError(
  error: unknown,
): boolean {
  return (
    error instanceof
      DOMException &&
    error.name ===
      "AbortError"
  );
}

/* =========================================================
   ERROR MESSAGE
========================================================= */

function getErrorMessage(
  error: unknown,
  fallback: string,
): string {
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof (
      error as {
        message?: unknown;
      }
    ).message ===
      "string"
  ) {
    return (
      error as {
        message: string;
      }
    ).message;
  }

  return fallback;
}

/* =========================================================
   KES FORMATTER
========================================================= */

const KES_FORMATTER =
  new Intl.NumberFormat(
    "en-KE",
    {
      style: "currency",
      currency: "KES",
      maximumFractionDigits: 2,
    },
  );

function formatKES(
  value: number,
): string {
  return KES_FORMATTER.format(
    safeNumber(value),
  );
}

/* =========================================================
   SAVINGS OVERVIEW CARD
========================================================= */

function OverviewCard({
  eyebrow,
  value,
  description,
  icon,
  footerLabel,
  footerHref,
  progress,
  progressLabel,
  progressValue,
  metrics,
}: {
  eyebrow: string;
  value: string;
  description: string;
  icon: ReactNode;
  footerLabel: string;
  footerHref: string;
  progress?: number;
  progressLabel?: string;
  progressValue?: string;
  metrics?: {
    label: string;
    value: string;
  }[];
}) {
  return (
    <div className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-[0.18em] text-black/40">
            {eyebrow}
          </p>

          <p className="mt-3 truncate text-3xl font-semibold tracking-tight text-black">
            {value}
          </p>

          <p className="mt-1 text-xs text-black/50">
            {description}
          </p>
        </div>

        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-yellow-50 text-yellow-600">
          {icon}
        </div>
      </div>

      {progress !==
        undefined && (
        <div className="mt-5">
          <div className="mb-2 flex items-center justify-between gap-3">
            <span className="truncate text-[10px] text-black/40">
              {progressLabel}
            </span>

            <span className="shrink-0 text-[10px] text-black/55">
              {progressValue}
            </span>
          </div>

          <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-yellow-500 transition-all"
              style={{
                width: `${Math.max(
                  0,
                  Math.min(
                    100,
                    progress,
                  ),
                )}%`,
              }}
            />
          </div>
        </div>
      )}

      {metrics &&
        metrics.length > 0 && (
          <div className="mt-5 grid grid-cols-3 gap-3">
            {metrics.map(
              (
                metric,
              ) => (
                <div
                  key={
                    metric.label
                  }
                  className="min-w-0"
                >
                  <p className="truncate text-[9px] uppercase tracking-[0.12em] text-black/35">
                    {
                      metric.label
                    }
                  </p>

                  <p className="mt-1 truncate text-xs font-medium text-black/65">
                    {
                      metric.value
                    }
                  </p>
                </div>
              ),
            )}
          </div>
        )}

      <button
        type="button"
        onClick={() =>
          window.location.assign(
            footerHref,
          )
        }
        className="mt-5 flex items-center gap-2 text-xs font-medium text-yellow-600 transition hover:text-yellow-700"
      >
        <span>
          {footerLabel}
        </span>

        <ArrowRight
          size={14}
          strokeWidth={1.8}
        />
      </button>
    </div>
  );
}

/* =========================================================
   ACTION MODAL TYPES
========================================================= */

type SavingsActionModalProps = {
  open: boolean;

  action:
    | ActionType
    | null;

  transaction:
    | SavingsTransaction
    | null;

  amount: string;
  reason: string;
  loading: boolean;

  error:
    | string
    | null;

  onAmountChange: (
    value: string,
  ) => void;

  onReasonChange: (
    value: string,
  ) => void;

  onClose: () => void;

  onSubmit: () => void;
};

/* =========================================================
   ACTION MODAL
========================================================= */

function SavingsActionModal({
  open,
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
}: SavingsActionModalProps) {
  if (
    !open ||
    !action ||
    !transaction
  ) {
    return null;
  }

  const isAdjustment =
    action === "adjust";

  const parsedAmount =
    Number(amount);

  const canSubmit =
    reason.trim().length >
      0 &&
    (
      !isAdjustment ||
      (
        amount.trim()
          .length > 0 &&
        Number.isFinite(
          parsedAmount,
        ) &&
        parsedAmount > 0
      )
    );

  return (
    <div
      className="
        fixed
        inset-0
        z-50
        flex
        items-center
        justify-center
        bg-black/40
        p-4
        backdrop-blur-sm
      "
    >
      <div
        className="
          w-full
          max-w-lg
          overflow-hidden
          rounded-2xl
          border
          border-slate-200
          bg-white
          shadow-2xl
        "
      >
        <div
          className="
            flex
            items-start
            justify-between
            gap-4
            border-b
            border-slate-200
            px-5
            py-4
          "
        >
          <div>
            <h2 className="text-lg font-semibold text-black">
              {isAdjustment
                ? "Record savings withdrawal"
                : "Reverse savings transaction"}
            </h2>

            <p className="mt-1 text-sm text-black/50">
              {isAdjustment
                ? "Create a new withdrawal entry. The original transaction remains unchanged."
                : "Create a new reversal entry. The original transaction remains unchanged."}
            </p>
          </div>

          <button
            type="button"
            onClick={
              onClose
            }
            disabled={
              loading === true
            }
            className="
              rounded-lg
              p-2
              text-black/40
              transition
              hover:bg-slate-100
              hover:text-black
              disabled:cursor-not-allowed
              disabled:opacity-50
            "
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="space-y-5 px-5 py-5">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-black/40">
                  Member
                </p>

                <p className="mt-1 truncate font-medium text-black">
                  {
                    transaction.memberName
                  }
                </p>
              </div>

              <div className="shrink-0 text-right">
                <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-black/40">
                  Original amount
                </p>

                <p className="mt-1 font-semibold text-black">
                  {formatKES(
                    Math.abs(
                      transaction.amount,
                    ),
                  )}
                </p>
              </div>
            </div>
          </div>

          {isAdjustment && (
            <div>
              <label
                htmlFor="adjustment-amount"
                className="mb-2 block text-sm font-medium text-black/75"
              >
                Withdrawal amount
              </label>

              <input
                id="adjustment-amount"
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0.01"
                value={amount}
                onChange={(
                  event,
                ) =>
                  onAmountChange(
                    event.target.value,
                  )
                }
                disabled={
                  loading === true
                }
                placeholder="e.g. 200"
                className="
                  h-11
                  w-full
                  rounded-xl
                  border
                  border-slate-200
                  bg-white
                  px-4
                  text-sm
                  text-black
                  outline-none
                  transition
                  placeholder:text-black/30
                  focus:border-yellow-500
                  focus:bg-white
                  focus:ring-2
                  focus:ring-yellow-500/10
                  disabled:cursor-not-allowed
                  disabled:opacity-50
                "
              />

              <p className="mt-2 text-xs text-black/45">
                Enter the withdrawal amount
                as a positive value. The
                ledger records withdrawals
                as negative entries.
              </p>
            </div>
          )}

          <div>
            <label
              htmlFor="savings-action-reason"
              className="mb-2 block text-sm font-medium text-black/75"
            >
              {isAdjustment
                ? "Withdrawal reason"
                : "Reversal reason"}
            </label>

            <textarea
              id="savings-action-reason"
              rows={4}
              value={reason}
              onChange={(
                event,
              ) =>
                onReasonChange(
                  event.target.value,
                )
              }
              disabled={
                loading === true
              }
              placeholder={
                isAdjustment
                  ? "Explain why this withdrawal is being recorded..."
                  : "Explain why this transaction is being reversed..."
              }
              className="
                w-full
                resize-none
                rounded-xl
                border
                border-slate-200
                bg-white
                px-4
                py-3
                text-sm
                text-black
                outline-none
                transition
                placeholder:text-black/30
                focus:border-yellow-500
                focus:bg-white
                focus:ring-2
                focus:ring-yellow-500/10
                disabled:cursor-not-allowed
                disabled:opacity-50
              "
            />
          </div>

          {error && (
            <div className="flex gap-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />

              <span>
                {error}
              </span>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-slate-200 px-5 py-4">
          <button
            type="button"
            onClick={
              onClose
            }
            disabled={
              loading === true
            }
            className="
              rounded-xl
              px-4
              py-2.5
              text-sm
              font-medium
              text-black/55
              transition
              hover:bg-slate-100
              hover:text-black
              disabled:cursor-not-allowed
              disabled:opacity-50
            "
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={
              onSubmit
            }
            disabled={
              canSubmit !==
                true ||
              loading === true
            }
            className="
              inline-flex
              items-center
              gap-2
              rounded-xl
              bg-yellow-500
              px-4
              py-2.5
              text-sm
              font-semibold
              text-black
              transition
              hover:bg-yellow-400
              disabled:cursor-not-allowed
              disabled:opacity-50
            "
          >
            {loading && (
              <Loader2 className="h-4 w-4 animate-spin" />
            )}

            {isAdjustment
              ? "Record Withdrawal"
              : "Reverse Transaction"}
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
     STATE
  ======================================================= */

  const [
    summary,
    setSummary,
  ] = useState<SummaryData>({
    totalBalance: 0,
    totalDeposits: 0,
    totalAdjustments: 0,
    totalReversals: 0,
    memberCount: 0,
  });

  const [
    transactions,
    setTransactions,
  ] = useState<
    SavingsTransaction[]
  >([]);

  const [
    transactionsTotal,
    setTransactionsTotal,
  ] = useState(0);

  const [
    summaryLoading,
    setSummaryLoading,
  ] = useState(true);

  const [
    transactionsLoading,
    setTransactionsLoading,
  ] = useState(true);

  const [
    summaryError,
    setSummaryError,
  ] = useState<
    string | null
  >(null);

  const [
    transactionsError,
    setTransactionsError,
  ] = useState<
    string | null
  >(null);

  const [
    refreshing,
    setRefreshing,
  ] = useState(false);

  const [
    filters,
    setFilters,
  ] =
    useState<SavingsSearchFilters>(
      DEFAULT_FILTERS,
    );

  const [
    formOpen,
    setFormOpen,
  ] = useState(false);

  const [
    action,
    setAction,
  ] =
    useState<ActionType | null>(
      null,
    );

  const [
    actionTransaction,
    setActionTransaction,
  ] =
    useState<
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

  const activeController =
    useRef<AbortController | null>(
      null,
    );

  const requestSequence =
    useRef(0);

  /* =======================================================
     FINANCIAL VALUES
  ======================================================= */

  const deposits =
    useMemo(
      () =>
        Math.max(
          0,
          safeNumber(
            summary.totalDeposits,
          ),
        ),
      [
        summary.totalDeposits,
      ],
    );

  const withdrawals =
    useMemo(
      () =>
        Math.abs(
          safeNumber(
            summary.totalAdjustments,
          ),
        ),
      [
        summary.totalAdjustments,
      ],
    );

  const reversals =
    useMemo(
      () =>
        Math.abs(
          safeNumber(
            summary.totalReversals,
          ),
        ),
      [
        summary.totalReversals,
      ],
    );

  const calculatedBalance =
    useMemo(
      () =>
        deposits -
        withdrawals -
        reversals,
      [
        deposits,
        withdrawals,
        reversals,
      ],
    );

  /* =======================================================
     LOAD SUMMARY
  ======================================================= */

  const loadSummary =
    useCallback(
      async (
        signal?: AbortSignal,
      ) => {
        setSummaryLoading(
          true,
        );

        setSummaryError(
          null,
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
                signal,
              },
            );

          const payload =
            await readJsonResponse(
              response,
            );

          if (!response.ok) {
            throw new Error(
              String(
                payload.message ??
                  payload.error ??
                  "Failed to load savings summary.",
              ),
            );
          }

          if (
            signal?.aborted
          ) {
            return;
          }

          const root =
            asRecord(payload);

          const data =
            asRecord(
              root?.data,
            ) ?? root;

          setSummary({
            totalBalance:
              safeNumber(
                data?.totalBalance,
              ),

            totalDeposits:
              safeNumber(
                data?.totalDeposits,
              ),

            totalAdjustments:
              safeNumber(
                data?.totalAdjustments,
              ),

            totalReversals:
              safeNumber(
                data?.totalReversals,
              ),

            memberCount:
              safePositiveInteger(
                data?.memberCount,
              ),
          });
        } catch (error) {
          if (
            isAbortError(error)
          ) {
            return;
          }

          console.error(
            "Savings summary loading error:",
            error,
          );

          setSummaryError(
            getErrorMessage(
              error,
              "Failed to load savings summary.",
            ),
          );
        } finally {
          if (
            signal?.aborted !==
            true
          ) {
            setSummaryLoading(
              false,
            );
          }
        }
      },
      [],
    );

  /* =======================================================
     FETCH ONE TRANSACTION PAGE
  ======================================================= */

  const fetchTransactionPage =
    useCallback(
      async (
        page: number,
        signal?: AbortSignal,
      ): Promise<TransactionPage> => {
        const params =
          new URLSearchParams();

        params.set(
          "page",
          String(page),
        );

        params.set(
          "limit",
          String(
            API_PAGE_LIMIT,
          ),
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
              signal,
            },
          );

        const payload =
          await readJsonResponse(
            response,
          );

        if (!response.ok) {
          throw new Error(
            String(
              payload.message ??
                payload.error ??
                "Failed to load savings transactions.",
            ),
          );
        }

        return {
          transactions:
            extractTransactions(
              payload,
            ),

          pagination:
            extractPagination(
              payload,
            ),
        };
      },
      [],
    );

  /* =======================================================
     LOAD TRANSACTIONS
  ======================================================= */

  const loadTransactions =
    useCallback(
      async (
        signal?: AbortSignal,
      ) => {
        setTransactionsLoading(
          true,
        );

        setTransactionsError(
          null,
        );

        try {
          const firstPage =
            await fetchTransactionPage(
              1,
              signal,
            );

          if (
            signal?.aborted
          ) {
            return;
          }

          let allTransactions = [
            ...firstPage.transactions,
          ];

          const totalPages =
            Math.max(
              1,
              firstPage
                .pagination
                .totalPages,
            );

          if (
            totalPages > 1
          ) {
            const remainingPages =
              Array.from(
                {
                  length:
                    totalPages -
                    1,
                },
                (
                  _,
                  index,
                ) =>
                  index + 2,
              );

            const pageResults =
              await Promise.all(
                remainingPages.map(
                  (
                    page,
                  ) =>
                    fetchTransactionPage(
                      page,
                      signal,
                    ),
                ),
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
                  pageResult.transactions,
                );
            }
          }

          if (
            signal?.aborted
          ) {
            return;
          }

          const unique =
            deduplicateTransactions(
              allTransactions,
            );

          const sorted =
            sortTransactions(
              unique,
            );

          setTransactions(
            sorted,
          );

          const apiTotal =
            firstPage
              .pagination
              .total;

          setTransactionsTotal(
            apiTotal > 0
              ? apiTotal
              : sorted.length,
          );

          if (
            apiTotal > 0 &&
            sorted.length === 0
          ) {
            setTransactionsError(
              "The savings API returned transactions, but the response format could not be understood.",
            );
          }
        } catch (error) {
          if (
            isAbortError(error)
          ) {
            return;
          }

          console.error(
            "Savings transaction loading error:",
            error,
          );

          setTransactionsError(
            getErrorMessage(
              error,
              "Failed to load savings transactions.",
            ),
          );

          setTransactions([]);

          setTransactionsTotal(
            0,
          );
        } finally {
          if (
            signal?.aborted !==
            true
          ) {
            setTransactionsLoading(
              false,
            );
          }
        }
      },
      [
        fetchTransactionPage,
      ],
    );

  /* =======================================================
     LOAD ALL DATA
  ======================================================= */

  const loadData =
    useCallback(
      async (
        signal?: AbortSignal,
      ) => {
        await Promise.all([
          loadSummary(signal),
          loadTransactions(signal),
        ]);
      },
      [
        loadSummary,
        loadTransactions,
      ],
    );

  /* =======================================================
     INITIAL LOAD
  ======================================================= */

  useEffect(() => {
    const controller =
      new AbortController();

    activeController.current =
      controller;

    const sequence =
      ++requestSequence.current;

    void loadData(
      controller.signal,
    ).finally(() => {
      if (
        requestSequence.current ===
        sequence
      ) {
        if (
          activeController.current ===
          controller
        ) {
          activeController.current =
            null;
        }
      }
    });

    return () => {
      controller.abort();

      if (
        activeController.current ===
        controller
      ) {
        activeController.current =
          null;
      }
    };
  }, [loadData]);

  /* =======================================================
     REFRESH
  ======================================================= */

  const handleRefresh =
    useCallback(async () => {
      activeController.current?.abort();

      const controller =
        new AbortController();

      activeController.current =
        controller;

      const sequence =
        ++requestSequence.current;

      setRefreshing(
        true,
      );

      try {
        await loadData(
          controller.signal,
        );
      } finally {
        if (
          requestSequence.current ===
          sequence
        ) {
          setRefreshing(
            false,
          );

          if (
            activeController.current ===
            controller
          ) {
            activeController.current =
              null;
          }
        }
      }
    }, [loadData]);

  /* =======================================================
     SAVINGS SUCCESS
  ======================================================= */

  const handleSavingsSuccess =
    useCallback(
      async (
        transaction?: SavingsTransaction,
      ) => {
        if (
          transaction
        ) {
          const normalized =
            normalizeTransaction(
              transaction,
            );

          if (
            normalized
          ) {
            setTransactions(
              (current) =>
                sortTransactions(
                  deduplicateTransactions([
                    normalized,
                    ...current,
                  ]),
                ),
            );
          }
        }

        setFormOpen(
          false,
        );

        await handleRefresh();
      },
      [handleRefresh],
    );

  /* =======================================================
     OPEN WITHDRAWAL
  ======================================================= */

  const handleAdjust =
    useCallback(
      (
        transaction: SavingsTransaction,
      ) => {
        if (
          transaction.status ===
          "reversed"
        ) {
          return;
        }

        if (
          transaction.type ===
          "reversal"
        ) {
          return;
        }

        setAction(
          "adjust",
        );

        setActionTransaction(
          transaction,
        );

        setActionAmount(
          "",
        );

        setActionReason(
          "",
        );

        setActionError(
          null,
        );
      },
      [],
    );

  /* =======================================================
     OPEN REVERSAL
  ======================================================= */

  const handleReverse =
    useCallback(
      (
        transaction: SavingsTransaction,
      ) => {
        if (
          transaction.status ===
          "reversed"
        ) {
          return;
        }

        if (
          transaction.type ===
          "reversal"
        ) {
          return;
        }

        setAction(
          "reverse",
        );

        setActionTransaction(
          transaction,
        );

        setActionAmount(
          "",
        );

        setActionReason(
          "",
        );

        setActionError(
          null,
        );
      },
      [],
    );

  /* =======================================================
     CLOSE ACTION MODAL
  ======================================================= */

  const closeActionModal =
    useCallback(() => {
      if (
        actionLoading ===
        true
      ) {
        return;
      }

      setAction(
        null,
      );

      setActionTransaction(
        null,
      );

      setActionAmount(
        "",
      );

      setActionReason(
        "",
      );

      setActionError(
        null,
      );
    }, [actionLoading]);

  /* =======================================================
     SUBMIT ACTION
  ======================================================= */

  const handleSubmitAction =
    useCallback(
      async () => {
        if (
          !action ||
          !actionTransaction
        ) {
          return;
        }

        const reason =
          actionReason.trim();

        if (!reason) {
          setActionError(
            "A reason is required.",
          );

          return;
        }

        let numericAmount:
          | number
          | undefined;

        if (
          action ===
          "adjust"
        ) {
          numericAmount =
            Number(
              actionAmount,
            );

          if (
            !Number.isFinite(
              numericAmount,
            ) ||
            numericAmount <=
              0
          ) {
            setActionError(
              "Enter a valid withdrawal amount greater than zero.",
            );

            return;
          }
        }

        setActionLoading(
          true,
        );

        setActionError(
          null,
        );

        try {
          const transactionId =
            encodeURIComponent(
              actionTransaction.id,
            );

          const endpoint =
            action ===
            "adjust"
              ? `${TRANSACTIONS_ENDPOINT}/${transactionId}/adjust`
              : `${TRANSACTIONS_ENDPOINT}/${transactionId}/reverse`;

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

                headers: {
                  "Content-Type":
                    "application/json",
                },

                credentials:
                  "same-origin",

                body: JSON.stringify(
                  body,
                ),
              },
            );

          const payload =
            await readJsonResponse(
              response,
            );

          if (
            !response.ok
          ) {
            throw new Error(
              String(
                payload.message ??
                  payload.error ??
                  `Failed to ${
                    action ===
                    "adjust"
                      ? "record withdrawal"
                      : "reverse transaction"
                  }.`,
              ),
            );
          }

          setAction(
            null,
          );

          setActionTransaction(
            null,
          );

          setActionAmount(
            "",
          );

          setActionReason(
            "",
          );

          await handleRefresh();
        } catch (error) {
          console.error(
            "Savings action error:",
            error,
          );

          setActionError(
            getErrorMessage(
              error,
              "Unable to complete the savings action.",
            ),
          );
        } finally {
          setActionLoading(
            false,
          );
        }
      },
      [
        action,
        actionTransaction,
        actionAmount,
        actionReason,
        handleRefresh,
      ],
    );

  /* =======================================================
     FILTER TRANSACTIONS
  ======================================================= */

  const filteredTransactions =
    useMemo(() => {
      const search =
        filters.search
          .trim()
          .toLowerCase();

      return transactions.filter(
        (
          transaction,
        ) => {
          if (
            search
          ) {
            const searchableText =
              [
                transaction.id,
                transaction.memberId,
                transaction.memberName,
                transaction.reference,
                transaction.sourceReference,
                transaction.smsId,
                transaction.reason,
                transaction.source,
                transaction.type,
                transaction.status,
              ]
                .filter(
                  Boolean,
                )
                .join(
                  " ",
                )
                .toLowerCase();

            if (
              !searchableText.includes(
                search,
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
        },
      );
    }, [
      transactions,
      filters,
    ]);

  /* =======================================================
     UI STATE
  ======================================================= */

  const hasDataError =
    Boolean(
      summaryError ||
        transactionsError,
    );

  const isRefreshing =
    refreshing ===
    true;

  const isTransactionsLoading =
    transactionsLoading ===
    true;

  const isSummaryLoading =
    summaryLoading ===
    true;

  const refreshDisabled =
    isRefreshing ||
    isTransactionsLoading ||
    isSummaryLoading;

  /* =======================================================
     RENDER
  ======================================================= */

  return (
    <div className="min-h-screen bg-white text-black">
      <TopBar />

      <main
        className="
          mx-auto
          w-full
          max-w-[1600px]
          overflow-x-hidden
          px-4
          pb-24
          pt-20
          sm:px-6
          lg:px-8
          lg:pb-8
          lg:pt-20
        "
      >
        {/* HEADER */}

        <SavingsHeader
          onAddSavings={() =>
            setFormOpen(true)
          }
        />

        {/* ERROR */}

        {hasDataError && (
          <div className="mt-4 flex flex-col gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex gap-3">
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />

              <div>
                <p className="font-medium text-red-700">
                  Unable to load some savings data
                </p>

                <p className="mt-1 text-sm text-red-600/70">
                  {summaryError ||
                    transactionsError}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={
                handleRefresh
              }
              disabled={
                refreshDisabled ===
                true
              }
              className="
                inline-flex
                items-center
                justify-center
                gap-2
                rounded-xl
                border
                border-red-200
                bg-red-50
                px-4
                py-2
                text-sm
                font-medium
                text-red-700
                transition
                hover:bg-red-100
                disabled:cursor-not-allowed
                disabled:opacity-50
              "
            >
              <RefreshCw
                className={
                  isRefreshing
                    ? "h-4 w-4 animate-spin"
                    : "h-4 w-4"
                }
              />

              Retry
            </button>
          </div>
        )}

        {/* DESKTOP SUMMARY */}

        <section className="mt-6 hidden grid-cols-5 gap-4 lg:grid">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <div className="rounded-xl bg-blue-50 p-2.5 text-blue-600">
                <Wallet className="h-5 w-5" />
              </div>

              <span className="text-xs font-medium text-black/40">
                BALANCE
              </span>
            </div>

            <p className="mt-5 text-xs font-medium uppercase tracking-wide text-black/50">
              Total Savings
            </p>

            <p className="mt-1 text-2xl font-bold tracking-tight text-black">
              {isSummaryLoading
                ? "—"
                : formatKES(
                    calculatedBalance,
                  )}
            </p>

            <p className="mt-2 text-xs text-black/40">
              Deposits − Withdrawals −
              Reversals
            </p>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <div className="rounded-xl bg-emerald-50 p-2.5 text-emerald-600">
                <ArrowDownLeft className="h-5 w-5" />
              </div>

              <span className="text-xs font-medium text-black/40">
                DEPOSITS
              </span>
            </div>

            <p className="mt-5 text-xs font-medium uppercase tracking-wide text-black/50">
              Total Deposits
            </p>

            <p className="mt-1 text-2xl font-bold tracking-tight text-black">
              {isSummaryLoading
                ? "—"
                : formatKES(
                    deposits,
                  )}
            </p>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <div className="rounded-xl bg-yellow-50 p-2.5 text-yellow-600">
                <FileEdit className="h-5 w-5" />
              </div>

              <span className="text-xs font-medium text-black/40">
                WITHDRAWALS
              </span>
            </div>

            <p className="mt-5 text-xs font-medium uppercase tracking-wide text-black/50">
              Total Withdrawals
            </p>

            <p className="mt-1 text-2xl font-bold tracking-tight text-black">
              {isSummaryLoading
                ? "—"
                : formatKES(
                    withdrawals,
                  )}
            </p>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <div className="rounded-xl bg-red-50 p-2.5 text-red-600">
                <RotateCcw className="h-5 w-5" />
              </div>

              <span className="text-xs font-medium text-black/40">
                REVERSALS
              </span>
            </div>

            <p className="mt-5 text-xs font-medium uppercase tracking-wide text-black/50">
              Total Reversals
            </p>

            <p className="mt-1 text-2xl font-bold tracking-tight text-black">
              {isSummaryLoading
                ? "—"
                : formatKES(
                    reversals,
                  )}
            </p>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <div className="rounded-xl bg-purple-50 p-2.5 text-purple-600">
                <Users className="h-5 w-5" />
              </div>

              <span className="text-xs font-medium text-black/40">
                MEMBERS
              </span>
            </div>

            <p className="mt-5 text-xs font-medium uppercase tracking-wide text-black/50">
              Members with Savings
            </p>

            <p className="mt-1 text-2xl font-bold tracking-tight text-black">
              {isSummaryLoading
                ? "—"
                : summary.memberCount.toLocaleString(
                    "en-KE",
                  )}
            </p>
          </div>
        </section>

        {/* MOBILE SUMMARY */}

        <section className="mt-5 lg:hidden">
          <OverviewCard
            eyebrow="Savings Overview"
            value={
              isSummaryLoading
                ? "—"
                : formatKES(
                    calculatedBalance,
                  )
            }
            description="Authoritative ledger balance"
            icon={
              <Wallet
                size={19}
                strokeWidth={1.8}
              />
            }
            footerLabel="Open savings"
            footerHref="/dashboard/savings"
            metrics={[
              {
                label:
                  "Deposits",
                value:
                  isSummaryLoading
                    ? "—"
                    : formatKES(
                        deposits,
                      ),
              },
              {
                label:
                  "Withdrawals",
                value:
                  isSummaryLoading
                    ? "—"
                    : formatKES(
                        withdrawals,
                      ),
              },
              {
                label:
                  "Reversals",
                value:
                  isSummaryLoading
                    ? "—"
                    : formatKES(
                        reversals,
                      ),
              },
            ]}
          />
        </section>

        {/* SEARCH */}

        <section className="mt-6">
          <SavingsSearch
            value={
              filters
            }
            onChange={
              setFilters
            }
            onReset={() =>
              setFilters(
                DEFAULT_FILTERS,
              )
            }
          />
        </section>

        {/* TRANSACTIONS */}

        <section className="mt-5">
          {/* DESKTOP */}

          <div className="hidden lg:block">
            <SavingsTable
              transactions={
                filteredTransactions
              }
              loading={
                isTransactionsLoading
              }
              onAdjust={
                handleAdjust
              }
              onReverse={
                handleReverse
              }
            />
          </div>

          {/* MOBILE */}

          <div className="lg:hidden">
            <div className="mb-3 flex items-end justify-between px-1">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-black/45">
                  Transactions
                </p>

                <p className="mt-1 text-[10px] text-black/30">
                  Swipe left or right
                  for more
                </p>
              </div>

              <span className="text-[9px] text-blue-600/70">
                {filteredTransactions.length.toLocaleString(
                  "en-KE",
                )}
              </span>
            </div>

            {isTransactionsLoading ? (
              <div
                className="
                  animate-pulse
                  overflow-hidden
                  rounded-[20px]
                  border
                  border-slate-200
                  bg-white
                  p-4
                  shadow-sm
                "
              >
                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 rounded-xl bg-slate-100" />

                  <div className="min-w-0 flex-1">
                    <div className="h-2.5 w-28 rounded bg-slate-100" />

                    <div className="mt-2 h-2 w-36 rounded bg-slate-100" />
                  </div>

                  <div className="h-2 w-10 rounded bg-slate-100" />
                </div>

                <div className="mt-4 flex items-end justify-between gap-4">
                  <div className="h-2 w-32 rounded bg-slate-100" />

                  <div className="h-4 w-24 rounded bg-slate-100" />
                </div>
              </div>
            ) : transactionsError ? (
              <div className="rounded-[20px] border border-red-200 bg-red-50 p-5 text-center">
                <AlertCircle className="mx-auto h-7 w-7 text-red-600" />

                <p className="mt-3 font-medium text-red-700">
                  Failed to load transactions
                </p>

                <p className="mt-1 text-sm text-red-600/70">
                  {transactionsError}
                </p>

                <button
                  type="button"
                  onClick={
                    handleRefresh
                  }
                  disabled={
                    refreshDisabled ===
                    true
                  }
                  className="mt-4 inline-flex items-center gap-2 rounded-xl bg-yellow-500 px-4 py-2 text-sm font-semibold text-black disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <RefreshCw className="h-4 w-4" />

                  Retry
                </button>
              </div>
            ) : filteredTransactions.length ===
              0 ? (
              <div className="rounded-[20px] border border-slate-200 bg-white p-8 text-center shadow-sm">
                <Wallet className="mx-auto h-8 w-8 text-black/20" />

                <p className="mt-3 font-medium text-black/70">
                  No savings transactions
                  found
                </p>

                <p className="mt-1 text-sm text-black/40">
                  Try changing your search or
                  filters.
                </p>
              </div>
            ) : (
              <>
                <div
                  className="
                    -mx-4
                    overflow-x-auto
                    overscroll-x-contain
                    scroll-smooth
                    snap-x
                    snap-mandatory
                    px-4
                    pb-2
                    [-ms-overflow-style:none]
                    [scrollbar-width:none]
                    [&::-webkit-scrollbar]:hidden
                  "
                  style={{
                    touchAction:
                      "pan-x",
                  }}
                >
                  <div className="flex gap-3">
                    {filteredTransactions.map(
                      (
                        transaction,
                      ) => (
                        <div
                          key={
                            transaction.id
                          }
                          className="
                            w-full
                            min-w-full
                            shrink-0
                            snap-center
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
                      ),
                    )}
                  </div>
                </div>

                {filteredTransactions.length >
                  1 && (
                  <div className="mt-3 flex items-center justify-center gap-1.5">
                    <span className="text-[9px] text-black/25">
                      ←
                    </span>

                    <div className="flex items-center gap-1">
                      {filteredTransactions
                        .slice(
                          0,
                          Math.min(
                            filteredTransactions.length,
                            8,
                          ),
                        )
                        .map(
                          (
                            transaction,
                            index,
                          ) => (
                            <span
                              key={
                                transaction.id
                              }
                              className={`
                                h-1 rounded-full
                                transition-all
                                ${
                                  index ===
                                  0
                                    ? "w-4 bg-blue-500"
                                    : "w-1.5 bg-slate-300"
                                }
                              `}
                            />
                          ),
                        )}
                    </div>

                    <span className="text-[9px] text-black/25">
                      →
                    </span>
                  </div>
                )}
              </>
            )}
          </div>

          {/* COUNT */}

          <div className="mt-4 flex items-center justify-between text-xs text-black/40">
            <span>
              Showing{" "}
              {
                filteredTransactions.length
              }{" "}
              of{" "}
              {
                transactionsTotal
              }{" "}
              transactions
            </span>

            {isRefreshing && (
              <span className="inline-flex items-center gap-1.5">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Refreshing…
              </span>
            )}
          </div>
        </section>
      </main>

      {/* SAVINGS FORM */}

      {formOpen && (
        <SavingsForm
          open={
            formOpen
          }
          onClose={() =>
            setFormOpen(false)
          }
          onSuccess={
            handleSavingsSuccess
          }
        />
      )}

      {/* ACTION MODAL */}

      <SavingsActionModal
        open={
          action !== null &&
          actionTransaction !==
            null
        }
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
          closeActionModal
        }
        onSubmit={
          handleSubmitAction
        }
      />
    </div>
  );
}