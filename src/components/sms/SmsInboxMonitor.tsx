"use client";

import {
  ChevronDown,
  ChevronUp,
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

type ScanPhase =
  | "idle"
  | "reading"
  | "processing"
  | "complete"
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
  response?: ApiRecord;
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
  currentAddress?: string | null;
  currentSmsId?: string | null;
};

type FilteredDiagnostic = {
  sms: SmsMessage;
  reason: string;
};

/* =========================================================
   GENERIC HELPERS
========================================================= */

function isRecord(value: unknown): value is ApiRecord {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function toRecord(value: unknown): ApiRecord | null {
  return isRecord(value) ? value : null;
}

function getString(
  value: unknown,
  fallback = ""
): string {
  return typeof value === "string"
    ? value
    : fallback;
}

function truncate(
  value: unknown,
  max = 500
): string {
  const text =
    typeof value === "string"
      ? value
      : JSON.stringify(value);

  if (!text) {
    return "";
  }

  return text.length > max
    ? `${text.slice(0, max)}…`
    : text;
}

function serializeValue(
  value: unknown
): string {
  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(
      value,
      null,
      2
    );
  } catch {
    return String(value);
  }
}

/* =========================================================
   SMS FILTERING
========================================================= */

function isFinancialCandidate(
  sms: SmsMessage
): {
  candidate: boolean;
  reason: string;
} {
  const body =
    typeof sms.body === "string"
      ? sms.body.trim()
      : "";

  if (!body) {
    return {
      candidate: false,
      reason: "SMS body is empty.",
    };
  }

  const normalized =
    body.toLowerCase();

  const hasFinancialTerm =
    FINANCIAL_TERMS.some((term) =>
      normalized.includes(term)
    );

  if (!hasFinancialTerm) {
    return {
      candidate: false,
      reason:
        "No configured financial keyword found.",
    };
  }

  return {
    candidate: true,
    reason: "Financial candidate.",
  };
}

/* =========================================================
   LOCAL SMS IDENTITY
========================================================= */

function getLocalSmsKey(
  sms: SmsMessage
): string {
  const id =
    typeof sms.id === "string"
      ? sms.id.trim()
      : "";

  if (id) {
    return `id:${id}`;
  }

  const address =
    typeof sms.address === "string"
      ? sms.address.trim()
      : "";

  const body =
    typeof sms.body === "string"
      ? sms.body.trim()
      : "";

  const date =
    typeof sms.date === "number"
      ? sms.date
      : Number(sms.date || 0);

  return [
    "fallback",
    address,
    date,
    body,
  ].join(":");
}

/* =========================================================
   DATE / TIME
========================================================= */

function formatDateTime(
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

  const date =
    new Date(timestamp);

  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return date.toLocaleString();
}

function formatDateOnly(
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

  const date =
    new Date(timestamp);

  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return date.toLocaleDateString();
}

/* =========================================================
   API DIAGNOSTICS
========================================================= */

function getApiReason(
  response: ApiRecord | undefined
): string {
  if (!response) {
    return "";
  }

  const direct =
    getString(response.reason);

  if (direct) {
    return direct;
  }

  const data =
    toRecord(response.data);

  return getString(
    data?.reason
  );
}

function getApiReference(
  response: ApiRecord | undefined
): string {
  if (!response) {
    return "";
  }

  const direct =
    getString(response.reference);

  if (direct) {
    return direct;
  }

  const parsed =
    toRecord(response.parsed);

  const parsedReference =
    getString(parsed?.reference);

  if (parsedReference) {
    return parsedReference;
  }

  const data =
    toRecord(response.data);

  const dataReference =
    getString(data?.reference);

  if (dataReference) {
    return dataReference;
  }

  const dataParsed =
    toRecord(data?.parsed);

  return getString(
    dataParsed?.reference
  );
}

function getApiAmount(
  response: ApiRecord | undefined
): string {
  if (!response) {
    return "";
  }

  const direct =
    response.amount;

  if (
    typeof direct === "number" ||
    typeof direct === "string"
  ) {
    return String(direct);
  }

  const parsed =
    toRecord(response.parsed);

  if (
    typeof parsed?.amount === "number" ||
    typeof parsed?.amount === "string"
  ) {
    return String(parsed.amount);
  }

  const data =
    toRecord(response.data);

  if (
    typeof data?.amount === "number" ||
    typeof data?.amount === "string"
  ) {
    return String(data.amount);
  }

  return "";
}

