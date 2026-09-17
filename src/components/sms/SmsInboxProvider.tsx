"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
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

const MAX_RESULTS = 100;

/* =========================================================
   TYPES
========================================================= */

export type SmsMonitorStatus =
  | "idle"
  | "scanning"
  | "synced"
  | "attention"
  | "error";

export type SmsScanPhase =
  | "idle"
  | "reading"
  | "processing"
  | "complete"
  | "error";

type ApiRecord = Record<string, unknown>;

export type SmsProcessResult = {
  sms: SmsMessage;
  httpStatus?: number;
  status?: string;
  type?: string;
  financialChange?: boolean;
  duplicate?: boolean;
  ignored?: boolean;
  processed?: boolean;
  error?: string;
};

export type SmsProcessStats = {
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

export type SmsScanProgress = {
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

type SmsInboxContextValue = {
  status: SmsMonitorStatus;
  scanPhase: SmsScanPhase;
  performingTransaction: boolean;
  stats: SmsProcessStats;
  progress: SmsScanProgress;
  results: SmsProcessResult[];
  lastSync: Date | null;
  processInbox: () => Promise<void>;
};

/* =========================================================
   CONTEXT
========================================================= */

const SmsInboxContext =
  createContext<SmsInboxContextValue | null>(
    null,
  );

/* =========================================================
   DEFAULT STATE
========================================================= */

const INITIAL_STATS: SmsProcessStats = {
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
};

const INITIAL_PROGRESS: SmsScanProgress = {
  current: 0,
  total: 0,
  submitted: 0,
  processed: 0,
  duplicate: 0,
  ignored: 0,
  failed: 0,
  loanUpdated: 0,
  savingsUpdated: 0,
};

/* =========================================================
   GENERIC HELPERS
========================================================= */

function isRecord(
  value: unknown,
): value is ApiRecord {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function getString(
  value: unknown,
  fallback = "",
): string {
  return typeof value === "string"
    ? value
    : fallback;
}

/* =========================================================
   SMS FILTERING
========================================================= */

function isFinancialCandidate(
  sms: SmsMessage,
): boolean {
  const body =
    typeof sms.body === "string"
      ? sms.body.trim()
      : "";

  if (!body) {
    return false;
  }

  const normalized =
    body.toLowerCase();

  return FINANCIAL_TERMS.some(
    (term) =>
      normalized.includes(term),
  );
}

/* =========================================================
   LOCAL SMS IDENTITY
========================================================= */

function getLocalSmsKey(
  sms: SmsMessage,
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
   API CLASSIFICATION
========================================================= */

function getResultKind(
  payload: ApiRecord,
): string {
  const directType =
    getString(payload.type);

  if (directType) {
    return directType.toLowerCase();
  }

  const transactionType =
    getString(
      payload.transactionType,
    );

  if (transactionType) {
    return transactionType.toLowerCase();
  }

  const parsed = isRecord(
    payload.parsed,
  )
    ? payload.parsed
    : null;

  const parsedType =
    getString(
      parsed?.transactionType,
    );

  if (parsedType) {
    return parsedType.toLowerCase();
  }

  const data = isRecord(
    payload.data,
  )
    ? payload.data
    : null;

  const dataType =
    getString(
      data?.type,
    );

  if (dataType) {
    return dataType.toLowerCase();
  }

  const dataTransactionType =
    getString(
      data?.transactionType,
    );

  if (dataTransactionType) {
    return dataTransactionType.toLowerCase();
  }

  return "";
}

/* =========================================================
   PROVIDER
========================================================= */

export function SmsInboxProvider({
  children,
}: {
  children: ReactNode;
}) {
  const isNative =
    Capacitor.isNativePlatform();

  const [
    status,
    setStatus,
  ] = useState<SmsMonitorStatus>(
    "idle",
  );

  const [
    scanPhase,
    setScanPhase,
  ] = useState<SmsScanPhase>(
    "idle",
  );

  const [
    performingTransaction,
    setPerformingTransaction,
  ] = useState(false);

  const [
    stats,
    setStats,
  ] = useState<SmsProcessStats>(
    INITIAL_STATS,
  );

  const [
    progress,
    setProgress,
  ] = useState<SmsScanProgress>(
    INITIAL_PROGRESS,
  );

  const [
    results,
    setResults,
  ] = useState<SmsProcessResult[]>(
    [],
  );

  const [
    lastSync,
    setLastSync,
  ] = useState<Date | null>(
    null,
  );

  const runningRef =
    useRef(false);

  const startupProcessedRef =
    useRef(false);

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

      setStats({
        ...INITIAL_STATS,
      });

      setProgress({
        ...INITIAL_PROGRESS,
      });

      setResults([]);

      try {
        /* ---------------------------------------------------
           READ SMS INBOX
        --------------------------------------------------- */

        const inboxResult =
          await SmsReader.readInbox();

        const messages =
          Array.isArray(
            inboxResult?.messages,
          )
            ? inboxResult.messages
            : [];

        /* ---------------------------------------------------
           DEDUPLICATE SMS
        --------------------------------------------------- */

        const uniqueMessages: SmsMessage[] =
          [];

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
           FIND FINANCIAL CANDIDATES
        --------------------------------------------------- */

        const candidates =
          uniqueMessages.filter(
            isFinancialCandidate,
          );

        const initialStats: SmsProcessStats =
          {
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
            loanUpdated: 0,
            savingsUpdated: 0,
          };

        setStats(initialStats);

        setScanPhase("processing");

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

        /* ---------------------------------------------------
           RUNNING COUNTERS
        --------------------------------------------------- */

        let submitted = 0;
        let processed = 0;
        let duplicate = 0;
        let ignored = 0;
        let failed = 0;
        let loanUpdated = 0;
        let savingsUpdated = 0;

        const resultList: SmsProcessResult[] =
          [];

        /* ---------------------------------------------------
           PROCESS SMS SEQUENTIALLY

           This intentionally remains sequential.

           Financial SMS processing must not be fired
           concurrently because two payments may belong to
           the same member/loan and ordering matters.
        --------------------------------------------------- */

        for (
          let index = 0;
          index <
          uniqueMessages.length;
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

          /* -----------------------------------------------
             SKIP NON-FINANCIAL SMS
          ------------------------------------------------ */

          if (
            !isFinancialCandidate(
              sms,
            )
          ) {
            continue;
          }

          /* -----------------------------------------------
             NORMALIZE SMS
          ------------------------------------------------ */

          const body =
            typeof sms.body === "string"
              ? sms.body.trim()
              : "";

          const date =
            typeof sms.date === "number"
              ? sms.date
              : Number(
                  sms.date || 0,
                );

          const address =
            typeof sms.address ===
            "string"
              ? sms.address.trim()
              : "";

          const smsId =
            typeof sms.id === "string" &&
            sms.id.trim()
              ? sms.id.trim()
              : getLocalSmsKey(
                  sms,
                );

          /* -----------------------------------------------
             INVALID SMS
          ------------------------------------------------ */

          if (!body || !date) {
            failed++;

            resultList.push({
              sms,
              status: "failed",
              error:
                "SMS body or date is invalid.",
            });

            setResults([
              ...resultList.slice(
                -MAX_RESULTS,
              ),
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

            continue;
          }

          /* -----------------------------------------------
             SEND TO SERVER
          ------------------------------------------------ */

          setPerformingTransaction(
            true,
          );

          submitted++;

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
                    smsId,
                    address,
                    body,
                    date,
                  }),
                },
              );

            let payload: ApiRecord =
              {};

            try {
              const parsed =
                await response.json();

              if (
                isRecord(parsed)
              ) {
                payload =
                  parsed;
              }
            } catch {
              payload = {};
            }

            const statusValue =
              getString(
                payload.status,
              );

            const type =
              getString(
                payload.type,
              );

            const duplicateFlag =
              payload.duplicate ===
                true ||
              statusValue ===
                "duplicate";

            const ignoredFlag =
              payload.ignored ===
                true ||
              statusValue ===
                "ignored";

            const processedFlag =
              payload.processed ===
                true ||
              statusValue ===
                "success";

            const financialChange =
              payload.financialChange ===
              true;

            const result: SmsProcessResult =
              {
                sms,
                httpStatus:
                  response.status,
                status:
                  statusValue ||
                  undefined,
                type:
                  type ||
                  undefined,
                financialChange,
                duplicate:
                  duplicateFlag,
                ignored:
                  ignoredFlag,
                processed:
                  processedFlag,
              };

            resultList.push(result);

            /* ---------------------------------------------
               CLASSIFY RESULT
            --------------------------------------------- */

            if (
              duplicateFlag
            ) {
              duplicate++;
            } else if (
              ignoredFlag
            ) {
              ignored++;
            } else if (
              processedFlag &&
              response.ok
            ) {
              processed++;

              const resultType =
                getResultKind(
                  payload,
                );

              if (
                resultType ===
                "loan"
              ) {
                loanUpdated++;
              }

              if (
                resultType ===
                "savings"
              ) {
                savingsUpdated++;
              }
            } else {
              failed++;
            }

            /* ---------------------------------------------
               KEEP ONLY RECENT RESULTS
            --------------------------------------------- */

            setResults([
              ...resultList.slice(
                -MAX_RESULTS,
              ),
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
              ...resultList.slice(
                -MAX_RESULTS,
              ),
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
          } finally {
            setPerformingTransaction(
              false,
            );
          }
        }

        /* ---------------------------------------------------
           FINAL STATE
        --------------------------------------------------- */

        const finalStats: SmsProcessStats =
          {
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

        setStats(finalStats);

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

        setLastSync(new Date());

        setPerformingTransaction(
          false,
        );

        setScanPhase(
          failed > 0
            ? "error"
            : "complete",
        );

        setStatus(
          failed > 0
            ? "attention"
            : "synced",
        );
      } catch {
        setPerformingTransaction(
          false,
        );

        setScanPhase("error");
        setStatus("error");
      } finally {
        runningRef.current = false;

        setPerformingTransaction(
          false,
        );
      }
    }, [isNative]);

  /* =======================================================
     AUTOMATIC INITIAL SCAN
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
     CONTEXT
  ======================================================= */

  const value: SmsInboxContextValue =
    {
      status,
      scanPhase,
      performingTransaction,
      stats,
      progress,
      results,
      lastSync,
      processInbox,
    };

  return (
    <SmsInboxContext.Provider
      value={value}
    >
      {children}
    </SmsInboxContext.Provider>
  );
}

/* =========================================================
   HOOK
========================================================= */

export function useSmsInbox() {
  const context =
    useContext(
      SmsInboxContext,
    );

  if (!context) {
    throw new Error(
      "useSmsInbox must be used inside SmsInboxProvider.",
    );
  }

  return context;
}