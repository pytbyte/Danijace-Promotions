"use client";

import {
  ArrowDownLeft,
  Banknote,
  CheckCircle2,
  CircleAlert,
  Clock3,
  FileWarning,
  RefreshCw,
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

  /**
   * Financial transaction date.
   *
   * This may be:
   *
   * YYYY-MM-DD
   *
   * or an actual timestamp returned by the API.
   */
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

type LoanWaiver = {
  id?: string;
  loanId?: string;
  loanNumber?: string;
  memberId?: string;
  waiverReference?: string;
  amount?: number | string;
  reason?: string;
  waivedBy?: {
    name?: string;
    email?: string;
  };
  createdAt?: string;
};

type LoanWaiverResponse = {
  success?: boolean;
  data?: LoanWaiver[];
  count?: number;
  error?: string;
};

type LoanWaiverCreateResponse = {
  success?: boolean;
  data?: LoanWaiver;
  error?: string;
};

type LoanTransactionModalProps = {
  loan: Loan | null;
  open: boolean;
  onClose: () => void;
  onLoanUpdated?: () => void | Promise<void>;
};

/* =========================================================
   CONSTANTS
========================================================= */

const WAIVERS_API = "/api/loans/waivers";

/* =========================================================
   HELPERS
========================================================= */

function formatKES(value: unknown): string {
  const amount =
    typeof value === "number"
      ? value
      : Number(value);

  if (!Number.isFinite(amount)) {
    return "KES 0.00";
  }

  return `KES ${amount.toLocaleString("en-KE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/* =========================================================
   CALENDAR DATE HELPERS
========================================================= */

/**
 * GEO-SHUA financial dates are CalendarDate strings:
 *
 * YYYY-MM-DD
 *
 * These values represent a calendar day.
 *
 * IMPORTANT:
 *
 * Never do:
 *
 * new Date("2026-09-18")
 *
 * because that introduces JavaScript timezone semantics into
 * a value that is supposed to remain an exact calendar date.
 */
function isCalendarDate(
  value: unknown,
): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(
      value.trim(),
    )
  );
}

/**
 * Converts YYYY-MM-DD into a numeric calendar key.
 *
 * Example:
 *
 * 2026-09-18 -> 20260918
 * 2026-09-17 -> 20260917
 *
 * This is string manipulation only.
 * No JavaScript Date is involved.
 */
function getCalendarDateKey(
  value: string,
): number {
  if (!isCalendarDate(value)) {
    return 0;
  }

  const numeric = Number(
    value.replaceAll("-", ""),
  );

  return Number.isFinite(numeric)
    ? numeric
    : 0;
}

/**
 * Validates and formats a CalendarDate.
 */
function formatCalendarDate(
  value: unknown,
): string {
  if (!isCalendarDate(value)) {
    return "";
  }

  const trimmed = value.trim();

  const [
    year,
    month,
    day,
  ] = trimmed.split("-");

  const parsedYear = Number(year);
  const parsedMonth = Number(month);
  const parsedDay = Number(day);

  if (
    !Number.isInteger(parsedYear) ||
    !Number.isInteger(parsedMonth) ||
    !Number.isInteger(parsedDay) ||
    parsedMonth < 1 ||
    parsedMonth > 12 ||
    parsedDay < 1 ||
    parsedDay > 31
  ) {
    return "";
  }

  const monthNames = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];

  return `${monthNames[parsedMonth - 1]} ${parsedDay}, ${parsedYear}`;
}

/* =========================================================
   TIMESTAMP HELPERS
========================================================= */

/**
 * Formats actual timestamps such as:
 *
 * 2026-09-18T14:32:00.000Z
 *
 * These are different from financial CalendarDate fields.
 */
function formatTimestamp(
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

  if (Number.isNaN(date.getTime())) {
    return "Unknown date";
  }

  return new Intl.DateTimeFormat("en-KE", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

/**
 * Displays either a CalendarDate or an actual timestamp.
 */
function formatTransactionDate(
  value: unknown,
): string {
  if (typeof value === "string") {
    const calendarDate =
      formatCalendarDate(value);

    if (calendarDate) {
      return calendarDate;
    }

    return formatTimestamp(value);
  }

  if (value instanceof Date) {
    return formatTimestamp(value);
  }

  return "Unknown date";
}

/* =========================================================
   TRANSACTION DATE
========================================================= */

/**
 * Returns the transaction's authoritative date.
 *
 * transactionDate is always preferred because it represents
 * the actual financial transaction date.
 *
 * createdAt/updatedAt are only fallbacks when transactionDate
 * is absent.
 */
function getTransactionDateValue(
  transaction: LoanTransaction,
): string | undefined {
  const transactionDate =
    typeof transaction.transactionDate ===
    "string"
      ? transaction.transactionDate.trim()
      : "";

  if (transactionDate) {
    return transactionDate;
  }

  const createdAt =
    typeof transaction.createdAt ===
    "string"
      ? transaction.createdAt.trim()
      : "";

  if (createdAt) {
    return createdAt;
  }

  const updatedAt =
    typeof transaction.updatedAt ===
    "string"
      ? transaction.updatedAt.trim()
      : "";

  if (updatedAt) {
    return updatedAt;
  }

  return undefined;
}

/* =========================================================
   TRANSACTION SORTING
========================================================= */

type TransactionSortKey = {
  /**
   * Calendar day:
   *
   * YYYYMMDD
   *
   * Example:
   *
   * 20260918
   */
  day: number;

  /**
   * Time inside that calendar day.
   *
   * For CalendarDate-only values this is 0.
   *
   * For timestamps this is the timestamp.
   */
  time: number;

  /**
   * Whether the source value was an exact CalendarDate.
   */
  isCalendarDate: boolean;
};

/**
 * Extracts the calendar day from an actual timestamp WITHOUT
 * converting the timestamp into the user's local calendar.
 *
 * Example:
 *
 * 2026-09-18T05:20:00.000Z
 *
 * gives:
 *
 * 20260918
 *
 * The date portion supplied by the backend remains authoritative.
 */
function getTimestampCalendarDay(
  value: string,
): number {
  const trimmed = value.trim();

  /*
   * ISO-like timestamp beginning with YYYY-MM-DD.
   *
   * We intentionally use the date portion directly instead of
   * converting it through Date -> local timezone.
   */
  const isoDateMatch =
    trimmed.match(
      /^(\d{4})-(\d{2})-(\d{2})(?:T|\s)/,
    );

  if (isoDateMatch) {
    const year = Number(
      isoDateMatch[1],
    );

    const month = Number(
      isoDateMatch[2],
    );

    const day = Number(
      isoDateMatch[3],
    );

    if (
      Number.isInteger(year) &&
      Number.isInteger(month) &&
      Number.isInteger(day) &&
      month >= 1 &&
      month <= 12 &&
      day >= 1 &&
      day <= 31
    ) {
      return (
        year * 10000 +
        month * 100 +
        day
      );
    }
  }

  /*
   * Fallback for timestamps that do not expose their date in
   * the expected ISO format.
   *
   * This is only used for actual timestamps, never for
   * CalendarDate values.
   */
  const timestamp =
    Date.parse(trimmed);

  if (!Number.isFinite(timestamp)) {
    return 0;
  }

  /*
   * UTC is used here only as a fallback for a timestamp whose
   * original date portion could not be extracted.
   *
   * This does NOT apply to YYYY-MM-DD financial dates.
   */
  const date =
    new Date(timestamp);

  return (
    date.getUTCFullYear() *
      10000 +
    (date.getUTCMonth() + 1) *
      100 +
    date.getUTCDate()
  );
}

/**
 * Creates a normalized transaction sort key.
 *
 * This is the important part of the ordering fix.
 *
 * We NEVER compare:
 *
 * 20260918
 *
 * directly against:
 *
 * 1758192000000
 *
 * anymore.
 *
 * Everything is first normalized into:
 *
 * {
 *   day: YYYYMMDD,
 *   time: timestamp
 * }
 *
 * Therefore:
 *
 * Jan 14 > Jan 13
 *
 * regardless of whether one record is a CalendarDate and the
 * other is an ISO timestamp.
 */
function getTransactionSortKey(
  transaction: LoanTransaction,
): TransactionSortKey {
  const value =
    getTransactionDateValue(
      transaction,
    );

  if (!value) {
    return {
      day: 0,
      time: 0,
      isCalendarDate: false,
    };
  }

  const trimmed = value.trim();

  if (!trimmed) {
    return {
      day: 0,
      time: 0,
      isCalendarDate: false,
    };
  }

  /*
   * Exact GEO-SHUA CalendarDate.
   *
   * NEVER use Date.parse here.
   */
  if (isCalendarDate(trimmed)) {
    return {
      day: getCalendarDateKey(
        trimmed,
      ),
      time: 0,
      isCalendarDate: true,
    };
  }

  /*
   * Actual timestamp.
   */
  const timestamp =
    Date.parse(trimmed);

  if (!Number.isFinite(timestamp)) {
    return {
      day: 0,
      time: 0,
      isCalendarDate: false,
    };
  }

  return {
    day: getTimestampCalendarDay(
      trimmed,
    ),
    time: timestamp,
    isCalendarDate: false,
  };
}

/**
 * Returns a createdAt timestamp for tie-breaking.
 *
 * createdAt is an actual timestamp and therefore Date.parse is
 * appropriate here.
 */
function getCreatedAtSortValue(
  transaction: LoanTransaction,
): number {
  if (
    typeof transaction.createdAt !==
    "string"
  ) {
    return 0;
  }

  const value =
    transaction.createdAt.trim();

  if (!value) {
    return 0;
  }

  const timestamp =
    Date.parse(value);

  return Number.isFinite(timestamp)
    ? timestamp
    : 0;
}

/**
 * Sort repayment transactions latest first.
 *
 * Ordering priority:
 *
 * 1. transaction calendar day
 * 2. transaction time when available
 * 3. createdAt
 * 4. updatedAt
 * 5. ID
 *
 * Example:
 *
 * 2026-09-14
 * 2026-09-13
 * 2026-09-12
 *
 * will ALWAYS appear in that order.
 *
 * The original array is not mutated.
 */
function sortTransactionsLatestFirst(
  records: LoanTransaction[],
): LoanTransaction[] {
  return [...records].sort(
    (a, b) => {
      const aKey =
        getTransactionSortKey(a);

      const bKey =
        getTransactionSortKey(b);

      /*
       * =====================================================
       * 1. CALENDAR DAY
       * =====================================================
       *
       * This is the most important comparison.
       *
       * Example:
       *
       * b = 20260914
       * a = 20260913
       *
       * b comes first.
       */
      if (aKey.day !== bKey.day) {
        return bKey.day - aKey.day;
      }

      /*
       * =====================================================
       * 2. TIME WITHIN SAME DAY
       * =====================================================
       *
       * If both records belong to the same calendar day and
       * contain actual timestamps, newest timestamp comes
       * first.
       *
       * CalendarDate-only values have time = 0.
       */
      if (aKey.time !== bKey.time) {
        return bKey.time - aKey.time;
      }

      /*
       * =====================================================
       * 3. CREATED AT
       * =====================================================
       *
       * Useful when two SMS/payment records have the same
       * transaction date.
       */
      const aCreated =
        getCreatedAtSortValue(a);

      const bCreated =
        getCreatedAtSortValue(b);

      if (
        aCreated !== bCreated
      ) {
        return bCreated - aCreated;
      }

      /*
       * =====================================================
       * 4. UPDATED AT
       * =====================================================
       */
      const aUpdated =
        typeof a.updatedAt ===
        "string"
          ? Date.parse(
              a.updatedAt,
            )
          : 0;

      const bUpdated =
        typeof b.updatedAt ===
        "string"
          ? Date.parse(
              b.updatedAt,
            )
          : 0;

      const safeAUpdated =
        Number.isFinite(
          aUpdated,
        )
          ? aUpdated
          : 0;

      const safeBUpdated =
        Number.isFinite(
          bUpdated,
        )
          ? bUpdated
          : 0;

      if (
        safeAUpdated !==
        safeBUpdated
      ) {
        return (
          safeBUpdated -
          safeAUpdated
        );
      }

      /*
       * =====================================================
       * 5. DETERMINISTIC ID FALLBACK
       * =====================================================
       */
      return String(
        b.id || "",
      ).localeCompare(
        String(a.id || ""),
      );
    },
  );
}

/* =========================================================
   WAIVER SORTING
========================================================= */

/**
 * Waivers use createdAt as their authoritative ordering
 * timestamp.
 */
function getWaiverSortValue(
  waiver: LoanWaiver,
): number {
  if (
    typeof waiver.createdAt !==
      "string" ||
    !waiver.createdAt.trim()
  ) {
    return 0;
  }

  const timestamp =
    Date.parse(
      waiver.createdAt,
    );

  return Number.isFinite(timestamp)
    ? timestamp
    : 0;
}

/**
 * Sort waivers latest first.
 */
function sortWaiversLatestFirst(
  records: LoanWaiver[],
): LoanWaiver[] {
  return [...records].sort(
    (a, b) => {
      const bDate =
        getWaiverSortValue(b);

      const aDate =
        getWaiverSortValue(a);

      if (bDate !== aDate) {
        return bDate - aDate;
      }

      return String(
        b.id || "",
      ).localeCompare(
        String(a.id || ""),
      );
    },
  );
}

/* =========================================================
   DISPLAY HELPERS
========================================================= */

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
    source.trim().toLowerCase()
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
    status.trim().toLowerCase()
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
  if (typeof status !== "string") {
    return "bg-emerald-500/10 text-emerald-400";
  }

  switch (
    status.trim().toLowerCase()
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

function getWaiverAmount(
  waiver: LoanWaiver,
): number {
  const amount = Number(
    waiver.amount,
  );

  return Number.isFinite(amount)
    ? Math.max(0, amount)
    : 0;
}

function createWaiverReference(): string {
  if (
    typeof crypto === "undefined" ||
    typeof crypto.randomUUID !==
      "function"
  ) {
    throw new Error(
      "Secure waiver reference generation is unavailable on this device.",
    );
  }

  return `GEO-WAIVER-${crypto.randomUUID()}`;
}

/* =========================================================
   MODAL
========================================================= */

export default function LoanTransactionModal({
  loan,
  open,
  onClose,
  onLoanUpdated,
}: LoanTransactionModalProps) {
  /* =======================================================
     REPAYMENT STATE
  ======================================================= */

  const [
    transactions,
    setTransactions,
  ] = useState<LoanTransaction[]>([]);

  const [loading, setLoading] =
    useState(false);

  const [error, setError] =
    useState("");

  /* =======================================================
     WAIVER STATE
  ======================================================= */

  const [
    waivers,
    setWaivers,
  ] = useState<LoanWaiver[]>([]);

  const [
    waiversLoading,
    setWaiversLoading,
  ] = useState(false);

  const [
    waiverSubmitting,
    setWaiverSubmitting,
  ] = useState(false);

  const [
    waiverError,
    setWaiverError,
  ] = useState("");

  const [
    waiverSuccess,
    setWaiverSuccess,
  ] = useState("");

  const [
    waiverAmount,
    setWaiverAmount,
  ] = useState("");

  const [
    waiverReason,
    setWaiverReason,
  ] = useState("");

  const [
    pendingWaiverReference,
    setPendingWaiverReference,
  ] = useState<string | null>(null);

  const [
    waiverFormOpen,
    setWaiverFormOpen,
  ] = useState(false);

  /* =======================================================
     LOAD TRANSACTIONS
  ======================================================= */

  const loadTransactions =
    useCallback(async () => {
      if (!loan) {
        return;
      }

      const loanId =
        typeof loan.id === "string"
          ? loan.id.trim()
          : "";

      if (!loanId) {
        setTransactions([]);
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
              cache: "no-store",
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
          | null = null;

        try {
          result =
            JSON.parse(
              rawResponse,
            ) as LoanTransactionResponse;
        } catch {
          result = null;
        }

        if (!response.ok) {
          throw new Error(
            result?.error ||
              `Failed to load loan transactions (${response.status}).`,
          );
        }

        if (
          result?.success === false
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

        /*
         * ===================================================
         * ALWAYS SORT LOCALLY
         * ===================================================
         *
         * We do not depend on MongoDB/API ordering.
         *
         * The final UI order is:
         *
         * newest calendar date
         *       ↓
         * newest transaction time
         *       ↓
         * newest createdAt
         */
        const sortedRecords =
          sortTransactionsLatestFirst(
            records,
          );

        setTransactions(
          sortedRecords,
        );
      } catch (requestError) {
        console.error(
          "Loan transaction history error:",
          requestError,
        );

        setTransactions([]);

        setError(
          requestError instanceof Error
            ? requestError.message
            : "Failed to load loan transaction history.",
        );
      } finally {
        setLoading(false);
      }
    }, [loan]);

  /* =======================================================
     LOAD WAIVERS
  ======================================================= */

  const loadWaivers =
    useCallback(async () => {
      if (!loan) {
        return;
      }

      const loanId =
        typeof loan.id === "string"
          ? loan.id.trim()
          : "";

      if (!loanId) {
        setWaivers([]);
        setWaiverError(
          "This loan does not have a valid ID.",
        );
        return;
      }

      setWaiversLoading(true);
      setWaiverError("");

      try {
        const params =
          new URLSearchParams();

        params.set(
          "loanId",
          loanId,
        );

        const response =
          await fetch(
            `${WAIVERS_API}?${params.toString()}`,
            {
              method: "GET",
              credentials:
                "same-origin",
              cache: "no-store",
              headers: {
                Accept:
                  "application/json",
              },
            },
          );

        const rawResponse =
          await response.text();

        let result:
          | LoanWaiverResponse
          | null = null;

        try {
          result =
            JSON.parse(
              rawResponse,
            ) as LoanWaiverResponse;
        } catch {
          result = null;
        }

        if (!response.ok) {
          throw new Error(
            result?.error ||
              `Failed to load loan waivers (${response.status}).`,
          );
        }

        if (
          result?.success === false
        ) {
          throw new Error(
            result.error ||
              "Failed to load loan waivers.",
          );
        }

        const records =
          Array.isArray(
            result?.data,
          )
            ? result.data
            : [];

        setWaivers(
          sortWaiversLatestFirst(
            records,
          ),
        );
      } catch (requestError) {
        console.error(
          "Loan waiver history error:",
          requestError,
        );

        setWaivers([]);

        setWaiverError(
          requestError instanceof Error
            ? requestError.message
            : "Failed to load loan waiver history.",
        );
      } finally {
        setWaiversLoading(false);
      }
    }, [loan]);

  /* =======================================================
     INITIAL LOAD
  ======================================================= */

  useEffect(() => {
    if (!open || !loan) {
      return;
    }

    setError("");
    setWaiverError("");
    setWaiverSuccess("");

    void loadTransactions();
    void loadWaivers();
  }, [
    open,
    loan,
    loadTransactions,
    loadWaivers,
  ]);

  /* =======================================================
     RESET WHEN DIFFERENT LOAN IS OPENED
  ======================================================= */

  useEffect(() => {
    if (!loan?.id) {
      return;
    }

    setWaiverFormOpen(false);
    setWaiverAmount("");
    setWaiverReason("");
    setPendingWaiverReference(
      null,
    );
    setWaiverError("");
    setWaiverSuccess("");
  }, [loan?.id]);

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
          const amount = Number(
            transaction.amount,
          );

          if (
            !Number.isFinite(
              amount,
            )
          ) {
            return total;
          }

          return total + amount;
        },
        0,
      );
    }, [transactions]);

  /* =======================================================
     WAIVER TOTALS
  ======================================================= */

  const totalWaivedFromHistory =
    useMemo(() => {
      return waivers.reduce(
        (
          total,
          waiver,
        ) =>
          total +
          getWaiverAmount(
            waiver,
          ),
        0,
      );
    }, [waivers]);

  const totalFines =
    Number.isFinite(
      loan?.totalFines,
    )
      ? Math.max(
          0,
          loan?.totalFines ?? 0,
        )
      : 0;

  const projectedWaivedFines =
    Number.isFinite(
      loan?.totalWaivedFines,
    )
      ? Math.max(
          0,
          loan?.totalWaivedFines ?? 0,
        )
      : 0;

  const knownWaivedFines =
    Math.max(
      projectedWaivedFines,
      totalWaivedFromHistory,
    );

  const activeFineBalance =
    Math.max(
      0,
      totalFines -
        knownWaivedFines,
    );

  const canRecordWaiver =
    loan?.status === "active" &&
    activeFineBalance > 0;

  /* =======================================================
     CURRENT INSTALLMENT BALANCE

     SERVER-DERIVED ONLY.

     The frontend does NOT calculate:
     - repayment periods
     - expected installments
     - payments during period
     - remaining installment
     - fines
  ======================================================= */

  const currentInstallmentBalance =
    useMemo(() => {
      const value = Number(
        loan?.completedInstallmentBalance,
      );

      if (
        !Number.isFinite(
          value,
        )
      ) {
        return 0;
      }

      return Math.max(
        0,
        value,
      );
    }, [
      loan?.completedInstallmentBalance,
    ]);

  /* =======================================================
     OPEN WAIVER FORM
  ======================================================= */

  const handleOpenWaiverForm =
    useCallback(() => {
      if (!canRecordWaiver) {
        return;
      }

      setWaiverFormOpen(true);
      setWaiverError("");
      setWaiverSuccess("");
    }, [
      canRecordWaiver,
    ]);

  /* =======================================================
     CLOSE WAIVER FORM
  ======================================================= */

  const handleCancelWaiver =
    useCallback(() => {
      if (waiverSubmitting) {
        return;
      }

      setWaiverFormOpen(false);
      setWaiverAmount("");
      setWaiverReason("");
      setPendingWaiverReference(
        null,
      );
      setWaiverError("");
      setWaiverSuccess("");
    }, [
      waiverSubmitting,
    ]);

  /* =======================================================
     SUBMIT WAIVER
  ======================================================= */

  const handleSubmitWaiver =
    useCallback(async () => {
      if (!loan) {
        setWaiverError(
          "No loan is selected.",
        );
        return;
      }

      if (waiverSubmitting) {
        return;
      }

      const loanId =
        typeof loan.id === "string"
          ? loan.id.trim()
          : "";

      if (!loanId) {
        setWaiverError(
          "This loan does not have a valid ID.",
        );
        return;
      }

      if (
        loan.status !== "active"
      ) {
        setWaiverError(
          "Fine waivers can only be recorded for active loans.",
        );
        return;
      }

      const amount = Number(
        waiverAmount,
      );

      if (
        !Number.isFinite(
          amount,
        ) ||
        amount <= 0
      ) {
        setWaiverError(
          "Enter a valid waiver amount greater than zero.",
        );
        return;
      }

      if (
        Math.abs(
          amount -
            Math.round(
              amount * 100,
            ) /
              100,
        ) > 0.000001
      ) {
        setWaiverError(
          "Waiver amount cannot have more than two decimal places.",
        );
        return;
      }

      if (
        amount >
        activeFineBalance
      ) {
        setWaiverError(
          `Waiver cannot exceed the available fine balance of ${formatKES(
            activeFineBalance,
          )}.`,
        );
        return;
      }

      const reason =
        waiverReason.trim();

      if (!reason) {
        setWaiverError(
          "A reason is required for every fine waiver.",
        );
        return;
      }

      if (reason.length > 1000) {
        setWaiverError(
          "Waiver reason must not exceed 1000 characters.",
        );
        return;
      }

      let waiverReference =
        pendingWaiverReference;

      if (!waiverReference) {
        try {
          waiverReference =
            createWaiverReference();

          setPendingWaiverReference(
            waiverReference,
          );
        } catch (
          referenceError
        ) {
          setWaiverError(
            referenceError instanceof
              Error
              ? referenceError.message
              : "Unable to generate a secure waiver reference.",
          );
          return;
        }
      }

      setWaiverSubmitting(
        true,
      );
      setWaiverError("");
      setWaiverSuccess("");

      try {
        const response =
          await fetch(
            WAIVERS_API,
            {
              method: "POST",
              credentials:
                "same-origin",
              headers: {
                "Content-Type":
                  "application/json",
                Accept:
                  "application/json",
              },
              body: JSON.stringify({
                waiverReference,
                loanId,
                amount,
                reason,
              }),
            },
          );

        const rawResponse =
          await response.text();

        let result:
          | LoanWaiverCreateResponse
          | null = null;

        try {
          result =
            JSON.parse(
              rawResponse,
            ) as LoanWaiverCreateResponse;
        } catch {
          result = null;
        }

        if (!response.ok) {
          throw new Error(
            result?.error ||
              `Unable to record waiver. Server returned ${response.status}.`,
          );
        }

        if (
          !result?.success
        ) {
          throw new Error(
            result?.error ||
              "Unable to record fine waiver.",
          );
        }

        setPendingWaiverReference(
          null,
        );

        setWaiverAmount("");
        setWaiverReason("");

        setWaiverSuccess(
          "Fine waiver recorded successfully.",
        );

        setWaiverFormOpen(
          false,
        );

        await loadWaivers();

        if (onLoanUpdated) {
          await onLoanUpdated();
        }
      } catch (
        requestError
      ) {
        console.error(
          "Loan waiver submission error:",
          requestError,
        );

        setWaiverError(
          requestError instanceof
            Error
            ? requestError.message
            : "Something went wrong while recording the fine waiver.",
        );
      } finally {
        setWaiverSubmitting(
          false,
        );
      }
    }, [
      loan,
      waiverSubmitting,
      waiverAmount,
      waiverReason,
      activeFineBalance,
      pendingWaiverReference,
      loadWaivers,
      onLoanUpdated,
    ]);

  /* =======================================================
     ESCAPE KEY
  ======================================================= */

  useEffect(() => {
    if (!open) {
      return;
    }

    const handleKeyDown = (
      event: KeyboardEvent,
    ) => {
      if (
        event.key === "Escape" &&
        !waiverSubmitting
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
    waiverSubmitting,
  ]);

  /* =======================================================
     CLOSED
  ======================================================= */

  if (!open || !loan) {
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
            event.currentTarget &&
          !waiverSubmitting
        ) {
          onClose();
        }
      }}
    >
      <section
        className="
          flex
          max-h-[92vh]
          w-full
          max-w-5xl
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
            onClick={onClose}
            disabled={
              waiverSubmitting
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
              disabled:cursor-not-allowed
              disabled:opacity-40
            "
            aria-label="Close"
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
            label="Weekly balance"
            value={formatKES(
              currentInstallmentBalance,
            )}
            danger={
              currentInstallmentBalance >
              0
            }
          />

          <SummaryBox
            label="Outstanding"
            value={formatKES(
              loan.outstandingBalance,
            )}
            highlight
          />
        </div>

        {/* =================================================
            SCROLLABLE CONTENT
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
          {/* =================================================
              FINE WAIVERS
          ================================================= */}

          <section className="mb-5 rounded-2xl border border-amber-500/10 bg-amber-500/[0.025] p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-3">
                <div
                  className="
                    flex
                    h-9
                    w-9
                    shrink-0
                    items-center
                    justify-center
                    rounded-xl
                    bg-amber-500/10
                    text-amber-400
                  "
                >
                  <FileWarning
                    size={17}
                    strokeWidth={1.8}
                  />
                </div>

                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-white/80">
                    Fine Waivers
                  </h3>

                  <p className="mt-1 text-[10px] leading-5 text-white/30">
                    Manage authorized
                    reductions of
                    outstanding loan
                    fines.
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  void loadWaivers();
                }}
                disabled={
                  waiversLoading ||
                  waiverSubmitting
                }
                className="
                  flex
                  h-8
                  w-8
                  shrink-0
                  items-center
                  justify-center
                  rounded-lg
                  border
                  border-white/[0.06]
                  bg-white/[0.025]
                  text-white/30
                  transition
                  hover:bg-white/[0.05]
                  hover:text-white
                  disabled:cursor-not-allowed
                  disabled:opacity-40
                "
                aria-label="Refresh waivers"
                title="Refresh waivers"
              >
                <RefreshCw
                  size={14}
                  strokeWidth={1.8}
                  className={
                    waiversLoading
                      ? "animate-spin"
                      : ""
                  }
                />
              </button>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
              <SummaryBox
                label="Total fines"
                value={formatKES(
                  totalFines,
                )}
              />

              <SummaryBox
                label="Total waived"
                value={formatKES(
                  knownWaivedFines,
                )}
              />

              <SummaryBox
                label="Active fine balance"
                value={formatKES(
                  activeFineBalance,
                )}
                highlight={
                  activeFineBalance >
                  0
                }
              />
            </div>

            {canRecordWaiver &&
              !waiverFormOpen && (
                <button
                  type="button"
                  onClick={
                    handleOpenWaiverForm
                  }
                  className="
                    mt-4
                    flex
                    w-full
                    items-center
                    justify-center
                    gap-2
                    rounded-xl
                    border
                    border-amber-500/20
                    bg-amber-500/[0.07]
                    px-4
                    py-3
                    text-xs
                    font-semibold
                    text-amber-400
                    transition
                    hover:border-amber-500/30
                    hover:bg-amber-500/[0.12]
                    active:scale-[0.99]
                  "
                >
                  <FileWarning
                    size={15}
                    strokeWidth={2}
                  />

                  Add Fine Waiver
                </button>
              )}

            {waiverFormOpen &&
              canRecordWaiver && (
                <div className="mt-4 rounded-xl border border-amber-500/15 bg-black/20 p-4">
                  <div className="mb-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <h4 className="text-xs font-semibold text-white/70">
                          Add Fine Waiver
                        </h4>

                        <p className="mt-1 text-[9px] leading-5 text-white/25">
                          This creates a
                          permanent,
                          audit-safe
                          financial
                          record.
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={
                          handleCancelWaiver
                        }
                        disabled={
                          waiverSubmitting
                        }
                        className="
                          flex
                          h-7
                          w-7
                          items-center
                          justify-center
                          rounded-lg
                          text-white/25
                          transition
                          hover:bg-white/[0.05]
                          hover:text-white
                          disabled:cursor-not-allowed
                          disabled:opacity-40
                        "
                        aria-label="Cancel waiver"
                      >
                        <X
                          size={14}
                          strokeWidth={1.8}
                        />
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <label className="block">
                      <span className="mb-1.5 block text-[9px] font-medium uppercase tracking-[0.12em] text-white/30">
                        Waiver amount
                      </span>

                      <div className="relative">
                        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[10px] text-white/25">
                          KES
                        </span>

                        <input
                          type="number"
                          inputMode="decimal"
                          min="0.01"
                          max={
                            activeFineBalance
                          }
                          step="0.01"
                          value={
                            waiverAmount
                          }
                          onChange={(
                            event,
                          ) => {
                            setWaiverAmount(
                              event
                                .target
                                .value,
                            );
                            setWaiverError(
                              "",
                            );
                            setWaiverSuccess(
                              "",
                            );
                          }}
                          disabled={
                            waiverSubmitting
                          }
                          placeholder="0.00"
                          className="
                            h-11
                            w-full
                            rounded-xl
                            border
                            border-white/[0.08]
                            bg-white/[0.025]
                            pl-12
                            pr-3
                            text-sm
                            text-white
                            outline-none
                            transition
                            placeholder:text-white/15
                            focus:border-amber-500/30
                            focus:bg-white/[0.04]
                            disabled:cursor-not-allowed
                            disabled:opacity-50
                          "
                        />
                      </div>

                      <p className="mt-1.5 text-[9px] text-white/20">
                        Maximum
                        available:{" "}
                        <span className="text-amber-400/60">
                          {formatKES(
                            activeFineBalance,
                          )}
                        </span>
                      </p>
                    </label>

                    <label className="block">
                      <span className="mb-1.5 block text-[9px] font-medium uppercase tracking-[0.12em] text-white/30">
                        Reason
                      </span>

                      <textarea
                        value={
                          waiverReason
                        }
                        onChange={(
                          event,
                        ) => {
                          setWaiverReason(
                            event
                              .target
                              .value,
                          );
                          setWaiverError(
                            "",
                          );
                          setWaiverSuccess(
                            "",
                          );
                        }}
                        disabled={
                          waiverSubmitting
                        }
                        maxLength={
                          1000
                        }
                        rows={3}
                        placeholder="Why is this fine being waived?"
                        className="
                          w-full
                          resize-none
                          rounded-xl
                          border
                          border-white/[0.08]
                          bg-white/[0.025]
                          px-3
                          py-2.5
                          text-xs
                          leading-5
                          text-white
                          outline-none
                          transition
                          placeholder:text-white/15
                          focus:border-amber-500/30
                          focus:bg-white/[0.04]
                          disabled:cursor-not-allowed
                          disabled:opacity-50
                        "
                      />

                      <p className="mt-1 text-right text-[9px] text-white/20">
                        {
                          waiverReason.length
                        }
                        /1000
                      </p>
                    </label>
                  </div>

                  {waiverError && (
                    <div className="mt-4 rounded-xl border border-red-500/15 bg-red-500/[0.04] p-3">
                      <div className="flex items-start gap-2">
                        <CircleAlert
                          size={15}
                          className="mt-0.5 shrink-0 text-red-400"
                          strokeWidth={
                            1.8
                          }
                        />

                        <p className="break-words text-[10px] leading-5 text-red-300/75">
                          {
                            waiverError
                          }
                        </p>
                      </div>
                    </div>
                  )}

                  {waiverSuccess && (
                    <div className="mt-4 rounded-xl border border-emerald-500/15 bg-emerald-500/[0.04] p-3">
                      <div className="flex items-start gap-2">
                        <CheckCircle2
                          size={15}
                          className="mt-0.5 shrink-0 text-emerald-400"
                          strokeWidth={
                            1.8
                          }
                        />

                        <p className="text-[10px] leading-5 text-emerald-300/75">
                          {
                            waiverSuccess
                          }
                        </p>
                      </div>
                    </div>
                  )}

                  {pendingWaiverReference && (
                    <div className="mt-4 rounded-xl border border-blue-500/10 bg-blue-500/[0.025] p-3">
                      <p className="text-[9px] leading-5 text-blue-300/50">
                        This submission has
                        a retained
                        transaction
                        reference. If
                        the previous
                        request was
                        interrupted,
                        retrying will
                        not create a
                        duplicate
                        waiver.
                      </p>
                    </div>
                  )}

                  <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                    <button
                      type="button"
                      onClick={
                        handleCancelWaiver
                      }
                      disabled={
                        waiverSubmitting
                      }
                      className="
                        inline-flex
                        h-10
                        items-center
                        justify-center
                        rounded-xl
                        border
                        border-white/[0.08]
                        bg-white/[0.025]
                        px-4
                        text-xs
                        font-medium
                        text-white/45
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
                      onClick={() => {
                        void handleSubmitWaiver();
                      }}
                      disabled={
                        waiverSubmitting ||
                        !waiverAmount ||
                        !waiverReason.trim()
                      }
                      className="
                        inline-flex
                        h-10
                        items-center
                        justify-center
                        gap-2
                        rounded-xl
                        bg-amber-500
                        px-5
                        text-xs
                        font-semibold
                        text-black
                        transition
                        hover:bg-amber-400
                        active:scale-[0.98]
                        disabled:cursor-not-allowed
                        disabled:opacity-40
                      "
                    >
                      {waiverSubmitting ? (
                        <>
                          <RefreshCw
                            size={14}
                            className="animate-spin"
                            strokeWidth={
                              2
                            }
                          />
                          Recording...
                        </>
                      ) : (
                        <>
                          <CheckCircle2
                            size={14}
                            strokeWidth={
                              2
                            }
                          />
                          Record Waiver
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}

            {!canRecordWaiver && (
              <div className="mt-4 rounded-xl border border-white/[0.06] bg-black/20 p-3">
                {loan.status !==
                "active" ? (
                  <p className="text-[10px] leading-5 text-white/30">
                    Fine waivers
                    cannot be
                    recorded
                    because this
                    loan is{" "}
                    <span className="font-medium capitalize text-white/50">
                      {
                        loan.status
                      }
                    </span>
                    .
                  </p>
                ) : (
                  <p className="text-[10px] leading-5 text-white/30">
                    There are
                    currently no
                    active fines
                    available for
                    waiver.
                  </p>
                )}
              </div>
            )}

            {/* =================================================
                WAIVER HISTORY
            ================================================= */}

            <div className="mt-5">
              <div className="mb-2 flex items-center justify-between gap-3">
                <div>
                  <p className="text-[9px] font-medium uppercase tracking-[0.14em] text-white/25">
                    Waiver history
                  </p>

                  <p className="mt-0.5 text-[9px] text-white/15">
                    {waivers.length.toLocaleString(
                      "en-KE",
                    )}{" "}
                    recorded{" "}
                    {waivers.length ===
                    1
                      ? "waiver"
                      : "waivers"}
                  </p>
                </div>
              </div>

              {waiversLoading ? (
                <div className="space-y-2">
                  {Array.from(
                    {
                      length: 2,
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
                          h-[82px]
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
              ) : waivers.length ===
                0 ? (
                <div className="rounded-xl border border-dashed border-white/[0.07] bg-black/15 p-5 text-center">
                  <p className="text-[10px] font-medium text-white/35">
                    No fine waivers
                    recorded
                  </p>

                  <p className="mt-1 text-[9px] leading-5 text-white/20">
                    Approved fine
                    waivers will
                    appear here
                    permanently.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {waivers.map(
                    (
                      waiver,
                      index,
                    ) => {
                      const amount =
                        getWaiverAmount(
                          waiver,
                        );

                      const reference =
                        waiver.waiverReference ||
                        "—";

                      const actorName =
                        waiver
                          .waivedBy
                          ?.name ||
                        "Unknown";

                      const actorEmail =
                        waiver
                          .waivedBy
                          ?.email ||
                        "—";

                      return (
                        <article
                          key={
                            waiver.id ||
                            `${loan.id}-waiver-${index}`
                          }
                          className="
                            rounded-xl
                            border
                            border-white/[0.06]
                            bg-white/[0.02]
                            p-3
                          "
                        >
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div className="min-w-0">
                              <div className="flex items-center gap-3">
                                <div
                                  className="
                                    flex
                                    h-8
                                    w-8
                                    shrink-0
                                    items-center
                                    justify-center
                                    rounded-lg
                                    bg-amber-500/10
                                    text-amber-400
                                  "
                                >
                                  <FileWarning
                                    size={
                                      14
                                    }
                                    strokeWidth={
                                      1.8
                                    }
                                  />
                                </div>

                                <div className="min-w-0">
                                  <p className="text-xs font-medium text-white/70">
                                    Fine
                                    waiver
                                  </p>

                                  <p className="mt-0.5 truncate font-mono text-[9px] text-white/20">
                                    {
                                      reference
                                    }
                                  </p>
                                </div>
                              </div>

                              <p className="mt-3 break-words text-[10px] leading-5 text-white/40">
                                {waiver.reason ||
                                  "No reason provided."}
                              </p>
                            </div>

                            <div className="shrink-0 sm:text-right">
                              <p className="text-sm font-semibold text-amber-400">
                                {formatKES(
                                  amount,
                                )}
                              </p>

                              <p className="mt-1 text-[9px] text-white/20">
                                {formatTimestamp(
                                  waiver.createdAt,
                                )}
                              </p>
                            </div>
                          </div>

                          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                            <TransactionDetail
                              icon={
                                <UserRound
                                  size={
                                    12
                                  }
                                  strokeWidth={
                                    1.8
                                  }
                                />
                              }
                              label="Waived by"
                              value={
                                actorName
                              }
                            />

                            <TransactionDetail
                              icon={
                                <Smartphone
                                  size={
                                    12
                                  }
                                  strokeWidth={
                                    1.8
                                  }
                                />
                              }
                              label="Actor email"
                              value={
                                actorEmail
                              }
                            />
                          </div>
                        </article>
                      );
                    },
                  )}
                </div>
              )}
            </div>
          </section>

          {/* =================================================
              TRANSACTION ERROR
          ================================================= */}

          {error && (
            <div className="mb-4 rounded-xl border border-red-500/15 bg-red-500/[0.04] p-3">
              <div className="flex items-start gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-red-500/10 text-red-400">
                  <CircleAlert
                    size={16}
                    strokeWidth={
                      1.8
                    }
                  />
                </div>

                <div className="min-w-0">
                  <p className="text-xs font-medium text-red-300">
                    Transaction
                    history
                    unavailable
                  </p>

                  <p className="mt-1 break-words text-[10px] leading-5 text-red-300/55">
                    {error}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* =================================================
              REPAYMENT TRANSACTIONS
          ================================================= */}

          <section>
            <div className="mb-3 flex items-end justify-between gap-3">
              <div>
                <p className="text-[9px] font-medium uppercase tracking-[0.14em] text-white/25">
                  Repayment
                  transactions
                </p>

                <p className="mt-0.5 text-[9px] text-white/15">
                  Latest repayments
                  appear first.
                </p>
              </div>

              <button
                type="button"
                onClick={() => {
                  void loadTransactions();
                }}
                disabled={
                  loading ||
                  waiverSubmitting
                }
                className="
                  flex
                  h-8
                  w-8
                  shrink-0
                  items-center
                  justify-center
                  rounded-lg
                  border
                  border-white/[0.06]
                  bg-white/[0.025]
                  text-white/30
                  transition
                  hover:bg-white/[0.05]
                  hover:text-white
                  disabled:cursor-not-allowed
                  disabled:opacity-40
                "
                aria-label="Refresh transactions"
                title="Refresh transactions"
              >
                <RefreshCw
                  size={14}
                  strokeWidth={
                    1.8
                  }
                  className={
                    loading
                      ? "animate-spin"
                      : ""
                  }
                />
              </button>
            </div>

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
                  min-h-[220px]
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
                      strokeWidth={
                        1.7
                      }
                    />
                  </div>

                  <p className="mt-4 text-sm font-medium text-white/55">
                    No repayment
                    transactions
                  </p>

                  <p className="mt-1 text-xs leading-5 text-white/25">
                    No repayments
                    have been
                    recorded
                    against this
                    loan.
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
                      getTransactionDateValue(
                        transaction,
                      );

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
                                size={
                                  16
                                }
                                strokeWidth={
                                  1.8
                                }
                              />
                            </div>

                            <div className="min-w-0">
                              <p className="truncate text-xs font-medium text-white/75">
                                Loan
                                repayment
                              </p>

                              <p className="mt-0.5 truncate font-mono text-[10px] text-white/25">
                                {
                                  reference
                                }
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

                        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                          <TransactionDetail
                            icon={
                              <Smartphone
                                size={
                                  12
                                }
                                strokeWidth={
                                  1.8
                                }
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
                                size={
                                  12
                                }
                                strokeWidth={
                                  1.8
                                }
                              />
                            }
                            label="Date"
                            value={formatTransactionDate(
                              transactionDate,
                            )}
                          />

                          <TransactionDetail
                            icon={
                              transaction.status?.toLowerCase() ===
                              "reversed" ? (
                                <XCircle
                                  size={
                                    12
                                  }
                                  strokeWidth={
                                    1.8
                                  }
                                />
                              ) : (
                                <CheckCircle2
                                  size={
                                    12
                                  }
                                  strokeWidth={
                                    1.8
                                  }
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
                                size={
                                  12
                                }
                                strokeWidth={
                                  1.8
                                }
                              />
                            }
                            label="Reference"
                            value={
                              reference
                            }
                          />
                        </div>

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

                        {transaction.rawMessage && (
                          <details className="mt-3 rounded-lg bg-black/20">
                            <summary className="cursor-pointer px-3 py-2 text-[9px] uppercase tracking-[0.12em] text-white/20">
                              Source
                              message
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
          </section>
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
                : "transactions"}{" "}
              ·{" "}
              {waivers.length.toLocaleString(
                "en-KE",
              )}{" "}
              {waivers.length ===
              1
                ? "waiver"
                : "waivers"}
            </p>

            {totalRepayments >
              0 && (
              <p className="mt-0.5 text-[9px] text-white/15">
                Total repayments:{" "}
                <span className="text-emerald-400/50">
                  {formatKES(
                    totalRepayments,
                  )}
                </span>
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={
              waiverSubmitting
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
              disabled:cursor-not-allowed
              disabled:opacity-40
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
  danger = false,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  danger?: boolean;
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
            danger
              ? "text-red-400"
              : highlight
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