function getApiDestinationAccountNumber(
  response: ApiRecord | undefined
): string {
  if (!response) {
    return "";
  }

  const direct =
    getString(
      response.destinationAccountNumber
    );

  if (direct) {
    return direct;
  }

  const parsed =
    toRecord(response.parsed);

  const parsedDestination =
    getString(
      parsed?.destinationAccountNumber
    );

  if (parsedDestination) {
    return parsedDestination;
  }

  const data =
    toRecord(response.data);

  const dataDestination =
    getString(
      data?.destinationAccountNumber
    );

  if (dataDestination) {
    return dataDestination;
  }

  const dataParsed =
    toRecord(data?.parsed);

  return getString(
    dataParsed?.destinationAccountNumber
  );
}

function getApiSenderName(
  response: ApiRecord | undefined
): string {
  if (!response) {
    return "";
  }

  const direct =
    getString(response.senderName);

  if (direct) {
    return direct;
  }

  const parsed =
    toRecord(response.parsed);

  const parsedSender =
    getString(parsed?.senderName);

  if (parsedSender) {
    return parsedSender;
  }

  const data =
    toRecord(response.data);

  const dataSender =
    getString(data?.senderName);

  if (dataSender) {
    return dataSender;
  }

  const dataParsed =
    toRecord(data?.parsed);

  return getString(
    dataParsed?.senderName
  );
}

function getApiTransactionDate(
  response: ApiRecord | undefined
): string {
  if (!response) {
    return "";
  }

  const direct =
    response.transactionDate;

  if (
    typeof direct === "string" ||
    typeof direct === "number"
  ) {
    return String(direct);
  }

  const parsed =
    toRecord(response.parsed);

  const parsedDate =
    parsed?.transactionDate;

  if (
    typeof parsedDate === "string" ||
    typeof parsedDate === "number"
  ) {
    return String(parsedDate);
  }

  const data =
    toRecord(response.data);

  const dataDate =
    data?.transactionDate;

  if (
    typeof dataDate === "string" ||
    typeof dataDate === "number"
  ) {
    return String(dataDate);
  }

  const dataParsed =
    toRecord(data?.parsed);

  const nestedDate =
    dataParsed?.transactionDate;

  if (
    typeof nestedDate === "string" ||
    typeof nestedDate === "number"
  ) {
    return String(nestedDate);
  }

  return "";
}

function getApiLoan(
  response: ApiRecord | undefined
): ApiRecord | null {
  if (!response) {
    return null;
  }

  const direct =
    toRecord(response.loan);

  if (direct) {
    return direct;
  }

  const data =
    toRecord(response.data);

  const nested =
    toRecord(data?.loan);

  return nested;
}

function getApiSavingsAccount(
  response: ApiRecord | undefined
): ApiRecord | null {
  if (!response) {
    return null;
  }

  const direct =
    toRecord(response.savingsAccount);

  if (direct) {
    return direct;
  }

  const data =
    toRecord(response.data);

  const nested =
    toRecord(data?.savingsAccount);

  return nested;
}

/* =========================================================
   RESULT CLASSIFICATION
========================================================= */

function getResultKind(
  result: ProcessResult
): string {
  if (result.type) {
    return result.type;
  }

  const response =
    result.response;

  if (!response) {
    return "";
  }

  const type =
    getString(response.type);

  if (type) {
    return type;
  }

  const transactionType =
    getString(
      response.transactionType
    );

  if (transactionType) {
    return transactionType;
  }

  const parsed =
    toRecord(response.parsed);

  return getString(
    parsed?.transactionType
  );
}

function getResultLabel(
  result: ProcessResult
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

  return (
    result.status ||
    "Unknown"
  );
}

function getResultReason(
  result: ProcessResult
): string {
  if (result.error) {
    return result.error;
  }

  return getApiReason(
    result.response
  );
}

/* =========================================================
   READER ERROR
========================================================= */

function extractReaderError(
  error: unknown
): ReaderError {
  const record =
    toRecord(error);

  const message =
    getString(
      record?.message,
      error instanceof Error
        ? error.message
        : "Failed to read SMS inbox."
    );

  return {
    message,
    code:
      getString(record?.code) ||
      undefined,
    data:
      record?.data,
    raw:
      error,
  };
}

