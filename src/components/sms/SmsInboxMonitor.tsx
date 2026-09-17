"use client";

import {
  ChevronDown,
  ChevronUp,
  RefreshCw,
} from "lucide-react";

import { useState } from "react";

import { Capacitor } from "@capacitor/core";

import {
  useSmsInbox,
  type SmsProcessResult,
} from "@/components/sms/SmsInboxProvider";

/* =========================================================
   HELPERS
========================================================= */

function formatSmsDate(
  value: unknown
): string {
  if (
    typeof value !== "number" &&
    typeof value !== "string"
  ) {
    return "—";
  }

  const timestamp =
    typeof value === "number"
      ? value
      : Number(value);

  if (!Number.isFinite(timestamp)) {
    return "—";
  }

  const date = new Date(timestamp);

  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return date.toLocaleString();
}

function getResultLabel(
  result: SmsProcessResult
): string {
  if (result.processed) {
    return "Processed";
  }

  if (result.duplicate) {
    return "Duplicate";
  }

  if (result.ignored) {
    return "Ignored";
  }

  if (result.error) {
    return "Failed";
  }

  return result.status || "Unknown";
}

function getResultLabelClass(
  result: SmsProcessResult
): string {
  if (result.processed) {
    return "text-emerald-400";
  }

  if (result.duplicate) {
    return "text-amber-400";
  }

  if (result.ignored) {
    return "text-slate-400";
  }

  if (result.error) {
    return "text-red-400";
  }

  return "text-slate-300";
}

/* =========================================================
   COMPONENT
========================================================= */

