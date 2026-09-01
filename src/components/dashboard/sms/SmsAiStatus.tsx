"use client";

import {
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  Activity,
  ArrowRight,
  CheckCircle2,
  Clock3,
  FileCheck2,
  Loader2,
  Smartphone,
  Wallet,
  HandCoins,
  XCircle,
  Zap,
} from "lucide-react";

/* =========================================================
   TYPES
========================================================= */

export type SmsActivityStatus =
  | "listening"
  | "detected"
  | "parsing"
  | "processing"
  | "saved"
  | "repaid"
  | "duplicate"
  | "ignored"
  | "error";

export type SmsActivity = {
  status: SmsActivityStatus;

  message: string;

  reference?: string;

  senderName?: string;

  amount?: number;

  transactionType?:
    | "savings"
    | "loan";

  accountNumber?: string;

  transactionDate?: string;

  timestamp: number;

  rawMessage?: string;

  response?: unknown;
};

/* =========================================================
   EVENT NAME
========================================================= */

const SMS_STATUS_EVENT =
  "geoshua:sms-status";

/* =========================================================
   DEFAULT STATE
========================================================= */

const DEFAULT_ACTIVITY: SmsActivity = {
  status: "listening",

  message:
    "Listening for new bank transactions…",

  timestamp: Date.now(),
};

/* =========================================================
   HELPERS
========================================================= */

function formatCurrency(
  value: number
): string {
  return `KES ${value.toLocaleString(
    "en-KE",
    {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }
  )}`;
}

function formatTime(
  timestamp: number
): string {
  if (!Number.isFinite(timestamp)) {
    return "";
  }

  const difference =
    Math.max(
      0,
      Date.now() - timestamp
    );

  const seconds =
    Math.floor(
      difference / 1000
    );

  if (seconds < 5) {
    return "now";
  }

  if (seconds < 60) {
    return `${seconds}s ago`;
  }

  const minutes =
    Math.floor(
      seconds / 60
    );

  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours =
    Math.floor(
      minutes / 60
    );

  if (hours < 24) {
    return `${hours}h ago`;
  }

  return new Date(
    timestamp
  ).toLocaleTimeString(
    "en-KE",
    {
      hour: "2-digit",
      minute: "2-digit",
    }
  );
}

function getStatusIcon(
  status: SmsActivityStatus
) {
  switch (status) {
    case "detected":
      return (
        <Smartphone
          size={16}
          strokeWidth={1.8}
        />
      );

    case "parsing":
      return (
        <FileCheck2
          size={16}
          strokeWidth={1.8}
        />
      );

    case "processing":
      return (
        <Loader2
          size={16}
          strokeWidth={1.8}
          className="animate-spin"
        />
      );

    case "saved":
      return (
        <Wallet
          size={16}
          strokeWidth={1.8}
        />
      );

    case "repaid":
      return (
        <HandCoins
          size={16}
          strokeWidth={1.8}
        />
      );

    case "duplicate":
      return (
        <Clock3
          size={16}
          strokeWidth={1.8}
        />
      );

    case "ignored":
      return (
        <Activity
          size={16}
          strokeWidth={1.8}
        />
      );

    case "error":
      return (
        <XCircle
          size={16}
          strokeWidth={1.8}
        />
      );

    case "listening":
    default:
      return (
        <Zap
          size={16}
          strokeWidth={1.8}
        />
      );
  }
}

function getStatusClasses(
  status: SmsActivityStatus
) {
  switch (status) {
    case "saved":
    case "repaid":
      return {
        icon:
          "bg-green-500/10 text-green-400",
        dot:
          "bg-green-400",
      };

    case "error":
      return {
        icon:
          "bg-red-500/10 text-red-400",
        dot:
          "bg-red-400",
      };

    case "duplicate":
      return {
        icon:
          "bg-orange-500/10 text-orange-400",
        dot:
          "bg-orange-400",
      };

    case "ignored":
      return {
        icon:
          "bg-white/[0.05] text-white/35",
        dot:
          "bg-white/30",
      };

    case "detected":
    case "parsing":
    case "processing":
      return {
        icon:
          "bg-blue-500/10 text-blue-400",
        dot:
          "bg-blue-400",
      };

    case "listening":
    default:
      return {
        icon:
          "bg-cyan-500/10 text-cyan-400",
        dot:
          "bg-cyan-400",
      };
  }
}

function prettyStatus(
  status: SmsActivityStatus
) {
  switch (status) {
    case "listening":
      return "Listening";

    case "detected":
      return "Detected";

    case "parsing":
      return "Parsing";

    case "processing":
      return "Processing";

    case "saved":
      return "Savings recorded";

    case "repaid":
      return "Loan repayment recorded";

    case "duplicate":
      return "Already recorded";

    case "ignored":
      return "Ignored";

    case "error":
      return "Needs attention";

    default:
      return "SMS";
  }
}

