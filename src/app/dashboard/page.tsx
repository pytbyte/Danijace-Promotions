"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  AlertCircle,
  ArrowRight,
  Bell,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  FileText,
  HandCoins,
  Inbox,
  Info,
  Loader2,
  RefreshCw,
  Send,
  Server,
  Smartphone,
  Users,
  Wallet,
  XCircle,
  Zap,
} from "lucide-react";

import TopBar from "@/components/dashboard/TopBar";
import SmsReader from "@/lib/sms/SmsReader";

/* =========================================================
   TYPES
========================================================= */

type DashboardStats = {
  members: number;
  activeMembers: number;
  savings: number;
  deposits: number;
  adjustments: number;
  reversals: number;
  loans: number;
  outstandingLoans: number;
  defaulters: number;
  notifications: number;
};

type DashboardActivity = {
  id: string;
  title: string;
  description: string;
  time: string;
  type:
    | "member"
    | "saving"
    | "loan"
    | "notification";
};

type SavingsSummary = {
  totalBalance?: unknown;
  totalDeposits?: unknown;
  totalAdjustments?: unknown;
  totalReversals?: unknown;
  memberCount?: unknown;
};

type ApiResponse<T = unknown> = {
  success?: boolean;
  data?: T;
  error?: string;
};

type SmsProcessResponse = {
  success?: boolean;
  processed?: boolean;
  duplicate?: boolean;
  ignored?: boolean;
  created?: boolean;
  updated?: boolean;
  financialChange?: boolean;
  data?: unknown;
  error?: string;
};

type MemberRecord = {
  id?: string;
  _id?: string;
  status?: string;
  isActive?: boolean;
  createdAt?: string;
  updatedAt?: string;
  name?: string;
  fullName?: string;
};

type LoanRecord = {
  id?: string;
  _id?: string;
  status?: string;
  loanStatus?: string;
  outstandingBalance?: unknown;
  balance?: unknown;
  remainingBalance?: unknown;
  amount?: unknown;
  createdAt?: string;
  updatedAt?: string;
  memberName?: string;
  memberId?: string;
};

type NotificationRecord = {
  id?: string;
  _id?: string;
  title?: string;
  message?: string;
  description?: string;
  createdAt?: string;
  updatedAt?: string;
  read?: boolean;
  status?: string;
};

type SmsLogStatus =
  | "scanning"
  | "received"
  | "sending"
  | "processed"
  | "duplicate"
  | "ignored"
  | "financial-change"
  | "error"
  | "complete";

type SmsLog = {
  id: string;
  status: SmsLogStatus;
  timestamp: number;
  address: string | null;
  date?: number;
  body?: string;
  message?: string;
  httpStatus?: number;
  response?: unknown;
  error?: string;
};

const DEFAULT_STATS: DashboardStats = {
  members: 0,
  activeMembers: 0,
  savings: 0,
  deposits: 0,
  adjustments: 0,
  reversals: 0,
  loans: 0,
  outstandingLoans: 0,
  defaulters: 0,
  notifications: 0,
};

/* =========================================================
   SAFE HELPERS
========================================================= */

function safeNumber(value: unknown): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === "string") {
    const parsed = Number(value);

    return Number.isFinite(parsed)
      ? parsed
      : 0;
  }

  return 0;
}

function getId(
  item: {
    id?: string;
    _id?: string;
  },
  fallback: string
) {
  return item.id || item._id || fallback;
}

function getDate(
  item: {
    createdAt?: string;
    updatedAt?: string;
  }
) {
  return item.createdAt || item.updatedAt || "";
}

function formatRelativeTime(value: string) {
  if (!value) return "";

  const timestamp = new Date(value).getTime();

  if (!Number.isFinite(timestamp)) {
    return "";
  }

  const difference = Date.now() - timestamp;

  const seconds = Math.max(0, difference) / 1000;

  if (seconds < 60) {
    return "Just now";
  }

  const minutes = Math.floor(seconds / 60);

  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours = Math.floor(minutes / 60);

  if (hours < 24) {
    return `${hours}h ago`;
  }

  const days = Math.floor(hours / 24);

  if (days < 7) {
    return `${days}d ago`;
  }

  return new Date(timestamp).toLocaleDateString(
    "en-KE",
    {
      day: "numeric",
      month: "short",
    }
  );
}

function formatCurrency(value: number) {
  return `KES ${safeNumber(value).toLocaleString(
    "en-KE",
    {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }
  )}`;
}

function formatSmsDate(date?: number) {
  if (!date || !Number.isFinite(date)) {
    return "Unknown date";
  }

  return new Date(date).toLocaleString(
    "en-KE",
    {
      dateStyle: "medium",
      timeStyle: "short",
    }
  );
}

/* =========================================================
   API RESPONSE EXTRACTION
========================================================= */

function extractRecords<T>(
  result: ApiResponse
): T[] {
  const data = result?.data;

  if (Array.isArray(data)) {
    return data as T[];
  }

  if (data && typeof data === "object") {
    const recordData =
      data as Record<string, unknown>;

    const candidates = [
      recordData.members,
      recordData.loans,
      recordData.notifications,
      recordData.transactions,
      recordData.items,
      recordData.results,
      recordData.data,
    ];

    for (const candidate of candidates) {
      if (Array.isArray(candidate)) {
        return candidate as T[];
      }
    }
  }

  return [];
}

/* =========================================================
   DASHBOARD PAGE
========================================================= */