export default function SmsInboxMonitor() {
  const isNative =
    Capacitor.isNativePlatform();

  const {
    scanPhase,
    performingTransaction,
    stats,
    progress,
    results,
    lastSync,
    processInbox,
  } = useSmsInbox();

  const [resultsOpen, setResultsOpen] =
    useState(false);

  if (!isNative) {
    return null;
  }

  const isRunning =
    scanPhase === "reading" ||
    scanPhase === "processing";

  return (
    <section
      className="
        w-full
        overflow-hidden
        rounded-2xl
        border
        border-slate-800
        bg-slate-950
        text-white
      "
    >
      {/* ===================================================
          STATUS / CONTROL BAR
      =================================================== */}

      <div
        className="
          flex
          min-h-[52px]
          items-center
          gap-3
          bg-slate-950
          px-3
          sm:px-4
        "
      >
        {/* STATUS */}

        <div className="min-w-0 flex-1">
          {/* READING */}

          {scanPhase === "reading" && (
            <div className="flex items-center gap-2">
              <span
                className="
                  h-1.5
                  w-1.5
                  shrink-0
                  animate-pulse
                  rounded-full
                  bg-sky-400
                  shadow-[0_0_8px_rgba(56,189,248,0.8)]
                "
              />

              <span
                className="
                  truncate
                  text-xs
                  font-medium
                  text-white
                "
              >
                Reading SMS…
              </span>
            </div>
          )}

          {/* PROCESSING */}

          {scanPhase === "processing" && (
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span
                  className="
                    h-1.5
                    w-1.5
                    shrink-0
                    animate-pulse
                    rounded-full
                    bg-sky-400
                    shadow-[0_0_8px_rgba(56,189,248,0.8)]
                  "
                />

                <span
                  className="
                    truncate
                    text-xs
                    font-medium
                    text-white
                  "
                >
                  Processing SMS{" "}
                  <span className="text-slate-500">
                    {progress.current}/
                    {progress.total}
                  </span>
                </span>
              </div>

              {performingTransaction && (
                <p
                  className="
                    ml-3.5
                    mt-0.5
                    truncate
                    text-[9px]
                    uppercase
                    tracking-[0.12em]
                    text-sky-400/80
                  "
                >
                  Performing transaction…
                </p>
              )}

              <div
                className="
                  mt-1.5
                  h-[2px]
                  w-full
                  max-w-[280px]
                  overflow-hidden
                  rounded-full
                  bg-slate-800
                "
              >
                <div
                  className="
                    h-full
                    rounded-full
                    bg-sky-400
                    shadow-[0_0_7px_rgba(56,189,248,0.5)]
                    transition-[width]
                    duration-300
                  "
                  style={{
                    width:
                      progress.total > 0
                        ? `${Math.min(
                            100,
                            Math.round(
                              (progress.current /
                                progress.total) *
                                100
                            )
                          )}%`
                        : "0%",
                  }}
                />
              </div>
            </div>
          )}

          {/* COMPLETE */}

          {scanPhase === "complete" && (
            <div className="flex items-center gap-2">
              <span
                className="
                  h-1.5
                  w-1.5
                  shrink-0
                  rounded-full
                  bg-emerald-400
                  shadow-[0_0_8px_rgba(52,211,153,0.7)]
                "
              />

              <span
                className="
                  text-xs
                  font-medium
                  text-white
                "
              >
                {stats.processed}{" "}
                <span className="text-slate-500">
                  transactions complete
                </span>
              </span>
            </div>
          )}

          {/* ERROR */}

          {scanPhase === "error" && (
            <div className="flex items-center gap-2">
              <span
                className="
                  h-1.5
                  w-1.5
                  shrink-0
                  rounded-full
                  bg-red-400
                "
              />

              <span
                className="
                  text-xs
                  font-medium
                  text-white
                "
              >
                SMS processing stopped
              </span>
            </div>
          )}

          {/* IDLE */}

          {scanPhase === "idle" && (
            <span
              className="
                text-xs
                text-slate-500
              "
            >
              SMS processing ready
            </span>
          )}
        </div>

        {/* CONTROLS */}

        <div
          className="
            flex
            shrink-0
            items-center
            gap-1.5
          "
        >
          {/* CHECK SMS */}

          <button
            type="button"
            onClick={() => {
              if (!isRunning) {
                void processInbox();
              }
            }}
            disabled={
              isRunning || !isNative
            }
            aria-label="Check SMS now"
            title="Check SMS now"
            className="
              flex
              h-8
              items-center
              gap-1.5
              rounded-lg
              border
              border-sky-500/40
              bg-sky-500/10
              px-3
              text-[10px]
              font-semibold
              uppercase
              tracking-[0.08em]
              text-sky-300
              transition-all
              duration-200
              hover:border-sky-400/70
              hover:bg-sky-500/20
              hover:text-white
              active:scale-[0.98]
              disabled:pointer-events-none
              disabled:opacity-40
            "
          >
            <RefreshCw
              className={`
                h-3.5
                w-3.5
                ${
                  isRunning
                    ? "animate-spin"
                    : ""
                }
              `}
            />

            <span>
              Check SMS
            </span>
          </button>

          {/* RESULTS */}

          <button
            type="button"
            onClick={() =>
              setResultsOpen(
                (open) => !open
              )
            }
            disabled={results.length === 0}
            aria-label={
              resultsOpen
                ? "Hide SMS results"
                : "Show SMS results"
            }
            title={
              resultsOpen
                ? "Hide SMS results"
                : "Show SMS results"
            }
            className="
              relative
              flex
              h-8
              w-8
              shrink-0
              items-center
              justify-center
              rounded-lg
              border
              border-slate-800
              bg-slate-900
              text-slate-500
              transition-all
              duration-200
              hover:border-slate-700
              hover:bg-slate-800
              hover:text-white
              disabled:pointer-events-none
              disabled:opacity-30
            "
          >
            {resultsOpen ? (
              <ChevronUp className="h-3.5 w-3.5" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" />
            )}

            {results.length > 0 && (
              <span
                className="
                  absolute
                  -right-1
                  -top-1
                  flex
                  h-4
                  min-w-4
                  items-center
                  justify-center
                  rounded-full
                  bg-sky-500
                  px-1
                  text-[8px]
                  font-bold
                  text-white
                "
              >
                {results.length > 99
                  ? "99+"
                  : results.length}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* ===================================================
          RESULTS
      =================================================== */}

      {resultsOpen &&
        results.length > 0 && (
          <div
            className="
              border-t
              border-slate-800
              bg-slate-900/60
            "
          >
            <div
              className="
                max-h-[360px]
                overflow-y-auto
                overscroll-contain
                p-3
                [scrollbar-width:thin]
              "
            >
              <div className="space-y-2">
                {results.map(
                  (
                    result,
                    index
                  ) => (
                    <div
                      key={`${result.sms.id || result.sms.date}-${index}`}
                      className="
                        rounded-xl
                        border
                        border-slate-800
                        bg-slate-950/80
                        p-3
                      "
                    >
                      {/* RESULT HEADER */}

                      <div
                        className="
                          flex
                          items-center
                          justify-between
                          gap-3
                        "
                      >
                        <span
                          className={`
                            text-[10px]
                            font-semibold
                            uppercase
                            tracking-[0.08em]
                            ${getResultLabelClass(
                              result
                            )}
                          `}
                        >
                          {getResultLabel(
                            result
                          )}
                        </span>

                        <span
                          className="
                            shrink-0
                            text-[9px]
                            text-slate-600
                          "
                        >
                          {formatSmsDate(
                            result.sms.date
                          )}
                        </span>
                      </div>

                      {/* SMS BODY */}

                      <p
                        className="
                          mt-2
                          whitespace-pre-wrap
                          break-words
                          text-[11px]
                          leading-relaxed
                          text-slate-300
                        "
                      >
                        {result.sms.body ||
                          "SMS body unavailable."}
                      </p>

                      {/* ERROR */}

                      {result.error && (
                        <p
                          className="
                            mt-2
                            whitespace-pre-wrap
                            break-words
                            rounded-lg
                            border
                            border-red-500/10
                            bg-red-500/5
                            px-2
                            py-1.5
                            text-[10px]
                            leading-relaxed
                            text-red-300
                          "
                        >
                          {result.error}
                        </p>
                      )}
                    </div>
                  )
                )}
              </div>
            </div>

            {/* RESULTS FOOTER */}

            <div
              className="
                flex
                items-center
                justify-between
                gap-3
                border-t
                border-slate-800
                px-3
                py-2
                text-[9px]
                text-slate-600
              "
            >
              <span>
                {results.length} SMS result
                {results.length === 1
                  ? ""
                  : "s"}
              </span>

              <span>
                {lastSync
                  ? `Last checked ${lastSync.toLocaleTimeString()}`
                  : "Processing"}
              </span>
            </div>
          </div>
        )}
    </section>
  );
}