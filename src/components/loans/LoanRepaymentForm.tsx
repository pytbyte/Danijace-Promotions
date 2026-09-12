"use client";

import {
  FormEvent,
  useEffect,
  useState,
} from "react";

import {
  X,
  Banknote,
  CalendarDays,
  Hash,
  Loader2,
  MessageSquareText,
  User,
} from "lucide-react";

import type {
  Loan,
  TransactionSource,
} from "@/lib/loans/types";

/* =========================================================
   TYPES
========================================================= */

interface LoanRepaymentModalProps {
  loan: Loan | null;
  open: boolean;
  onClose: () => void;

  /**
   * Financial transaction dates are calendar dates.
   *
   * Format:
   *
   *     YYYY-MM-DD
   *
   * They are intentionally NOT JavaScript Date values.
   */
  onSubmit: (data: {
    loanId: string;
    amount: number;
    transactionReference: string;
    transactionDate: string;
    source: TransactionSource;
    rawMessage?: string;
  }) => Promise<void> | void;

  loading?: boolean;
}

/* =========================================================
   CALENDAR DATE
========================================================= */

/**
 * Return today's calendar date in Kenya.
 *
 * Financial dates are business/calendar dates, not
 * timestamps. Therefore we explicitly use Africa/Nairobi.
 */
function getKenyanToday(): string {
  const formatter =
    new Intl.DateTimeFormat(
      "en-CA",
      {
        timeZone: "Africa/Nairobi",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      },
    );

  return formatter.format(
    new Date(),
  );
}

/**
 * Validate an actual YYYY-MM-DD calendar date.
 *
 * This does NOT convert the date to a timestamp.
 * Date.UTC is used only to verify that the calendar
 * combination actually exists.
 */
function isValidCalendarDate(
  value: string,
): boolean {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(
      value,
    )
  ) {
    return false;
  }

  const [
    yearString,
    monthString,
    dayString,
  ] = value.split("-");

  const year =
    Number(yearString);

  const month =
    Number(monthString);

  const day =
    Number(dayString);

  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day)
  ) {
    return false;
  }

  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return false;
  }

  const parsed =
    new Date(
      Date.UTC(
        year,
        month - 1,
        day,
      ),
    );

  return (
    parsed.getUTCFullYear() ===
      year &&
    parsed.getUTCMonth() ===
      month - 1 &&
    parsed.getUTCDate() ===
      day
  );
}

/* =========================================================
   COMPONENT
========================================================= */

