"use client";

import {
  CheckCircle2,
  Clipboard,
  Loader2,
  Play,
  RotateCcw,
  Smartphone,
  XCircle,
} from "lucide-react";
import { useState } from "react";

/* =========================================================
   TYPES
========================================================= */

type TestResult = {
  success: boolean;
  stage: string;
  data?: unknown;
  error?: string;
};

type ParsedView = {
  reference?: string;
  amount?: number;
  senderName?: string;
  accountNumber?: string;
  transactionType?: string;
  transactionDate?: string;
};

/* =========================================================
   TEST SMS
========================================================= */

const SAMPLE_SMS =
  "UHVJO4KICG Confirmed. KES 2,000.00 received from DAVID NG'ANG'A KUNG'U for account 082083 on 31/08/26 at 09:17 AM. Enquiries, call 0719088000.";

/* =========================================================
   HELPERS
========================================================= */

function formatJson(value: unknown): string {
  try {
    return JSON.stringify(
      value,
      null,
      2,
    );
  } catch {
    return String(value);
  }
}

function getErrorMessage(
  error: unknown,
): string {
  return error instanceof Error
    ? error.message
    : "Unknown error.";
}

/* =========================================================
   PAGE
========================================================= */

export default function SmsTestPage() {
  const [sms, setSms] =
    useState(SAMPLE_SMS);

  const [loading, setLoading] =
    useState(false);

  const [result, setResult] =
    useState<TestResult | null>(null);

  const [parsed, setParsed] =
    useState<ParsedView | null>(null);

  const [copied, setCopied] =
    useState(false);

  /* =======================================================
     COPY SAMPLE SMS
  ======================================================= */

  async function copySms() {
    try {
      await navigator.clipboard.writeText(
        sms,
      );

      setCopied(true);

      window.setTimeout(
        () => setCopied(false),
        1500,
      );
    } catch {
      setCopied(false);
    }
  }

  /* =======================================================
     RUN TEST
  ======================================================= */

  async function runTest() {
    const message =
      sms.trim();

    if (!message) {
      setResult({
        success: false,
        stage: "input",
        error:
          "SMS message cannot be empty.",
      });

      return;
    }

    setLoading(true);
    setResult(null);
    setParsed(null);

    try {
      /*
       * -----------------------------------------------------
       * IMPORTANT
       * -----------------------------------------------------
       *
       * The test endpoint should execute the EXISTING
       * processBankSms() flow.
       *
       * We deliberately send only the raw SMS.
       *
       * The server must perform:
       *
       * raw SMS
       *   ↓
       * classifier
       *   ↓
       * routing
       *   ↓
       * member resolution
       *   ↓
       * loan resolution
       *   ↓
       * createLoanRepayment()
       *
       * Do NOT send memberId, loanId or amount from this page.
       */

      const response =
        await fetch(
          "/api/loans/repayments",
          {
            method: "POST",
            credentials:
              "same-origin",
            cache: "no-store",
            headers: {
              Accept:
                "application/json",
              "Content-Type":
                "application/json",
            },
            body: JSON.stringify({
              message,
            }),
          },
        );

      let body: unknown = null;

      try {
        body =
          await response.json();
      } catch {
        body = null;
      }

      if (!response.ok) {
        throw new Error(
          body &&
          typeof body ===
            "object" &&
          "error" in body &&
          typeof (
            body as {
              error?: unknown;
            }
          ).error === "string"
            ? (
                body as {
                  error: string;
                }
              ).error
            : `SMS processing failed (${response.status}).`,
        );
      }

      /*
       * Try to expose the classified/parsed portion
       * if the endpoint returns it.
       */
      if (
        body &&
        typeof body ===
          "object"
      ) {
        const record =
          body as Record<
            string,
            unknown
          >;

        const transaction =
          record.transaction;

        if (
          transaction &&
          typeof transaction ===
            "object"
        ) {
          setParsed(
            transaction as ParsedView,
          );
        } else if (
          record.data &&
          typeof record.data ===
            "object"
        ) {
          const data =
            record.data as Record<
              string,
              unknown
            >;

          if (
            data.transaction &&
            typeof data.transaction ===
              "object"
          ) {
            setParsed(
              data.transaction as ParsedView,
            );
          }
        }
      }

      setResult({
        success: true,
        stage: "completed",
        data: body,
      });
    } catch (error) {
      setResult({
        success: false,
        stage: "processing",
        error:
          getErrorMessage(error),
      });
    } finally {
      setLoading(false);
    }
  }

  /* =======================================================
     RESET
  ======================================================= */

  function reset() {
    setSms(SAMPLE_SMS);
    setResult(null);
    setParsed(null);
    setCopied(false);
  }

  /* =======================================================
     RENDER
  ======================================================= */

  return (
    <main className="min-h-screen bg-black px-4 py-6 text-white">
      <div className="mx-auto w-full max-w-5xl">
        {/* =================================================
           HEADER
        ================================================= */}

        <header className="mb-6">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-500/10 text-blue-400">
              <Smartphone
                size={22}
                strokeWidth={1.8}
              />
            </div>

            <div>
              <h1 className="text-xl font-semibold">
                SMS Payment Test
              </h1>

              <p className="text-sm text-white/50">
                GEO-SHUA loan payment pipeline
              </p>
            </div>
          </div>
        </header>

        {/* =================================================
           PIPELINE
        ================================================= */}

        <section className="mb-5 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {[
              "SMS Inbox",
              "Parser",
              "Classifier",
              "Member",
              "Loan",
              "Repayment",
            ].map(
              (
                item,
                index,
              ) => (
                <div
                  key={item}
                  className="flex items-center gap-2"
                >
                  <span className="rounded-full border border-white/10 px-3 py-1.5 text-white/70">
                    {item}
                  </span>

                  {index < 5 && (
                    <span className="text-white/20">
                      →
                    </span>
                  )}
                </div>
              ),
            )}
          </div>
        </section>

        {/* =================================================
           SMS INPUT
        ================================================= */}

        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h2 className="font-medium">
                Bank SMS
              </h2>

              <p className="text-xs text-white/40">
                Paste an existing bank SMS for testing.
              </p>
            </div>

            <button
              type="button"
              onClick={copySms}
              className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-xs text-white/70 hover:bg-white/5"
            >
              <Clipboard size={14} />

              {copied
                ? "Copied"
                : "Copy"}
            </button>
          </div>

          <textarea
            value={sms}
            onChange={(event) =>
              setSms(
                event.target.value,
              )
            }
            rows={5}
            spellCheck={false}
            className="w-full resize-none rounded-xl border border-white/10 bg-black p-4 text-sm leading-6 text-white outline-none placeholder:text-white/30 focus:border-blue-500/50"
            placeholder="Paste bank SMS here..."
          />

          {/* ACTIONS */}

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={runTest}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-sm font-medium text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? (
                <Loader2
                  size={17}
                  className="animate-spin"
                />
              ) : (
                <Play
                  size={17}
                  fill="currentColor"
                />
              )}

              {loading
                ? "Processing..."
                : "Process SMS"}
            </button>

            <button
              type="button"
              onClick={reset}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-xl border border-white/10 px-4 py-3 text-sm text-white/70 hover:bg-white/5 disabled:opacity-50"
            >
              <RotateCcw size={16} />
              Reset
            </button>
          </div>
        </section>

        {/* =================================================
           PARSED DATA
        ================================================= */}

        {parsed && (
          <section className="mt-5 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <div className="mb-4">
              <h2 className="font-medium">
                Parsed Transaction
              </h2>

              <p className="text-xs text-white/40">
                Values extracted from the bank SMS.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              <Info
                label="Reference"
                value={
                  parsed.reference ??
                  "—"
                }
              />

              <Info
                label="Amount"
                value={
                  typeof parsed.amount ===
                  "number"
                    ? `KES ${parsed.amount.toLocaleString(
                        "en-KE",
                        {
                          minimumFractionDigits: 2,
                        },
                      )}`
                    : "—"
                }
              />

              <Info
                label="Sender"
                value={
                  parsed.senderName ??
                  "—"
                }
              />

              <Info
                label="Bank Account"
                value={
                  parsed.accountNumber ??
                  "—"
                }
              />

              <Info
                label="Type"
                value={
                  parsed.transactionType ??
                  "—"
                }
              />

              <Info
                label="Transaction Date"
                value={
                  parsed.transactionDate ??
                  "—"
                }
              />
            </div>
          </section>
        )}

        {/* =================================================
           RESULT
        ================================================= */}

        {result && (
          <section className="mt-5 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <div className="mb-4 flex items-center gap-3">
              {result.success ? (
                <CheckCircle2
                  size={22}
                  className="text-emerald-400"
                />
              ) : (
                <XCircle
                  size={22}
                  className="text-red-400"
                />
              )}

              <div>
                <h2 className="font-medium">
                  {result.success
                    ? "Processing completed"
                    : "Processing failed"}
                </h2>

                <p className="text-xs text-white/40">
                  Stage:{" "}
                  {result.stage}
                </p>
              </div>
            </div>

            {result.error && (
              <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4 text-sm text-red-300">
                {result.error}
              </div>
            )}

            {result.data !==
              undefined && (
              <pre className="max-h-[500px] overflow-auto rounded-xl border border-white/10 bg-black p-4 text-xs leading-5 text-white/70">
                {formatJson(
                  result.data,
                )}
              </pre>
            )}
          </section>
        )}

        {/* =================================================
           EXPECTED TEST
        ================================================= */}

        <section className="mt-5 rounded-2xl border border-blue-500/10 bg-blue-500/[0.03] p-4">
          <h2 className="mb-2 font-medium text-blue-300">
            Expected test
          </h2>

          <div className="space-y-1 text-sm text-white/60">
            <p>
              Reference:{" "}
              <strong className="text-white">
                UHVJO4KICG
              </strong>
            </p>

            <p>
              Amount:{" "}
              <strong className="text-white">
                KES 2,000.00
              </strong>
            </p>

            <p>
              Sender:{" "}
              <strong className="text-white">
                DAVID NG'ANG'A KUNG'U
              </strong>
            </p>

            <p>
              Bank account:{" "}
              <strong className="text-white">
                082083
              </strong>
            </p>

            <p>
              Classification:{" "}
              <strong className="text-blue-300">
                loan
              </strong>
            </p>

            <p className="pt-2 text-xs text-white/40">
              The system should then resolve David's
              registered GEO-SHUA member record and his
              active loan before creating the repayment.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}

/* =========================================================
   INFO
========================================================= */

function Info({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/30 p-3">
      <p className="mb-1 text-[10px] uppercase tracking-wider text-white/30">
        {label}
      </p>

      <p className="break-words text-sm text-white/80">
        {value}
      </p>
    </div>
  );
}