/* =========================================================
   COMPONENT
========================================================= */

export default function SmsInboxMonitor() {
  const [status, setStatus] =
    useState<MonitorStatus>("idle");

  const [scanPhase, setScanPhase] =
    useState<ScanPhase>("idle");

  const [
    performingTransaction,
    setPerformingTransaction,
  ] = useState(false);

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

  const [progress, setProgress] =
    useState<ScanProgress>({
      current: 0,
      total: 0,
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

  const [
    filteredDiagnostics,
    setFilteredDiagnostics,
  ] = useState<FilteredDiagnostic[]>([]);

  const [
    readerError,
    setReaderError,
  ] = useState<ReaderError | null>(null);

  const [
    lastSync,
    setLastSync,
  ] = useState<Date | null>(null);

  const [
    diagnosticsOpen,
    setDiagnosticsOpen,
  ] = useState(false);

  const runningRef =
    useRef(false);

  const startupProcessedRef =
    useRef(false);

  /* =======================================================
     NATIVE CHECK
  ======================================================= */

  const isNative = useMemo(
    () => Capacitor.isNativePlatform(),
    []
  );

  /* =======================================================
     PROCESS INBOX
  ======================================================= */

  const processInbox =
    useCallback(async () => {
      if (runningRef.current) {
        return;
      }

      if (!isNative) {
        setStatus("idle");
        setScanPhase("idle");
        return;
      }

      runningRef.current = true;

      setStatus("scanning");
      setScanPhase("reading");
      setPerformingTransaction(false);

      setReaderError(null);
      setResults([]);
      setFilteredDiagnostics([]);

      setStats({
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

      setProgress({
        current: 0,
        total: 0,
        submitted: 0,
        processed: 0,
        duplicate: 0,
        ignored: 0,
        failed: 0,
        loanUpdated: 0,
        savingsUpdated: 0,
      });

      try {
        console.log(
          "[GEO-SHUA SMS] Starting foreground SMS scan."
        );

        /* ---------------------------------------------------
           READ SMS
        --------------------------------------------------- */

        const inboxResult =
          await SmsReader.readInbox();

        const messages =
          Array.isArray(
            inboxResult?.messages
          )
            ? inboxResult.messages
            : [];

        console.log(
          "[GEO-SHUA SMS] Inbox messages:",
          messages.length
        );

        /* ---------------------------------------------------
           DEDUPLICATE LOCAL INBOX
        --------------------------------------------------- */

        const uniqueMessages: SmsMessage[] = [];

        const seen =
          new Set<string>();

        for (const sms of messages) {
          const key =
            getLocalSmsKey(sms);

          if (seen.has(key)) {
            continue;
          }

          seen.add(key);
          uniqueMessages.push(sms);
        }

        /* ---------------------------------------------------
           LOCAL FINANCIAL FILTER
        --------------------------------------------------- */

        const candidates: SmsMessage[] = [];

        const filtered: FilteredDiagnostic[] = [];

        for (const sms of uniqueMessages) {
          const classification =
            isFinancialCandidate(sms);

          if (classification.candidate) {
            candidates.push(sms);
          } else if (
            filtered.length <
            MAX_FILTERED_DIAGNOSTICS
          ) {
            filtered.push({
              sms,
              reason:
                classification.reason,
            });
          }
        }

        setFilteredDiagnostics(
          filtered
        );

        setScanPhase("processing");

        const initialStats: ProcessStats = {
          inbox: uniqueMessages.length,
          candidates: candidates.length,
          filtered:
            uniqueMessages.length -
            candidates.length,
          submitted: 0,
          processed: 0,
          duplicate: 0,
          ignored: 0,
          failed: 0,
          loanUpdated: 0,
          savingsUpdated: 0,
        };

        setStats(initialStats);

        setProgress({
          current: 0,
          total: uniqueMessages.length,
          submitted: 0,
          processed: 0,
          duplicate: 0,
          ignored: 0,
          failed: 0,
          loanUpdated: 0,
          savingsUpdated: 0,
        });

        /* ---------------------------------------------------
           PROCESS ENTIRE INBOX SEQUENTIALLY
        --------------------------------------------------- */

        let submitted = 0;
        let processed = 0;
        let duplicate = 0;
        let ignored = 0;
        let failed = 0;
        let loanUpdated = 0;
        let savingsUpdated = 0;

        const resultList: ProcessResult[] = [];

        for (
          let index = 0;
          index < uniqueMessages.length;
          index++
        ) {
          const sms =
            uniqueMessages[index];

          const current =
            index + 1;

          setProgress({
            current,
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
              sms.address,
            currentSmsId:
              sms.id,
          });

          /* -------------------------------------------------
             SKIP NON-FINANCIAL SMS LOCALLY
          ------------------------------------------------- */

          const candidateCheck =
            isFinancialCandidate(sms);

          if (!candidateCheck.candidate) {
            continue;
          }

          /* -------------------------------------------------
             VALIDATE SMS
          ------------------------------------------------- */

          const body =
            typeof sms.body === "string"
              ? sms.body.trim()
              : "";

          const date =
            typeof sms.date === "number"
              ? sms.date
              : Number(sms.date || 0);

          const address =
            typeof sms.address === "string"
              ? sms.address.trim()
              : "";

          const smsId =
            typeof sms.id === "string" &&
            sms.id.trim()
              ? sms.id.trim()
              : getLocalSmsKey(sms);

          if (!body || !date) {
            failed++;

            resultList.push({
              sms,
              status: "failed",
              error:
                "SMS body or date is invalid.",
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
              loanUpdated,
              savingsUpdated,
            });

            setProgress({
              current,
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
                sms.address,
              currentSmsId:
                sms.id,
            });

            continue;
          }

          /* -------------------------------------------------
             PERFORM FINANCIAL TRANSACTION
          ------------------------------------------------- */

          setPerformingTransaction(true);

          submitted++;

          try {
            console.log(
              "[GEO-SHUA SMS] Processing:",
              {
                smsId,
                address,
                date,
              }
            );

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
                    smsId,
                    address,
                    body,
                    date,
                  }),
                }
              );

            let payload: ApiRecord = {};

            try {
              const parsed =
                await response.json();

              if (isRecord(parsed)) {
                payload = parsed;
              }
            } catch {
              payload = {};
            }

            const statusValue =
              getString(
                payload.status
              );

            const type =
              getString(
                payload.type
              );

            const duplicateFlag =
              payload.duplicate === true ||
              statusValue ===
                "duplicate";

            const ignoredFlag =
              payload.ignored === true ||
              statusValue ===
                "ignored";

            const processedFlag =
              payload.processed === true ||
              statusValue ===
                "success";

            const financialChange =
              payload.financialChange === true;

            const result: ProcessResult = {
              sms,
              httpStatus:
                response.status,
              status:
                statusValue,
              type:
                type || undefined,
              financialChange,
              duplicate:
                duplicateFlag,
              ignored:
                ignoredFlag,
              processed:
                processedFlag,
              response:
                payload,
            };

            resultList.push(result);

            if (duplicateFlag) {
              duplicate++;
            } else if (ignoredFlag) {
              ignored++;
            } else if (
              processedFlag &&
              response.ok
            ) {
              processed++;

              const apiType =
                getResultKind(
                  result
                );

              if (
                apiType ===
                "loan"
              ) {
                loanUpdated++;
              }

              if (
                apiType ===
                "savings"
              ) {
                savingsUpdated++;
              }
            } else {
              failed++;
            }

            setResults([
              ...resultList,
            ]);

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
              loanUpdated,
              savingsUpdated,
            });

            setProgress({
              current,
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
                sms.address,
              currentSmsId:
                sms.id,
            });
          } catch (error) {
            failed++;

            const message =
              error instanceof Error
                ? error.message
                : "Failed to process SMS.";

            resultList.push({
              sms,
              status: "failed",
              error: message,
            });

            setResults([
              ...resultList,
            ]);

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
              loanUpdated,
              savingsUpdated,
            });

            setProgress({
              current,
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
                sms.address,
              currentSmsId:
                sms.id,
            });

            console.error(
              "[GEO-SHUA SMS] Processing error:",
              error
            );
          } finally {
            setPerformingTransaction(
              false
            );
          }
        }

        /* ---------------------------------------------------
           FINAL STATE
        --------------------------------------------------- */

        const finalStats: ProcessStats = {
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
          loanUpdated,
          savingsUpdated,
        };

        setStats(
          finalStats
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

        setLastSync(
          new Date()
        );

        setPerformingTransaction(
          false
        );

        setScanPhase(
          failed > 0
            ? "error"
            : "complete"
        );

        setStatus(
          failed > 0
            ? "attention"
            : "synced"
        );

        console.log(
          "[GEO-SHUA SMS] Scan complete:",
          finalStats
        );
      } catch (error) {
        const extracted =
          extractReaderError(
            error
          );

        console.error(
          "[GEO-SHUA SMS] Reader error:",
          extracted
        );

        setReaderError(
          extracted
        );

        setPerformingTransaction(
          false
        );

        setScanPhase(
          "error"
        );

        setStatus(
          "error"
        );
      } finally {
        runningRef.current =
          false;

        setPerformingTransaction(
          false
        );
      }
    }, [isNative]);

  /* =======================================================
     AUTO-RUN WHEN APP OPENS
  ======================================================= */

  useEffect(() => {
    if (!isNative) {
      return;
    }

    if (
      startupProcessedRef.current
    ) {
      return;
    }

    startupProcessedRef.current =
      true;

    void processInbox();
  }, [
    isNative,
    processInbox,
  ]);

  /* =======================================================
     DIAGNOSTIC METRICS
  ======================================================= */

  const diagnosticSummary =
    useMemo(() => {
      return {
        status,
        scanPhase,
        performingTransaction,
        isNative,
        inbox:
          stats.inbox,
        candidates:
          stats.candidates,
        filtered:
          stats.filtered,
        submitted:
          stats.submitted,
        processed:
          stats.processed,
        duplicate:
          stats.duplicate,
        ignored:
          stats.ignored,
        failed:
          stats.failed,
        loanUpdated:
          stats.loanUpdated,
        savingsUpdated:
          stats.savingsUpdated,
      };
    }, [
      status,
      scanPhase,
      performingTransaction,
      isNative,
      stats,
    ]);

  /* =======================================================
     RENDER
  ======================================================= */

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
          SIMPLE PROCESS DISPLAY
      =================================================== */}

      <div className="px-4 py-4">
        {scanPhase === "reading" && (
          <p className="text-sm font-medium text-white">
            Reading SMS…
          </p>
        )}

        {scanPhase === "processing" && (
          <div className="space-y-2">
            <p className="text-sm font-medium text-white">
              Processing SMS{" "}
              {progress.current} of{" "}
              {progress.total}
            </p>

            {performingTransaction && (
              <p className="text-xs text-slate-400">
                Performing transactions…
              </p>
            )}

            <div className="h-1 w-full overflow-hidden rounded-full bg-slate-800">
              <div
                className="h-full rounded-full bg-slate-400 transition-all duration-300"
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

        {scanPhase === "complete" && (
          <p className="text-sm font-medium text-white">
            {stats.processed}{" "}
            transactions complete
          </p>
        )}

        {scanPhase === "error" && (
          <p className="text-sm font-medium text-white">
            SMS processing stopped
          </p>
        )}

        {scanPhase === "idle" && (
          <p className="text-sm font-medium text-white">
            SMS processing ready
          </p>
        )}
      </div>

      {/* ===================================================
          ONLY VISIBLE CONTROL
      =================================================== */}

      <div className="flex justify-center border-t border-slate-800">
        <button
          type="button"
          onClick={() =>
            setDiagnosticsOpen(
              (open) => !open
            )
          }
          aria-label={
            diagnosticsOpen
              ? "Hide diagnostics"
              : "Show diagnostics"
          }
          title={
            diagnosticsOpen
              ? "Hide diagnostics"
              : "Show diagnostics"
          }
          className="
            flex
            h-8
            w-10
            items-center
            justify-center
            text-slate-500
            transition
            hover:text-white
            focus:outline-none
            focus:ring-1
            focus:ring-slate-600
          "
        >
          {diagnosticsOpen ? (
            <ChevronUp
              className="h-4 w-4"
            />
          ) : (
            <ChevronDown
              className="h-4 w-4"
            />
          )}
        </button>
      </div>

      {/* ===================================================
          DEVELOPER DIAGNOSTICS
          Hidden during normal operation.
      =================================================== */}

      {diagnosticsOpen && (
        <div
          className="
            border-t
            border-slate-800
            bg-slate-900/70
            p-4
          "
        >
          {/* -------------------------------------------------
              INTERNAL METRICS
          ------------------------------------------------- */}

          <div className="mb-4">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
              Internal metrics
            </h3>

            <pre
              className="
                overflow-x-auto
                rounded-xl
                border
                border-slate-800
                bg-black/30
                p-3
                text-[11px]
                leading-relaxed
                text-slate-300
              "
            >
              {serializeValue(
                diagnosticSummary
              )}
            </pre>
          </div>

          {/* -------------------------------------------------
              READER ERROR
          ------------------------------------------------- */}

          {readerError && (
            <div className="mb-4">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
                Reader error
              </h3>

              <pre
                className="
                  overflow-x-auto
                  rounded-xl
                  border
                  border-slate-800
                  bg-black/30
                  p-3
                  text-[11px]
                  leading-relaxed
                  text-slate-300
                "
              >
                {serializeValue(
                  readerError
                )}
              </pre>
            </div>
          )}

          {/* -------------------------------------------------
              FILTERED SMS
          ------------------------------------------------- */}

          {filteredDiagnostics.length >
            0 && (
            <div className="mb-4">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
                Filtered SMS
              </h3>

              <div className="space-y-2">
                {filteredDiagnostics.map(
                  (
                    item,
                    index
                  ) => (
                    <details
                      key={`${getLocalSmsKey(
                        item.sms
                      )}-${index}`}
                      className="
                        rounded-xl
                        border
                        border-slate-800
                        bg-black/20
                      "
                    >
                      <summary
                        className="
                          cursor-pointer
                          px-3
                          py-2
                          text-xs
                          text-slate-300
                        "
                      >
                        {item.reason}
                      </summary>

                      <div className="border-t border-slate-800 p-3">
                        <div className="space-y-1 text-[11px] text-slate-400">
                          <div>
                            <span className="text-slate-500">
                              ID:
                            </span>{" "}
                            {item.sms.id ||
                              "—"}
                          </div>

                          <div>
                            <span className="text-slate-500">
                              Address:
                            </span>{" "}
                            {item.sms.address ||
                              "—"}
                          </div>

                          <div>
                            <span className="text-slate-500">
                              Date:
                            </span>{" "}
                            {formatDateTime(
                              item.sms.date
                            )}
                          </div>
                        </div>

                        <pre
                          className="
                            mt-2
                            max-h-32
                            overflow-auto
                            whitespace-pre-wrap
                            break-words
                            rounded-lg
                            bg-black/30
                            p-2
                            text-[11px]
                            text-slate-300
                          "
                        >
                          {truncate(
                            item.sms.body,
                            1000
                          )}
                        </pre>
                      </div>
                    </details>
                  )
                )}
              </div>
            </div>
          )}

          {/* -------------------------------------------------
              API RESULTS
          ------------------------------------------------- */}

          {results.length > 0 && (
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
                API results
              </h3>

              <div className="space-y-2">
                {results.map(
                  (
                    result,
                    index
                  ) => {
                    const apiReason =
                      getResultReason(
                        result
                      );

                    const reference =
                      getApiReference(
                        result.response
                      );

                    const amount =
                      getApiAmount(
                        result.response
                      );

                    const destination =
                      getApiDestinationAccountNumber(
                        result.response
                      );

                    const sender =
                      getApiSenderName(
                        result.response
                      );

                    const transactionDate =
                      getApiTransactionDate(
                        result.response
                      );

                    const loan =
                      getApiLoan(
                        result.response
                      );

                    const savingsAccount =
                      getApiSavingsAccount(
                        result.response
                      );

                    return (
                      <details
                        key={`${getLocalSmsKey(
                          result.sms
                        )}-${index}`}
                        className="
                          rounded-xl
                          border
                          border-slate-800
                          bg-black/20
                        "
                      >
                        <summary
                          className="
                            cursor-pointer
                            px-3
                            py-2
                            text-xs
                            text-slate-300
                          "
                        >
                          <span>
                            {getResultLabel(
                              result
                            )}
                          </span>

                          {result.type && (
                            <span className="ml-2 text-slate-500">
                              {result.type}
                            </span>
                          )}

                          {result.httpStatus !==
                            undefined && (
                            <span className="ml-2 text-slate-500">
                              HTTP{" "}
                              {
                                result.httpStatus
                              }
                            </span>
                          )}
                        </summary>

                        <div className="border-t border-slate-800 p-3">
                          <div className="space-y-1 text-[11px] text-slate-400">
                            <div>
                              <span className="text-slate-500">
                                SMS ID:
                              </span>{" "}
                              {result.sms.id ||
                                getLocalSmsKey(
                                  result.sms
                                )}
                            </div>

                            <div>
                              <span className="text-slate-500">
                                Address:
                              </span>{" "}
                              {result.sms.address ||
                                "—"}
                            </div>

                            <div>
                              <span className="text-slate-500">
                                SMS date:
                              </span>{" "}
                              {formatDateTime(
                                result.sms.date
                              )}
                            </div>

                            <div>
                              <span className="text-slate-500">
                                Reference:
                              </span>{" "}
                              {reference ||
                                "—"}
                            </div>

                            <div>
                              <span className="text-slate-500">
                                Amount:
                              </span>{" "}
                              {amount ||
                                "—"}
                            </div>

                            <div>
                              <span className="text-slate-500">
                                Sender:
                              </span>{" "}
                              {sender ||
                                "—"}
                            </div>

                            <div>
                              <span className="text-slate-500">
                                Destination:
                              </span>{" "}
                              {destination ||
                                "—"}
                            </div>

                            <div>
                              <span className="text-slate-500">
                                Transaction date:
                              </span>{" "}
                              {transactionDate
                                ? formatDateOnly(
                                    transactionDate
                                  )
                                : "—"}
                            </div>

                            <div>
                              <span className="text-slate-500">
                                Financial change:
                              </span>{" "}
                              {result.financialChange
                                ? "yes"
                                : "no"}
                            </div>

                            <div>
                              <span className="text-slate-500">
                                Reason:
                              </span>{" "}
                              {apiReason ||
                                "—"}
                            </div>
                          </div>

                          {loan && (
                            <div className="mt-3">
                              <div className="mb-1 text-[10px] uppercase tracking-wider text-slate-500">
                                Loan
                              </div>

                              <pre
                                className="
                                  overflow-x-auto
                                  rounded-lg
                                  bg-black/30
                                  p-2
                                  text-[11px]
                                  text-slate-300
                                "
                              >
                                {serializeValue(
                                  loan
                                )}
                              </pre>
                            </div>
                          )}

                          {savingsAccount && (
                            <div className="mt-3">
                              <div className="mb-1 text-[10px] uppercase tracking-wider text-slate-500">
                                Savings account
                              </div>

                              <pre
                                className="
                                  overflow-x-auto
                                  rounded-lg
                                  bg-black/30
                                  p-2
                                  text-[11px]
                                  text-slate-300
                                "
                              >
                                {serializeValue(
                                  savingsAccount
                                )}
                              </pre>
                            </div>
                          )}

                          <div className="mt-3">
                            <div className="mb-1 text-[10px] uppercase tracking-wider text-slate-500">
                              Raw SMS
                            </div>

                            <pre
                              className="
                                max-h-32
                                overflow-auto
                                whitespace-pre-wrap
                                break-words
                                rounded-lg
                                bg-black/30
                                p-2
                                text-[11px]
                                text-slate-300
                              "
                            >
                              {truncate(
                                result.sms.body,
                                1500
                              )}
                            </pre>
                          </div>

                          {result.response && (
                            <div className="mt-3">
                              <div className="mb-1 text-[10px] uppercase tracking-wider text-slate-500">
                                Raw API response
                              </div>

                              <pre
                                className="
                                  max-h-72
                                  overflow-auto
                                  rounded-lg
                                  bg-black/30
                                  p-2
                                  text-[11px]
                                  leading-relaxed
                                  text-slate-300
                                "
                              >
                                {serializeValue(
                                  result.response
                                )}
                              </pre>
                            </div>
                          )}

                          {result.error && (
                            <div className="mt-3">
                              <div className="mb-1 text-[10px] uppercase tracking-wider text-slate-500">
                                Error
                              </div>

                              <pre
                                className="
                                  whitespace-pre-wrap
                                  break-words
                                  rounded-lg
                                  bg-black/30
                                  p-2
                                  text-[11px]
                                  text-slate-300
                                "
                              >
                                {result.error}
                              </pre>
                            </div>
                          )}
                        </div>
                      </details>
                    );
                  }
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}