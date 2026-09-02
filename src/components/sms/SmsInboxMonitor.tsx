"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  Inbox,
  RefreshCw,
  Smartphone,
  XCircle,
} from "lucide-react";

import { Capacitor } from "@capacitor/core";

import SmsReader, {
  type SmsMessage,
} from "@/lib/sms/SmsReader";

/* =========================================================
   TYPES
========================================================= */

type ApiResult = {
  success?: boolean;
  status?: string;
  stage?: string;

  processed?: boolean;
  duplicate?: boolean;
  ignored?: boolean;
  financialChange?: boolean;

  type?: string;

  error?: string;

  parser?: unknown;
  classifier?: unknown;
  processor?: unknown;
  result?: unknown;

  [key: string]: unknown;
};

type ProcessedSms = {
  sms: SmsMessage;
  httpStatus: number | null;
  response: ApiResult | null;
  error: string | null;
};

type SweepResult = {
  startedAt: number;
  completedAt: number;

  scanned: number;
  candidates: number;
  submitted: number;

  processed: number;
  duplicates: number;
  ignored: number;
  failed: number;

  results: ProcessedSms[];
};

/* =========================================================
   CONFIGURATION
========================================================= */

const PROCESS_URL =
  "/api/sms/process";

const SWEEP_INTERVAL_MS =
  5 * 60 * 1000;

/*
 * Keep this filter broad.
 *
 * The Android dashboard monitor should NOT make the final
 * financial classification.
 *
 * The server parser remains authoritative.
 */
function looksLikeTransaction(
  body: string,
): boolean {
  const normalized =
    body
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();

  if (!normalized) {
    return false;
  }

  return (
    normalized.includes("kes") ||
    normalized.includes("ksh") ||
    normalized.includes("mpesa") ||
    normalized.includes("m-pesa") ||
    normalized.includes("confirmed") ||
    normalized.includes("paybill") ||
    normalized.includes("received") ||
    normalized.includes("transaction") ||
    normalized.includes("account")
  );
}

/* =========================================================
   FORMATTERS
========================================================= */

function formatDate(
  timestamp: number,
): string {
  if (!timestamp) {
    return "Unknown";
  }

  return new Date(
    timestamp,
  ).toLocaleString();
}

/* =========================================================
   COMPONENT
========================================================= */

