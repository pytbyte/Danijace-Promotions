
"use client";

import {
  AlertCircle,
  Bug,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  FileSearch,
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

/*
 * These terms are ONLY a local candidate filter.
 *
 * Passing this filter does NOT mean the SMS is valid.
 * The server remains authoritative.
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

/*
 * Only a small sample of locally filtered messages
 * is retained for developer diagnostics.
 */
const MAX_FILTERED_DIAGNOSTICS = 10;

/* =========================================================
   TYPES
========================================================= */

type MonitorStatus =
  | "idle"
  | "scanning"
  | "synced"
  | "attention"
  | "error";

type ApiRecord = Record<string, unknown>;

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

type ProcessStats = {
  inbox: number;

  candidates: number;

  filtered: number;

  submitted: number;

  processed: number;

  duplicate: number;

  ignored: number;

  failed: number;

  loanUpdated: number;

  savingsUpdated: number;
};

type ReaderError = {
  message: string;

  code?: string;

  data?: unknown;

  raw?: unknown;
};

type ScanProgress = {
  current: number;

  total: number;

  submitted: number;

  processed: number;

  duplicate: number;

  ignored: number;

  failed: number;

  loanUpdated: number;

  savingsUpdated: number;

  currentAddress?: string;

  currentSmsId?: string;
};

type FilteredDiagnostic = {
  sms: SmsMessage;

  reason: string;
};

/* =========================================================
   BASIC HELPERS
========================================================= */

function isFinancialCandidate(
  sms: SmsMessage,
): boolean {
  const text =
    `${sms.address ?? ""} ${sms.body ?? ""}`.toLowerCase();

  return FINANCIAL_TERMS.some((term) =>
    text.includes(term),
  );
}

/*
 * Creates a deterministic local key for an Android
 * inbox row.
 *
 * We prefer Android's native SMS _id.
 *
 * If Android does not provide one, we use:
 *
 * address + date + body
 *
 * The SERVER remains responsible for permanent
 * financial idempotency.
 */
function getLocalSmsKey(
  sms: SmsMessage,
): string {
  if (
    sms.id !== undefined &&
    sms.id !== null &&
    String(sms.id).trim()
  ) {
    return `id:${String(sms.id)}`;
  }

  return [
    `address:${sms.address ?? ""}`,
    `date:${sms.date}`,
    `body:${sms.body ?? ""}`,
  ].join("|");
}

/* =========================================================
   DATE / TIME
========================================================= */

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
    ).format(new Date(timestamp));
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
        year: "numeric",
      },
    ).format(new Date(timestamp));
  } catch {
    return "";
  }
}

function formatFullDateTime(
  timestamp: number,
): string {
  if (!timestamp) {
    return "Unknown date";
  }

  try {
    return new Intl.DateTimeFormat(
      "en-KE",
      {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      },
    ).format(new Date(timestamp));
  } catch {
    return "Unknown date";
  }
}

/* =========================================================
   STRING HELPERS
========================================================= */

function truncate(
  value: string,
  length = 100,
): string {
  if (value.length <= length) {
    return value;
  }

  return `${value.slice(0, length)}…`;
}

function toRecord(
  value: unknown,
): ApiRecord | null {
  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value)
  ) {
    return value as ApiRecord;
  }

  return null;
}

function getString(
  value: unknown,
): string | undefined {
  if (
    typeof value === "string" &&
    value.trim()
  ) {
    return value.trim();
  }

  if (
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return String(value);
  }

  return undefined;
}

/* =========================================================
   API DIAGNOSTIC HELPERS
========================================================= */

function getApiReason(
  value: unknown,
): string | undefined {
  const root =
    toRecord(value);

  if (!root) {
    return undefined;
  }

  const directKeys = [
    "reason",
    "message",
    "error",
  ];

  for (const key of directKeys) {
    const text =
      getString(root[key]);

    if (text) {
      return text;
    }
  }

  const diagnostic =
    toRecord(root.diagnostic);

  if (diagnostic) {
    for (const key of directKeys) {
      const text =
        getString(diagnostic[key]);

      if (text) {
        return text;
      }
    }
  }

  const result =
    toRecord(root.result);

  if (result) {
    for (const key of directKeys) {
      const text =
        getString(result[key]);

      if (text) {
        return text;
      }
    }
  }

  const parser =
    toRecord(root.parser);

  if (parser) {
    for (const key of directKeys) {
      const text =
        getString(parser[key]);

      if (text) {
        return text;
      }
    }
  }

  return undefined;
}

/* =========================================================
   API REFERENCE
========================================================= */

function getApiReference(
  value: unknown,
): string | undefined {
  const root =
    toRecord(value);

  if (!root) {
    return undefined;
  }

  const direct =
    getString(root.reference) ??
    getString(root.transactionReference);

  if (direct) {
    return direct;
  }

  const parsed =
    toRecord(root.parsed);

  if (parsed) {
    const parsedReference =
      getString(parsed.reference) ??
      getString(
        parsed.transactionReference,
      );

    if (parsedReference) {
      return parsedReference;
    }

    const parserData =
      toRecord(parsed.data);

    if (parserData) {
      const parserReference =
        getString(
          parserData.reference,
        );

      if (parserReference) {
        return parserReference;
      }
    }
  }

  const transaction =
    toRecord(root.transaction);

  if (transaction) {
    const transactionReference =
      getString(
        transaction.reference,
      ) ??
      getString(
        transaction.transactionReference,
      );

    if (transactionReference) {
      return transactionReference;
    }
  }

  const repayment =
    toRecord(root.repayment);

  if (repayment) {
    const repaymentReference =
      getString(
        repayment.transactionReference,
      ) ??
      getString(
        repayment.reference,
      );

    if (repaymentReference) {
      return repaymentReference;
    }
  }

  return undefined;
}

/* =========================================================
   API AMOUNT
========================================================= */

function getApiAmount(
  value: unknown,
): string | undefined {
  const root =
    toRecord(value);

  if (!root) {
    return undefined;
  }

  const direct =
    root.amount;

  if (
    typeof direct === "number" ||
    typeof direct === "string"
  ) {
    return String(direct);
  }

  const parsed =
    toRecord(root.parsed);

  if (parsed) {
    const amount =
      parsed.amount;

    if (
      typeof amount === "number" ||
      typeof amount === "string"
    ) {
      return String(amount);
    }
  }

  const transaction =
    toRecord(root.transaction);

  if (transaction) {
    const amount =
      transaction.amount;

    if (
      typeof amount === "number" ||
      typeof amount === "string"
    ) {
      return String(amount);
    }
  }

  return undefined;
}

/* =========================================================
   API DESTINATION ACCOUNT
========================================================= */