/* =========================================================
   MAIN COMPONENT
========================================================= */

export default function SmsAiStatus() {
  const [
    activity,
    setActivity,
  ] = useState<SmsActivity>(
    DEFAULT_ACTIVITY
  );

  const [
    detailsOpen,
    setDetailsOpen,
  ] = useState(false);

  /* =======================================================
     STATUS EVENTS
  ======================================================= */

  useEffect(() => {
    const handleStatusEvent =
      (event: Event) => {
        const customEvent =
          event as CustomEvent<
            Partial<SmsActivity>
          >;

        const detail =
          customEvent.detail;

        if (
          !detail ||
          typeof detail !==
            "object"
        ) {
          return;
        }

        const nextActivity: SmsActivity =
          {
            status:
              detail.status ||
              "processing",

            message:
              detail.message ||
              "Processing bank transaction…",

            reference:
              detail.reference,

            senderName:
              detail.senderName,

            amount:
              typeof detail.amount ===
              "number"
                ? detail.amount
                : undefined,

            transactionType:
              detail.transactionType,

            accountNumber:
              detail.accountNumber,

            transactionDate:
              detail.transactionDate,

            timestamp:
              typeof detail.timestamp ===
              "number"
                ? detail.timestamp
                : Date.now(),

            rawMessage:
              detail.rawMessage,

            response:
              detail.response,
          };

        setActivity(
          nextActivity
        );
      };

    window.addEventListener(
      SMS_STATUS_EVENT,
      handleStatusEvent
    );

    return () => {
      window.removeEventListener(
        SMS_STATUS_EVENT,
        handleStatusEvent
      );
    };
  }, []);

  /* =======================================================
     TIME REFRESH
  ======================================================= */

  const [
    now,
    setNow,
  ] = useState(() => Date.now());

  useEffect(() => {
    const timer =
      window.setInterval(
        () => {
          setNow(
            Date.now()
          );
        },
        5000
      );

    return () => {
      window.clearInterval(
        timer
      );
    };
  }, []);

  const relativeTime =
    useMemo(
      () =>
        formatTime(
          activity.timestamp
        ),
      [
        activity.timestamp,
        now,
      ]
    );

  const classes =
    getStatusClasses(
      activity.status
    );

  const isWorking =
    [
      "detected",
      "parsing",
      "processing",
    ].includes(
      activity.status
    );

  return (
    <>
      {/* =================================================
          MINIMAL STATUS BAR
      ================================================= */}

      <section className="mb-6 w-full">
        <button
          type="button"
          onClick={() =>
            setDetailsOpen(true)
          }
          className="group flex w-full min-w-0 items-center gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.02] px-4 py-3 text-left transition hover:border-white/[0.12] hover:bg-white/[0.035] sm:px-5"
        >
          {/* ICON */}

          <div
            className={`relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${classes.icon}`}
          >
            {getStatusIcon(
              activity.status
            )}

            <span
              className={`absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full ${classes.dot} ${
                isWorking
                  ? "animate-pulse"
                  : ""
              }`}
            />
          </div>

          {/* STATUS */}

          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <span className="shrink-0 text-[9px] font-medium uppercase tracking-[0.18em] text-blue-400/60">
                SMS AI
              </span>

              <span className="h-1 w-1 shrink-0 rounded-full bg-white/15" />

              <span className="truncate text-[9px] text-white/20">
                {prettyStatus(
                  activity.status
                )}
              </span>

              <span className="hidden shrink-0 text-[9px] text-white/15 sm:inline">
                ·
              </span>

              <span className="hidden shrink-0 text-[9px] text-white/15 sm:inline">
                {relativeTime}
              </span>
            </div>

            <p className="mt-1 truncate text-xs font-medium text-white/65">
              {activity.message}
            </p>
          </div>

          {/* AMOUNT */}

          {activity.amount !==
            undefined && (
            <div className="hidden shrink-0 text-right sm:block">
              <p className="text-[10px] font-semibold text-white/55">
                {formatCurrency(
                  activity.amount
                )}
              </p>

              {activity.transactionType && (
                <p className="mt-0.5 text-[8px] uppercase tracking-[0.12em] text-white/20">
                  {
                    activity.transactionType
                  }
                </p>
              )}
            </div>
          )}

          <ArrowRight
            size={14}
            strokeWidth={1.8}
            className="shrink-0 text-white/15 transition group-hover:translate-x-0.5 group-hover:text-white/35"
          />
        </button>
      </section>

      {/* =================================================
          DETAILS MODAL
      ================================================= */}

      {detailsOpen && (
        <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/70 p-3 backdrop-blur-sm sm:items-center">
          <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-white/[0.08] bg-[#090909] shadow-2xl">

            {/* HEADER */}

            <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-4 sm:px-5">
              <div className="flex items-center gap-3">
                <div
                  className={`flex h-9 w-9 items-center justify-center rounded-xl ${classes.icon}`}
                >
                  {getStatusIcon(
                    activity.status
                  )}
                </div>

                <div>
                  <p className="text-sm font-semibold text-white">
                    SMS activity
                  </p>

                  <p className="mt-0.5 text-[10px] text-white/25">
                    GEO-SHUA transaction monitor
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() =>
                  setDetailsOpen(
                    false
                  )
                }
                className="flex h-8 w-8 items-center justify-center rounded-lg text-white/25 transition hover:bg-white/[0.05] hover:text-white/60"
              >
                <XCircle
                  size={16}
                />
              </button>
            </div>

            {/* BODY */}

            <div className="max-h-[70vh] overflow-y-auto p-4 sm:p-5">

              {/* CURRENT STATUS */}

              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[9px] uppercase tracking-[0.16em] text-white/20">
                    Current state
                  </span>

                  <span
                    className={`rounded-full px-2.5 py-1 text-[9px] font-medium ${
                      classes.icon
                    }`}
                  >
                    {prettyStatus(
                      activity.status
                    )}
                  </span>
                </div>

                <p className="mt-3 text-sm font-medium leading-6 text-white/75">
                  {activity.message}
                </p>

                <p className="mt-2 text-[9px] text-white/20">
                  {new Date(
                    activity.timestamp
                  ).toLocaleString(
                    "en-KE"
                  )}
                </p>
              </div>

              {/* TRANSACTION INFORMATION */}

              {(activity.reference ||
                activity.senderName ||
                activity.amount !==
                  undefined ||
                activity.transactionType ||
                activity.accountNumber) && (
                <div className="mt-3 grid grid-cols-2 gap-2">

                  {activity.reference && (
                    <DetailItem
                      label="Reference"
                      value={
                        activity.reference
                      }
                    />
                  )}

                  {activity.senderName && (
                    <DetailItem
                      label="Sender"
                      value={
                        activity.senderName
                      }
                    />
                  )}

                  {activity.amount !==
                    undefined && (
                    <DetailItem
                      label="Amount"
                      value={formatCurrency(
                        activity.amount
                      )}
                    />
                  )}

                  {activity.transactionType && (
                    <DetailItem
                      label="Destination"
                      value={
                        activity.transactionType ===
                        "loan"
                          ? "Loan repayment"
                          : "Savings deposit"
                      }
                    />
                  )}

                  {activity.accountNumber && (
                    <DetailItem
                      label="Bank account"
                      value={
                        activity.accountNumber
                      }
                    />
                  )}

                  {activity.transactionDate && (
                    <DetailItem
                      label="Transaction time"
                      value={new Date(
                        activity.transactionDate
                      ).toLocaleString(
                        "en-KE"
                      )}
                    />
                  )}
                </div>
              )}

              {/* RAW MESSAGE */}

              {activity.rawMessage && (
                <div className="mt-3 overflow-hidden rounded-xl border border-white/[0.06] bg-black/30">
                  <div className="border-b border-white/[0.05] px-3 py-2.5">
                    <span className="text-[9px] font-medium uppercase tracking-[0.14em] text-white/20">
                      Bank message
                    </span>
                  </div>

                  <pre className="max-h-[180px] overflow-auto whitespace-pre-wrap break-words p-3 font-mono text-[10px] leading-5 text-white/40">
                    {
                      activity.rawMessage
                    }
                  </pre>
                </div>
              )}

              {/* SERVER RESPONSE */}

              {activity.response !==
                undefined && (
                <div className="mt-3 overflow-hidden rounded-xl border border-white/[0.06] bg-black/30">
                  <div className="border-b border-white/[0.05] px-3 py-2.5">
                    <span className="text-[9px] font-medium uppercase tracking-[0.14em] text-white/20">
                      Processor response
                    </span>
                  </div>

                  <pre className="max-h-[220px] overflow-auto whitespace-pre-wrap break-words p-3 font-mono text-[10px] leading-5 text-white/40">
                    {JSON.stringify(
                      activity.response,
                      null,
                      2
                    )}
                  </pre>
                </div>
              )}
            </div>

            {/* FOOTER */}

            <div className="border-t border-white/[0.06] px-4 py-3">
              <p className="text-center text-[9px] text-white/15">
                Background SMS processing operates
                independently of the dashboard.
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/* =========================================================
   DETAIL ITEM
========================================================= */

function DetailItem({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="min-w-0 rounded-xl border border-white/[0.05] bg-white/[0.02] p-3">
      <p className="truncate text-[8px] uppercase tracking-[0.14em] text-white/20">
        {label}
      </p>

      <p className="mt-1 truncate text-xs font-medium text-white/55">
        {value}
      </p>
    </div>
  );
}