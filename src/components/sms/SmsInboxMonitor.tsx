"use client";

import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleDollarSign,
  FileSearch,
  Inbox,
  Info,
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
 * Maximum number of locally filtered messages retained
 * for diagnostics during one scan.
 *
 * We do not send these messages to the server.
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
 * This protects only the current foreground run.
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

function getBoolean(
  value: unknown,
): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }

  return undefined;
}

/* =========================================================
   API DIAGNOSTIC HELPERS
========================================================= */

/*
 * Searches the API response for a useful human-readable
 * explanation.
 *
 * This intentionally supports several possible response
 * shapes because different API stages may expose their
 * diagnostic under different keys.
 */
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
        getString(
          diagnostic[key],
        );

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

  return undefined;
}

/*
 * Extract a likely reference from whatever API object
 * the server returns.
 */
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

/*
 * Extract amount from API response.
 */
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

/*
 * Extract account number.
 */
function getApiAccountNumber(
  value: unknown,
): string | undefined {
  const root =
    toRecord(value);

  if (!root) {
    return undefined;
  }

  const direct =
    getString(root.accountNumber);

  if (direct) {
    return direct;
  }

  const parsed =
    toRecord(root.parsed);

  if (parsed) {
    const account =
      getString(
        parsed.accountNumber,
      );

    if (account) {
      return account;
    }
  }

  return undefined;
}

/*
 * Extract sender/member name.
 */
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

/*
 * Extract transaction date returned by parser/API.
 */
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
  }

  return undefined;
}

/*
 * Extract loan information.
 */
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

/*
 * Extract savings account information.
 */
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