function getApiDestinationAccountNumber(
  value: unknown,
): string | undefined {
  const root =
    toRecord(value);

  if (!root) {
    return undefined;
  }

  const direct =
    getString(
      root.destinationAccountNumber,
    );

  if (direct) {
    return direct;
  }

  const parsed =
    toRecord(root.parsed);

  if (parsed) {
    const account =
      getString(
        parsed.destinationAccountNumber,
      );

    if (account) {
      return account;
    }

    /*
     * Compatibility with nested parser diagnostic:
     *
     * parsed: {
     *   data: {
     *     destinationAccountNumber: ...
     *   }
     * }
     */
    const parserData =
      toRecord(parsed.data);

    if (parserData) {
      const parserAccount =
        getString(
          parserData.destinationAccountNumber,
        );

      if (parserAccount) {
        return parserAccount;
      }
    }
  }

  return undefined;
}

/* =========================================================
   API SENDER / MEMBER
========================================================= */

function getApiSenderName(
  value: unknown,
): string | undefined {
  const root =
    toRecord(value);

  if (!root) {
    return undefined;
  }

  const direct =
    getString(root.senderName) ??
    getString(root.memberName);

  if (direct) {
    return direct;
  }

  const parsed =
    toRecord(root.parsed);

  if (parsed) {
    const sender =
      getString(
        parsed.senderName,
      );

    if (sender) {
      return sender;
    }

    const parserData =
      toRecord(parsed.data);

    if (parserData) {
      const parserSender =
        getString(
          parserData.senderName,
        );

      if (parserSender) {
        return parserSender;
      }
    }
  }

  const member =
    toRecord(root.member);

  if (member) {
    const memberName =
      getString(member.name) ??
      getString(member.fullName);

    if (memberName) {
      return memberName;
    }
  }

  return undefined;
}

/* =========================================================
   API TRANSACTION DATE
========================================================= */

function getApiTransactionDate(
  value: unknown,
): string | undefined {
  const root =
    toRecord(value);

  if (!root) {
    return undefined;
  }

  const direct =
    root.transactionDate;

  if (
    typeof direct === "string" ||
    typeof direct === "number"
  ) {
    return String(direct);
  }

  const parsed =
    toRecord(root.parsed);

  if (parsed) {
    const parsedDate =
      parsed.transactionDate;

    if (
      typeof parsedDate === "string" ||
      typeof parsedDate === "number"
    ) {
      return String(parsedDate);
    }

    const parserData =
      toRecord(parsed.data);

    if (parserData) {
      const parserDate =
        parserData.transactionDate;

      if (
        typeof parserDate === "string" ||
        typeof parserDate === "number"
      ) {
        return String(parserDate);
      }
    }
  }

  return undefined;
}

/* =========================================================
   API LOAN
========================================================= */

function getApiLoan(
  value: unknown,
): ApiRecord | null {
  const root =
    toRecord(value);

  if (!root) {
    return null;
  }

  const directLoan =
    toRecord(root.loan);

  if (directLoan) {
    return directLoan;
  }

  const result =
    toRecord(root.result);

  if (result) {
    const resultLoan =
      toRecord(result.loan);

    if (resultLoan) {
      return resultLoan;
    }
  }

  return null;
}

/* =========================================================
   API SAVINGS ACCOUNT
========================================================= */

function getApiSavingsAccount(
  value: unknown,
): ApiRecord | null {
  const root =
    toRecord(value);

  if (!root) {
    return null;
  }

  return (
    toRecord(
      root.savingsAccount,
    ) ??
    toRecord(
      root.account,
    )
  );
}

/* =========================================================
   SERIALIZE
========================================================= */

function serializeValue(
  value: unknown,
): string {
  try {
    const result =
      JSON.stringify(
        value,
        null,
        2,
      );

    return result ?? String(value);
  } catch {
    return String(value);
  }
}

/* =========================================================
   RESULT HELPERS
========================================================= */

function getResultKind(
  item: ProcessResult,
):
  | "processed"
  | "duplicate"
  | "ignored"
  | "failed" {
  if (item.processed) {
    return "processed";
  }

  if (item.duplicate) {
    return "duplicate";
  }

  if (item.ignored) {
    return "ignored";
  }

  return "failed";
}

function getResultLabel(
  item: ProcessResult,
): string {
  const kind =
    getResultKind(item);

  switch (kind) {
    case "processed":
      return item.type
        ? `Processed · ${item.type}`
        : "Processed";

    case "duplicate":
      return "Already synced";

    case "ignored":
      return "Ignored";

    default:
      return "Needs attention";
  }
}

function getResultReason(
  item: ProcessResult,
): string | undefined {
  if (item.error) {
    return item.error;
  }

  return getApiReason(
    item.response,
  );
}

/* =========================================================
   NATIVE ERROR EXTRACTION
========================================================= */

function extractReaderError(
  error: unknown,
): ReaderError {
  if (
    error &&
    typeof error === "object"
  ) {
    const value =
      error as Record<
        string,
        unknown
      >;

    const message =
      typeof value.message === "string" &&
      value.message.trim()
        ? value.message
        : typeof value.error === "string" &&
            value.error.trim()
          ? value.error
          : "Unknown Android SMS reader error.";

    const code =
      typeof value.code === "string"
        ? value.code
        : undefined;

    const data =
      value.data !== undefined
        ? value.data
        : undefined;

    return {
      message,
      code,
      data,
      raw: error,
    };
  }

  if (error instanceof Error) {
    return {
      message:
        error.message ||
        "Unknown Android SMS reader error.",
      raw: error,
    };
  }

  if (typeof error === "string") {
    return {
      message: error,
      raw: error,
    };
  }

  return {
    message:
      "Unknown Android SMS reader error.",
    raw: error,
  };
}

/* =========================================================
   COMPONENT
========================================================= */

