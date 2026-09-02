"use client";

import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock3,
  Inbox,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  TriangleAlert,
  XCircle,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { Capacitor } from "@capacitor/core";

import SmsReader, {
  type SmsMessage,
} from "@/lib/sms/SmsReader";

/* =========================================================
   CONFIG
========================================================= */

const PROCESS_URL = "/api/sms/process";

const SWEEP_INTERVAL_MS =
  5 * 60 * 1000;

/*
 * Keep the local filter broad.
 *
 * This is only noise reduction. The server remains
 * responsible for parsing and deciding whether an SMS
 * represents a financial transaction.
 */
const FINANCIAL_TERMS = [
  "kes",
  "ksh",
  "mpesa",
  "m-pesa",
  "confirmed",
  "paybill",
  "received",
  "transaction",
  "account",
  "deposit",
  "payment",
  "repayment",
];

/* =========================================================
   TYPES
========================================================= */

type MonitorStatus =
  | "idle"
  | "scanning"
  | "synced"
  | "attention"
  | "error";

type ProcessResult = {
  sms: SmsMessage;
  httpStatus?: number;
  status?: string;
  type?: string;
  financialChange?: boolean;
  duplicate?: boolean;
  ignored?: boolean;
  processed?: boolean;
  error?: string;
  response?: unknown;
};

type SweepStats = {
  inbox: number;
  candidates: number;
  submitted: number;
  processed: number;
  duplicate: number;
  ignored: number;
  failed: number;
};

/* =========================================================
   HELPERS
========================================================= */

function isFinancialCandidate(
  sms: SmsMessage,
): boolean {
  const text =
    `${sms.address ?? ""} ${sms.body}`.toLowerCase();

  return FINANCIAL_TERMS.some((term) =>
    text.includes(term),
  );
}

function formatTime(
  timestamp: number,
): string {
  if (!timestamp) {
    return "Unknown time";
  }

  try {
    return new Intl.DateTimeFormat(
      "en-KE",
      {
        hour: "2-digit",
        minute: "2-digit",
      },
    ).format(
      new Date(timestamp),
    );
  } catch {
    return "Unknown time";
  }
}

function formatDate(
  timestamp: number,
): string {
  if (!timestamp) {
    return "";
  }

  try {
    return new Intl.DateTimeFormat(
      "en-KE",
      {
        day: "2-digit",
        month: "short",
      },
    ).format(
      new Date(timestamp),
    );
  } catch {
    return "";
  }
}

function truncate(
  value: string,
  length = 100,
): string {
  if (value.length <= length) {
    return value;
  }

  return `${value.slice(0, length)}…`;
}

/* =========================================================
   COMPONENT
========================================================= */