export default function DashboardPage() {
  const [stats, setStats] =
    useState<DashboardStats>(DEFAULT_STATS);

  const [activities, setActivities] =
    useState<DashboardActivity[]>([]);

  const [loading, setLoading] =
    useState(true);

  const [refreshing, setRefreshing] =
    useState(false);

  const [error, setError] =
    useState("");

  const [mounted, setMounted] =
    useState(false);

  /* =======================================================
     SMS DEBUG STATE
  ======================================================= */

  const [smsLogs, setSmsLogs] =
    useState<SmsLog[]>([]);

  const [smsRunning, setSmsRunning] =
    useState(false);

  const [smsExpanded, setSmsExpanded] =
    useState(true);

  const [smsSummary, setSmsSummary] =
    useState({
      found: 0,
      processed: 0,
      duplicates: 0,
      ignored: 0,
      errors: 0,
      financialChanges: 0,
    });

  /*
   * Prevent duplicate SMS synchronization.
   */
  const smsSyncStarted = useRef(false);

  /*
   * Prevent dashboard updates after unmount.
   */
  const dashboardMounted = useRef(true);

  /*
   * Abort active SMS requests on unmount.
   */
  const smsAbortController =
    useRef<AbortController | null>(null);

  /* =======================================================
     SMS LOG HELPER
  ======================================================= */

  const addSmsLog = useCallback(
    (log: Omit<SmsLog, "id" | "timestamp">) => {
      const entry: SmsLog = {
        ...log,
        id:
          typeof crypto !== "undefined" &&
          typeof crypto.randomUUID ===
            "function"
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random()}`,
        timestamp: Date.now(),
      };

      setSmsLogs((previous) => [
        ...previous,
        entry,
      ]);

      return entry.id;
    },
    []
  );

  /* =======================================================
     MOUNT / UNMOUNT
  ======================================================= */

  useEffect(() => {
    dashboardMounted.current = true;

    setMounted(true);

    return () => {
      dashboardMounted.current = false;

      smsAbortController.current?.abort();
    };
  }, []);

  /* =======================================================
     LOAD DASHBOARD DATA
  ======================================================= */

  const loadDashboard = useCallback(
    async (isRefresh = false) => {
      try {
        if (isRefresh) {
          setRefreshing(true);
        } else {
          setLoading(true);
        }

        setError("");

        const [
          savingsResponse,
          membersResponse,
          loansResponse,
          notificationsResponse,
        ] = await Promise.allSettled([
          fetch("/api/savings/summary", {
            method: "GET",
            cache: "no-store",
            headers: {
              Accept: "application/json",
            },
          }),

          fetch("/api/members", {
            method: "GET",
            cache: "no-store",
            headers: {
              Accept: "application/json",
            },
          }),

          fetch("/api/loans", {
            method: "GET",
            cache: "no-store",
            headers: {
              Accept: "application/json",
            },
          }),

          fetch("/api/notifications", {
            method: "GET",
            cache: "no-store",
            headers: {
              Accept: "application/json",
            },
          }),
        ]);

        /* =================================================
           SAVINGS
        ================================================= */

        let savings: SavingsSummary = {};

        let savingsError = "";

        if (
          savingsResponse.status ===
          "fulfilled"
        ) {
          try {
            const response =
              savingsResponse.value;

            const json =
              (await response.json()) as ApiResponse<SavingsSummary>;

            if (
              !response.ok ||
              json.success === false
            ) {
              savingsError =
                json.error ||
                `Savings API returned ${response.status}.`;
            } else {
              savings = json.data || {};
            }
          } catch {
            savingsError =
              "Invalid savings API response.";
          }
        } else {
          savingsError =
            "Unable to connect to the savings API.";
        }

        /* =================================================
           MEMBERS
        ================================================= */

        let members: MemberRecord[] = [];

        let membersError = "";

        if (
          membersResponse.status ===
          "fulfilled"
        ) {
          try {
            const response =
              membersResponse.value;

            const json =
              (await response.json()) as ApiResponse;

            if (
              !response.ok ||
              json.success === false
            ) {
              membersError =
                json.error ||
                `Members API returned ${response.status}.`;
            } else {
              members =
                extractRecords<MemberRecord>(
                  json
                );
            }
          } catch {
            membersError =
              "Invalid members API response.";
          }
        } else {
          membersError =
            "Unable to connect to the members API.";
        }

        /* =================================================
           LOANS
        ================================================= */

        let loans: LoanRecord[] = [];

        let loansError = "";

        if (
          loansResponse.status ===
          "fulfilled"
        ) {
          try {
            const response =
              loansResponse.value;

            const json =
              (await response.json()) as ApiResponse;

            if (
              !response.ok ||
              json.success === false
            ) {
              loansError =
                json.error ||
                `Loans API returned ${response.status}.`;
            } else {
              loans =
                extractRecords<LoanRecord>(
                  json
                );
            }
          } catch {
            loansError =
              "Invalid loans API response.";
          }
        } else {
          loansError =
            "Unable to connect to the loans API.";
        }

        /* =================================================
           NOTIFICATIONS
        ================================================= */

        let notifications: NotificationRecord[] =
          [];

        let notificationsError = "";

        if (
          notificationsResponse.status ===
          "fulfilled"
        ) {
          try {
            const response =
              notificationsResponse.value;

            const json =
              (await response.json()) as ApiResponse;

            if (
              !response.ok ||
              json.success === false
            ) {
              notificationsError =
                json.error ||
                `Notifications API returned ${response.status}.`;
            } else {
              notifications =
                extractRecords<NotificationRecord>(
                  json
                );
            }
          } catch {
            notificationsError =
              "Invalid notifications API response.";
          }
        } else {
          notificationsError =
            "Unable to connect to the notifications API.";
        }

        /* =================================================
           MEMBER COUNTS
        ================================================= */

        const memberCountFromSavings =
          safeNumber(
            savings.memberCount
          );

        const totalMembers =
          members.length ||
          memberCountFromSavings;

        const activeMembers =
          members.length > 0
            ? members.filter((member) => {
                if (
                  member.isActive === true
                ) {
                  return true;
                }

                return (
                  typeof member.status ===
                    "string" &&
                  ["active", "ACTIVE"].includes(
                    member.status
                  )
                );
              }).length
            : memberCountFromSavings;

        /* =================================================
           LOAN CALCULATIONS
        ================================================= */

        const loanCount = loans.length;

        let outstandingLoans = 0;

        let defaulters = 0;

        for (const loan of loans) {
          const outstanding =
            safeNumber(
              loan.outstandingBalance ??
                loan.remainingBalance ??
                loan.balance
            );

          outstandingLoans += Math.max(
            0,
            outstanding
          );

          const status = (
            loan.status ||
            loan.loanStatus ||
            ""
          )
            .toLowerCase()
            .trim();

          if (
            [
              "default",
              "defaulted",
              "overdue",
              "defaulter",
            ].includes(status)
          ) {
            defaulters += 1;
          }
        }

        /* =================================================
           NOTIFICATION COUNT
        ================================================= */

        const notificationCount =
          notifications.filter(
            (notification) => {
              if (
                notification.read === true
              ) {
                return false;
              }

              if (
                notification.status?.toLowerCase() ===
                "read"
              ) {
                return false;
              }

              return true;
            }
          ).length;

        /* =================================================
           UPDATE STATS
        ================================================= */

        const nextStats: DashboardStats = {
          members: totalMembers,
          activeMembers,
          savings: safeNumber(
            savings.totalBalance
          ),
          deposits: safeNumber(
            savings.totalDeposits
          ),
          adjustments: safeNumber(
            savings.totalAdjustments
          ),
          reversals: safeNumber(
            savings.totalReversals
          ),
          loans: loanCount,
          outstandingLoans,
          defaulters,
          notifications:
            notificationCount,
        };

        if (dashboardMounted.current) {
          setStats(nextStats);
        }

        /* =================================================
           RECENT ACTIVITY
        ================================================= */

        const nextActivities: DashboardActivity[] =
          [];

        members
          .slice()
          .sort(
            (a, b) =>
              new Date(
                getDate(b)
              ).getTime() -
              new Date(
                getDate(a)
              ).getTime()
          )
          .slice(0, 4)
          .forEach(
            (member, index) => {
              const name =
                member.name ||
                member.fullName ||
                "Member";

              nextActivities.push({
                id: `member-${getId(
                  member,
                  String(index)
                )}`,
                title:
                  "Member activity",
                description:
                  `${name} was recently recorded.`,
                time:
                  formatRelativeTime(
                    getDate(member)
                  ),
                type: "member",
              });
            }
          );

        loans
          .slice()
          .sort(
            (a, b) =>
              new Date(
                getDate(b)
              ).getTime() -
              new Date(
                getDate(a)
              ).getTime()
          )
          .slice(0, 4)
          .forEach(
            (loan, index) => {
              nextActivities.push({
                id: `loan-${getId(
                  loan,
                  String(index)
                )}`,
                title:
                  "Loan activity",
                description:
                  loan.memberName
                    ? `${loan.memberName} has loan activity.`
                    : "A loan record was recently updated.",
                time:
                  formatRelativeTime(
                    getDate(loan)
                  ),
                type: "loan",
              });
            }
          );

        notifications
          .slice()
          .sort(
            (a, b) =>
              new Date(
                getDate(b)
              ).getTime() -
              new Date(
                getDate(a)
              ).getTime()
          )
          .slice(0, 4)
          .forEach(
            (
              notification,
              index
            ) => {
              nextActivities.push({
                id: `notification-${getId(
                  notification,
                  String(index)
                )}`,
                title:
                  notification.title ||
                  "Notification",
                description:
                  notification.message ||
                  notification.description ||
                  "New notification.",
                time:
                  formatRelativeTime(
                    getDate(
                      notification
                    )
                  ),
                type:
                  "notification",
              });
            }
          );

        if (dashboardMounted.current) {
          setActivities(
            nextActivities.slice(0, 12)
          );
        }

        /* =================================================
           PARTIAL API ERRORS
        ================================================= */

        const errors = [
          savingsError,
          membersError,
          loansError,
          notificationsError,
        ].filter(Boolean);

        if (
          dashboardMounted.current &&
          errors.length > 0
        ) {
          setError(errors.join(" "));
        }
      } catch (err) {
        console.error(
          "Failed to load dashboard:",
          err
        );

        if (
          dashboardMounted.current
        ) {
          if (
            err instanceof TypeError &&
            err.message ===
              "Failed to fetch"
          ) {
            setError(
              "Unable to connect to the server. Check your connection and try again."
            );
          } else if (
            err instanceof Error
          ) {
            setError(err.message);
          } else {
            setError(
              "Something went wrong while loading the dashboard."
            );
          }
        }
      } finally {
        if (dashboardMounted.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    []
  );

  /* =======================================================
     SMS INBOX SYNCHRONIZATION
  ======================================================= */

  const syncSmsInbox = useCallback(
    async () => {
      if (smsSyncStarted.current) {
        addSmsLog({
          status: "ignored",
          address: null,
          message:
            "SMS synchronization was already started for this dashboard lifecycle.",
        });

        return;
      }

      smsSyncStarted.current = true;

      const controller =
        new AbortController();

      smsAbortController.current =
        controller;

      setSmsRunning(true);

      setSmsLogs([]);

      setSmsSummary({
        found: 0,
        processed: 0,
        duplicates: 0,
        ignored: 0,
        errors: 0,
        financialChanges: 0,
      });

      addSmsLog({
        status: "scanning",
        address: null,
        message:
          "Starting Android SMS inbox scan...",
      });

      try {
        /* =================================================
           READ ANDROID INBOX
        ================================================= */

        const result =
          await SmsReader.readInbox();

        const messages =
          Array.isArray(result.messages)
            ? result.messages
            : [];

        setSmsSummary((previous) => ({
          ...previous,
          found: messages.length,
        }));

        addSmsLog({
          status: "received",
          address: null,
          message:
            `Android SMS reader returned ${messages.length} message${
              messages.length === 1
                ? ""
                : "s"
            }.`,
          response: result.diagnostic,
        });

        if (messages.length === 0) {
          addSmsLog({
            status: "complete",
            address: null,
            message:
              "SMS inbox is empty. Nothing to process.",
          });

          return;
        }

        let financialChange = false;

        /* =================================================
           PROCESS EACH SMS
        ================================================= */

        for (
          let index = 0;
          index < messages.length;
          index++
        ) {
          if (
            controller.signal.aborted
          ) {
            addSmsLog({
              status: "ignored",
              address: null,
              message:
                "SMS synchronization was aborted.",
            });

            break;
          }

          const sms = messages[index];

          const smsLabel = `SMS ${index + 1}/${messages.length}`;

          /* -----------------------------------------------
             SHOW RECEIVED SMS
          ------------------------------------------------ */

          addSmsLog({
            status: "received",
            address:
              sms.address ?? null,
            date: sms.date,
            body: sms.body,
            message:
              `${smsLabel}: SMS received from ${
                sms.address ||
                "unknown sender"
              }.`,
          });

          /* -----------------------------------------------
             VALIDATE SMS
          ------------------------------------------------ */

          if (
            typeof sms.body !== "string" ||
            sms.body.trim().length === 0
          ) {
            setSmsSummary((previous) => ({
              ...previous,
              errors:
                previous.errors + 1,
            }));

            addSmsLog({
              status: "error",
              address:
                sms.address ?? null,
              date: sms.date,
              body: sms.body,
              message:
                `${smsLabel}: SMS skipped because the body is empty.`,
              error:
                "SMS body is empty.",
            });

            continue;
          }

          if (
            typeof sms.date !== "number" ||
            !Number.isFinite(sms.date)
          ) {
            setSmsSummary((previous) => ({
              ...previous,
              errors:
                previous.errors + 1,
            }));

            addSmsLog({
              status: "error",
              address:
                sms.address ?? null,
              date: sms.date,
              body: sms.body,
              message:
                `${smsLabel}: SMS skipped because its date is invalid.`,
              error:
                "SMS date is invalid.",
            });

            continue;
          }

          /* -----------------------------------------------
             SEND TO SERVER
          ------------------------------------------------ */

          addSmsLog({
            status: "sending",
            address:
              sms.address ?? null,
            date: sms.date,
            body: sms.body,
            message:
              `${smsLabel}: Sending SMS to /api/sms/process...`,
          });

          try {
            const response =
              await fetch(
                "/api/sms/process",
                {
                  method: "POST",

                  headers: {
                    "Content-Type":
                      "application/json",

                    Accept:
                      "application/json",
                  },

                  body: JSON.stringify({
                    address:
                      sms.address ?? null,

                    body: sms.body,

                    date: sms.date,
                  }),

                  signal:
                    controller.signal,

                  cache: "no-store",
                }
              );

            /* ---------------------------------------------
               PARSE SERVER RESPONSE
            --------------------------------------------- */

            let data:
              | SmsProcessResponse
              | null = null;

            try {
              data =
                (await response.json()) as SmsProcessResponse;
            } catch {
              data = null;
            }

            /* ---------------------------------------------
               HTTP ERROR
            --------------------------------------------- */

            if (!response.ok) {
              setSmsSummary((previous) => ({
                ...previous,
                errors:
                  previous.errors + 1,
              }));

              addSmsLog({
                status: "error",
                address:
                  sms.address ?? null,
                date: sms.date,
                body: sms.body,
                httpStatus:
                  response.status,
                response: data,
                message:
                  `${smsLabel}: Server rejected the SMS.`,
                error:
                  data?.error ||
                  `HTTP ${response.status}`,
              });

              continue;
            }

            /* ---------------------------------------------
               FINANCIAL CHANGE
            --------------------------------------------- */

            if (
              data?.financialChange ===
                true ||
              data?.created === true ||
              data?.updated === true
            ) {
              financialChange = true;

              setSmsSummary((previous) => ({
                ...previous,
                financialChanges:
                  previous.financialChanges +
                  1,
              }));

              addSmsLog({
                status:
                  "financial-change",
                address:
                  sms.address ?? null,
                date: sms.date,
                body: sms.body,
                httpStatus:
                  response.status,
                response: data,
                message:
                  `${smsLabel}: Financial records changed.`,
              });
            }

            /* ---------------------------------------------
               DUPLICATE
            --------------------------------------------- */

            if (
              data?.duplicate === true
            ) {
              setSmsSummary((previous) => ({
                ...previous,
                duplicates:
                  previous.duplicates + 1,
              }));

              addSmsLog({
                status: "duplicate",
                address:
                  sms.address ?? null,
                date: sms.date,
                body: sms.body,
                httpStatus:
                  response.status,
                response: data,
                message:
                  `${smsLabel}: Duplicate transaction detected and safely ignored.`,
              });

              continue;
            }

            /* ---------------------------------------------
               IGNORED
            --------------------------------------------- */

            if (
              data?.ignored === true
            ) {
              setSmsSummary((previous) => ({
                ...previous,
                ignored:
                  previous.ignored + 1,
              }));

              addSmsLog({
                status: "ignored",
                address:
                  sms.address ?? null,
                date: sms.date,
                body: sms.body,
                httpStatus:
                  response.status,
                response: data,
                message:
                  `${smsLabel}: SMS was received but ignored by the server processor.`,
              });

              continue;
            }

            /* ---------------------------------------------
               PROCESSED
            --------------------------------------------- */

            if (
              data?.processed === true
            ) {
              setSmsSummary((previous) => ({
                ...previous,
                processed:
                  previous.processed + 1,
              }));

              addSmsLog({
                status: "processed",
                address:
                  sms.address ?? null,
                date: sms.date,
                body: sms.body,
                httpStatus:
                  response.status,
                response: data,
                message:
                  `${smsLabel}: SMS processed successfully.`,
              });

              continue;
            }

            /* ---------------------------------------------
               UNKNOWN SUCCESS RESPONSE
            --------------------------------------------- */

            addSmsLog({
              status: "complete",
              address:
                sms.address ?? null,
              date: sms.date,
              body: sms.body,
              httpStatus:
                response.status,
              response: data,
              message:
                `${smsLabel}: Server responded successfully, but returned no recognized processing state.`,
            });
          } catch (error) {
            /* ---------------------------------------------
               ABORT
            --------------------------------------------- */

            if (
              error instanceof DOMException &&
              error.name ===
                "AbortError"
            ) {
              addSmsLog({
                status: "ignored",
                address:
                  sms.address ?? null,
                date: sms.date,
                body: sms.body,
                message:
                  `${smsLabel}: Request aborted.`,
              });

              break;
            }

            /* ---------------------------------------------
               NETWORK / UNKNOWN ERROR
            --------------------------------------------- */

            setSmsSummary((previous) => ({
              ...previous,
              errors:
                previous.errors + 1,
            }));

            addSmsLog({
              status: "error",
              address:
                sms.address ?? null,
              date: sms.date,
              body: sms.body,
              message:
                `${smsLabel}: Request failed.`,
              error:
                error instanceof Error
                  ? error.message
                  : "Unknown request error.",
            });
          }
        }

        /* =================================================
           FINAL DASHBOARD REFRESH
        ================================================= */

        if (
          financialChange &&
          !controller.signal.aborted &&
          dashboardMounted.current
        ) {
          addSmsLog({
            status:
              "financial-change",
            address: null,
            message:
              "At least one SMS changed financial data. Refreshing dashboard aggregates...",
          });

          await loadDashboard(true);

          addSmsLog({
            status: "complete",
            address: null,
            message:
              "Dashboard successfully refreshed after SMS financial changes.",
          });
        } else {
          addSmsLog({
            status: "complete",
            address: null,
            message:
              "SMS synchronization completed. No dashboard financial refresh was required.",
          });
        }
      } catch (error) {
        if (
          error instanceof DOMException &&
          error.name === "AbortError"
        ) {
          addSmsLog({
            status: "ignored",
            address: null,
            message:
              "SMS inbox synchronization was aborted.",
          });

          return;
        }

        setSmsSummary((previous) => ({
          ...previous,
          errors:
            previous.errors + 1,
        }));

        addSmsLog({
          status: "error",
          address: null,
          message:
            "Android SMS inbox synchronization failed.",
          error:
            error instanceof Error
              ? error.message
              : "Unknown SMS reader error.",
        });
      } finally {
        if (dashboardMounted.current) {
          setSmsRunning(false);
        }

        smsAbortController.current =
          null;
      }
    },
    [addSmsLog, loadDashboard]
  );

  /* =======================================================
     INITIAL LOAD
  ======================================================= */

  useEffect(() => {
    if (!mounted) return;

    void loadDashboard();

    void syncSmsInbox();
  }, [
    mounted,
    loadDashboard,
    syncSmsInbox,
  ]);

  /* =======================================================
     MANUAL SMS RESCAN
  ======================================================= */

  function handleSmsRescan() {
    if (smsRunning) {
      return;
    }

    smsSyncStarted.current = false;

    void syncSmsInbox();
  }

  /* =======================================================
     REFRESH
  ======================================================= */

  function handleRefresh() {
    if (loading || refreshing) {
      return;
    }

    void loadDashboard(true);
  }

  /* =======================================================
     HYDRATION GUARD
  ======================================================= */

  if (!mounted) {
    return (
      <main className="min-h-[100dvh] w-full overflow-x-clip bg-[#050505] text-white">
        <TopBar />

        <div className="w-full min-w-0 pt-16">
          <div className="mx-auto w-full max-w-[1800px] px-4 py-6 sm:px-6 sm:py-8 lg:px-8 xl:px-10 2xl:px-12">
            <DashboardLoading />
          </div>
        </div>
      </main>
    );
  }

  /* =======================================================
     MAIN UI
  ======================================================= */

  return (
    <main className="min-h-[100dvh] w-full max-w-full overflow-x-clip bg-[#050505] text-white">
      <TopBar />

      <div className="w-full min-w-0 pt-16">
        <div className="mx-auto w-full max-w-[1800px] min-w-0 px-4 py-6 sm:px-6 sm:py-8 lg:px-8 lg:py-10 xl:px-10 2xl:px-12">

          {/* =================================================
              HEADER
          ================================================= */}

          <section className="mb-6 w-full min-w-0 sm:mb-8">
            <div className="flex w-full min-w-0 flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-yellow-500/10 text-yellow-400">
                    <FileText
                      size={17}
                      strokeWidth={1.8}
                    />
                  </div>

                  <p className="text-xs font-medium uppercase tracking-[0.22em] text-yellow-500/60">
                    Overview
                  </p>
                </div>

                <h1 className="mt-3 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
                  Dashboard
                </h1>

                <p className="mt-2 max-w-2xl text-sm leading-6 text-white/35">
                  Overview of your SACCO members,
                  savings, loans and account
                  activity.
                </p>
              </div>

              <button
                type="button"
                onClick={handleRefresh}
                disabled={
                  loading ||
                  refreshing
                }
                className="flex h-11 w-full shrink-0 items-center justify-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.025] px-4 text-sm font-medium text-white/55 transition hover:border-white/[0.14] hover:bg-white/[0.05] hover:text-white disabled:cursor-not-allowed disabled:opacity-40 lg:w-auto"
              >
                <RefreshCw
                  size={16}
                  strokeWidth={1.8}
                  className={
                    refreshing
                      ? "animate-spin"
                      : ""
                  }
                />

                <span>Refresh</span>
              </button>
            </div>
          </section>

          {/* =================================================
              SMS MONITOR
          ================================================= */}

          <SmsMonitor
            logs={smsLogs}
            summary={smsSummary}
            running={smsRunning}
            expanded={smsExpanded}
            onToggle={() =>
              setSmsExpanded(
                (value) => !value
              )
            }
            onRescan={handleSmsRescan}
          />

          {/* =================================================
              ERROR
          ================================================= */}

          {error && (
            <section className="mb-6">
              <div className="flex w-full min-w-0 flex-col gap-4 rounded-2xl border border-red-500/15 bg-red-500/[0.05] p-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                <div className="flex min-w-0 items-start gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-red-500/10 text-red-400">
                    <AlertCircle
                      size={18}
                      strokeWidth={1.8}
                    />
                  </div>

                  <div className="min-w-0">
                    <p className="text-sm font-medium text-red-300">
                      Some dashboard data could not
                      be loaded
                    </p>

                    <p className="mt-1 break-words text-xs leading-5 text-red-300/50">
                      {error}
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() =>
                    void loadDashboard()
                  }
                  className="h-10 shrink-0 rounded-xl border border-red-400/10 bg-red-400/[0.06] px-4 text-xs font-medium text-red-300 transition hover:bg-red-400/10"
                >
                  Try again
                </button>
              </div>
            </section>
          )}

          {/* =================================================
              STATISTICS
          ================================================= */}

          {loading ? (
            <DashboardLoading />
          ) : (
            <>
              <section className="grid w-full min-w-0 grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
                <StatCard
                  title="Members"
                  value={
                    stats.members
                  }
                  subtitle={`${stats.activeMembers.toLocaleString()} active`}
                  icon={
                    <Users
                      size={19}
                      strokeWidth={1.8}
                    />
                  }
                  href="/dashboard/members"
                />

                <StatCard
                  title="Savings"
                  value={formatCurrency(
                    stats.savings
                  )}
                  subtitle="Current ledger balance"
                  icon={
                    <Wallet
                      size={19}
                      strokeWidth={1.8}
                    />
                  }
                  href="/dashboard/savings"
                />

                <StatCard
                  title="Loans"
                  value={
                    stats.loans
                  }
                  subtitle={formatCurrency(
                    stats.outstandingLoans
                  )}
                  icon={
                    <HandCoins
                      size={19}
                      strokeWidth={1.8}
                    />
                  }
                  href="/dashboard/loans"
                />

                <StatCard
                  title="Defaulters"
                  value={
                    stats.defaulters
                  }
                  subtitle="Members requiring attention"
                  icon={
                    <AlertCircle
                      size={19}
                      strokeWidth={1.8}
                    />
                  }
                  href="/dashboard/loans"
                />
              </section>

              {/* =================================================
                  SAVINGS BREAKDOWN
              ================================================= */}

              <section className="mt-6 grid w-full min-w-0 grid-cols-2 gap-3 sm:grid-cols-4">
                <MetricCard
                  label="Deposits"
                  value={formatCurrency(
                    stats.deposits
                  )}
                />

                <MetricCard
                  label="Adjustments"
                  value={formatCurrency(
                    stats.adjustments
                  )}
                />

                <MetricCard
                  label="Reversals"
                  value={formatCurrency(
                    stats.reversals
                  )}
                />

                <MetricCard
                  label="Net Savings"
                  value={formatCurrency(
                    stats.savings
                  )}
                />
              </section>

              {/* =================================================
                  MAIN GRID
              ================================================= */}

              <section className="mt-6 grid w-full min-w-0 gap-6 lg:grid-cols-[minmax(0,1.45fr)_minmax(300px,0.75fr)]">

                {/* RECENT ACTIVITY */}

                <div className="min-w-0 overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.025]">
                  <div className="flex items-center justify-between border-b border-white/[0.07] px-4 py-4 sm:px-5">
                    <div>
                      <h2 className="text-sm font-semibold text-white">
                        Recent Activity
                      </h2>

                      <p className="mt-1 text-xs text-white/30">
                        Latest activity across the SACCO
                      </p>
                    </div>

                    <span className="rounded-lg bg-white/[0.04] px-2.5 py-1 text-[10px] text-white/30">
                      Live
                    </span>
                  </div>

                  {activities.length ===
                  0 ? (
                    <div className="flex min-h-[160px] items-center justify-center p-6">
                      <div className="text-center">
                        <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.03] text-white/25">
                          <Bell
                            size={19}
                            strokeWidth={1.5}
                          />
                        </div>

                        <p className="mt-4 text-sm font-medium text-white/45">
                          No recent activity
                        </p>

                        <p className="mt-2 text-xs text-white/25">
                          New member, savings and loan
                          activity will appear here.
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="max-h-[280px] overflow-y-auto overscroll-contain scrollbar-thin scrollbar-track-transparent scrollbar-thumb-white/10 hover:scrollbar-thumb-white/20">
                      <div className="divide-y divide-white/[0.05]">
                        {activities.map(
                          (activity) => (
                            <ActivityRow
                              key={
                                activity.id
                              }
                              activity={
                                activity
                              }
                            />
                          )
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* QUICK ACCESS */}

                <div className="min-w-0 overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.025]">
                  <div className="border-b border-white/[0.07] px-4 py-4 sm:px-5">
                    <h2 className="text-sm font-semibold text-white">
                      Quick Access
                    </h2>

                    <p className="mt-1 text-xs text-white/30">
                      Frequently used features
                    </p>
                  </div>

                  <div className="max-h-[280px] overflow-y-auto overscroll-contain scrollbar-thin scrollbar-track-transparent scrollbar-thumb-white/10 hover:scrollbar-thumb-white/20">
                    <div className="grid gap-2 p-3 sm:p-4">
                      <QuickAccess
                        label="Members"
                        description="Manage member records"
                        icon={
                          <Users
                            size={18}
                            strokeWidth={1.8}
                          />
                        }
                        href="/dashboard/members"
                      />

                      <QuickAccess
                        label="Savings"
                        description="View savings records"
                        icon={
                          <Wallet
                            size={18}
                            strokeWidth={1.8}
                          />
                        }
                        href="/dashboard/savings"
                      />

                      <QuickAccess
                        label="Loans"
                        description="Manage loans"
                        icon={
                          <HandCoins
                            size={18}
                            strokeWidth={1.8}
                          />
                        }
                        href="/dashboard/loans"
                      />

                      <QuickAccess
                        label="Notifications"
                        description={`${stats.notifications.toLocaleString()} unread notifications`}
                        icon={
                          <Bell
                            size={18}
                            strokeWidth={1.8}
                          />
                        }
                        href="/dashboard/notifications"
                      />
                    </div>
                  </div>
                </div>
              </section>

              {/* =================================================
                  LOWER SECTION
              ================================================= */}

              <section className="mt-6 grid w-full min-w-0 gap-6 md:grid-cols-2">
                <div className="min-w-0 overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.025] p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-xs uppercase tracking-[0.18em] text-white/25">
                        Member Overview
                      </p>

                      <p className="mt-3 text-3xl font-semibold text-white">
                        {stats.members.toLocaleString()}
                      </p>

                      <p className="mt-1 text-xs text-white/30">
                        Registered members
                      </p>
                    </div>

                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-yellow-500/10 text-yellow-400">
                      <Users
                        size={19}
                        strokeWidth={1.8}
                      />
                    </div>
                  </div>

                  <div className="mt-5">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-[10px] text-white/25">
                        Active members
                      </span>

                      <span className="text-[10px] text-white/40">
                        {stats.members >
                        0
                          ? Math.round(
                              (stats.activeMembers /
                                stats.members) *
                                100
                            )
                          : 0}
                        %
                      </span>
                    </div>

                    <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                      <div
                        className="h-full rounded-full bg-yellow-500 transition-all"
                        style={{
                          width: `${
                            stats.members >
                            0
                              ? Math.min(
                                  100,
                                  (stats.activeMembers /
                                    stats.members) *
                                    100
                                )
                              : 0
                          }%`,
                        }}
                      />
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() =>
                      window.location.assign(
                        "/dashboard/members"
                      )
                    }
                    className="mt-5 flex items-center gap-2 text-xs font-medium text-yellow-400 transition hover:text-yellow-300"
                  >
                    <span>
                      Manage members
                    </span>

                    <ArrowRight
                      size={14}
                      strokeWidth={1.8}
                    />
                  </button>
                </div>

                <div className="min-w-0 overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.025] p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-xs uppercase tracking-[0.18em] text-white/25">
                        Savings Overview
                      </p>

                      <p className="mt-3 text-3xl font-semibold text-white">
                        {formatCurrency(
                          stats.savings
                        )}
                      </p>

                      <p className="mt-1 text-xs text-white/30">
                        Authoritative ledger balance
                      </p>
                    </div>

                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-yellow-500/10 text-yellow-400">
                      <Wallet
                        size={19}
                        strokeWidth={1.8}
                      />
                    </div>
                  </div>

                  <div className="mt-5 grid grid-cols-3 gap-3">
                    <MiniMetric
                      label="Deposits"
                      value={formatCurrency(
                        stats.deposits
                      )}
                    />

                    <MiniMetric
                      label="Adjustments"
                      value={formatCurrency(
                        stats.adjustments
                      )}
                    />

                    <MiniMetric
                      label="Reversals"
                      value={formatCurrency(
                        stats.reversals
                      )}
                    />
                  </div>

                  <button
                    type="button"
                    onClick={() =>
                      window.location.assign(
                        "/dashboard/savings"
                      )
                    }
                    className="mt-5 flex items-center gap-2 text-xs font-medium text-yellow-400 transition hover:text-yellow-300"
                  >
                    <span>
                      Open savings
                    </span>

                    <ArrowRight
                      size={14}
                      strokeWidth={1.8}
                    />
                  </button>
                </div>
              </section>

              <div className="mt-6 flex w-full min-w-0 flex-col gap-1 px-1 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-[10px] text-white/20">
                  GEO-SHUA SACCO Management
                </p>

                <p className="text-[10px] text-white/20">
                  Financial data sourced from domain APIs
                </p>
              </div>
            </>
          )}
        </div>
      </div>
    </main>
  );
}

/* =========================================================
   SMS MONITOR
========================================================= */

function SmsMonitor({
  logs,
  summary,
  running,
  expanded,
  onToggle,
  onRescan,
}: {
  logs: SmsLog[];
  summary: {
    found: number;
    processed: number;
    duplicates: number;
    ignored: number;
    errors: number;
    financialChanges: number;
  };
  running: boolean;
  expanded: boolean;
  onToggle: () => void;
  onRescan: () => void;
}) {
  return (
    <section className="mb-6 overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.025]">

      {/* =====================================================
          HEADER
      ===================================================== */}

      <div className="border-b border-white/[0.07] px-4 py-4 sm:px-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">

          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-500/10 text-blue-400">
              <Smartphone
                size={19}
                strokeWidth={1.8}
              />
            </div>

            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-white">
                  SMS Synchronization
                </h2>

                {running && (
                  <span className="flex items-center gap-1 rounded-full bg-blue-500/10 px-2 py-0.5 text-[9px] font-medium text-blue-400">
                    <Loader2
                      size={10}
                      className="animate-spin"
                    />
                    Running
                  </span>
                )}

                {!running &&
                  logs.length > 0 && (
                    <span className="rounded-full bg-green-500/10 px-2 py-0.5 text-[9px] font-medium text-green-400">
                      Complete
                    </span>
                  )}
              </div>

              <p className="mt-1 text-xs text-white/30">
                Android inbox → SMS processor → financial records
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onRescan}
              disabled={running}
              className="flex h-9 items-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.025] px-3 text-[10px] font-medium text-white/45 transition hover:bg-white/[0.05] hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
            >
              <RefreshCw
                size={13}
                className={
                  running
                    ? "animate-spin"
                    : ""
                }
              />

              Rescan
            </button>

            <button
              type="button"
              onClick={onToggle}
              className="flex h-9 items-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.025] px-3 text-[10px] font-medium text-white/45 transition hover:bg-white/[0.05] hover:text-white"
            >
              {expanded ? (
                <>
                  <ChevronUp size={13} />
                  Hide
                </>
              ) : (
                <>
                  <ChevronDown size={13} />
                  Show
                </>
              )}
            </button>
          </div>
        </div>

        {/* ===================================================
            SUMMARY
        =================================================== */}

        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <SmsSummaryMetric
            label="Found"
            value={summary.found}
            icon={
              <Inbox size={13} />
            }
          />

          <SmsSummaryMetric
            label="Processed"
            value={summary.processed}
            icon={
              <CheckCircle2
                size={13}
              />
            }
          />

          <SmsSummaryMetric
            label="Duplicates"
            value={summary.duplicates}
            icon={
              <Info size={13} />
            }
          />

          <SmsSummaryMetric
            label="Ignored"
            value={summary.ignored}
            icon={
              <Clock size={13} />
            }
          />

          <SmsSummaryMetric
            label="Errors"
            value={summary.errors}
            icon={
              <XCircle size={13} />
            }
          />

          <SmsSummaryMetric
            label="Financial changes"
            value={
              summary.financialChanges
            }
            icon={
              <Zap size={13} />
            }
          />
        </div>
      </div>

      {/* =====================================================
          LOG STREAM
      ===================================================== */}

      {expanded && (
        <div className="max-h-[520px] overflow-y-auto overscroll-contain scrollbar-thin scrollbar-track-transparent scrollbar-thumb-white/10">

          {logs.length === 0 ? (
            <div className="flex min-h-[180px] items-center justify-center p-8">
              <div className="text-center">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.03] text-white/20">
                  <Smartphone
                    size={20}
                  />
                </div>

                <p className="mt-4 text-sm text-white/40">
                  Waiting for SMS synchronization
                </p>

                <p className="mt-2 text-xs text-white/20">
                  Android SMS activity will appear here.
                </p>
              </div>
            </div>
          ) : (
            <div className="divide-y divide-white/[0.05]">
              {logs.map((log) => (
                <SmsLogRow
                  key={log.id}
                  log={log}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/* =========================================================
   SMS SUMMARY METRIC
========================================================= */

function SmsSummaryMetric({
  label,
  value,
  icon,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
}) {
  return (
    <div className="min-w-0 rounded-xl border border-white/[0.06] bg-black/20 px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-white/25">
        {icon}

        <span className="truncate text-[9px] uppercase tracking-[0.1em]">
          {label}
        </span>
      </div>

      <p className="mt-1 text-sm font-semibold text-white/70">
        {value.toLocaleString()}
      </p>
    </div>
  );
}

/* =========================================================
   SMS LOG ROW
========================================================= */

function SmsLogRow({
  log,
}: {
  log: SmsLog;
}) {
  const [expanded, setExpanded] =
    useState(false);

  const config =
    getSmsStatusConfig(log.status);

  return (
    <div className="px-4 py-4 sm:px-5">

      <div className="flex min-w-0 items-start gap-3">

        {/* STATUS ICON */}

        <div
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${config.background} ${config.text}`}
        >
          {config.icon}
        </div>

        {/* MAIN CONTENT */}

        <div className="min-w-0 flex-1">

          <div className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-4">

            <div className="min-w-0">
              <p
                className={`text-xs font-medium ${config.text}`}
              >
                {log.message}
              </p>

              {log.address && (
                <p className="mt-1 truncate text-[10px] text-white/25">
                  Sender: {log.address}
                </p>
              )}
            </div>

            <span className="shrink-0 text-[9px] text-white/20">
              {new Date(
                log.timestamp
              ).toLocaleTimeString(
                "en-KE",
                {
                  hour: "2-digit",
                  minute:
                    "2-digit",
                  second:
                    "2-digit",
                }
              )}
            </span>
          </div>

          {/* SMS METADATA */}

          {(log.body ||
            log.httpStatus ||
            log.date) && (
            <div className="mt-2 flex flex-wrap gap-2">

              {log.date && (
                <span className="rounded-md bg-white/[0.035] px-2 py-1 text-[9px] text-white/25">
                  SMS date:{" "}
                  {formatSmsDate(
                    log.date
                  )}
                </span>
              )}

              {log.httpStatus && (
                <span className="rounded-md bg-white/[0.035] px-2 py-1 text-[9px] text-white/25">
                  HTTP{" "}
                  {log.httpStatus}
                </span>
              )}

              {log.body && (
                <button
                  type="button"
                  onClick={() =>
                    setExpanded(
                      (value) =>
                        !value
                    )
                  }
                  className="rounded-md bg-white/[0.035] px-2 py-1 text-[9px] text-white/35 transition hover:bg-white/[0.06] hover:text-white/60"
                >
                  {expanded
                    ? "Hide SMS"
                    : "View SMS"}
                </button>
              )}
            </div>
          )}

          {/* =================================================
              SMS BODY + SERVER RESPONSE
          ================================================= */}

          {expanded && (
            <div className="mt-3 space-y-3">

              {log.body && (
                <div className="overflow-hidden rounded-xl border border-white/[0.06] bg-black/30">
                  <div className="flex items-center gap-2 border-b border-white/[0.05] px-3 py-2">
                    <Inbox
                      size={12}
                      className="text-white/25"
                    />

                    <span className="text-[9px] font-medium uppercase tracking-[0.12em] text-white/25">
                      SMS received
                    </span>
                  </div>

                  <pre className="max-h-[180px] overflow-auto whitespace-pre-wrap break-words p-3 font-mono text-[10px] leading-5 text-white/50">
                    {log.body}
                  </pre>
                </div>
              )}

              {log.response !==
                undefined && (
                <div className="overflow-hidden rounded-xl border border-white/[0.06] bg-black/30">
                  <div className="flex items-center gap-2 border-b border-white/[0.05] px-3 py-2">
                    <Server
                      size={12}
                      className="text-white/25"
                    />

                    <span className="text-[9px] font-medium uppercase tracking-[0.12em] text-white/25">
                      API response
                    </span>
                  </div>

                  <pre className="max-h-[220px] overflow-auto whitespace-pre-wrap break-words p-3 font-mono text-[10px] leading-5 text-white/50">
                    {JSON.stringify(
                      log.response,
                      null,
                      2
                    )}
                  </pre>
                </div>
              )}

              {log.error && (
                <div className="overflow-hidden rounded-xl border border-red-500/10 bg-red-500/[0.04]">
                  <div className="flex items-center gap-2 border-b border-red-500/[0.08] px-3 py-2">
                    <XCircle
                      size={12}
                      className="text-red-400"
                    />

                    <span className="text-[9px] font-medium uppercase tracking-[0.12em] text-red-400/60">
                      Error
                    </span>
                  </div>

                  <pre className="whitespace-pre-wrap break-words p-3 font-mono text-[10px] leading-5 text-red-300/60">
                    {log.error}
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* =========================================================
   SMS STATUS CONFIG
========================================================= */

function getSmsStatusConfig(
  status: SmsLogStatus
) {
  switch (status) {
    case "scanning":
      return {
        background:
          "bg-blue-500/10",
        text: "text-blue-400",
        icon: (
          <Smartphone
            size={16}
          />
        ),
      };

    case "received":
      return {
        background:
          "bg-cyan-500/10",
        text: "text-cyan-400",
        icon: (
          <Inbox size={16} />
        ),
      };

    case "sending":
      return {
        background:
          "bg-purple-500/10",
        text: "text-purple-400",
        icon: (
          <Send size={16} />
        ),
      };

    case "processed":
      return {
        background:
          "bg-green-500/10",
        text: "text-green-400",
        icon: (
          <CheckCircle2
            size={16}
          />
        ),
      };

    case "financial-change":
      return {
        background:
          "bg-yellow-500/10",
        text: "text-yellow-400",
        icon: (
          <Zap size={16} />
        ),
      };

    case "duplicate":
      return {
        background:
          "bg-orange-500/10",
        text: "text-orange-400",
        icon: (
          <Info size={16} />
        ),
      };

    case "ignored":
      return {
        background:
          "bg-white/[0.05]",
        text: "text-white/40",
        icon: (
          <Clock size={16} />
        ),
      };

    case "error":
      return {
        background:
          "bg-red-500/10",
        text: "text-red-400",
        icon: (
          <XCircle size={16} />
        ),
      };

    case "complete":
    default:
      return {
        background:
          "bg-white/[0.05]",
        text: "text-white/40",
        icon: (
          <CheckCircle2
            size={16}
          />
        ),
      };
  }
}

/* =========================================================
   STAT CARD
========================================================= */

function StatCard({
  title,
  value,
  subtitle,
  icon,
  href,
}: {
  title: string;
  value: string | number;
  subtitle: string;
  icon: React.ReactNode;
  href: string;
}) {
  return (
    <button
      type="button"
      onClick={() =>
        window.location.assign(href)
      }
      className="group min-w-0 overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.025] p-4 text-left transition hover:border-white/[0.12] hover:bg-white/[0.04] sm:p-5"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium text-white/35">
            {title}
          </p>

          <p className="mt-3 truncate text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            {value}
          </p>

          <p className="mt-2 truncate text-[10px] text-white/25">
            {subtitle}
          </p>
        </div>

        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-yellow-500/10 text-yellow-400 transition group-hover:bg-yellow-500/15 sm:h-10 sm:w-10">
          {icon}
        </div>
      </div>
    </button>
  );
}

/* =========================================================
   METRIC CARD
========================================================= */

function MetricCard({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="min-w-0 overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.025] p-4">
      <p className="truncate text-[10px] uppercase tracking-[0.14em] text-white/25">
        {label}
      </p>

      <p className="mt-2 truncate text-sm font-semibold text-white/75">
        {value}
      </p>
    </div>
  );
}

/* =========================================================
   MINI METRIC
========================================================= */

function MiniMetric({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="min-w-0">
      <p className="truncate text-[9px] uppercase tracking-[0.12em] text-white/20">
        {label}
      </p>

      <p className="mt-1 truncate text-xs font-medium text-white/55">
        {value}
      </p>
    </div>
  );
}

/* =========================================================
   QUICK ACCESS
========================================================= */

function QuickAccess({
  label,
  description,
  icon,
  href,
}: {
  label: string;
  description: string;
  icon: React.ReactNode;
  href: string;
}) {
  return (
    <button
      type="button"
      onClick={() =>
        window.location.assign(href)
      }
      className="group flex min-w-0 items-center gap-3 rounded-xl border border-transparent px-3 py-3 text-left transition hover:border-white/[0.06] hover:bg-white/[0.04]"
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/[0.04] text-white/40 transition group-hover:bg-yellow-500/10 group-hover:text-yellow-400">
        {icon}
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-white/65 group-hover:text-white">
          {label}
        </p>

        <p className="mt-0.5 truncate text-[10px] text-white/25">
          {description}
        </p>
      </div>

      <ArrowRight
        size={14}
        strokeWidth={1.8}
        className="shrink-0 text-white/15 transition group-hover:translate-x-0.5 group-hover:text-white/40"
      />
    </button>
  );
}

/* =========================================================
   ACTIVITY ROW
========================================================= */

function ActivityRow({
  activity,
}: {
  activity: DashboardActivity;
}) {
  const icons = {
    member: (
      <Users
        size={15}
        strokeWidth={1.8}
      />
    ),

    saving: (
      <Wallet
        size={15}
        strokeWidth={1.8}
      />
    ),

    loan: (
      <HandCoins
        size={15}
        strokeWidth={1.8}
      />
    ),

    notification: (
      <Bell
        size={15}
        strokeWidth={1.8}
      />
    ),
  };

  return (
    <div className="flex min-w-0 items-center gap-3 px-4 py-3.5 sm:px-5">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/[0.04] text-white/35">
        {icons[activity.type]}
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-white/65">
          {activity.title}
        </p>

        <p className="mt-0.5 truncate text-[10px] text-white/25">
          {activity.description}
        </p>
      </div>

      <span className="shrink-0 text-[10px] text-white/20">
        {activity.time}
      </span>
    </div>
  );
}

/* =========================================================
   LOADING
========================================================= */

function DashboardLoading() {
  return (
    <div className="w-full min-w-0 animate-pulse space-y-6">
      <section className="grid w-full min-w-0 grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {Array.from({
          length: 4,
        }).map((_, index) => (
          <div
            key={index}
            className="h-[125px] min-w-0 rounded-2xl border border-white/[0.06] bg-white/[0.025]"
          />
        ))}
      </section>

      <section className="grid w-full min-w-0 grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({
          length: 4,
        }).map((_, index) => (
          <div
            key={index}
            className="h-[85px] rounded-2xl border border-white/[0.06] bg-white/[0.025]"
          />
        ))}
      </section>

      <section className="grid w-full min-w-0 gap-6 lg:grid-cols-[minmax(0,1.45fr)_minmax(300px,0.75fr)]">
        <div className="min-h-[360px] rounded-2xl border border-white/[0.06] bg-white/[0.025]" />

        <div className="min-h-[360px] rounded-2xl border border-white/[0.06] bg-white/[0.025]" />
      </section>

      <section className="grid w-full min-w-0 gap-6 md:grid-cols-2">
        <div className="h-[220px] rounded-2xl border border-white/[0.06] bg-white/[0.025]" />

        <div className="h-[220px] rounded-2xl border border-white/[0.06] bg-white/[0.025]" />
      </section>
    </div>
  );
}