export default function SmsInboxMonitor() {
  const [mounted, setMounted] =
    useState(false);

  const [running, setRunning] =
    useState(false);

  const [lastSweep, setLastSweep] =
    useState<SweepResult | null>(
      null,
    );

  const [error, setError] =
    useState<string | null>(
      null,
    );

  const runningRef =
    useRef(false);

  /* =======================================================
     MOUNT
  ======================================================= */

  useEffect(() => {
    setMounted(true);
  }, []);

  /* =======================================================
     SWEEP
  ======================================================= */

  const sweep = useCallback(
    async () => {
      if (
        runningRef.current
      ) {
        return;
      }

      runningRef.current = true;

      setRunning(true);
      setError(null);

      const startedAt =
        Date.now();

      const result: SweepResult = {
        startedAt,
        completedAt: startedAt,

        scanned: 0,
        candidates: 0,
        submitted: 0,

        processed: 0,
        duplicates: 0,
        ignored: 0,
        failed: 0,

        results: [],
      };

      try {
        console.log(
          "[GEO-SHUA SMS] Starting inbox sweep...",
        );

        /* =================================================
           READ ANDROID INBOX
        ================================================= */

        const inbox =
          await SmsReader.readInbox();

        const messages =
          Array.isArray(
            inbox?.messages,
          )
            ? inbox.messages
            : [];

        result.scanned =
          messages.length;

        console.log(
          "[GEO-SHUA SMS] Inbox messages:",
          messages.length,
        );

        /* =================================================
           FILTER CANDIDATES
        ================================================= */

        const candidates =
          messages.filter(
            (sms) =>
              typeof sms?.body ===
                "string" &&
              sms.body.trim()
                .length > 0 &&
              looksLikeTransaction(
                sms.body,
              ),
          );

        result.candidates =
          candidates.length;

        console.log(
          "[GEO-SHUA SMS] Candidates:",
          candidates.length,
        );

        /* =================================================
           SEND TO API
        ================================================= */

        for (
          const sms of candidates
        ) {
          try {
            console.log(
              "[GEO-SHUA SMS] Processing SMS:",
              {
                id: sms.id,
                address:
                  sms.address,
                date: sms.date,
              },
            );

            const response =
              await fetch(
                PROCESS_URL,
                {
                  method: "POST",

                  headers: {
                    "Content-Type":
                      "application/json",

                    Accept:
                      "application/json",
                  },

                  body: JSON.stringify({
                    /*
                     * Keep the Android provider ID available
                     * to the server.
                     */
                    smsId:
                      sms.id,

                    address:
                      sms.address,

                    body:
                      sms.body,

                    date:
                      sms.date,
                  }),
                },
              );

            let data:
              ApiResult | null =
              null;

            const contentType =
              response.headers.get(
                "content-type",
              ) ?? "";

            if (
              contentType.includes(
                "application/json",
              )
            ) {
              try {
                data =
                  (await response.json()) as ApiResult;
              } catch {
                data = null;
              }
            } else {
              const text =
                await response.text();

              data = {
                success: false,
                error:
                  text ||
                  "Server returned a non-JSON response.",
              };
            }

            result.submitted++;

            /* =============================================
               RESULT CLASSIFICATION
            ============================================= */

            if (
              response.ok
            ) {
              if (
                data?.duplicate
              ) {
                result.duplicates++;

              } else if (
                data?.ignored
              ) {
                result.ignored++;

              } else if (
                data?.processed
              ) {
                result.processed++;
              }
            } else {
              result.failed++;
            }

            result.results.push({
              sms,

              httpStatus:
                response.status,

              response: data,

              error: null,
            });

            console.log(
              "[GEO-SHUA SMS] API result:",
              {
                smsId: sms.id,
                httpStatus:
                  response.status,
                data,
              },
            );
          } catch (
            requestError
          ) {
            result.failed++;

            const message =
              requestError instanceof
              Error
                ? requestError.message
                : "Request failed.";

            result.results.push({
              sms,

              httpStatus:
                null,

              response:
                null,

              error:
                message,
            });

            console.error(
              "[GEO-SHUA SMS] API request failed:",
              requestError,
            );
          }
        }

        result.completedAt =
          Date.now();

        setLastSweep(
          result,
        );

        console.log(
          "[GEO-SHUA SMS] Sweep complete:",
          result,
        );
      } catch (
        sweepError
      ) {
        const message =
          sweepError instanceof
          Error
            ? sweepError.message
            : "Unable to read Android SMS inbox.";

        setError(
          message,
        );

        console.error(
          "[GEO-SHUA SMS] Sweep failed:",
          sweepError,
        );
      } finally {
        runningRef.current =
          false;

        setRunning(false);
      }
    },
    [],
  );

  /* =======================================================
     AUTOMATIC 5-MINUTE SWEEP
  ======================================================= */

  useEffect(() => {
    if (!mounted) {
      return;
    }

    /*
     * Do not run the SMS reader on normal web browsers.
     */
    if (
      !Capacitor.isNativePlatform()
    ) {
      return;
    }

    /*
     * Run immediately when dashboard loads.
     */
    void sweep();

    /*
     * Then every five minutes.
     */
    const interval =
      window.setInterval(
        () => {
          void sweep();
        },
        SWEEP_INTERVAL_MS,
      );

    return () => {
      window.clearInterval(
        interval,
      );
    };
  }, [
    mounted,
    sweep,
  ]);

  /* =======================================================
     SSR
  ======================================================= */

  if (!mounted) {
    return null;
  }

  /*
   * Don't show the monitor on desktop/web.
   */
  if (
    !Capacitor.isNativePlatform()
  ) {
    return null;
  }

  /* =======================================================
     RENDER
  ======================================================= */

  return (
    <section className="rounded-3xl border bg-card p-4 shadow-sm">
      {/* HEADER */}

      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-blue-500/10">
            <Smartphone className="h-5 w-5 text-blue-600" />
          </div>

          <div className="min-w-0">
            <h2 className="font-semibold">
              SMS Inbox Monitor
            </h2>

            <p className="text-xs text-muted-foreground">
              Automatic sweep every 5 minutes
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => void sweep()}
          disabled={running}
          className="inline-flex shrink-0 items-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium transition hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
        >
          <RefreshCw
            className={
              running
                ? "h-4 w-4 animate-spin"
                : "h-4 w-4"
            }
          />

          {running
            ? "Sweeping"
            : "Sweep"}
        </button>
      </div>

      {/* ERROR */}

      {error && (
        <div className="mt-4 flex gap-3 rounded-2xl border border-red-500/20 bg-red-500/5 p-3">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-500" />

          <div>
            <p className="text-sm font-semibold">
              SMS sweep failed
            </p>

            <p className="mt-1 text-xs text-muted-foreground">
              {error}
            </p>
          </div>
        </div>
      )}

      {/* SUMMARY */}

      {lastSweep && (
        <>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
            <Stat
              label="Inbox"
              value={
                lastSweep.scanned
              }
            />

            <Stat
              label="Candidates"
              value={
                lastSweep.candidates
              }
            />

            <Stat
              label="Submitted"
              value={
                lastSweep.submitted
              }
            />

            <Stat
              label="Processed"
              value={
                lastSweep.processed
              }
            />

            <Stat
              label="Duplicate"
              value={
                lastSweep.duplicates
              }
            />

            <Stat
              label="Ignored"
              value={
                lastSweep.ignored
              }
            />

            <Stat
              label="Failed"
              value={
                lastSweep.failed
              }
            />

            <Stat
              label="Total"
              value={
                lastSweep.results.length
              }
            />
          </div>

          <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
            <Clock3 className="h-3.5 w-3.5" />

            Last sweep

            {" · "}

            {new Date(
              lastSweep.completedAt,
            ).toLocaleString()}
          </div>

          {/* RESULTS */}

          {lastSweep.results.length >
            0 && (
            <div className="mt-4 max-h-[520px] space-y-2 overflow-y-auto pr-1">
              {lastSweep.results.map(
                (
                  item,
                  index,
                ) => {
                  const response =
                    item.response;

                  const success =
                    item.httpStatus !==
                      null &&
                    item.httpStatus >=
                      200 &&
                    item.httpStatus <
                      300;

                  return (
                    <div
                      key={`${item.sms.id ?? "sms"}-${item.sms.date}-${index}`}
                      className="rounded-2xl border p-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">
                            {item.sms.address ??
                              "Unknown sender"}
                          </p>

                          <p className="mt-1 text-[11px] text-muted-foreground">
                            SMS ID:{" "}
                            {item.sms.id ??
                              "not available"}
                          </p>

                          <p className="text-[11px] text-muted-foreground">
                            {formatDate(
                              item.sms.date,
                            )}
                          </p>
                        </div>

                        {success ? (
                          <CheckCircle2 className="h-5 w-5 shrink-0 text-green-600" />
                        ) : (
                          <XCircle className="h-5 w-5 shrink-0 text-red-600" />
                        )}
                      </div>

                      <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed">
                        {item.sms.body}
                      </p>

                      <div className="mt-3 flex flex-wrap gap-2">
                        {item.httpStatus !==
                          null && (
                          <Badge>
                            HTTP{" "}
                            {
                              item.httpStatus
                            }
                          </Badge>
                        )}

                        {response?.status && (
                          <Badge>
                            {
                              response.status
                            }
                          </Badge>
                        )}

                        {response?.stage && (
                          <Badge>
                            stage:{" "}
                            {
                              response.stage
                            }
                          </Badge>
                        )}

                        {response?.type && (
                          <Badge>
                            type:{" "}
                            {
                              response.type
                            }
                          </Badge>
                        )}

                        {response?.processed && (
                          <Badge>
                            processed
                          </Badge>
                        )}

                        {response?.duplicate && (
                          <Badge>
                            duplicate
                          </Badge>
                        )}

                        {response?.ignored && (
                          <Badge>
                            ignored
                          </Badge>
                        )}

                        {response?.financialChange && (
                          <Badge>
                            DB change
                          </Badge>
                        )}
                      </div>

                      {item.error && (
                        <div className="mt-3 rounded-xl bg-red-500/5 p-2 text-xs text-red-600">
                          {item.error}
                        </div>
                      )}

                      {response?.error && (
                        <div className="mt-3 rounded-xl bg-red-500/5 p-2 text-xs text-red-600">
                          {response.error}
                        </div>
                      )}

                      {/* DEBUG RESPONSE */}

                      {response && (
                        <details className="mt-3">
                          <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
                            View server response
                          </summary>

                          <pre className="mt-2 max-h-72 overflow-auto rounded-xl bg-muted p-3 text-[10px] leading-relaxed">
                            {JSON.stringify(
                              response,
                              null,
                              2,
                            )}
                          </pre>
                        </details>
                      )}
                    </div>
                  );
                },
              )}
            </div>
          )}

          {lastSweep.results.length ===
            0 && (
            <div className="mt-4 flex flex-col items-center justify-center rounded-2xl border border-dashed p-8 text-center">
              <Inbox className="h-8 w-8 text-muted-foreground" />

              <p className="mt-2 text-sm font-medium">
                No transaction candidates found
              </p>

              <p className="mt-1 text-xs text-muted-foreground">
                Inbox:{" "}
                {lastSweep.scanned}
                {" · "}
                Candidates: 0
              </p>
            </div>
          )}
        </>
      )}
    </section>
  );
}

/* =========================================================
   STAT
========================================================= */

function Stat({
  label,
  value,
}: {
  label: string;
  value: number;
}) {
  return (
    <div className="rounded-2xl bg-muted/50 p-3">
      <p className="text-[11px] text-muted-foreground">
        {label}
      </p>

      <p className="mt-1 text-lg font-semibold">
        {value}
      </p>
    </div>
  );
}

/* =========================================================
   BADGE
========================================================= */

function Badge({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <span className="rounded-lg bg-muted px-2 py-1 text-[10px] font-medium">
      {children}
    </span>
  );
}