export default function LoanRepaymentModal({
  loan,
  open,
  onClose,
  onSubmit,
  loading = false,
}: LoanRepaymentModalProps) {
  const [amount, setAmount] =
    useState("");

  const [
    transactionReference,
    setTransactionReference,
  ] = useState("");

  const [
    transactionDate,
    setTransactionDate,
  ] = useState("");

  const [source, setSource] =
    useState<TransactionSource>(
      "manual",
    );

  const [rawMessage, setRawMessage] =
    useState("");

  const [error, setError] =
    useState("");

  /* =======================================================
     RESET FORM
  ======================================================= */

  useEffect(() => {
    if (!open || !loan) {
      return;
    }

    setAmount("");
    setTransactionReference("");
    setSource("manual");
    setRawMessage("");
    setError("");

    /*
     * Financial transaction dates are calendar dates.
     *
     * The HTML date input expects:
     *
     *     YYYY-MM-DD
     *
     * We intentionally do NOT use:
     *
     *     new Date().toISOString()
     *
     * because that introduces UTC timestamp semantics.
     */
    setTransactionDate(
      getKenyanToday(),
    );
  }, [open, loan]);

  /* =======================================================
     CLOSED STATE
  ======================================================= */

  if (!open || !loan) {
    return null;
  }

  /* =======================================================
     SELECTED LOAN
  ======================================================= */

  const selectedLoan = loan;

  const outstanding =
    Number.isFinite(
      selectedLoan.outstandingBalance,
    ) &&
    selectedLoan.outstandingBalance > 0
      ? selectedLoan.outstandingBalance
      : 0;

  const parsedAmount =
    Number(amount);

  const validAmount =
    Number.isFinite(
      parsedAmount,
    ) &&
    parsedAmount > 0;

  const amountWithinBalance =
    validAmount &&
    parsedAmount <= outstanding;

  const remainingAfterPayment =
    amountWithinBalance
      ? Math.max(
          0,
          outstanding -
            parsedAmount,
        )
      : outstanding;

  /* =======================================================
     MONEY
  ======================================================= */

  function formatMoney(
    value: number,
  ): string {
    return value.toLocaleString(
      "en-KE",
      {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      },
    );
  }

  /* =======================================================
     SUBMIT
  ======================================================= */

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    if (loading) {
      return;
    }

    setError("");

    /* =====================================================
       LOAN VALIDATION
    ===================================================== */

    if (
      typeof selectedLoan.id !==
        "string" ||
      !selectedLoan.id.trim()
    ) {
      setError(
        "The selected loan does not have a valid ID.",
      );

      return;
    }

    if (
      selectedLoan.status !==
      "active"
    ) {
      setError(
        "Repayment can only be recorded against an active loan.",
      );

      return;
    }

    if (outstanding <= 0) {
      setError(
        "This loan has no outstanding balance.",
      );

      return;
    }

    /* =====================================================
       AMOUNT VALIDATION
    ===================================================== */

    if (!amount.trim()) {
      setError(
        "Repayment amount is required.",
      );

      return;
    }

    if (!validAmount) {
      setError(
        "Repayment amount must be greater than zero.",
      );

      return;
    }

    const normalizedAmount =
      Math.round(
        parsedAmount * 100,
      ) / 100;

    if (
      !Number.isFinite(
        normalizedAmount,
      ) ||
      normalizedAmount <= 0
    ) {
      setError(
        "Repayment amount must be greater than zero.",
      );

      return;
    }

    if (
      normalizedAmount >
      outstanding
    ) {
      setError(
        `Repayment cannot exceed the current outstanding balance of KSh ${formatMoney(
          outstanding,
        )}.`,
      );

      return;
    }

    /* =====================================================
       TRANSACTION REFERENCE
    ===================================================== */

    const reference =
      transactionReference.trim();

    /*
     * The server generates a reference for manual/system
     * repayments when one is omitted.
     *
     * SMS repayments require the bank reference.
     */
    if (
      source === "sms" &&
      !reference
    ) {
      setError(
        "Transaction reference is required for an SMS repayment.",
      );

      return;
    }

    /* =====================================================
       TRANSACTION DATE
    ===================================================== */

    const calendarDate =
      transactionDate.trim();

    if (!calendarDate) {
      setError(
        "Transaction date is required.",
      );

      return;
    }

    /*
     * IMPORTANT:
     *
     * Do NOT do:
     *
     *     new Date(calendarDate)
     *
     * Do NOT do:
     *
     *     toISOString()
     *
     * Do NOT create a datetime-local value.
     *
     * The financial transaction date remains exactly:
     *
     *     YYYY-MM-DD
     */
    if (
      !isValidCalendarDate(
        calendarDate,
      )
    ) {
      setError(
        "Transaction date must be a valid calendar date in YYYY-MM-DD format.",
      );

      return;
    }

    /* =====================================================
       FUTURE DATE
    ===================================================== */

    const today =
      getKenyanToday();

    if (
      calendarDate >
      today
    ) {
      setError(
        "Transaction date cannot be in the future.",
      );

      return;
    }

    /* =====================================================
       SOURCE VALIDATION
    ===================================================== */

    if (
      source !== "manual" &&
      source !== "sms" &&
      source !== "system"
    ) {
      setError(
        "Invalid payment source.",
      );

      return;
    }

    /* =====================================================
       RAW SMS
    ===================================================== */

    const normalizedRawMessage =
      rawMessage.trim();

    if (
      source === "sms" &&
      !normalizedRawMessage
    ) {
      setError(
        "Original SMS message is required for an SMS repayment.",
      );

      return;
    }

    /* =====================================================
       SUBMIT
    ===================================================== */

    try {
      await onSubmit({
        loanId:
          selectedLoan.id,

        amount:
          normalizedAmount,

        transactionReference:
          reference,

        /*
         * Financial date remains a plain calendar string.
         *
         * Example:
         *
         *     "2026-09-12"
         */
        transactionDate:
          calendarDate,

        source,

        ...(source === "sms" &&
        normalizedRawMessage
          ? {
              rawMessage:
                normalizedRawMessage,
            }
          : {}),
      });
    } catch (submitError) {
      console.error(
        "Failed to record loan repayment:",
        submitError,
      );

      setError(
        submitError instanceof Error
          ? submitError.message
          : "Failed to record the repayment. Please try again.",
      );
    }
  }

  /* =======================================================
     RENDER
  ======================================================= */

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="loan-repayment-title"
    >
      <div className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-slate-900">
        {/* =================================================
            HEADER
        ================================================= */}

        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-700">
          <div className="min-w-0">
            <h2
              id="loan-repayment-title"
              className="text-lg font-semibold text-slate-900 dark:text-white"
            >
              Record Loan Repayment
            </h2>

            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Add an immutable repayment transaction.
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="rounded-full p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-slate-800 dark:hover:text-white"
            aria-label="Close repayment modal"
          >
            <X size={20} />
          </button>
        </div>

        {/* =================================================
            FORM
        ================================================= */}

        <form
          onSubmit={handleSubmit}
          className="max-h-[85vh] overflow-y-auto"
        >
          <div className="space-y-5 p-5">
            {/* =================================================
                LOAN INFORMATION
            ================================================= */}

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/50">
              <div className="flex items-start gap-3">
                <div className="rounded-lg bg-slate-200 p-2 dark:bg-slate-700">
                  <User
                    size={18}
                    className="text-slate-700 dark:text-slate-200"
                  />
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="font-semibold text-slate-900 dark:text-white">
                      {
                        selectedLoan.loanNumber
                      }
                    </span>

                    <span className="text-slate-400">
                      •
                    </span>

                    <span className="text-sm text-slate-600 dark:text-slate-300">
                      {
                        selectedLoan.memberNumber
                      }
                    </span>
                  </div>

                  <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                    {
                      selectedLoan.memberName
                    }
                  </p>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Original Due
                  </p>

                  <p className="mt-1 font-semibold text-slate-900 dark:text-white">
                    KSh{" "}
                    {formatMoney(
                      selectedLoan.totalDue,
                    )}
                  </p>
                </div>

                <div>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Current Outstanding
                  </p>

                  <p className="mt-1 font-semibold text-red-600 dark:text-red-400">
                    KSh{" "}
                    {formatMoney(
                      outstanding,
                    )}
                  </p>
                </div>
              </div>
            </div>

            {/* =================================================
                ERROR
            ================================================= */}

            {error && (
              <div
                className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300"
                role="alert"
              >
                {error}
              </div>
            )}

            {/* =================================================
                AMOUNT
            ================================================= */}

            <div>
              <label
                htmlFor="repayment-amount"
                className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-200"
              >
                Amount Received

                <span className="ml-1 text-red-500">
                  *
                </span>
              </label>

              <div className="relative">
                <Banknote
                  size={18}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                />

                <input
                  id="repayment-amount"
                  type="number"
                  min="0.01"
                  max={outstanding}
                  step="0.01"
                  inputMode="decimal"
                  value={amount}
                  onChange={(
                    event,
                  ) => {
                    setAmount(
                      event.target.value,
                    );
                    setError("");
                  }}
                  disabled={loading}
                  placeholder="0.00"
                  autoComplete="off"
                  className="w-full rounded-xl border border-slate-300 bg-white py-3 pl-10 pr-4 text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200 disabled:cursor-not-allowed disabled:bg-slate-100 dark:border-slate-600 dark:bg-slate-800 dark:text-white dark:focus:border-slate-400 dark:focus:ring-slate-700"
                />
              </div>

              {validAmount &&
                amountWithinBalance && (
                  <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                    Balance after payment:{" "}
                    <span className="font-semibold text-slate-700 dark:text-slate-200">
                      KSh{" "}
                      {formatMoney(
                        remainingAfterPayment,
                      )}
                    </span>
                  </p>
                )}
            </div>

            {/* =================================================
                TRANSACTION REFERENCE
            ================================================= */}

            <div>
              <label
                htmlFor="repayment-reference"
                className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-200"
              >
                Transaction Reference

                {source === "sms" && (
                  <span className="ml-1 text-red-500">
                    *
                  </span>
                )}
              </label>

              <div className="relative">
                <Hash
                  size={18}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                />

                <input
                  id="repayment-reference"
                  type="text"
                  value={
                    transactionReference
                  }
                  onChange={(
                    event,
                  ) => {
                    setTransactionReference(
                      event.target.value,
                    );
                    setError("");
                  }}
                  disabled={loading}
                  placeholder="e.g. BANK123456"
                  autoComplete="off"
                  className="w-full rounded-xl border border-slate-300 bg-white py-3 pl-10 pr-4 text-slate-900 uppercase outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200 disabled:cursor-not-allowed disabled:bg-slate-100 dark:border-slate-600 dark:bg-slate-800 dark:text-white dark:focus:border-slate-400 dark:focus:ring-slate-700"
                />
              </div>

              <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
                {source === "sms"
                  ? "This reference must uniquely identify the bank payment."
                  : "Optional for manual payments. The server generates a reference when omitted."}
              </p>
            </div>

            {/* =================================================
                DATE
            ================================================= */}

            <div>
              <label
                htmlFor="repayment-date"
                className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-200"
              >
                Transaction Date

                <span className="ml-1 text-red-500">
                  *
                </span>
              </label>

              <div className="relative">
                <CalendarDays
                  size={18}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                />

                <input
                  id="repayment-date"
                  type="date"
                  value={
                    transactionDate
                  }
                  max={getKenyanToday()}
                  onChange={(
                    event,
                  ) => {
                    setTransactionDate(
                      event.target.value,
                    );
                    setError("");
                  }}
                  disabled={loading}
                  className="w-full rounded-xl border border-slate-300 bg-white py-3 pl-10 pr-4 text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200 disabled:cursor-not-allowed disabled:bg-slate-100 dark:border-slate-600 dark:bg-slate-800 dark:text-white dark:focus:border-slate-400 dark:focus:ring-slate-700"
                />
              </div>

              <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
                Use the actual calendar date the payment occurred.
              </p>
            </div>

            {/* =================================================
                SOURCE
            ================================================= */}

            <div>
              <label
                htmlFor="repayment-source"
                className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-200"
              >
                Payment Source
              </label>

              <select
                id="repayment-source"
                value={source}
                onChange={(
                  event,
                ) => {
                  setSource(
                    event.target
                      .value as TransactionSource,
                  );
                  setError("");
                }}
                disabled={loading}
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200 disabled:cursor-not-allowed disabled:bg-slate-100 dark:border-slate-600 dark:bg-slate-800 dark:text-white dark:focus:border-slate-400 dark:focus:ring-slate-700"
              >
                <option value="manual">
                  Manual
                </option>

                <option value="sms">
                  SMS
                </option>

                <option value="system">
                  System
                </option>
              </select>
            </div>

            {/* =================================================
                RAW SMS
            ================================================= */}

            {source === "sms" && (
              <div>
                <label
                  htmlFor="repayment-raw-sms"
                  className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200"
                >
                  <MessageSquareText
                    size={16}
                  />

                  Original SMS

                  <span className="text-red-500">
                    *
                  </span>
                </label>

                <textarea
                  id="repayment-raw-sms"
                  value={rawMessage}
                  onChange={(
                    event,
                  ) => {
                    setRawMessage(
                      event.target.value,
                    );
                    setError("");
                  }}
                  disabled={loading}
                  rows={5}
                  placeholder="Paste the original bank SMS here..."
                  className="w-full resize-none rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200 disabled:cursor-not-allowed disabled:bg-slate-100 dark:border-slate-600 dark:bg-slate-800 dark:text-white dark:focus:border-slate-400 dark:focus:ring-slate-700"
                />

                <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
                  Keep the original message for audit and reconciliation.
                </p>
              </div>
            )}
          </div>

          {/* =================================================
              FOOTER
          ================================================= */}

          <div className="flex flex-col-reverse gap-3 border-t border-slate-200 bg-slate-50 px-5 py-4 sm:flex-row sm:justify-end dark:border-slate-700 dark:bg-slate-800/50">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="rounded-xl border border-slate-300 px-5 py-3 text-sm font-medium text-slate-700 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              Cancel
            </button>

            <button
              type="submit"
              disabled={
                loading ||
                outstanding <= 0
              }
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
            >
              {loading ? (
                <>
                  <Loader2
                    size={17}
                    className="animate-spin"
                  />

                  Recording...
                </>
              ) : (
                <>
                  <Banknote size={17} />

                  Record Repayment
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