export default function SmsInboxMonitor() {
  const [status, setStatus] =
    useState<MonitorStatus>("idle");

  const [stats, setStats] =
    useState<SweepStats>({
      inbox: 0,
      candidates: 0,
      submitted: 0,
      processed: 0,
      duplicate: 0,
      ignored: 0,
      failed: 0,
    });

  const [results, setResults] =
    useState<ProcessResult[]>([]);

  const [lastSync, setLastSync] =
    useState<number | null>(null);

  const [expanded, setExpanded] =
    useState(false);

  const runningRef =
    useRef(false);

  /* =======================================================
     SWEEP
  ======================================================= */

  const sweepInbox =
    useCallback(async () => {
      if (
        runningRef.current ||
        !Capacitor.isNativePlatform()
      ) {
        return;
      }

      runningRef.current = true;

      setStatus("scanning");

      try {
        const inboxResult =
          await SmsReader.readInbox();

        const messages =
          Array.isArray(
            inboxResult?.messages,
          )
            ? inboxResult.messages
            : [];

        const candidates =
          messages.filter(
            isFinancialCandidate,
          );

        const nextResults: ProcessResult[] =
          [];

        let processed = 0;
        let duplicate = 0;
        let ignored = 0;
        let failed = 0;
        let submitted = 0;

        /*
         * Process sequentially.
         *
         * This deliberately avoids flooding the API if
         * a device has a large SMS inbox.
         */
        for (
          const sms of candidates
        ) {
          submitted += 1;

          try {
            const response =
              await fetch(
                PROCESS_URL,
                {
                  method: "POST",
                  headers: {
                    "Content-Type":
                      "application/json",
                  },
                  body: JSON.stringify({
                    smsId: sms.id,
                    address:
                      sms.address,
                    body: sms.body,
                    date: sms.date,
                  }),
                },
              );

            let data: unknown =
              null;

            try {
              data =
                await response.json();
            } catch {
              data = null;
            }

            const payload =
              data &&
              typeof data === "object"
                ? (data as Record<
                    string,
                    unknown
                  >)
                : {};

            const wasDuplicate =
              payload.duplicate === true;

            const wasIgnored =
              payload.ignored === true;

            const wasProcessed =
              payload.processed === true;

            if (wasDuplicate) {
              duplicate += 1;
            } else if (wasIgnored) {
              ignored += 1;
            } else if (
              wasProcessed &&
              response.ok
            ) {
              processed += 1;
            } else if (
              !response.ok
            ) {
              failed += 1;
            }

            nextResults.push({
              sms,
              httpStatus:
                response.status,
              status:
                typeof payload.status ===
                "string"
                  ? payload.status
                  : undefined,
              type:
                typeof payload.type ===
                "string"
                  ? payload.type
                  : undefined,
              financialChange:
                payload.financialChange ===
                true,
              duplicate:
                wasDuplicate,
              ignored:
                wasIgnored,
              processed:
                wasProcessed,
              error:
                typeof payload.error ===
                "string"
                  ? payload.error
                  : !response.ok
                    ? `Request failed (${response.status})`
                    : undefined,
              response: data,
            });
          } catch (error) {
            failed += 1;

            nextResults.push({
              sms,
              error:
                error instanceof Error
                  ? error.message
                  : "Unable to reach GEO-SHUA.",
            });
          }
        }

        const nextStats: SweepStats = {
          inbox: messages.length,
          candidates:
            candidates.length,
          submitted,
          processed,
          duplicate,
          ignored,
          failed,
        };

        setStats(nextStats);
        setResults(nextResults);
        setLastSync(Date.now());

        /*
         * Determine the user-facing state.
         *
         * Failed submissions deserve attention.
         * Otherwise the system is considered synced,
         * including when there were simply no new
         * financial messages.
         */
        if (failed > 0) {
          setStatus("attention");
        } else {
          setStatus("synced");
        }
      } catch (error) {
        console.error(
          "GEO-SHUA SMS sweep failed:",
          error,
        );

        setStatus("error");

        setStats((current) => ({
          ...current,
          failed:
            current.failed + 1,
        }));
      } finally {
        runningRef.current = false;
      }
    }, []);

  /* =======================================================
     NATIVE CHECK + INITIAL SWEEP
  ======================================================= */

  useEffect(() => {
    if (
      !Capacitor.isNativePlatform()
    ) {
      return;
    }

    void sweepInbox();

    const interval =
      window.setInterval(
        () => {
          void sweepInbox();
        },
        SWEEP_INTERVAL_MS,
      );

    return () =>
      window.clearInterval(interval);
  }, [sweepInbox]);

  /* =======================================================
     PRESENTATION
  ======================================================= */

  const hasAttention =
    status === "attention" ||
    status === "error";

  const isScanning =
    status === "scanning";

  const statusLabel =
    isScanning
      ? "Checking messages…"
      : hasAttention
        ? "Needs attention"
        : status === "synced"
          ? "Up to date"
          : "Ready";

  const statusDescription =
    isScanning
      ? "Checking for recent payments"
      : hasAttention
        ? "Some payment messages could not be processed"
        : status === "synced"
          ? stats.processed > 0
            ? `${stats.processed} payment${stats.processed === 1 ? "" : "s"} checked`
            : stats.duplicate > 0
              ? "Payments already synced"
              : "Payment messages checked"
          : "Payment messages are monitored automatically";

  const successfulCount =
    stats.processed +
    stats.duplicate;

  const latestResults =
    useMemo(
      () =>
        [...results]
          .sort(
            (a, b) =>
              b.sms.date -
              a.sms.date,
          )
          .slice(0, 5),
      [results],
    );

  /* =======================================================
     NON-NATIVE
  ======================================================= */

  if (
    typeof window !== "undefined" &&
    !Capacitor.isNativePlatform()
  ) {
    return null;
  }

  /* =======================================================
     UI
  ======================================================= */

  return (
    <section
      className="
        relative
        overflow-hidden
        rounded-[28px]
        border
        border-slate-800/80
        bg-[#0b1118]
        px-4
        py-4
        shadow-[0_12px_40px_rgba(0,0,0,0.18)]
      "
    >
      {/* ===================================================
          HEADER
      =================================================== */}

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
              bg-blue-500/10
              text-blue-400
              ring-1
              ring-blue-400/10
            "
          >
            {isScanning ? (
              <Loader2
                size={21}
                className="animate-spin"
              />
            ) : (
              <Smartphone
                size={21}
                strokeWidth={1.8}
              />
            )}
          </div>

          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="truncate text-[15px] font-semibold tracking-tight text-white">
                SMS Payments
              </h3>

              <span
                className={`
                  h-1.5
                  w-1.5
                  rounded-full
                  ${
                    hasAttention
                      ? "bg-amber-400"
                      : isScanning
                        ? "bg-blue-400"
                        : "bg-emerald-400"
                  }
                `}
              />
            </div>

            <p className="mt-0.5 text-[12px] text-slate-500">
              Automatic payment monitoring
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() =>
            void sweepInbox()
          }
          disabled={isScanning}
          aria-label="Refresh SMS payments"
          className="
            flex
            h-9
            w-9
            shrink-0
            items-center
            justify-center
            rounded-xl
            border
            border-slate-800
            bg-slate-900/70
            text-slate-400
            transition
            hover:border-slate-700
            hover:text-white
            active:scale-95
            disabled:cursor-not-allowed
            disabled:opacity-50
          "
        >
          <RefreshCw
            size={16}
            className={
              isScanning
                ? "animate-spin"
                : ""
            }
          />
        </button>
      </div>

      {/* ===================================================
          STATUS
      =================================================== */}

      <div
        className="
          mt-4
          flex
          items-center
          justify-between
          rounded-2xl
          border
          border-slate-800/80
          bg-slate-950/60
          px-3.5
          py-3
        "
      >
        <div className="flex min-w-0 items-center gap-2.5">
          <div
            className={`
              flex
              h-8
              w-8
              shrink-0
              items-center
              justify-center
              rounded-xl
              ${
                hasAttention
                  ? "bg-amber-400/10 text-amber-400"
                  : "bg-emerald-400/10 text-emerald-400"
              }
            `}
          >
            {hasAttention ? (
              <TriangleAlert size={16} />
            ) : (
              <ShieldCheck size={16} />
            )}
          </div>

          <div className="min-w-0">
            <p className="text-[12px] font-medium text-slate-200">
              {statusLabel}
            </p>

            <p className="mt-0.5 truncate text-[11px] text-slate-500">
              {statusDescription}
            </p>
          </div>
        </div>

        {lastSync && (
          <span className="ml-2 shrink-0 text-[10px] text-slate-600">
            {formatTime(lastSync)}
          </span>
        )}
      </div>

      {/* ===================================================
          COMPACT METRICS
      =================================================== */}

      <div className="mt-3 grid grid-cols-3 gap-2">
        <div
          className="
            rounded-2xl
            bg-slate-950/45
            px-3
            py-2.5
          "
        >
          <div className="flex items-center gap-1.5 text-slate-500">
            <Inbox size={12} />
            <span className="text-[10px]">
              Inbox
            </span>
          </div>

          <p className="mt-1 text-base font-semibold tracking-tight text-white">
            {stats.inbox}
          </p>
        </div>

        <div
          className="
            rounded-2xl
            bg-slate-950/45
            px-3
            py-2.5
          "
        >
          <div className="flex items-center gap-1.5 text-slate-500">
            <CheckCircle2 size={12} />
            <span className="text-[10px]">
              Synced
            </span>
          </div>

          <p className="mt-1 text-base font-semibold tracking-tight text-white">
            {successfulCount}
          </p>
        </div>

        <div
          className="
            rounded-2xl
            bg-slate-950/45
            px-3
            py-2.5
          "
        >
          <div className="flex items-center gap-1.5 text-slate-500">
            <Clock3 size={12} />
            <span className="text-[10px]">
              Next
            </span>
          </div>

          <p className="mt-1 text-[12px] font-semibold tracking-tight text-white">
            5 min
          </p>
        </div>
      </div>

      {/* ===================================================
          RECENT PAYMENT MESSAGES
      =================================================== */}

      {latestResults.length > 0 && (
        <div className="mt-4">
          <button
            type="button"
            onClick={() =>
              setExpanded(
                (value) => !value,
              )
            }
            className="
              flex
              w-full
              items-center
              justify-between
              text-left
            "
          >
            <div>
              <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-slate-600">
                Recent activity
              </p>

              <p className="mt-1 text-[12px] text-slate-400">
                {latestResults.length} recent
                payment message
                {latestResults.length ===
                1
                  ? ""
                  : "s"}
              </p>
            </div>

            <div
              className="
                flex
                h-8
                w-8
                items-center
                justify-center
                rounded-xl
                bg-slate-900
                text-slate-500
              "
            >
              {expanded ? (
                <ChevronUp size={15} />
              ) : (
                <ChevronDown size={15} />
              )}
            </div>
          </button>

          {expanded && (
            <div className="mt-3 space-y-2">
              {latestResults.map(
                (item, index) => {
                  const success =
                    item.processed ||
                    item.duplicate;

                  const failed =
                    !!item.error;

                  return (
                    <div
                      key={`${item.sms.id ?? item.sms.date}-${index}`}
                      className="
                        rounded-2xl
                        border
                        border-slate-800/70
                        bg-slate-950/50
                        px-3
                        py-3
                      "
                    >
                      <div className="flex items-start gap-2.5">
                        <div
                          className={`
                            mt-0.5
                            flex
                            h-7
                            w-7
                            shrink-0
                            items-center
                            justify-center
                            rounded-lg
                            ${
                              failed
                                ? "bg-amber-400/10 text-amber-400"
                                : "bg-emerald-400/10 text-emerald-400"
                            }
                          `}
                        >
                          {failed ? (
                            <XCircle
                              size={14}
                            />
                          ) : (
                            <CheckCircle2
                              size={14}
                            />
                          )}
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <p className="truncate text-[11px] font-medium text-slate-300">
                              {item.sms.address ||
                                "Payment message"}
                            </p>

                            <span className="shrink-0 text-[10px] text-slate-600">
                              {formatDate(
                                item.sms
                                  .date,
                              )}{" "}
                              {formatTime(
                                item.sms
                                  .date,
                              )}
                            </span>
                          </div>

                          <p className="mt-1 text-[11px] leading-4 text-slate-500">
                            {truncate(
                              item.sms.body,
                              110,
                            )}
                          </p>

                          <div className="mt-2 flex items-center gap-2">
                            <span
                              className={`
                                rounded-md
                                px-1.5
                                py-0.5
                                text-[9px]
                                font-medium
                                ${
                                  success
                                    ? "bg-emerald-400/10 text-emerald-400"
                                    : "bg-amber-400/10 text-amber-400"
                                }
                              `}
                            >
                              {item.duplicate
                                ? "Already synced"
                                : item.processed
                                  ? item.type ||
                                    "Processed"
                                  : item.ignored
                                    ? "Not a payment"
                                    : "Needs attention"}
                            </span>

                            {item.financialChange && (
                              <span className="text-[9px] text-blue-400">
                                Account updated
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                },
              )}
            </div>
          )}
        </div>
      )}

      {/* ===================================================
          FOOTER
      =================================================== */}

      <div className="mt-4 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-slate-600">
          <ShieldCheck size={11} />

          <span className="text-[10px]">
            GEO-SHUA secure sync
          </span>
        </div>

        <span className="text-[10px] text-slate-700">
          Automatic
        </span>
      </div>
    </section>
  );
}