/*
 * Safely serializes API/native diagnostic objects.
 */
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
   RESULT PRESENTATION HELPERS
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
    });

  const [results, setResults] =
    useState<ProcessResult[]>([]);

  const [filteredDiagnostics, setFilteredDiagnostics] =
    useState<FilteredDiagnostic[]>([]);

  const [lastSync, setLastSync] =
    useState<number | null>(null);

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

        console.log(
          "GEO-SHUA SMS: candidates:",
          candidates.length,
        );

        console.log(
          "GEO-SHUA SMS: locally filtered:",
          uniqueMessages.length -
            candidates.length,
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
            uniqueMessages.length -
            candidates.length,

          submitted: 0,

          processed: 0,

          duplicate: 0,

          ignored: 0,

          failed: 0,
        };

        setStats(
          initialStats,
        );

        setProgress({
          current: 0,
          total: candidates.length,
          submitted: 0,
          processed: 0,
          duplicate: 0,
          ignored: 0,
          failed: 0,
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

        for (
          let index = 0;
          index < candidates.length;
          index += 1
        ) {
          const sms =
            candidates[index];

          const currentNumber =
            index + 1;

          setProgress({
            current:
              currentNumber,

            total:
              candidates.length,

            submitted,

            processed,

            duplicate,

            ignored,

            failed,

            currentAddress:
              sms.address ??
              undefined,

            currentSmsId:
              sms.id !== undefined
                ? String(sms.id)
                : undefined,
          });

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
                date: sms.date,
              },
            );

            setStats({
              inbox:
                uniqueMessages.length,

              candidates:
                candidates.length,

              filtered:
                uniqueMessages.length -
                candidates.length,

              submitted,

              processed,

              duplicate,

              ignored,

              failed,
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
              number: currentNumber,
              total:
                candidates.length,
              id: sms.id,
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

            const apiAccount =
              getApiAccountNumber(
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

                accountNumber:
                  apiAccount,

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
                uniqueMessages.length -
                candidates.length,

              submitted,

              processed,

              duplicate,

              ignored,

              failed,
            });

            setProgress({
              current:
                currentNumber,

              total:
                candidates.length,

              submitted,

              processed,

              duplicate,

              ignored,

              failed,

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
                uniqueMessages.length -
                candidates.length,

              submitted,

              processed,

              duplicate,

              ignored,

              failed,
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
            uniqueMessages.length -
            candidates.length,

          submitted,

          processed,

          duplicate,

          ignored,

          failed,
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
            candidates.length,

          total:
            candidates.length,

          submitted,

          processed,

          duplicate,

          ignored,

          failed,
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
     PRESENTATION
  ======================================================= */

  const hasReaderError =
    status === "error" &&
    readerError !== null;

  const hasAttention =
    status === "attention" ||
    status === "error";

  const isScanning =
    status === "scanning";

  const statusLabel =
    isScanning
      ? "Processing messages…"
      : hasReaderError
        ? "SMS reader unavailable"
        : hasAttention
          ? "Needs attention"
          : status === "synced"
            ? "Processing complete"
            : "Ready";

  const statusDescription =
    isScanning
      ? progress
        ? `Processing ${progress.current} of ${progress.total} candidates`
        : "Reading the Android inbox…"
      : hasReaderError
        ? "Android could not read the SMS inbox"
        : hasAttention
          ? `${stats.failed} message${stats.failed === 1 ? "" : "s"} need attention`
          : status === "synced"
            ? stats.processed > 0
              ? `${stats.processed} payment${stats.processed === 1 ? "" : "s"} processed`
              : stats.duplicate > 0
                ? "Payments already synchronized"
                : stats.ignored > 0
                  ? `${stats.ignored} message${stats.ignored === 1 ? "" : "s"} ignored`
                  : "Inbox checked"
            : "SMS payments are checked when the app opens";

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
        rounded-[28px]
        border
        border-slate-800/80
        bg-[#0b1118]
        px-4
        py-4
        shadow-[0_12px_40px_rgba(0,0,0,0.18)]
      "
    >
      {/* =================================================
          HEADER
      ================================================= */}

      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div
            className="
              flex h-11 w-11 shrink-0
              items-center justify-center
              rounded-2xl
              bg-blue-500/10
              text-blue-400
              ring-1 ring-blue-400/10
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

            <p className="mt-0.5 text-[12px] text-slate-500">
              App-open foreground processing
            </p>
          </div>
        </div>

        {/* =================================================
            MANUAL BUTTON
        ================================================= */}

        <button
          type="button"
          onClick={() =>
            void processInbox()
          }
          disabled={isScanning}
          aria-label="Process SMS payments"
          className="
            flex h-9 shrink-0
            items-center gap-1.5
            rounded-xl
            border border-blue-500/30
            bg-blue-500/10
            px-3
            text-[11px]
            font-medium
            text-blue-400
            transition
            hover:border-blue-400/50
            hover:bg-blue-500/15
            hover:text-blue-300
            active:scale-[0.98]
            disabled:cursor-not-allowed
            disabled:opacity-50
          "
        >
          <RefreshCw
            size={14}
            className={
              isScanning
                ? "animate-spin"
                : ""
            }
          />

          <span>
            {isScanning
              ? "Processing"
              : "Process SMS"}
          </span>
        </button>
      </div>

      {/* =================================================
          STATUS
      ================================================= */}

      <div
        className="
          mt-4 flex items-center justify-between
          rounded-2xl
          border border-slate-800/80
          bg-slate-950/60
          px-3.5 py-3
        "
      >
        <div className="flex min-w-0 items-center gap-2.5">
          <div
            className={`
              flex h-8 w-8 shrink-0
              items-center justify-center
              rounded-xl
              ${
                hasAttention
                  ? "bg-amber-400/10 text-amber-400"
                  : isScanning
                    ? "bg-blue-400/10 text-blue-400"
                    : "bg-emerald-400/10 text-emerald-400"
              }
            `}
          >
            {hasAttention ? (
              <TriangleAlert size={16} />
            ) : isScanning ? (
              <Loader2
                size={16}
                className="animate-spin"
              />
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

      {/* =================================================
          LIVE PROGRESS
      ================================================= */}

      {isScanning &&
        progress && (
          <div
            className="
              mt-3
              rounded-2xl
              border border-blue-400/10
              bg-blue-400/[0.03]
              px-3.5 py-3
            "
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <Loader2
                  size={13}
                  className="shrink-0 animate-spin text-blue-400"
                />

                <span className="truncate text-[10px] text-slate-400">
                  {progress.currentAddress ||
                    "Processing SMS"}
                </span>
              </div>

              <span className="shrink-0 font-mono text-[10px] text-blue-400">
                {progress.current}/
                {progress.total}
              </span>
            </div>

            <div className="mt-2 h-1 overflow-hidden rounded-full bg-slate-900">
              <div
                className="
                  h-full
                  rounded-full
                  bg-blue-400
                  transition-all
                  duration-300
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

            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[9px] text-slate-600">
              <span>
                Submitted{" "}
                {progress.submitted}
              </span>

              <span>
                Processed{" "}
                {progress.processed}
              </span>

              <span>
                Duplicate{" "}
                {progress.duplicate}
              </span>

              <span>
                Ignored{" "}
                {progress.ignored}
              </span>

              <span>
                Failed{" "}
                {progress.failed}
              </span>
            </div>
          </div>
        )}

      {/* =================================================
          NATIVE ERROR
      ================================================= */}

      {hasReaderError && (
        <div
          className="
            mt-3 rounded-2xl
            border border-amber-400/20
            bg-amber-400/[0.04]
            px-3.5 py-3
          "
        >
          <div className="flex items-start gap-2.5">
            <div
              className="
                flex h-8 w-8 shrink-0
                items-center justify-center
                rounded-xl
                bg-amber-400/10
                text-amber-400
              "
            >
              <XCircle size={16} />
            </div>

            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-medium text-amber-300">
                Android SMS reader error
              </p>

              <p className="mt-1 break-words text-[11px] leading-4 text-slate-300">
                {readerError.message}
              </p>

              {readerError.code && (
                <div className="mt-2">
                  <p className="text-[9px] uppercase tracking-[0.12em] text-slate-600">
                    Error code
                  </p>

                  <p className="mt-0.5 break-all font-mono text-[10px] text-amber-400">
                    {readerError.code}
                  </p>
                </div>
              )}

              {readerError.data !==
                undefined && (
                <div className="mt-2">
                  <p className="text-[9px] uppercase tracking-[0.12em] text-slate-600">
                    Native diagnostic
                  </p>

                  <pre
                    className="
                      mt-1 max-h-40 overflow-auto
                      whitespace-pre-wrap break-words
                      rounded-xl
                      bg-black/40
                      p-2
                      text-[9px]
                      leading-4
                      text-slate-500
                    "
                  >
                    {serializeValue(
                      readerError.data,
                    )}
                  </pre>
                </div>
              )}

              <details className="mt-2">
                <summary className="cursor-pointer text-[9px] text-slate-600">
                  Show raw native error
                </summary>

                <pre
                  className="
                    mt-1 max-h-40 overflow-auto
                    whitespace-pre-wrap break-words
                    rounded-xl
                    bg-black/40
                    p-2
                    text-[9px]
                    leading-4
                    text-slate-600
                  "
                >
                  {serializeValue(
                    readerError.raw,
                  )}
                </pre>
              </details>
            </div>
          </div>
        </div>
      )}

      {/* =================================================
          METRICS
      ================================================= */}

      <div className="mt-3 grid grid-cols-3 gap-2">
        {/* INBOX */}

        <div className="rounded-2xl bg-slate-950/45 px-3 py-2.5">
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

        {/* CANDIDATES */}

        <div className="rounded-2xl bg-slate-950/45 px-3 py-2.5">
          <div className="flex items-center gap-1.5 text-slate-500">
            <FileSearch size={12} />

            <span className="text-[10px]">
              Candidates
            </span>
          </div>

          <p className="mt-1 text-base font-semibold tracking-tight text-white">
            {stats.candidates}
          </p>
        </div>

        {/* SUBMITTED */}

        <div className="rounded-2xl bg-slate-950/45 px-3 py-2.5">
          <div className="flex items-center gap-1.5 text-slate-500">
            <CircleDollarSign size={12} />

            <span className="text-[10px]">
              Submitted
            </span>
          </div>

          <p className="mt-1 text-base font-semibold tracking-tight text-white">
            {stats.submitted}
          </p>
        </div>

        {/* PROCESSED */}

        <div className="rounded-2xl bg-slate-950/45 px-3 py-2.5">
          <div className="flex items-center gap-1.5 text-emerald-500/70">
            <CheckCircle2 size={12} />

            <span className="text-[10px]">
              Processed
            </span>
          </div>

          <p className="mt-1 text-base font-semibold tracking-tight text-white">
            {stats.processed}
          </p>
        </div>

        {/* IGNORED */}

        <div className="rounded-2xl bg-slate-950/45 px-3 py-2.5">
          <div className="flex items-center gap-1.5 text-amber-500/70">
            <TriangleAlert size={12} />

            <span className="text-[10px]">
              Ignored
            </span>
          </div>

          <p className="mt-1 text-base font-semibold tracking-tight text-white">
            {stats.ignored}
          </p>
        </div>

        {/* FAILED */}

        <div className="rounded-2xl bg-slate-950/45 px-3 py-2.5">
          <div className="flex items-center gap-1.5 text-red-500/70">
            <XCircle size={12} />

            <span className="text-[10px]">
              Failed
            </span>
          </div>

          <p className="mt-1 text-base font-semibold tracking-tight text-white">
            {stats.failed}
          </p>
        </div>
      </div>

      {/* =================================================
          FILTER DIAGNOSTIC
      ================================================= */}

      {filteredDiagnostics.length >
        0 && (
        <details className="mt-3">
          <summary
            className="
              flex cursor-pointer
              list-none items-center justify-between
              rounded-2xl
              border border-slate-800/70
              bg-slate-950/40
              px-3 py-2.5
            "
          >
            <div className="flex items-center gap-2">
              <Info
                size={13}
                className="text-slate-500"
              />

              <div>
                <p className="text-[10px] font-medium text-slate-400">
                  Local filtering
                </p>

                <p className="text-[9px] text-slate-600">
                  {stats.filtered} message
                  {stats.filtered === 1
                    ? ""
                    : "s"} did not reach the API
                </p>
              </div>
            </div>

            <ChevronDown
              size={14}
              className="text-slate-600"
            />
          </summary>

          <div className="mt-2 space-y-2">
            {filteredDiagnostics.map(
              (item, index) => (
                <div
                  key={`${getLocalSmsKey(item.sms)}-filtered-${index}`}
                  className="
                    rounded-2xl
                    border border-slate-800/60
                    bg-black/20
                    p-3
                  "
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="truncate text-[10px] font-medium text-slate-400">
                      {item.sms.address ||
                        "Unknown sender"}
                    </span>

                    <span className="shrink-0 text-[9px] text-slate-600">
                      {formatDate(
                        item.sms.date,
                      )}
                    </span>
                  </div>

                  <p className="mt-1 text-[10px] leading-4 text-slate-600">
                    {truncate(
                      item.sms.body,
                      120,
                    )}
                  </p>

                  <p className="mt-1.5 text-[9px] text-amber-500/60">
                    {item.reason}
                  </p>
                </div>
              ),
            )}

            {stats.filtered >
              MAX_FILTERED_DIAGNOSTICS && (
              <p className="px-1 text-[9px] text-slate-700">
                Showing the first{" "}
                {MAX_FILTERED_DIAGNOSTICS}{" "}
                locally filtered messages.
              </p>
            )}
          </div>
        </details>
      )}

      {/* =================================================
          RECENT ACTIVITY
      ================================================= */}

      {latestResults.length > 0 && (
        <div className="mt-4">
          <button
            type="button"
            onClick={() =>
              setExpanded(
                (value) => !value,
              )
            }
            className="flex w-full items-center justify-between text-left"
          >
            <div>
              <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-slate-600">
                Recent activity
              </p>

              <p className="mt-1 text-[12px] text-slate-400">
                Detailed API processing results
              </p>
            </div>

            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-slate-900 text-slate-500">
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

                  const apiAccount =
                    getApiAccountNumber(
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
                        border border-slate-800/70
                        bg-slate-950/50
                        px-3 py-3
                      "
                    >
                      {/* =================================
                          MESSAGE HEADER
                      ================================= */}

                      <div className="flex items-start gap-2.5">
                        <div
                          className={`
                            mt-0.5 flex h-7 w-7 shrink-0
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
                              size={14}
                            />
                          ) : resultKind ===
                            "duplicate" ? (
                            <ShieldCheck
                              size={14}
                            />
                          ) : resultKind ===
                            "ignored" ? (
                            <TriangleAlert
                              size={14}
                            />
                          ) : (
                            <XCircle
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
                                item.sms.date,
                              )}{" "}
                              {formatTime(
                                item.sms.date,
                              )}
                            </span>
                          </div>

                          {/* =================================
                              RESULT BADGE
                          ================================= */}

                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <span
                              className={`
                                rounded-md px-1.5 py-0.5
                                text-[9px] font-medium
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
                              <span className="rounded-md bg-slate-900 px-1.5 py-0.5 font-mono text-[9px] text-slate-500">
                                HTTP{" "}
                                {
                                  item.httpStatus
                                }
                              </span>
                            )}

                            {item.financialChange && (
                              <span className="rounded-md bg-blue-400/10 px-1.5 py-0.5 text-[9px] text-blue-400">
                                Account updated
                              </span>
                            )}
                          </div>

                          {/* =================================
                              SMS BODY
                          ================================= */}

                          <p className="mt-2 text-[11px] leading-4 text-slate-500">
                            {truncate(
                              item.sms.body,
                              180,
                            )}
                          </p>

                          {/* =================================
                              WHY IT WAS IGNORED / FAILED
                          ================================= */}

                          {reason && (
                            <div
                              className={`
                                mt-2
                                rounded-xl
                                border
                                px-2.5 py-2
                                ${
                                  resultKind ===
                                  "ignored"
                                    ? "border-amber-400/10 bg-amber-400/[0.03]"
                                    : "border-red-400/10 bg-red-400/[0.03]"
                                }
                              `}
                            >
                              <div className="flex items-start gap-2">
                                <AlertCircle
                                  size={12}
                                  className={`
                                    mt-0.5 shrink-0
                                    ${
                                      resultKind ===
                                      "ignored"
                                        ? "text-amber-400"
                                        : "text-red-400"
                                    }
                                  `}
                                />

                                <div className="min-w-0">
                                  <p className="text-[9px] uppercase tracking-[0.1em] text-slate-600">
                                    Server decision
                                  </p>

                                  <p className="mt-0.5 break-words text-[10px] leading-4 text-slate-400">
                                    {reason}
                                  </p>
                                </div>
                              </div>
                            </div>
                          )}

                          {/* =================================
                              API SUMMARY
                          ================================= */}

                          <div className="mt-3 grid grid-cols-2 gap-1.5">
                            <div className="rounded-lg bg-black/20 px-2 py-1.5">
                              <p className="text-[8px] uppercase tracking-[0.1em] text-slate-700">
                                API status
                              </p>

                              <p className="mt-0.5 truncate text-[9px] text-slate-400">
                                {item.status ||
                                  "—"}
                              </p>
                            </div>

                            <div className="rounded-lg bg-black/20 px-2 py-1.5">
                              <p className="text-[8px] uppercase tracking-[0.1em] text-slate-700">
                                Type
                              </p>

                              <p className="mt-0.5 truncate text-[9px] text-slate-400">
                                {item.type ||
                                  "—"}
                              </p>
                            </div>

                            <div className="rounded-lg bg-black/20 px-2 py-1.5">
                              <p className="text-[8px] uppercase tracking-[0.1em] text-slate-700">
                                Processed
                              </p>

                              <p className="mt-0.5 text-[9px] text-slate-400">
                                {item.processed
                                  ? "true"
                                  : "false"}
                              </p>
                            </div>

                            <div className="rounded-lg bg-black/20 px-2 py-1.5">
                              <p className="text-[8px] uppercase tracking-[0.1em] text-slate-700">
                                Ignored
                              </p>

                              <p className="mt-0.5 text-[9px] text-slate-400">
                                {item.ignored
                                  ? "true"
                                  : "false"}
                              </p>
                            </div>

                            <div className="rounded-lg bg-black/20 px-2 py-1.5">
                              <p className="text-[8px] uppercase tracking-[0.1em] text-slate-700">
                                Duplicate
                              </p>

                              <p className="mt-0.5 text-[9px] text-slate-400">
                                {item.duplicate
                                  ? "true"
                                  : "false"}
                              </p>
                            </div>

                            <div className="rounded-lg bg-black/20 px-2 py-1.5">
                              <p className="text-[8px] uppercase tracking-[0.1em] text-slate-700">
                                Financial change
                              </p>

                              <p className="mt-0.5 text-[9px] text-slate-400">
                                {item.financialChange
                                  ? "true"
                                  : "false"}
                              </p>
                            </div>
                          </div>

                          {/* =================================
                              PARSED INFORMATION
                          ================================= */}

                          {(apiReference ||
                            apiAmount ||
                            apiAccount ||
                            apiSender ||
                            apiTransactionDate) && (
                            <div className="mt-3">
                              <p className="mb-1.5 text-[9px] font-medium uppercase tracking-[0.12em] text-slate-600">
                                Parsed transaction
                              </p>

                              <div className="space-y-1 rounded-xl border border-slate-800/50 bg-black/20 p-2.5">
                                {apiReference && (
                                  <div className="flex items-start justify-between gap-3">
                                    <span className="text-[9px] text-slate-600">
                                      Reference
                                    </span>

                                    <span className="break-all text-right font-mono text-[9px] text-blue-400">
                                      {
                                        apiReference
                                      }
                                    </span>
                                  </div>
                                )}

                                {apiAmount && (
                                  <div className="flex items-start justify-between gap-3">
                                    <span className="text-[9px] text-slate-600">
                                      Amount
                                    </span>

                                    <span className="text-right font-mono text-[9px] text-slate-300">
                                      KES{" "}
                                      {
                                        apiAmount
                                      }
                                    </span>
                                  </div>
                                )}

                                {apiAccount && (
                                  <div className="flex items-start justify-between gap-3">
                                    <span className="text-[9px] text-slate-600">
                                      Account
                                    </span>

                                    <span className="text-right font-mono text-[9px] text-slate-300">
                                      {
                                        apiAccount
                                      }
                                    </span>
                                  </div>
                                )}

                                {apiSender && (
                                  <div className="flex items-start justify-between gap-3">
                                    <span className="text-[9px] text-slate-600">
                                      Sender
                                    </span>

                                    <span className="max-w-[65%] text-right text-[9px] text-slate-300">
                                      {
                                        apiSender
                                      }
                                    </span>
                                  </div>
                                )}

                                {apiTransactionDate && (
                                  <div className="flex items-start justify-between gap-3">
                                    <span className="text-[9px] text-slate-600">
                                      Transaction date
                                    </span>

                                    <span className="max-w-[65%] break-all text-right font-mono text-[9px] text-slate-300">
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
                              LOAN INFORMATION
                          ================================= */}

                          {apiLoan && (
                            <div className="mt-3">
                              <p className="mb-1.5 text-[9px] font-medium uppercase tracking-[0.12em] text-slate-600">
                                Loan returned by API
                              </p>

                              <pre
                                className="
                                  max-h-48 overflow-auto
                                  whitespace-pre-wrap break-words
                                  rounded-xl
                                  border border-slate-800/50
                                  bg-black/30
                                  p-2.5
                                  text-[9px]
                                  leading-4
                                  text-slate-500
                                "
                              >
                                {serializeValue(
                                  apiLoan,
                                )}
                              </pre>
                            </div>
                          )}

                          {/* =================================
                              SAVINGS INFORMATION
                          ================================= */}

                          {apiSavingsAccount && (
                            <div className="mt-3">
                              <p className="mb-1.5 text-[9px] font-medium uppercase tracking-[0.12em] text-slate-600">
                                Savings account returned by API
                              </p>

                              <pre
                                className="
                                  max-h-48 overflow-auto
                                  whitespace-pre-wrap break-words
                                  rounded-xl
                                  border border-slate-800/50
                                  bg-black/30
                                  p-2.5
                                  text-[9px]
                                  leading-4
                                  text-slate-500
                                "
                              >
                                {serializeValue(
                                  apiSavingsAccount,
                                )}
                              </pre>
                            </div>
                          )}

                          {/* =================================
                              RAW API RESPONSE
                          ================================= */}

                          <details className="mt-3">
                            <summary
                              className="
                                flex cursor-pointer
                                items-center gap-2
                                text-[9px]
                                font-medium
                                uppercase
                                tracking-[0.1em]
                                text-blue-400/70
                              "
                            >
                              <FileSearch
                                size={11}
                              />

                              Show full API diagnostic
                            </summary>

                            <div className="mt-2 space-y-2">
                              <div>
                                <p className="mb-1 text-[8px] uppercase tracking-[0.1em] text-slate-700">
                                  API endpoint
                                </p>

                                <p className="rounded-lg bg-black/30 p-2 font-mono text-[9px] text-slate-500">
                                  POST{" "}
                                  {
                                    PROCESS_URL
                                  }
                                </p>
                              </div>

                              <div>
                                <p className="mb-1 text-[8px] uppercase tracking-[0.1em] text-slate-700">
                                  HTTP status
                                </p>

                                <p className="rounded-lg bg-black/30 p-2 font-mono text-[9px] text-slate-500">
                                  {item.httpStatus ??
                                    "No response"}
                                </p>
                              </div>

                              <div>
                                <p className="mb-1 text-[8px] uppercase tracking-[0.1em] text-slate-700">
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
                                    p-2.5
                                    text-[9px]
                                    leading-4
                                    text-slate-500
                                  "
                                >
                                  {serializeValue(
                                    item.response,
                                  )}
                                </pre>
                              </div>

                              {/* =========================
                                  RAW SMS
                              ========================= */}

                              <div>
                                <p className="mb-1 text-[8px] uppercase tracking-[0.1em] text-slate-700">
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
                                    p-2.5
                                    text-[9px]
                                    leading-4
                                    text-slate-500
                                  "
                                >
                                  {serializeValue(
                                    {
                                      id:
                                        item.sms
                                          .id,

                                      address:
                                        item.sms
                                          .address,

                                      date:
                                        item.sms
                                          .date,

                                      dateFormatted:
                                        formatFullDateTime(
                                          item.sms
                                            .date,
                                        ),

                                      body:
                                        item.sms
                                          .body,
                                    },
                                  )}
                                </pre>
                              </div>

                              {/* =========================
                                  REQUEST PAYLOAD
                              ========================= */}

                              <div>
                                <p className="mb-1 text-[8px] uppercase tracking-[0.1em] text-slate-700">
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
                                    p-2.5
                                    text-[9px]
                                    leading-4
                                    text-slate-500
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
                      </div>
                    </div>
                  );
                },
              )}
            </div>
          )}
        </div>
      )}

      {/* =================================================
          NO RESULTS
      ================================================= */}

      {status === "synced" &&
        results.length === 0 && (
          <div
            className="
              mt-4
              rounded-2xl
              border border-slate-800/60
              bg-slate-950/30
              px-3 py-4
              text-center
            "
          >
            <Inbox
              size={18}
              className="mx-auto text-slate-700"
            />

            <p className="mt-2 text-[11px] text-slate-500">
              No financial candidate messages were submitted.
            </p>

            <p className="mt-1 text-[9px] text-slate-700">
              Inbox: {stats.inbox} · Filtered:{" "}
              {stats.filtered}
            </p>
          </div>
        )}

      {/* =================================================
          FOOTER
      ================================================= */}

      <div className="mt-4 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-slate-600">
          <ShieldCheck size={11} />

          <span className="text-[10px]">
            GEO-SHUA secure sync
          </span>
        </div>

        <span className="text-[10px] text-slate-700">
          Foreground only
        </span>
      </div>
    </section>
  );
}