export default function SmsInboxMonitor() {
  const [status, setStatus] =
    useState<MonitorStatus>("idle");

  const [stats, setStats] =
    useState<ProcessStats>({
      inbox: 0,
      candidates: 0,
      filtered: 0,
      submitted: 0,
      processed: 0,
      duplicate: 0,
      ignored: 0,
      failed: 0,
      loanUpdated: 0,
      savingsUpdated: 0,
    });

  const [results, setResults] =
    useState<ProcessResult[]>([]);

  const [filteredDiagnostics, setFilteredDiagnostics] =
    useState<FilteredDiagnostic[]>([]);

  const [lastSync, setLastSync] =
    useState<number | null>(null);

  /*
   * Developer diagnostics panel.
   *
   * Closed by default.
   */
  const [expanded, setExpanded] =
    useState(false);

  const [readerError, setReaderError] =
    useState<ReaderError | null>(null);

  const [progress, setProgress] =
    useState<ScanProgress | null>(null);

  /*
   * Prevent two foreground operations from running
   * simultaneously.
   */
  const runningRef =
    useRef(false);

  /*
   * Prevent automatic startup processing from running
   * twice for this mounted component instance.
   */
  const startupProcessedRef =
    useRef(false);

  /* =======================================================
     PROCESS INBOX
  ======================================================= */

  const processInbox =
    useCallback(async () => {
      /*
       * SMS reading is Android-native.
       */
      if (
        runningRef.current ||
        !Capacitor.isNativePlatform()
      ) {
        return;
      }

      runningRef.current = true;

      setStatus("scanning");
      setReaderError(null);
      setProgress(null);

      /*
       * Reset visible run data.
       *
       * This keeps every scan independent.
       */
      setResults([]);
      setFilteredDiagnostics([]);

      console.log(
        "=================================================",
      );

      console.log(
        "GEO-SHUA SMS: FOREGROUND PROCESSING START",
      );

      console.log(
        "=================================================",
      );

      try {
        /* =================================================
           STEP 1 — READ ANDROID INBOX
        ================================================= */

        console.log(
          "GEO-SHUA SMS: calling native readInbox...",
        );

        let inboxResult;

        try {
          inboxResult =
            await SmsReader.readInbox();
        } catch (error) {
          const nativeError =
            extractReaderError(error);

          console.error(
            "GEO-SHUA SMS: native readInbox FAILED:",
            error,
          );

          console.error(
            "GEO-SHUA SMS: native error:",
            nativeError,
          );

          setReaderError(
            nativeError,
          );

          setStatus("error");

          setStats((current) => ({
            ...current,
            failed:
              current.failed + 1,
          }));

          return;
        }

        console.log(
          "GEO-SHUA SMS: native readInbox returned.",
        );

        console.log(
          "GEO-SHUA SMS: native diagnostic:",
          inboxResult?.diagnostic,
        );

        /* =================================================
           STEP 2 — NORMALIZE INBOX
        ================================================= */

        const messages =
          Array.isArray(
            inboxResult?.messages,
          )
            ? inboxResult.messages
            : [];

        console.log(
          "GEO-SHUA SMS: raw inbox count:",
          messages.length,
        );

        /*
         * Deduplicate Android inbox rows for this run.
         */
        const uniqueMessages: SmsMessage[] =
          [];

        const seenSmsKeys =
          new Set<string>();

        for (
          const sms of messages
        ) {
          const key =
            getLocalSmsKey(sms);

          if (
            seenSmsKeys.has(key)
          ) {
            continue;
          }

          seenSmsKeys.add(key);

          uniqueMessages.push(
            sms,
          );
        }

        console.log(
          "GEO-SHUA SMS: unique inbox count:",
          uniqueMessages.length,
        );

        /* =================================================
           STEP 3 — LOCAL CANDIDATE FILTER
        ================================================= */

        const candidates: SmsMessage[] =
          [];

        const filtered: FilteredDiagnostic[] =
          [];

        for (
          const sms of uniqueMessages
        ) {
          if (
            isFinancialCandidate(sms)
          ) {
            candidates.push(sms);
          } else if (
            filtered.length <
            MAX_FILTERED_DIAGNOSTICS
          ) {
            filtered.push({
              sms,
              reason:
                "Did not match the local financial-message candidate filter.",
            });
          }
        }

        const filteredCount =
          uniqueMessages.length -
          candidates.length;

        console.log(
          "GEO-SHUA SMS: candidates:",
          candidates.length,
        );

        console.log(
          "GEO-SHUA SMS: locally filtered:",
          filteredCount,
        );

        setFilteredDiagnostics(
          filtered,
        );

        /* =================================================
           INITIAL STATS
        ================================================= */

        const initialStats: ProcessStats = {
          inbox:
            uniqueMessages.length,

          candidates:
            candidates.length,

          filtered:
            filteredCount,

          submitted: 0,

          processed: 0,

          duplicate: 0,

          ignored: 0,

          failed: 0,

          loanUpdated: 0,

          savingsUpdated: 0,
        };

        setStats(
          initialStats,
        );

        setProgress({
          current: 0,

          total:
            uniqueMessages.length,

          submitted: 0,

          processed: 0,

          duplicate: 0,

          ignored: 0,

          failed: 0,

          loanUpdated: 0,

          savingsUpdated: 0,
        });

        /* =================================================
           STEP 4 — PROCESS CANDIDATES
        ================================================= */

        const nextResults: ProcessResult[] =
          [];

        let processed = 0;

        let duplicate = 0;

        let ignored = 0;

        let failed = 0;

        let submitted = 0;

        let loanUpdated = 0;

        let savingsUpdated = 0;

        /*
         * The progress number represents the position
         * inside the ENTIRE inbox, not merely the candidate
         * subset.
         *
         * Example:
         *
         * Processing SMS 1 of 200
         * Processing SMS 2 of 200
         *
         * This is the number the administrator sees.
         */
        for (
          let index = 0;
          index < uniqueMessages.length;
          index += 1
        ) {
          const sms =
            uniqueMessages[index];

          const currentNumber =
            index + 1;

          /*
           * Immediately update visible progress.
           */
          setProgress({
            current:
              currentNumber,

            total:
              uniqueMessages.length,

            submitted,

            processed,

            duplicate,

            ignored,

            failed,

            loanUpdated,

            savingsUpdated,

            currentAddress:
              sms.address ??
              undefined,

            currentSmsId:
              sms.id !== undefined
                ? String(sms.id)
                : undefined,
          });

          /* ===============================================
             LOCAL FILTER
          =============================================== */

          if (
            !isFinancialCandidate(
              sms,
            )
          ) {
            /*
             * This SMS does not reach the API.
             *
             * It counts toward the overall scan but is
             * represented by stats.filtered.
             */
            continue;
          }

          /* ===============================================
             LOCAL VALIDATION
          =============================================== */

          if (
            !sms.body ||
            !sms.body.trim() ||
            !sms.date ||
            sms.date <= 0
          ) {
            failed += 1;

            const invalidResult: ProcessResult =
              {
                sms,

                error:
                  "SMS has invalid body or date.",
              };

            nextResults.push(
              invalidResult,
            );

            console.warn(
              "GEO-SHUA SMS: local validation failed:",
              {
                smsId: sms.id,

                address:
                  sms.address,

                date:
                  sms.date,
              },
            );

            setStats({
              inbox:
                uniqueMessages.length,

              candidates:
                candidates.length,

              filtered:
                filteredCount,

              submitted,

              processed,

              duplicate,

              ignored,

              failed,

              loanUpdated,

              savingsUpdated,
            });

            continue;
          }

          submitted += 1;

          /* ===============================================
             DEBUG LOG
          =============================================== */

          console.log(
            "-------------------------------------------------",
          );

          console.log(
            "GEO-SHUA SMS: PROCESSING CANDIDATE",
            {
              number:
                currentNumber,

              total:
                uniqueMessages.length,

              id:
                sms.id,

              address:
                sms.address,

              date:
                sms.date,

              dateFormatted:
                formatFullDateTime(
                  sms.date,
                ),

              body:
                sms.body,
            },
          );

          /* ===============================================
             SEND TO SERVER
          =============================================== */

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

            let data: unknown =
              null;

            try {
              data =
                await response.json();
            } catch {
              data = null;
            }

            console.log(
              "GEO-SHUA SMS: API RESPONSE",
              {
                smsId:
                  sms.id,

                httpStatus:
                  response.status,

                httpOk:
                  response.ok,

                data,
              },
            );

            const payload =
              toRecord(data) ??
              {};

            /* =============================================
               API FLAGS
            ============================================= */

            const wasDuplicate =
              payload.duplicate ===
              true;

            const wasIgnored =
              payload.ignored ===
              true;

            const wasProcessed =
              payload.processed ===
              true;

            const financialChange =
              payload.financialChange ===
              true;

            const apiStatus =
              getString(
                payload.status,
              );

            const apiType =
              getString(
                payload.type,
              );

            const apiReason =
              getApiReason(
                data,
              );

            const apiReference =
              getApiReference(
                data,
              );

            const apiAmount =
              getApiAmount(
                data,
              );

            const apiDestinationAccount =
              getApiDestinationAccountNumber(
                data,
              );

            const apiSender =
              getApiSenderName(
                data,
              );

            const apiTransactionDate =
              getApiTransactionDate(
                data,
              );

            console.log(
              "GEO-SHUA SMS: API DECISION",
              {
                status:
                  apiStatus,

                type:
                  apiType,

                processed:
                  wasProcessed,

                duplicate:
                  wasDuplicate,

                ignored:
                  wasIgnored,

                financialChange,

                reason:
                  apiReason,

                reference:
                  apiReference,

                amount:
                  apiAmount,

                destinationAccountNumber:
                  apiDestinationAccount,

                senderName:
                  apiSender,

                transactionDate:
                  apiTransactionDate,
              },
            );

            /* =============================================
               CLASSIFY RESULT
            ============================================= */

            if (
              wasDuplicate
            ) {
              duplicate += 1;
            } else if (
              wasIgnored
            ) {
              ignored += 1;
            } else if (
              wasProcessed &&
              response.ok
            ) {
              processed += 1;

              /*
               * IMPORTANT:
               *
               * We count the actual financial destination
               * returned by the server.
               *
               * This is NOT based on the local SMS filter.
               */
              if (
                apiType === "loan"
              ) {
                loanUpdated += 1;
              } else if (
                apiType === "savings"
              ) {
                savingsUpdated += 1;
              }
            } else {
              failed += 1;
            }

            /* =============================================
               ERROR DETECTION
            ============================================= */

            let errorMessage:
              | string
              | undefined;

            const apiError =
              getString(
                payload.error,
              );

            if (apiError) {
              errorMessage =
                apiError;
            } else if (
              !response.ok
            ) {
              errorMessage =
                `Request failed (${response.status})`;
            } else if (
              !wasDuplicate &&
              !wasIgnored &&
              !wasProcessed
            ) {
              errorMessage =
                "Server returned an unknown processing result.";
            }

            /* =============================================
               STORE FULL RESULT
            ============================================= */

            nextResults.push({
              sms,

              httpStatus:
                response.status,

              status:
                apiStatus,

              type:
                apiType,

              financialChange,

              duplicate:
                wasDuplicate,

              ignored:
                wasIgnored,

              processed:
                wasProcessed,

              error:
                errorMessage,

              response:
                data,
            });

            /* =============================================
               LIVE UI STATS
            ============================================= */

            setStats({
              inbox:
                uniqueMessages.length,

              candidates:
                candidates.length,

              filtered:
                filteredCount,

              submitted,

              processed,

              duplicate,

              ignored,

              failed,

              loanUpdated,

              savingsUpdated,
            });

            setProgress({
              current:
                currentNumber,

              total:
                uniqueMessages.length,

              submitted,

              processed,

              duplicate,

              ignored,

              failed,

              loanUpdated,

              savingsUpdated,

              currentAddress:
                sms.address ??
                undefined,

              currentSmsId:
                sms.id !== undefined
                  ? String(
                      sms.id,
                    )
                  : undefined,
            });
          } catch (error) {
            failed += 1;

            const message =
              error instanceof Error
                ? error.message
                : String(error);

            console.error(
              "GEO-SHUA SMS: API request failed:",
              {
                smsId:
                  sms.id,

                address:
                  sms.address,

                error,

                message,
              },
            );

            nextResults.push({
              sms,

              error:
                message,
            });

            setStats({
              inbox:
                uniqueMessages.length,

              candidates:
                candidates.length,

              filtered:
                filteredCount,

              submitted,

              processed,

              duplicate,

              ignored,

              failed,

              loanUpdated,

              savingsUpdated,
            });
          }
        }

        /* =================================================
           STEP 5 — FINAL STATE
        ================================================= */

        const nextStats: ProcessStats = {
          inbox:
            uniqueMessages.length,

          candidates:
            candidates.length,

          filtered:
            filteredCount,

          submitted,

          processed,

          duplicate,

          ignored,

          failed,

          loanUpdated,

          savingsUpdated,
        };

        console.log(
          "=================================================",
        );

        console.log(
          "GEO-SHUA SMS: FOREGROUND PROCESSING COMPLETE",
        );

        console.log(
          nextStats,
        );

        console.log(
          "=================================================",
        );

        setStats(
          nextStats,
        );

        setResults(
          nextResults,
        );

        setLastSync(
          Date.now(),
        );

        setProgress({
          current:
            uniqueMessages.length,

          total:
            uniqueMessages.length,

          submitted,

          processed,

          duplicate,

          ignored,

          failed,

          loanUpdated,

          savingsUpdated,
        });

        if (failed > 0) {
          setStatus(
            "attention",
          );
        } else {
          setStatus(
            "synced",
          );
        }
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : String(error);

        console.error(
          "GEO-SHUA SMS: unexpected processing failure:",
          error,
        );

        setReaderError({
          message,

          raw:
            error,
        });

        setStatus(
          "error",
        );

        setStats((current) => ({
          ...current,

          failed:
            current.failed + 1,
        }));
      } finally {
        runningRef.current =
          false;

        console.log(
          "GEO-SHUA SMS: foreground inbox processing finished.",
        );
      }
    }, []);

  /* =======================================================
     AUTOMATIC APP-OPEN PROCESSING
  ======================================================= */

  useEffect(() => {
    if (
      !Capacitor.isNativePlatform()
    ) {
      return;
    }

    if (
      startupProcessedRef.current
    ) {
      return;
    }

    startupProcessedRef.current =
      true;

    console.log(
      "GEO-SHUA SMS: automatic app-open processing.",
    );

    void processInbox();
  }, [processInbox]);

  /* =======================================================
     PRESENTATION STATE
  ======================================================= */

  const hasReaderError =
    status === "error" &&
    readerError !== null;

  const hasAttention =
    status === "attention" ||
    status === "error";

  const isScanning =
    status === "scanning";

  /*
   * Visible administrator summary.
   */
  const scanSummary =
    isScanning
      ? `${progress?.current ?? 0} of ${progress?.total ?? stats.inbox}`
      : status === "synced"
        ? `${stats.loanUpdated} loan${stats.loanUpdated === 1 ? "" : "s"} updated · ${stats.savingsUpdated} saving${stats.savingsUpdated === 1 ? "" : "s"} updated · ${stats.filtered} didn't match filters`
        : hasReaderError
          ? "Unable to read Android SMS inbox"
          : hasAttention
            ? `${stats.failed} message${stats.failed === 1 ? "" : "s"} need attention`
            : "SMS payments are checked when the app opens";

  const latestResults =
    useMemo(
      () =>
        [...results]
          .sort(
            (a, b) =>
              b.sms.date -
              a.sms.date,
          )
          .slice(0, 10),
      [results],
    );

  /* =======================================================
     NON-NATIVE
  ======================================================= */

  if (
    typeof window !==
      "undefined" &&
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
        rounded-[24px]
        border border-slate-800/80
        bg-[#0b1118]
        px-3.5
        py-3.5
        shadow-[0_12px_40px_rgba(0,0,0,0.18)]
      "
    >
      {/* =================================================
          COMPACT HEADER
      ================================================= */}

      <div className="flex items-center gap-3">
        <div
          className="
            flex h-9 w-9 shrink-0
            items-center justify-center
            rounded-xl
            bg-blue-500/10
            text-blue-400
            ring-1 ring-blue-400/10
          "
        >
          {isScanning ? (
            <Loader2
              size={17}
              className="animate-spin"
            />
          ) : (
            <Smartphone
              size={17}
              strokeWidth={1.8}
            />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-[13px] font-semibold tracking-tight text-white">
              SMS Processing
            </h3>

            <span
              className={`
                h-1.5 w-1.5 rounded-full
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

          <p className="mt-0.5 truncate text-[10px] text-slate-500">
            {isScanning
              ? `Processing SMS ${scanSummary}`
              : scanSummary}
          </p>
        </div>

        {/* =================================================
            MANUAL PROCESS
        ================================================= */}

        <button
          type="button"
          onClick={() =>
            void processInbox()
          }
          disabled={isScanning}
          aria-label="Process SMS payments"
          title="Process SMS"
          className="
            flex h-8 w-8 shrink-0
            items-center justify-center
            rounded-xl
            border border-blue-500/25
            bg-blue-500/10
            text-blue-400
            transition
            hover:border-blue-400/40
            hover:bg-blue-500/15
            active:scale-[0.96]
            disabled:cursor-not-allowed
            disabled:opacity-40
          "
        >
          <RefreshCw
            size={13}
            className={
              isScanning
                ? "animate-spin"
                : ""
            }
          />
        </button>

        {/* =================================================
            DEVELOPER DIAGNOSTIC TOGGLE
        ================================================= */}

        <button
          type="button"
          onClick={() =>
            setExpanded(
              (value) => !value,
            )
          }
          aria-label={
            expanded
              ? "Hide SMS developer diagnostics"
              : "Show SMS developer diagnostics"
          }
          title="Developer diagnostics"
          className="
            flex h-8 w-8 shrink-0
            items-center justify-center
            rounded-xl
            border border-slate-800
            bg-slate-950/70
            text-slate-600
            transition
            hover:border-slate-700
            hover:bg-slate-900
            hover:text-blue-400
            active:scale-[0.96]
          "
        >
          <Bug size={13} />
        </button>
      </div>

      {/* =================================================
          LIVE PROCESSING AREA
      ================================================= */}

      {isScanning &&
        progress && (
          <div className="mt-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <Loader2
                  size={12}
                  className="shrink-0 animate-spin text-blue-400"
                />

                <span className="truncate text-[10px] text-slate-500">
                  Processing SMS{" "}
                  {progress.current} of{" "}
                  {progress.total}
                </span>
              </div>

              <span className="shrink-0 font-mono text-[10px] text-blue-400">
                {progress.total > 0
                  ? `${Math.round(
                      (progress.current /
                        progress.total) *
                        100,
                    )}%`
                  : "0%"}
              </span>
            </div>

            <div className="mt-2 h-1 overflow-hidden rounded-full bg-slate-900">
              <div
                className="
                  h-full
                  rounded-full
                  bg-blue-400
                  transition-all
                  duration-200
                "
                style={{
                  width:
                    progress.total > 0
                      ? `${Math.min(
                          100,
                          (progress.current /
                            progress.total) *
                            100,
                        )}%`
                      : "0%",
                }}
              />
            </div>

            {/* =============================================
                LIVE FINANCIAL COUNTERS
            ============================================= */}

            <div className="mt-2 flex items-center gap-3 text-[9px]">
              <span className="text-emerald-400">
                Loans{" "}
                {progress.loanUpdated}
              </span>

              <span className="text-blue-400">
                Savings{" "}
                {progress.savingsUpdated}
              </span>

              <span className="text-amber-400">
                Filtered{" "}
                {stats.filtered}
              </span>
            </div>
          </div>
        )}

      {/* =================================================
          COMPLETED SUMMARY
      ================================================= */}

      {status === "synced" && (
        <div
          className="
            mt-3
            rounded-2xl
            border border-slate-800/70
            bg-slate-950/50
            px-3
            py-2.5
          "
        >
          <div className="flex items-center gap-2">
            <CheckCircle2
              size={14}
              className="shrink-0 text-emerald-400"
            />

            <p className="text-[11px] font-medium text-slate-300">
              Processing complete
            </p>

            {lastSync && (
              <span className="ml-auto text-[9px] text-slate-700">
                {formatTime(lastSync)}
              </span>
            )}
          </div>

          <div className="mt-2 grid grid-cols-3 gap-1.5">
            <div
              className="
                rounded-xl
                bg-emerald-400/[0.04]
                px-2
                py-2
                text-center
              "
            >
              <p className="text-[8px] uppercase tracking-[0.08em] text-slate-600">
                Loans
              </p>

              <p className="mt-0.5 text-[15px] font-semibold text-emerald-400">
                {stats.loanUpdated}
              </p>

              <p className="text-[8px] text-slate-700">
                updated
              </p>
            </div>

            <div
              className="
                rounded-xl
                bg-blue-400/[0.04]
                px-2
                py-2
                text-center
              "
            >
              <p className="text-[8px] uppercase tracking-[0.08em] text-slate-600">
                Savings
              </p>

              <p className="mt-0.5 text-[15px] font-semibold text-blue-400">
                {stats.savingsUpdated}
              </p>

              <p className="text-[8px] text-slate-700">
                updated
              </p>
            </div>

            <div
              className="
                rounded-xl
                bg-amber-400/[0.04]
                px-2
                py-2
                text-center
              "
            >
              <p className="text-[8px] uppercase tracking-[0.08em] text-slate-600">
                Filters
              </p>

              <p className="mt-0.5 text-[15px] font-semibold text-amber-400">
                {stats.filtered}
              </p>

              <p className="text-[8px] text-slate-700">
                no match
              </p>
            </div>
          </div>
        </div>
      )}

      {/* =================================================
          ATTENTION
      ================================================= */}

      {hasAttention &&
        !hasReaderError && (
          <div
            className="
              mt-3
              flex items-center gap-2.5
              rounded-2xl
              border border-amber-400/15
              bg-amber-400/[0.03]
              px-3 py-2.5
            "
          >
            <TriangleAlert
              size={14}
              className="shrink-0 text-amber-400"
            />

            <div className="min-w-0">
              <p className="text-[10px] font-medium text-amber-300">
                Processing completed with attention
              </p>

              <p className="mt-0.5 text-[9px] text-slate-600">
                {stats.failed} message
                {stats.failed === 1
                  ? ""
                  : "s"} require
                developer review.
              </p>
            </div>
          </div>
        )}

      {/* =================================================
          NATIVE ERROR
      ================================================= */}

      {hasReaderError && (
        <div
          className="
            mt-3
            rounded-2xl
            border border-amber-400/20
            bg-amber-400/[0.04]
            px-3 py-2.5
          "
        >
          <div className="flex items-start gap-2.5">
            <XCircle
              size={15}
              className="mt-0.5 shrink-0 text-amber-400"
            />

            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-medium text-amber-300">
                Android SMS reader error
              </p>

              <p className="mt-1 break-words text-[10px] leading-4 text-slate-400">
                {readerError.message}
              </p>

              {readerError.code && (
                <p className="mt-1 font-mono text-[9px] text-amber-400">
                  {readerError.code}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* =================================================
          DEVELOPER DIAGNOSTICS
      ================================================= */}

      {expanded && (
        <div
          className="
            mt-3
            border-t border-slate-800/70
            pt-3
          "
        >
          {/* =================================================
              DIAGNOSTIC HEADER
          ================================================= */}

          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Bug
                size={13}
                className="text-blue-400"
              />

              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                  Developer diagnostics
                </p>

                <p className="mt-0.5 text-[9px] text-slate-700">
                  Full processing and API information
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() =>
                setExpanded(false)
              }
              className="
                flex h-7 w-7
                items-center justify-center
                rounded-lg
                bg-slate-900
                text-slate-600
                hover:text-slate-300
              "
            >
              <ChevronUp size={13} />
            </button>
          </div>

          {/* =================================================
              INTERNAL METRICS
          ================================================= */}

          <div className="mt-3 grid grid-cols-4 gap-1.5">
            <div className="rounded-xl bg-slate-950/60 px-2 py-2">
              <p className="text-[8px] text-slate-700">
                Inbox
              </p>

              <p className="mt-0.5 text-[12px] font-semibold text-slate-300">
                {stats.inbox}
              </p>
            </div>

            <div className="rounded-xl bg-slate-950/60 px-2 py-2">
              <p className="text-[8px] text-slate-700">
                Candidates
              </p>

              <p className="mt-0.5 text-[12px] font-semibold text-slate-300">
                {stats.candidates}
              </p>
            </div>

            <div className="rounded-xl bg-slate-950/60 px-2 py-2">
              <p className="text-[8px] text-slate-700">
                Submitted
              </p>

              <p className="mt-0.5 text-[12px] font-semibold text-slate-300">
                {stats.submitted}
              </p>
            </div>

            <div className="rounded-xl bg-slate-950/60 px-2 py-2">
              <p className="text-[8px] text-slate-700">
                Processed
              </p>

              <p className="mt-0.5 text-[12px] font-semibold text-emerald-400">
                {stats.processed}
              </p>
            </div>

            <div className="rounded-xl bg-slate-950/60 px-2 py-2">
              <p className="text-[8px] text-slate-700">
                Loans
              </p>

              <p className="mt-0.5 text-[12px] font-semibold text-emerald-400">
                {stats.loanUpdated}
              </p>
            </div>

            <div className="rounded-xl bg-slate-950/60 px-2 py-2">
              <p className="text-[8px] text-slate-700">
                Savings
              </p>

              <p className="mt-0.5 text-[12px] font-semibold text-blue-400">
                {stats.savingsUpdated}
              </p>
            </div>

            <div className="rounded-xl bg-slate-950/60 px-2 py-2">
              <p className="text-[8px] text-slate-700">
                Duplicate
              </p>

              <p className="mt-0.5 text-[12px] font-semibold text-slate-400">
                {stats.duplicate}
              </p>
            </div>

            <div className="rounded-xl bg-slate-950/60 px-2 py-2">
              <p className="text-[8px] text-slate-700">
                Failed
              </p>

              <p className="mt-0.5 text-[12px] font-semibold text-red-400">
                {stats.failed}
              </p>
            </div>
          </div>

          {/* =================================================
              FILTERED SMS
          ================================================= */}

          {filteredDiagnostics.length >
            0 && (
            <details className="mt-3">
              <summary
                className="
                  flex cursor-pointer
                  list-none
                  items-center
                  justify-between
                  rounded-xl
                  border border-slate-800/60
                  bg-slate-950/40
                  px-3 py-2
                "
              >
                <div className="flex items-center gap-2">
                  <Inbox
                    size={12}
                    className="text-amber-400"
                  />

                  <span className="text-[9px] text-slate-500">
                    Local filter diagnostics ·{" "}
                    {stats.filtered}
                  </span>
                </div>

                <ChevronDown
                  size={12}
                  className="text-slate-700"
                />
              </summary>

              <div className="mt-2 space-y-1.5">
                {filteredDiagnostics.map(
                  (
                    item,
                    index,
                  ) => (
                    <div
                      key={`${getLocalSmsKey(item.sms)}-filtered-${index}`}
                      className="
                        rounded-xl
                        border border-slate-800/50
                        bg-black/20
                        p-2.5
                      "
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="truncate text-[9px] text-slate-500">
                          {item.sms.address ||
                            "Unknown sender"}
                        </span>

                        <span className="shrink-0 text-[8px] text-slate-700">
                          {formatDate(
                            item.sms.date,
                          )}
                        </span>
                      </div>

                      <p className="mt-1 text-[9px] leading-4 text-slate-700">
                        {truncate(
                          item.sms.body,
                          120,
                        )}
                      </p>

                      <p className="mt-1 text-[8px] text-amber-500/60">
                        {item.reason}
                      </p>
                    </div>
                  ),
                )}

                {stats.filtered >
                  MAX_FILTERED_DIAGNOSTICS && (
                  <p className="px-1 text-[8px] text-slate-700">
                    Showing the first{" "}
                    {
                      MAX_FILTERED_DIAGNOSTICS
                    }{" "}
                    locally filtered messages.
                  </p>
                )}
              </div>
            </details>
          )}

          {/* =================================================
              RECENT API RESULTS
          ================================================= */}

          {latestResults.length >
            0 && (
            <div className="mt-3">
              <div className="mb-2 flex items-center gap-2">
                <FileSearch
                  size={12}
                  className="text-blue-400"
                />

                <p className="text-[9px] font-medium uppercase tracking-[0.12em] text-slate-600">
                  API results
                </p>
              </div>

              <div className="space-y-2">
                {latestResults.map(
                  (
                    item,
                    index,
                  ) => {
                    const resultKind =
                      getResultKind(
                        item,
                      );

                    const reason =
                      getResultReason(
                        item,
                      );

                    const apiReference =
                      getApiReference(
                        item.response,
                      );

                    const apiAmount =
                      getApiAmount(
                        item.response,
                      );

                    const apiDestinationAccount =
                      getApiDestinationAccountNumber(
                        item.response,
                      );

                    const apiSender =
                      getApiSenderName(
                        item.response,
                      );

                    const apiTransactionDate =
                      getApiTransactionDate(
                        item.response,
                      );

                    const apiLoan =
                      getApiLoan(
                        item.response,
                      );

                    const apiSavingsAccount =
                      getApiSavingsAccount(
                        item.response,
                      );

                    return (
                      <div
                        key={`${getLocalSmsKey(item.sms)}-${index}`}
                        className="
                          rounded-2xl
                          border border-slate-800/60
                          bg-slate-950/50
                          p-3
                        "
                      >
                        {/* =================================
                            RESULT HEADER
                        ================================= */}

                        <div className="flex items-start gap-2">
                          <div
                            className={`
                              flex h-7 w-7 shrink-0
                              items-center justify-center
                              rounded-lg
                              ${
                                resultKind ===
                                "processed"
                                  ? "bg-emerald-400/10 text-emerald-400"
                                  : resultKind ===
                                      "duplicate"
                                    ? "bg-blue-400/10 text-blue-400"
                                    : resultKind ===
                                        "ignored"
                                      ? "bg-amber-400/10 text-amber-400"
                                      : "bg-red-400/10 text-red-400"
                              }
                            `}
                          >
                            {resultKind ===
                            "processed" ? (
                              <CheckCircle2
                                size={13}
                              />
                            ) : resultKind ===
                              "duplicate" ? (
                              <ShieldCheck
                                size={13}
                              />
                            ) : resultKind ===
                              "ignored" ? (
                              <TriangleAlert
                                size={13}
                              />
                            ) : (
                              <XCircle
                                size={13}
                              />
                            )}
                          </div>

                          <div className="min-w-0 flex-1">
                            <div className="flex items-start justify-between gap-2">
                              <p className="truncate text-[10px] font-medium text-slate-400">
                                {item.sms.address ||
                                  "Payment message"}
                              </p>

                              <span className="shrink-0 text-[8px] text-slate-700">
                                {formatDate(
                                  item.sms.date,
                                )}{" "}
                                {formatTime(
                                  item.sms.date,
                                )}
                              </span>
                            </div>

                            <div className="mt-1.5 flex flex-wrap gap-1.5">
                              <span
                                className={`
                                  rounded-md
                                  px-1.5
                                  py-0.5
                                  text-[8px]
                                  font-medium
                                  ${
                                    resultKind ===
                                    "processed"
                                      ? "bg-emerald-400/10 text-emerald-400"
                                      : resultKind ===
                                          "duplicate"
                                        ? "bg-blue-400/10 text-blue-400"
                                        : resultKind ===
                                            "ignored"
                                          ? "bg-amber-400/10 text-amber-400"
                                          : "bg-red-400/10 text-red-400"
                                  }
                                `}
                              >
                                {getResultLabel(
                                  item,
                                )}
                              </span>

                              {item.httpStatus !==
                                undefined && (
                                <span className="rounded-md bg-slate-900 px-1.5 py-0.5 font-mono text-[8px] text-slate-600">
                                  HTTP{" "}
                                  {
                                    item.httpStatus
                                  }
                                </span>
                              )}

                              {item.financialChange && (
                                <span className="rounded-md bg-blue-400/10 px-1.5 py-0.5 text-[8px] text-blue-400">
                                  Account updated
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* =================================
                            SERVER REASON
                        ================================= */}

                        {reason && (
                          <div
                            className="
                              mt-2
                              rounded-xl
                              border border-slate-800/60
                              bg-black/20
                              px-2.5
                              py-2
                            "
                          >
                            <div className="flex items-start gap-2">
                              <AlertCircle
                                size={11}
                                className={`
                                  mt-0.5
                                  shrink-0
                                  ${
                                    resultKind ===
                                    "ignored"
                                      ? "text-amber-400"
                                      : "text-red-400"
                                  }
                                `}
                              />

                              <p className="break-words text-[9px] leading-4 text-slate-500">
                                {reason}
                              </p>
                            </div>
                          </div>
                        )}

                        {/* =================================
                            PARSED DATA
                        ================================= */}

                        {(apiReference ||
                          apiAmount ||
                          apiDestinationAccount ||
                          apiSender ||
                          apiTransactionDate) && (
                          <div className="mt-2">
                            <p className="mb-1 text-[8px] uppercase tracking-[0.1em] text-slate-700">
                              Parsed
                            </p>

                            <div className="space-y-1 rounded-xl bg-black/20 p-2">
                              {apiReference && (
                                <div className="flex justify-between gap-3">
                                  <span className="text-[8px] text-slate-700">
                                    Reference
                                  </span>

                                  <span className="break-all text-right font-mono text-[8px] text-blue-400">
                                    {
                                      apiReference
                                    }
                                  </span>
                                </div>
                              )}

                              {apiAmount && (
                                <div className="flex justify-between gap-3">
                                  <span className="text-[8px] text-slate-700">
                                    Amount
                                  </span>

                                  <span className="font-mono text-[8px] text-slate-400">
                                    KES{" "}
                                    {
                                      apiAmount
                                    }
                                  </span>
                                </div>
                              )}

                              {apiDestinationAccount && (
                                <div className="flex justify-between gap-3">
                                  <span className="text-[8px] text-slate-700">
                                    Bank destination
                                  </span>

                                  <span className="font-mono text-[8px] text-slate-400">
                                    {
                                      apiDestinationAccount
                                    }
                                  </span>
                                </div>
                              )}

                              {apiSender && (
                                <div className="flex justify-between gap-3">
                                  <span className="text-[8px] text-slate-700">
                                    Sender
                                  </span>

                                  <span className="max-w-[65%] text-right text-[8px] text-slate-400">
                                    {
                                      apiSender
                                    }
                                  </span>
                                </div>
                              )}

                              {apiTransactionDate && (
                                <div className="flex justify-between gap-3">
                                  <span className="text-[8px] text-slate-700">
                                    Transaction date
                                  </span>

                                  <span className="max-w-[65%] break-all text-right font-mono text-[8px] text-slate-400">
                                    {
                                      apiTransactionDate
                                    }
                                  </span>
                                </div>
                              )}
                            </div>
                          </div>
                        )}

                        {/* =================================
                            LOAN
                        ================================= */}

                        {apiLoan && (
                          <details className="mt-2">
                            <summary className="cursor-pointer text-[8px] text-slate-600">
                              Show loan response
                            </summary>

                            <pre
                              className="
                                mt-1
                                max-h-48
                                overflow-auto
                                whitespace-pre-wrap
                                break-words
                                rounded-xl
                                bg-black/30
                                p-2
                                text-[8px]
                                leading-4
                                text-slate-600
                              "
                            >
                              {serializeValue(
                                apiLoan,
                              )}
                            </pre>
                          </details>
                        )}

                        {/* =================================
                            SAVINGS
                        ================================= */}

                        {apiSavingsAccount && (
                          <details className="mt-2">
                            <summary className="cursor-pointer text-[8px] text-slate-600">
                              Show savings response
                            </summary>

                            <pre
                              className="
                                mt-1
                                max-h-48
                                overflow-auto
                                whitespace-pre-wrap
                                break-words
                                rounded-xl
                                bg-black/30
                                p-2
                                text-[8px]
                                leading-4
                                text-slate-600
                              "
                            >
                              {serializeValue(
                                apiSavingsAccount,
                              )}
                            </pre>
                          </details>
                        )}

                        {/* =================================
                            FULL API DIAGNOSTIC
                        ================================= */}

                        <details className="mt-2">
                          <summary
                            className="
                              flex cursor-pointer
                              items-center gap-2
                              text-[8px]
                              font-medium
                              uppercase
                              tracking-[0.1em]
                              text-blue-400/70
                            "
                          >
                            <FileSearch
                              size={10}
                            />

                            Show full API response
                          </summary>

                          <div className="mt-2 space-y-2">
                            <div>
                              <p className="mb-1 text-[7px] uppercase tracking-[0.1em] text-slate-700">
                                Endpoint
                              </p>

                              <p className="rounded-lg bg-black/30 p-2 font-mono text-[8px] text-slate-600">
                                POST{" "}
                                {
                                  PROCESS_URL
                                }
                              </p>
                            </div>

                            <div>
                              <p className="mb-1 text-[7px] uppercase tracking-[0.1em] text-slate-700">
                                HTTP status
                              </p>

                              <p className="rounded-lg bg-black/30 p-2 font-mono text-[8px] text-slate-600">
                                {item.httpStatus ??
                                  "No response"}
                              </p>
                            </div>

                            <div>
                              <p className="mb-1 text-[7px] uppercase tracking-[0.1em] text-slate-700">
                                Full server response
                              </p>

                              <pre
                                className="
                                  max-h-72
                                  overflow-auto
                                  whitespace-pre-wrap
                                  break-words
                                  rounded-xl
                                  bg-black/40
                                  p-2
                                  text-[8px]
                                  leading-4
                                  text-slate-600
                                "
                              >
                                {serializeValue(
                                  item.response,
                                )}
                              </pre>
                            </div>

                            <div>
                              <p className="mb-1 text-[7px] uppercase tracking-[0.1em] text-slate-700">
                                Raw Android SMS
                              </p>

                              <pre
                                className="
                                  max-h-48
                                  overflow-auto
                                  whitespace-pre-wrap
                                  break-words
                                  rounded-xl
                                  bg-black/40
                                  p-2
                                  text-[8px]
                                  leading-4
                                  text-slate-600
                                "
                              >
                                {serializeValue(
                                  {
                                    id:
                                      item
                                        .sms
                                        .id,

                                    address:
                                      item
                                        .sms
                                        .address,

                                    date:
                                      item
                                        .sms
                                        .date,

                                    dateFormatted:
                                      formatFullDateTime(
                                        item
                                          .sms
                                          .date,
                                      ),

                                    body:
                                      item
                                        .sms
                                        .body,
                                  },
                                )}
                              </pre>
                            </div>

                            <div>
                              <p className="mb-1 text-[7px] uppercase tracking-[0.1em] text-slate-700">
                                API request payload
                              </p>

                              <pre
                                className="
                                  max-h-48
                                  overflow-auto
                                  whitespace-pre-wrap
                                  break-words
                                  rounded-xl
                                  bg-black/40
                                  p-2
                                  text-[8px]
                                  leading-4
                                  text-slate-600
                                "
                              >
                                {serializeValue(
                                  {
                                    smsId:
                                      item
                                        .sms
                                        .id,

                                    address:
                                      item
                                        .sms
                                        .address,

                                    body:
                                      item
                                        .sms
                                        .body,

                                    date:
                                      item
                                        .sms
                                        .date,
                                  },
                                )}
                              </pre>
                            </div>
                          </div>
                        </details>
                      </div>
                    );
                  },
                )}
              </div>
            </div>
          )}

          {/* =================================================
              NATIVE DIAGNOSTIC
          ================================================= */}

          {readerError && (
            <details className="mt-3">
              <summary className="cursor-pointer text-[8px] text-slate-600">
                Show raw native diagnostic
              </summary>

              <pre
                className="
                  mt-2
                  max-h-48
                  overflow-auto
                  whitespace-pre-wrap
                  break-words
                  rounded-xl
                  bg-black/40
                  p-2.5
                  text-[8px]
                  leading-4
                  text-slate-600
                "
              >
                {serializeValue(
                  readerError,
                )}
              </pre>
            </details>
          )}

          {/* =================================================
              NO API RESULTS
          ================================================= */}

          {results.length === 0 &&
            status === "synced" && (
              <div
                className="
                  mt-3
                  rounded-xl
                  border border-slate-800/50
                  bg-black/20
                  px-3 py-3
                  text-center
                "
              >
                <Inbox
                  size={15}
                  className="mx-auto text-slate-700"
                />

                <p className="mt-1.5 text-[9px] text-slate-600">
                  No candidate SMS reached the API.
                </p>
              </div>
            )}
        </div>
      )}

      {/* =================================================
          COLLAPSED DEVELOPER HINT
      ================================================= */}

      {!expanded && (
        <div className="mt-2 flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-slate-700">
            <ShieldCheck size={10} />

            <span className="text-[8px]">
              Foreground only
            </span>
          </div>

          <button
            type="button"
            onClick={() =>
              setExpanded(true)
            }
            className="
              flex items-center gap-1
              text-[8px]
              text-slate-700
              transition
              hover:text-blue-400
            "
          >
            <Bug size={9} />

            Diagnostics

            <ChevronDown size={9} />
          </button>
        </div>
      )}
    </section>
  );
}
