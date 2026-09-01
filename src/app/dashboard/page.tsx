"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  ArrowRight,
  Bell,
  CheckCircle2,
  FileText,
  HandCoins,
  Inbox,
  Loader2,
  RefreshCw,
  Smartphone,
  Users,
  Wallet,
} from "lucide-react";

import TopBar from "@/components/dashboard/TopBar";
import SmsReader from "@/lib/sms/SmsReader";

/* =========================================================
   CONSTANTS
========================================================= */

/**
 * IMPORTANT
 *
 * Browser:
 *   Uses the current application origin.
 *
 * Android/Capacitor:
 *   Uses NEXT_PUBLIC_API_BASE_URL when provided.
 *
 * This prevents localhost WebView requests from incorrectly
 * going to:
 *
 *   capacitor://localhost/api/...
 *
 * while still allowing normal browser/local testing.
 *
 * Set in .env.local for Android/native builds:
 *
 * NEXT_PUBLIC_API_BASE_URL=https://YOUR-DEPLOYMENT.vercel.app
 *
 * Do not include a trailing slash.
 */
const SMS_SWEEP_INTERVAL_MS = 5 * 60 * 1000;

const MAX_SMS_HISTORY = 50;

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

  /*
   * Normal dashboard APIs.
   */
  data?: T;

  /*
   * SMS API.
   */
  status?: string;
  stage?: string;
  processed?: boolean;
  duplicate?: boolean;
  ignored?: boolean;
  financialChange?: boolean;

  type?:
    | "loan"
    | "savings"
    | "unknown";

  received?: unknown;
  parser?: unknown;
  classifier?: unknown;
  processor?: unknown;

  /*
   * /api/sms/process returns the processor result
   * at the TOP LEVEL.
   */
  result?: T;

  error?: string;

  receivedAt?: string;
};

type MemberRecord = {
  id?: string;
  _id?: string;

  firstName?: string;
  middleName?: string;
  lastName?: string;

  name?: string;
  fullName?: string;

  status?: string;
  isActive?: boolean;

  createdAt?: string;
  updatedAt?: string;
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
  principal?: unknown;

  createdAt?: string;
  updatedAt?: string;

  memberName?: string;
  memberId?: string;

  loanNumber?: string;
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

/* =========================================================
   SMS TYPES
========================================================= */

type SmsActivityStatus =
  | "idle"
  | "scanning"
  | "detected"
  | "processing"
  | "savings"
  | "loan"
  | "duplicate"
  | "ignored"
  | "error"
  | "complete";

type SmsActivity = {
  status: SmsActivityStatus;

  message: string;

  reference?: string;

  amount?: number;

  senderName?: string;

  transactionType?:
    | "loan"
    | "savings"
    | "unknown";

  accountNumber?: string;

  address?: string | null;

  date?: number;

  body?: string;

  response?: unknown;

  error?: string;

  timestamp: number;
};

type SmsTransactionResult = {
  status?:
    | "processed"
    | "duplicate";

  type?:
    | "savings"
    | "loan"
    | "unknown";

  transaction?: {
    reference?: string;

    amount?: number;

    senderName?: string;

    transactionType?:
      | "loan"
      | "savings"
      | "unknown";

    accountNumber?: string;

    transactionDate?:
      | string
      | Date;

    rawMessage?: string;

    address?: string | null;

    smsDate?: number;
  };

  member?: {
    id?: string;
    name?: string;
  };

  savingsAccount?: {
    id?: string;
    accountNumber?: string;
  };

  savingsTransaction?: unknown;

  loan?: unknown;

  repayment?: unknown;
};

type SmsApiResponse =
  ApiResponse<SmsTransactionResult>;

/* =========================================================
   DEFAULTS
========================================================= */

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
   API URL
========================================================= */

/**
 * Resolve the SMS API URL at runtime.
 *
 * Browser:
 *   /api/sms/process
 *
 * Android/native:
 *   NEXT_PUBLIC_API_BASE_URL + /api/sms/process
 *
 * This means:
 *
 * LOCAL BROWSER
 *   http://localhost:3000/api/sms/process
 *
 * PRODUCTION BROWSER
 *   https://your-domain/api/sms/process
 *
 * ANDROID
 *   https://your-deployment/api/sms/process
 */
function getSmsProcessUrl(): string {
  const base =
    typeof process !==
      "undefined"
      ? process.env
          .NEXT_PUBLIC_API_BASE_URL
      : undefined;

  const cleanBase =
    typeof base === "string"
      ? base.trim().replace(
          /\/+$/,
          "",
        )
      : "";

  /*
   * Explicit environment configuration wins.
   */
  if (cleanBase) {
    return `${cleanBase}/api/sms/process`;
  }

  /*
   * Normal browser/PWA.
   *
   * Relative requests remain same-origin.
   */
  if (
    typeof window !==
    "undefined"
  ) {
    return `${window.location.origin}/api/sms/process`;
  }

  return "/api/sms/process";
}

/* =========================================================
   SAFE HELPERS
========================================================= */

function safeNumber(
  value: unknown,
): number {
  if (
    typeof value === "number"
  ) {
    return Number.isFinite(
      value,
    )
      ? value
      : 0;
  }

  if (
    typeof value === "string"
  ) {
    const parsed =
      Number(value);

    return Number.isFinite(
      parsed,
    )
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
  fallback: string,
): string {
  return (
    item.id ||
    item._id ||
    fallback
  );
}

function getDate(
  item: {
    createdAt?: string;
    updatedAt?: string;
  },
): string {
  return (
    item.createdAt ||
    item.updatedAt ||
    ""
  );
}

function formatRelativeTime(
  value: string,
): string {
  if (!value) {
    return "";
  }

  const timestamp =
    new Date(
      value,
    ).getTime();

  if (
    !Number.isFinite(
      timestamp,
    )
  ) {
    return "";
  }

  const difference =
    Math.max(
      0,
      Date.now() -
        timestamp,
    );

  const seconds =
    difference / 1000;

  if (
    seconds < 60
  ) {
    return "Just now";
  }

  const minutes =
    Math.floor(
      seconds / 60,
    );

  if (
    minutes < 60
  ) {
    return `${minutes}m ago`;
  }

  const hours =
    Math.floor(
      minutes / 60,
    );

  if (
    hours < 24
  ) {
    return `${hours}h ago`;
  }

  const days =
    Math.floor(
      hours / 24,
    );

  if (
    days < 7
  ) {
    return `${days}d ago`;
  }

  return new Date(
    timestamp,
  ).toLocaleDateString(
    "en-KE",
    {
      day: "numeric",
      month: "short",
    },
  );
}

function formatCurrency(
  value: number,
): string {
  return `KES ${safeNumber(
    value,
  ).toLocaleString(
    "en-KE",
    {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    },
  )}`;
}

function formatSmsDate(
  date?: number,
): string {
  if (
    typeof date !== "number" ||
    !Number.isFinite(date)
  ) {
    return "Unknown date";
  }

  const parsed =
    new Date(date);

  if (
    Number.isNaN(
      parsed.getTime(),
    )
  ) {
    return "Unknown date";
  }

  return parsed.toLocaleString(
    "en-KE",
    {
      dateStyle: "medium",
      timeStyle: "short",
    },
  );
}

/* =========================================================
   API RESPONSE EXTRACTION
========================================================= */

function extractRecords<T>(
  result: ApiResponse,
): T[] {
  const data =
    result?.data;

  if (
    Array.isArray(data)
  ) {
    return data as T[];
  }

  if (
    data &&
    typeof data ===
      "object"
  ) {
    const recordData =
      data as Record<
        string,
        unknown
      >;

    const candidates = [
      recordData.members,
      recordData.loans,
      recordData.notifications,
      recordData.transactions,
      recordData.items,
      recordData.results,
      recordData.data,
    ];

    for (
      const candidate of
        candidates
    ) {
      if (
        Array.isArray(
          candidate,
        )
      ) {
        return candidate as T[];
      }
    }
  }

  return [];
}

/* =========================================================
   SMS HELPERS
========================================================= */

function getSmsKey(
  sms: {
    address: string | null;
    body: string;
    date: number;
  },
): string {
  return [
    sms.address || "",
    sms.date,
    sms.body,
  ].join("|");
}

function looksLikeGeoShuaBankSms(
  body: string,
): boolean {
  if (
    typeof body !==
    "string"
  ) {
    return false;
  }

  return (
    /\bConfirmed\./i.test(
      body,
    ) &&
    /\bKES\s*[\d,]+(?:\.\d{1,2})?\b/i.test(
      body,
    ) &&
    /\breceived\s+from\b/i.test(
      body,
    ) &&
    /\bfor\s+account\b/i.test(
      body,
    )
  );
}

function isSmsTransactionType(
  value: unknown,
): value is
  | "loan"
  | "savings"
  | "unknown" {
  return (
    value === "loan" ||
    value === "savings" ||
    value === "unknown"
  );
}

/**
 * The API returns:
 *
 * {
 *   success: true,
 *   result: {
 *     status: "processed",
 *     type: "savings" | "loan",
 *     ...
 *   }
 * }
 */
function getSmsResult(
  response: SmsApiResponse,
): SmsTransactionResult | null {
  if (
    response?.result &&
    typeof response.result ===
      "object"
  ) {
    return response.result;
  }

  return null;
}

/* =========================================================
   SMS STATUS MESSAGE
========================================================= */

function getSmsActivityMessage(
  activity: SmsActivity,
): string {
  switch (
    activity.status
  ) {
    case "idle":
      return "Watching for new bank SMS";

    case "scanning":
      return "Checking for new bank transactions…";

    case "detected":
      return activity.senderName
        ? `Bank payment detected from ${activity.senderName}`
        : "Bank payment detected";

    case "processing":
      return activity.senderName
        ? `Processing ${
            activity.amount
              ? formatCurrency(
                  activity.amount,
                )
              : "payment"
          } from ${activity.senderName}…`
        : "Processing bank payment…";

    case "savings":
      return activity.amount
        ? `Savings deposit recorded · ${formatCurrency(
            activity.amount,
          )}`
        : "Savings deposit recorded";

    case "loan":
      return activity.amount
        ? `Loan repayment recorded · ${formatCurrency(
            activity.amount,
          )}`
        : "Loan repayment recorded";

    case "duplicate":
      return activity.reference
        ? `Payment already recorded · ${activity.reference}`
        : "Payment already recorded";

    case "ignored":
      return "Bank message ignored";

    case "error":
      return (
        activity.error ||
        "Bank SMS could not be processed"
      );

    case "complete":
      return "Bank transaction monitoring active";

    default:
      return activity.message;
  }
}

/* =========================================================
   DASHBOARD
========================================================= */

export default function DashboardPage() {
  const [stats, setStats] =
    useState<DashboardStats>(
      DEFAULT_STATS,
    );

  const [activities, setActivities] =
    useState<
      DashboardActivity[]
    >([]);

  const [loading, setLoading] =
    useState(true);

  const [refreshing, setRefreshing] =
    useState(false);

  const [mounted, setMounted] =
    useState(false);

  const dashboardMounted =
    useRef(false);

  /* =======================================================
     SMS STATE
  ======================================================= */

  const [smsActivity, setSmsActivity] =
    useState<SmsActivity>({
      status: "idle",

      message:
        "Watching for new bank SMS",

      timestamp:
        Date.now(),
    });

  const [smsDetailsOpen, setSmsDetailsOpen] =
    useState(false);

  const [smsHistory, setSmsHistory] =
    useState<SmsActivity[]>(
      [],
    );

  const smsRunning =
    useRef(false);

  const smsAbortController =
    useRef<AbortController | null>(
      null,
    );

  const smsTimer =
    useRef<number | null>(
      null,
    );

  const resetTimer =
    useRef<number | null>(
      null,
    );

  /*
   * Prevent duplicate local submissions during the
   * current dashboard lifecycle.
   */
  const processedSmsKeys =
    useRef(
      new Set<string>(),
    );

  /* =======================================================
     MOUNT / UNMOUNT
  ======================================================= */

  useEffect(() => {
    dashboardMounted.current =
      true;

    setMounted(true);

    return () => {
      dashboardMounted.current =
        false;

      smsAbortController.current?.abort();

      if (
        smsTimer.current !==
        null
      ) {
        window.clearInterval(
          smsTimer.current,
        );

        smsTimer.current =
          null;
      }

      if (
        resetTimer.current !==
        null
      ) {
        window.clearTimeout(
          resetTimer.current,
        );

        resetTimer.current =
          null;
      }
    };
  }, []);

  /* =======================================================
     SMS ACTIVITY UPDATE
  ======================================================= */

  const updateSmsActivity =
    useCallback(
      (
        next: Omit<
          SmsActivity,
          "timestamp"
        >,
      ) => {
        if (
          !dashboardMounted.current
        ) {
          return;
        }

        const activity:
          SmsActivity = {
          ...next,

          timestamp:
            Date.now(),
        };

        setSmsActivity(
          activity,
        );

        setSmsHistory(
          (
            previous,
          ) => [
            activity,
            ...previous,
          ].slice(
            0,
            MAX_SMS_HISTORY,
          ),
        );
      },
      [],
    );

  /* =======================================================
     LOAD DASHBOARD
  ======================================================= */

  const loadDashboard =
    useCallback(
      async (
        isRefresh = false,
      ) => {
        if (
          !dashboardMounted.current
        ) {
          return;
        }

        try {
          if (
            isRefresh
          ) {
            setRefreshing(
              true,
            );
          } else {
            setLoading(
              true,
            );
          }

          const [
            savingsResponse,
            membersResponse,
            loansResponse,
            notificationsResponse,
          ] =
            await Promise.allSettled(
              [
                fetch(
                  "/api/savings/summary",
                  {
                    method:
                      "GET",
                    cache:
                      "no-store",
                    headers: {
                      Accept:
                        "application/json",
                    },
                  },
                ),

                fetch(
                  "/api/members",
                  {
                    method:
                      "GET",
                    cache:
                      "no-store",
                    headers: {
                      Accept:
                        "application/json",
                    },
                  },
                ),

                fetch(
                  "/api/loans",
                  {
                    method:
                      "GET",
                    cache:
                      "no-store",
                    headers: {
                      Accept:
                        "application/json",
                    },
                  },
                ),

                fetch(
                  "/api/notifications",
                  {
                    method:
                      "GET",
                    cache:
                      "no-store",
                    headers: {
                      Accept:
                        "application/json",
                    },
                  },
                ),
              ],
            );

          /* =================================================
             SAVINGS
          ================================================= */

          let savings:
            SavingsSummary =
            {};

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
                response.ok &&
                json.success !==
                  false
              ) {
                savings =
                  json.data ||
                  {};
              }
            } catch {
              savings =
                {};
            }
          }

          /* =================================================
             MEMBERS
          ================================================= */

          let members:
            MemberRecord[] =
            [];

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
                response.ok &&
                json.success !==
                  false
              ) {
                members =
                  extractRecords<MemberRecord>(
                    json,
                  );
              }
            } catch {
              members =
                [];
            }
          }

          /* =================================================
             LOANS
          ================================================= */

          let loans:
            LoanRecord[] =
            [];

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
                response.ok &&
                json.success !==
                  false
              ) {
                loans =
                  extractRecords<LoanRecord>(
                    json,
                  );
              }
            } catch {
              loans =
                [];
            }
          }

          /* =================================================
             NOTIFICATIONS
          ================================================= */

          let notifications:
            NotificationRecord[] =
            [];

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
                response.ok &&
                json.success !==
                  false
              ) {
                notifications =
                  extractRecords<NotificationRecord>(
                    json,
                  );
              }
            } catch {
              notifications =
                [];
            }
          }

          if (
            !dashboardMounted.current
          ) {
            return;
          }

          /* =================================================
             MEMBER STATS
          ================================================= */

          const memberCountFromSavings =
            safeNumber(
              savings.memberCount,
            );

          const totalMembers =
            members.length ||
            memberCountFromSavings;

          const activeMembers =
            members.length >
            0
              ? members.filter(
                  (
                    member,
                  ) => {
                    if (
                      member.isActive ===
                      true
                    ) {
                      return true;
                    }

                    return (
                      typeof member.status ===
                        "string" &&
                      member.status
                        .trim()
                        .toLowerCase() ===
                        "active"
                    );
                  },
                ).length
              : memberCountFromSavings;

          /* =================================================
             LOAN STATS
          ================================================= */

          const loanCount =
            loans.length;

          let outstandingLoans =
            0;

          let defaulters =
            0;

          for (
            const loan of
              loans
          ) {
            const outstanding =
              safeNumber(
                loan.outstandingBalance ??
                  loan.remainingBalance ??
                  loan.balance,
              );

            outstandingLoans +=
              Math.max(
                0,
                outstanding,
              );

            const status =
              (
                loan.status ||
                loan.loanStatus ||
                ""
              )
                .trim()
                .toLowerCase();

            if (
              [
                "default",
                "defaulted",
                "overdue",
                "defaulter",
              ].includes(
                status,
              )
            ) {
              defaulters +=
                1;
            }
          }

          /* =================================================
             NOTIFICATIONS
          ================================================= */

          const notificationCount =
            notifications.filter(
              (
                notification,
              ) => {
                if (
                  notification.read ===
                  true
                ) {
                  return false;
                }

                if (
                  notification.status
                    ?.trim()
                    .toLowerCase() ===
                  "read"
                ) {
                  return false;
                }

                return true;
              },
            ).length;

          /* =================================================
             UPDATE STATS
          ================================================= */

          setStats({
            members:
              totalMembers,

            activeMembers,

            savings:
              safeNumber(
                savings.totalBalance,
              ),

            deposits:
              safeNumber(
                savings.totalDeposits,
              ),

            adjustments:
              safeNumber(
                savings.totalAdjustments,
              ),

            reversals:
              safeNumber(
                savings.totalReversals,
              ),

            loans:
              loanCount,

            outstandingLoans,

            defaulters,

            notifications:
              notificationCount,
          });

          /* =================================================
             BUILD RECENT ACTIVITY
          ================================================= */

          const nextActivities:
            Array<
              DashboardActivity & {
                sortTimestamp: number;
              }
            > = [];

          members
            .slice()
            .sort(
              (
                a,
                b,
              ) =>
                new Date(
                  getDate(b),
                ).getTime() -
                new Date(
                  getDate(a),
                ).getTime(),
            )
            .slice(
              0,
              4,
            )
            .forEach(
              (
                member,
                index,
              ) => {
                const name =
                  member.name ||
                  member.fullName ||
                  [
                    member.firstName,
                    member.middleName,
                    member.lastName,
                  ]
                    .filter(
                      Boolean,
                    )
                    .join(
                      " ",
                    ) ||
                  "Member";

                const date =
                  getDate(
                    member,
                  );

                nextActivities.push(
                  {
                    id: `member-${getId(
                      member,
                      String(
                        index,
                      ),
                    )}`,

                    title:
                      "Member activity",

                    description:
                      `${name} was recently recorded.`,

                    time:
                      formatRelativeTime(
                        date,
                      ),

                    type:
                      "member",

                    sortTimestamp:
                      new Date(
                        date,
                      ).getTime() ||
                      0,
                  },
                );
              },
            );

          loans
            .slice()
            .sort(
              (
                a,
                b,
              ) =>
                new Date(
                  getDate(b),
                ).getTime() -
                new Date(
                  getDate(a),
                ).getTime(),
            )
            .slice(
              0,
              4,
            )
            .forEach(
              (
                loan,
                index,
              ) => {
                const date =
                  getDate(
                    loan,
                  );

                nextActivities.push(
                  {
                    id: `loan-${getId(
                      loan,
                      String(
                        index,
                      ),
                    )}`,

                    title:
                      "Loan activity",

                    description:
                      loan.memberName
                        ? `${loan.memberName} has loan activity.`
                        : "A loan record was recently updated.",

                    time:
                      formatRelativeTime(
                        date,
                      ),

                    type:
                      "loan",

                    sortTimestamp:
                      new Date(
                        date,
                      ).getTime() ||
                      0,
                  },
                );
              },
            );

          notifications
            .slice()
            .sort(
              (
                a,
                b,
              ) =>
                new Date(
                  getDate(b),
                ).getTime() -
                new Date(
                  getDate(a),
                ).getTime(),
            )
            .slice(
              0,
              4,
            )
            .forEach(
              (
                notification,
                index,
              ) => {
                const date =
                  getDate(
                    notification,
                  );

                nextActivities.push(
                  {
                    id: `notification-${getId(
                      notification,
                      String(
                        index,
                      ),
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
                        date,
                      ),

                    type:
                      "notification",

                    sortTimestamp:
                      new Date(
                        date,
                      ).getTime() ||
                      0,
                  },
                );
              },
            );

          setActivities(
            nextActivities
              .sort(
                (
                  a,
                  b,
                ) =>
                  b.sortTimestamp -
                  a.sortTimestamp,
              )
              .slice(
                0,
                12,
              )
              .map(
                ({
                  sortTimestamp:
                    _sortTimestamp,
                  ...activity
                }) =>
                  activity,
              ),
          );
        } catch (error) {
          console.error(
            "Failed to load dashboard:",
            error,
          );
        } finally {
          if (
            dashboardMounted.current
          ) {
            setLoading(
              false,
            );

            setRefreshing(
              false,
            );
          }
        }
      },
      [],
    );

  /* =======================================================
     PROCESS ONE SMS
  ======================================================= */

  const processSms =
    useCallback(
      async (
        sms: {
          address:
            | string
            | null;

          body:
            string;

          date:
            number;
        },
        signal: AbortSignal,
      ): Promise<boolean> => {
        const key =
          getSmsKey(
            sms,
          );

        /* -------------------------------------------------
           ALREADY PROCESSED
        ------------------------------------------------- */

        if (
          processedSmsKeys.current.has(
            key,
          )
        ) {
          return false;
        }

        /* -------------------------------------------------
           VALIDATION
        ------------------------------------------------- */

        if (
          typeof sms.body !==
            "string" ||
          !sms.body.trim()
        ) {
          return false;
        }

        if (
          typeof sms.date !==
            "number" ||
          !Number.isFinite(
            sms.date,
          )
        ) {
          return false;
        }

        /* -------------------------------------------------
           CLIENT PRE-FILTER
        ------------------------------------------------- */

        if (
          !looksLikeGeoShuaBankSms(
            sms.body,
          )
        ) {
          /*
           * Unrelated messages are not financial failures.
           */
          processedSmsKeys.current.add(
            key,
          );

          return false;
        }

        if (
          signal.aborted ||
          !dashboardMounted.current
        ) {
          return false;
        }

        /* -------------------------------------------------
           DETECTED
        ------------------------------------------------- */

        updateSmsActivity({
          status:
            "detected",

          message:
            "Bank payment detected",

          address:
            sms.address,

          date:
            sms.date,

          body:
            sms.body,
        });

        /* -------------------------------------------------
           PROCESSING
        ------------------------------------------------- */

        updateSmsActivity({
          status:
            "processing",

          message:
            "Processing bank payment…",

          address:
            sms.address,

          date:
            sms.date,

          body:
            sms.body,
        });

        try {
          const smsUrl =
            getSmsProcessUrl();

          const response =
            await fetch(
              smsUrl,
              {
                method:
                  "POST",

                headers: {
                  "Content-Type":
                    "application/json",

                  Accept:
                    "application/json",
                },

                body:
                  JSON.stringify({
                    address:
                      sms.address ??
                      null,

                    body:
                      sms.body,

                    date:
                      sms.date,
                  }),

                cache:
                  "no-store",

                signal,
              },
            );

          let data:
            | SmsApiResponse
            | null =
            null;

          try {
            data =
              (await response.json()) as SmsApiResponse;
          } catch {
            data =
              null;
          }

          if (
            signal.aborted ||
            !dashboardMounted.current
          ) {
            return false;
          }

          /* -------------------------------------------------
             HTTP FAILURE
          ------------------------------------------------- */

          if (
            !response.ok
          ) {
            updateSmsActivity({
              status:
                "error",

              message:
                "Bank payment could not be processed",

              address:
                sms.address,

              date:
                sms.date,

              body:
                sms.body,

              response:
                data,

              error:
                data?.error ||
                `HTTP ${response.status} from ${smsUrl}`,
            });

            /*
             * Leave unmarked so a transient failure can
             * be retried on the next sweep.
             */
            return false;
          }

          /* -------------------------------------------------
             APPLICATION FAILURE
          ------------------------------------------------- */

          if (
            !data ||
            data.success !==
              true
          ) {
            updateSmsActivity({
              status:
                "error",

              message:
                "Bank payment was rejected",

              address:
                sms.address,

              date:
                sms.date,

              body:
                sms.body,

              response:
                data,

              error:
                data?.error ||
                "The server did not accept the transaction.",
            });

            return false;
          }

          /* -------------------------------------------------
             SERVER-SIDE IGNORE
          ------------------------------------------------- */

          if (
            data.status ===
              "ignored" ||
            data.ignored ===
              true
          ) {
            processedSmsKeys.current.add(
              key,
            );

            updateSmsActivity({
              status:
                "ignored",

              message:
                data.error ||
                "Bank message ignored",

              reference:
                undefined,

              amount:
                undefined,

              senderName:
                undefined,

              transactionType:
                isSmsTransactionType(
                  data.type,
                )
                  ? data.type
                  : undefined,

              accountNumber:
                undefined,

              address:
                sms.address,

              date:
                sms.date,

              body:
                sms.body,

              response:
                data,

              error:
                data.error,
            });

            return false;
          }

          /* -------------------------------------------------
             PROCESSING RESULT
          ------------------------------------------------- */

          const result =
            getSmsResult(
              data,
            );

          if (
            !result
          ) {
            updateSmsActivity({
              status:
                "error",

              message:
                "Server returned no transaction result",

              address:
                sms.address,

              date:
                sms.date,

              body:
                sms.body,

              response:
                data,

              error:
                "The SMS API reported success but did not return the processor result.",
            });

            /*
             * Do not mark it processed.
             *
             * A malformed API response is not a successful
             * financial completion.
             */
            return false;
          }

          /* -------------------------------------------------
             TRANSACTION
          ------------------------------------------------- */

          const transaction =
            result.transaction;

          const reference =
            transaction?.reference;

          const amount =
            transaction?.amount !==
              undefined
              ? safeNumber(
                  transaction.amount,
                )
              : undefined;

          const senderName =
            transaction?.senderName;

          /*
           * IMPORTANT:
           *
           * The FINAL transaction type is determined by
           * processor.ts.
           *
           * parser.ts intentionally returns "unknown".
           */
          const transactionType =
            isSmsTransactionType(
              result.type,
            )
              ? result.type
              : isSmsTransactionType(
                    transaction?.transactionType,
                  )
                ? transaction.transactionType
                : undefined;

          /* -------------------------------------------------
             DUPLICATE
          ------------------------------------------------- */

          if (
            data.duplicate ===
              true ||
            result.status ===
              "duplicate"
          ) {
            processedSmsKeys.current.add(
              key,
            );

            updateSmsActivity({
              status:
                "duplicate",

              message:
                "Payment already recorded",

              reference,

              amount,

              senderName,

              transactionType,

              accountNumber:
                transaction?.accountNumber,

              address:
                sms.address,

              date:
                sms.date,

              body:
                sms.body,

              response:
                data,
            });

            return false;
          }

          /* -------------------------------------------------
             SAVINGS
          ------------------------------------------------- */

          if (
            transactionType ===
            "savings"
          ) {
            processedSmsKeys.current.add(
              key,
            );

            updateSmsActivity({
              status:
                "savings",

              message:
                "Savings deposit recorded",

              reference,

              amount,

              senderName,

              transactionType:
                "savings",

              accountNumber:
                transaction?.accountNumber,

              address:
                sms.address,

              date:
                sms.date,

              body:
                sms.body,

              response:
                data,
            });

            await loadDashboard(
              true,
            );

            return (
              data.financialChange !==
              false
            );
          }

          /* -------------------------------------------------
             LOAN
          ------------------------------------------------- */

          if (
            transactionType ===
            "loan"
          ) {
            processedSmsKeys.current.add(
              key,
            );

            updateSmsActivity({
              status:
                "loan",

              message:
                "Loan repayment recorded",

              reference,

              amount,

              senderName,

              transactionType:
                "loan",

              accountNumber:
                transaction?.accountNumber,

              address:
                sms.address,

              date:
                sms.date,

              body:
                sms.body,

              response:
                data,
            });

            await loadDashboard(
              true,
            );

            return (
              data.financialChange !==
              false
            );
          }

          /* -------------------------------------------------
             UNKNOWN / INVALID PROCESSOR RESULT
          ------------------------------------------------- */

          updateSmsActivity({
            status:
              "error",

            message:
              "Bank transaction needs attention",

            reference,

            amount,

            senderName,

            transactionType,

            accountNumber:
              transaction?.accountNumber,

            address:
              sms.address,

            date:
              sms.date,

            body:
              sms.body,

            response:
              data,

            error:
              data.error ||
              "The processor returned an unrecognized transaction type.",
          });

          return false;
        } catch (error) {
          /* -------------------------------------------------
             ABORT
          ------------------------------------------------- */

          if (
            error instanceof
              DOMException &&
            error.name ===
              "AbortError"
          ) {
            return false;
          }

          if (
            !dashboardMounted.current
          ) {
            return false;
          }

          /* -------------------------------------------------
             NETWORK / FETCH ERROR
          ------------------------------------------------- */

          const message =
            error instanceof
              Error
              ? error.message
              : "Unable to communicate with the SMS processing server.";

          console.error(
            "SMS processing failed:",
            error,
          );

          updateSmsActivity({
            status:
              "error",

            message:
              "Bank payment connection failed",

            address:
              sms.address,

            date:
              sms.date,

            body:
              sms.body,

            error:
              `${message} · ${getSmsProcessUrl()}`,
          });

          return false;
        }
      },
      [
        loadDashboard,
        updateSmsActivity,
      ],
    );

  /* =======================================================
     SMS INBOX SWEEP
  ======================================================= */

  const sweepSmsInbox =
    useCallback(
      async () => {
        if (
          smsRunning.current
        ) {
          return;
        }

        if (
          !dashboardMounted.current
        ) {
          return;
        }

        /*
         * Reading SMS is local.
         *
         * Financial processing requires internet access.
         */
        if (
          typeof navigator !==
            "undefined" &&
          !navigator.onLine
        ) {
          updateSmsActivity({
            status:
              "idle",

            message:
              "SMS sync waiting for internet connection",
          });

          return;
        }

        smsRunning.current =
          true;

        const controller =
          new AbortController();

        smsAbortController.current =
          controller;

        try {
          updateSmsActivity({
            status:
              "scanning",

            message:
              "Checking for new bank transactions…",
          });

          const result =
            await SmsReader.readInbox();

          if (
            controller.signal.aborted ||
            !dashboardMounted.current
          ) {
            return;
          }

          const messages =
            Array.isArray(
              result?.messages,
            )
              ? result.messages
              : [];

          if (
            messages.length ===
            0
          ) {
            updateSmsActivity({
              status:
                "idle",

              message:
                "Watching for new bank SMS",
            });

            return;
          }

          /*
           * Oldest first.
           */
          const candidates =
            messages
              .filter(
                (
                  sms,
                ) =>
                  sms &&
                  typeof sms.body ===
                    "string" &&
                  sms.body.trim()
                    .length >
                    0 &&
                  typeof sms.date ===
                    "number" &&
                  Number.isFinite(
                    sms.date,
                  ),
              )
              .slice()
              .sort(
                (
                  a,
                  b,
                ) =>
                  a.date -
                  b.date,
              );

          let financialChange =
            false;

          for (
            const sms of
              candidates
          ) {
            if (
              controller.signal.aborted ||
              !dashboardMounted.current
            ) {
              break;
            }

            const changed =
              await processSms(
                {
                  address:
                    sms.address ??
                    null,

                  body:
                    sms.body,

                  date:
                    sms.date,
                },
                controller.signal,
              );

            if (
              changed
            ) {
              financialChange =
                true;
            }
          }

          if (
            controller.signal.aborted ||
            !dashboardMounted.current
          ) {
            return;
          }

          /*
           * Keep useful final state visible.
           *
           * Only return to idle when the sweep ended
           * without a meaningful terminal state.
           */
          if (
            !financialChange
          ) {
            if (
              resetTimer.current !==
              null
            ) {
              window.clearTimeout(
                resetTimer.current,
              );
            }

            resetTimer.current =
              window.setTimeout(
                () => {
                  if (
                    !dashboardMounted.current
                  ) {
                    return;
                  }

                  setSmsActivity(
                    (
                      current,
                    ) => {
                      if (
                        [
                          "savings",
                          "loan",
                          "duplicate",
                          "error",
                          "ignored",
                        ].includes(
                          current.status,
                        )
                      ) {
                        return current;
                      }

                      return {
                        status:
                          "idle",

                        message:
                          "Watching for new bank SMS",

                        timestamp:
                          Date.now(),
                      };
                    },
                  );
                },
                1200,
              );
          }
        } catch (error) {
          if (
            error instanceof
              DOMException &&
            error.name ===
              "AbortError"
          ) {
            return;
          }

          if (
            !dashboardMounted.current
          ) {
            return;
          }

          console.error(
            "SMS sweep failed:",
            error,
          );

          updateSmsActivity({
            status:
              "error",

            message:
              "SMS monitor temporarily unavailable",

            error:
              error instanceof
                Error
                ? error.message
                : "Unable to read SMS inbox.",
          });
        } finally {
          smsRunning.current =
            false;

          smsAbortController.current =
            null;
        }
      },
      [
        processSms,
        updateSmsActivity,
      ],
    );

  /* =======================================================
     INITIAL LOAD + SMS MONITOR
  ======================================================= */

  useEffect(() => {
    if (
      !mounted
    ) {
      return;
    }

    void loadDashboard();

    /*
     * Scan immediately.
     */
    void sweepSmsInbox();

    /*
     * Periodic reconciliation.
     */
    smsTimer.current =
      window.setInterval(
        () => {
          void sweepSmsInbox();
        },
        SMS_SWEEP_INTERVAL_MS,
      );

    const handleOnline =
      () => {
        void sweepSmsInbox();
      };

    window.addEventListener(
      "online",
      handleOnline,
    );

    return () => {
      if (
        smsTimer.current !==
        null
      ) {
        window.clearInterval(
          smsTimer.current,
        );

        smsTimer.current =
          null;
      }

      window.removeEventListener(
        "online",
        handleOnline,
      );

      smsAbortController.current?.abort();

      smsAbortController.current =
        null;
    };
  }, [
    mounted,
    loadDashboard,
    sweepSmsInbox,
  ]);

  /* =======================================================
     MANUAL REFRESH
  ======================================================= */

  function handleRefresh() {
    if (
      loading ||
      refreshing
    ) {
      return;
    }

    void loadDashboard(
      true,
    );
  }

  /* =======================================================
     HYDRATION GUARD
  ======================================================= */

  if (
    !mounted
  ) {
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

          <section className="mb-5 w-full min-w-0 sm:mb-6">
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
                  savings, loans and account activity.
                </p>
              </div>

              <button
                type="button"
                onClick={
                  handleRefresh
                }
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

                <span>
                  Refresh
                </span>
              </button>
            </div>
          </section>

          {/* =================================================
              SMS STATUS
          ================================================= */}

          <SmsStatusBar
            activity={
              smsActivity
            }
            detailsOpen={
              smsDetailsOpen
            }
            history={
              smsHistory
            }
            onToggleDetails={() =>
              setSmsDetailsOpen(
                (
                  value,
                ) =>
                  !value,
              )
            }
          />

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
                    stats.savings,
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
                    stats.outstandingLoans,
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
                    <Bell
                      size={19}
                      strokeWidth={1.8}
                    />
                  }
                  href="/dashboard/loans"
                />
              </section>

              {/* =================================================
                  FINANCIAL BREAKDOWN
              ================================================= */}

              <section className="mt-6 grid w-full min-w-0 grid-cols-2 gap-3 sm:grid-cols-4">
                <MetricCard
                  label="Deposits"
                  value={formatCurrency(
                    stats.deposits,
                  )}
                />

                <MetricCard
                  label="Adjustments"
                  value={formatCurrency(
                    stats.adjustments,
                  )}
                />

                <MetricCard
                  label="Reversals"
                  value={formatCurrency(
                    stats.reversals,
                  )}
                />

                <MetricCard
                  label="Net Savings"
                  value={formatCurrency(
                    stats.savings,
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
                          New member, savings and loan activity will appear here.
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="max-h-[280px] overflow-y-auto overscroll-contain scrollbar-thin scrollbar-track-transparent scrollbar-thumb-white/10 hover:scrollbar-thumb-white/20">
                      <div className="divide-y divide-white/[0.05]">
                        {activities.map(
                          (
                            activity,
                          ) => (
                            <ActivityRow
                              key={
                                activity.id
                              }
                              activity={
                                activity
                              }
                            />
                          ),
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
                  MEMBER + SAVINGS
              ================================================= */}

              <section className="mt-6 grid w-full min-w-0 gap-6 md:grid-cols-2">
                <OverviewCard
                  eyebrow="Member Overview"
                  value={stats.members.toLocaleString()}
                  description="Registered members"
                  icon={
                    <Users
                      size={19}
                      strokeWidth={1.8}
                    />
                  }
                  footerLabel="Manage members"
                  footerHref="/dashboard/members"
                  progress={
                    stats.members >
                    0
                      ? Math.min(
                          100,
                          (stats.activeMembers /
                            stats.members) *
                            100,
                        )
                      : 0
                  }
                  progressLabel="Active members"
                  progressValue={`${
                    stats.members >
                    0
                      ? Math.round(
                          (stats.activeMembers /
                            stats.members) *
                            100,
                        )
                      : 0
                  }%`}
                />

                <OverviewCard
                  eyebrow="Savings Overview"
                  value={formatCurrency(
                    stats.savings,
                  )}
                  description="Authoritative ledger balance"
                  icon={
                    <Wallet
                      size={19}
                      strokeWidth={1.8}
                    />
                  }
                  footerLabel="Open savings"
                  footerHref="/dashboard/savings"
                  metrics={[
                    {
                      label:
                        "Deposits",
                      value:
                        formatCurrency(
                          stats.deposits,
                        ),
                    },
                    {
                      label:
                        "Adjustments",
                      value:
                        formatCurrency(
                          stats.adjustments,
                        ),
                    },
                    {
                      label:
                        "Reversals",
                      value:
                        formatCurrency(
                          stats.reversals,
                        ),
                    },
                  ]}
                />
              </section>

              {/* =================================================
                  LOAN OVERVIEW
              ================================================= */}

              <section className="mt-6">
                <LoanOverviewCard
                  loans={
                    stats.loans
                  }
                  outstanding={
                    stats.outstandingLoans
                  }
                  defaulters={
                    stats.defaulters
                  }
                />
              </section>

              {/* =================================================
                  FOOTER
              ================================================= */}

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
   SMS STATUS BAR
========================================================= */

function SmsStatusBar({
  activity,
  detailsOpen,
  history,
  onToggleDetails,
}: {
  activity: SmsActivity;
  detailsOpen: boolean;
  history: SmsActivity[];
  onToggleDetails: () => void;
}) {
  const isWorking =
    [
      "scanning",
      "detected",
      "processing",
    ].includes(
      activity.status,
    );

  const isSuccessful =
    [
      "savings",
      "loan",
      "duplicate",
    ].includes(
      activity.status,
    );

  const hasDetails =
    Boolean(
      activity.body ||
        activity.response ||
        activity.error ||
        activity.reference,
    );

  return (
    <section className="mb-6 overflow-hidden rounded-2xl border border-white/[0.07] bg-white/[0.018]">
      <div className="flex min-w-0 items-center gap-3 px-4 py-3.5 sm:px-5">
        <div
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
            activity.status ===
            "error"
              ? "bg-red-500/10 text-red-400"
              : activity.status ===
                    "savings" ||
                  activity.status ===
                    "loan"
                ? "bg-green-500/10 text-green-400"
                : "bg-blue-500/10 text-blue-400"
          }`}
        >
          {isWorking ? (
            <Loader2
              size={15}
              className="animate-spin"
            />
          ) : isSuccessful ? (
            <CheckCircle2
              size={15}
            />
          ) : (
            <Smartphone
              size={15}
            />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <p
            className={`truncate text-xs font-medium ${
              activity.status ===
              "error"
                ? "text-red-300"
                : "text-white/65"
            }`}
          >
            {getSmsActivityMessage(
              activity,
            )}
          </p>

          <div className="mt-0.5 flex min-w-0 items-center gap-2">
            <span className="truncate text-[9px] text-white/20">
              {activity.reference ||
                "SMS monitor"}
            </span>

            {activity.senderName && (
              <>
                <span className="text-white/10">
                  ·
                </span>

                <span className="truncate text-[9px] text-white/20">
                  {
                    activity.senderName
                  }
                </span>
              </>
            )}
          </div>
        </div>

        {activity.amount !==
          undefined && (
          <span className="hidden shrink-0 text-xs font-semibold text-white/50 sm:block">
            {formatCurrency(
              activity.amount,
            )}
          </span>
        )}

        <span className="hidden shrink-0 text-[9px] text-white/15 sm:block">
          {formatSmsDate(
            activity.date,
          )}
        </span>

        {hasDetails && (
          <button
            type="button"
            onClick={
              onToggleDetails
            }
            className="shrink-0 rounded-lg border border-white/[0.06] bg-white/[0.025] px-2.5 py-1.5 text-[9px] font-medium text-white/30 transition hover:bg-white/[0.05] hover:text-white/60"
          >
            {detailsOpen
              ? "Hide"
              : "Details"}
          </button>
        )}
      </div>

      {detailsOpen && (
        <div className="border-t border-white/[0.06] px-4 py-4 sm:px-5">
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.6fr)]">

            {/* =================================================
                LEFT
            ================================================= */}

            <div className="min-w-0">
              <div className="grid grid-cols-2 gap-2">
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
                      activity.amount,
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
                        : activity.transactionType ===
                            "savings"
                          ? "Savings deposit"
                          : "Unknown"
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

                {activity.address && (
                  <DetailItem
                    label="SMS sender"
                    value={
                      activity.address
                    }
                  />
                )}

                <DetailItem
                  label="SMS time"
                  value={formatSmsDate(
                    activity.date,
                  )}
                />
              </div>

              {activity.body && (
                <div className="mt-3 overflow-hidden rounded-xl border border-white/[0.06] bg-black/20">
                  <div className="flex items-center gap-2 border-b border-white/[0.05] px-3 py-2">
                    <Inbox
                      size={12}
                      className="text-white/25"
                    />

                    <span className="text-[9px] font-medium uppercase tracking-[0.12em] text-white/25">
                      Bank SMS
                    </span>
                  </div>

                  <pre className="max-h-[180px] overflow-auto whitespace-pre-wrap break-words p-3 font-mono text-[10px] leading-5 text-white/40">
                    {
                      activity.body
                    }
                  </pre>
                </div>
              )}

              {activity.error && (
                <div className="mt-3 rounded-xl border border-red-500/10 bg-red-500/[0.04] p-3">
                  <p className="text-[10px] leading-5 text-red-300/60">
                    {
                      activity.error
                    }
                  </p>
                </div>
              )}
            </div>

            {/* =================================================
                RIGHT
            ================================================= */}

            {activity.response !==
              undefined && (
              <div className="overflow-hidden rounded-xl border border-white/[0.06] bg-black/20">
                <div className="border-b border-white/[0.05] px-3 py-2">
                  <span className="text-[9px] font-medium uppercase tracking-[0.12em] text-white/25">
                    Full processing response
                  </span>
                </div>

                <pre className="max-h-[360px] overflow-auto whitespace-pre-wrap break-words p-3 font-mono text-[10px] leading-5 text-white/35">
                  {JSON.stringify(
                    activity.response,
                    null,
                    2,
                  )}
                </pre>
              </div>
            )}
          </div>

          {/* =================================================
              HISTORY
          ================================================= */}

          {history.length >
            1 && (
            <div className="mt-3 flex min-w-0 gap-2 overflow-x-auto pb-1">
              {history
                .slice(
                  0,
                  8,
                )
                .map(
                  (
                    item,
                  ) => (
                    <span
                      key={`${item.timestamp}-${item.reference || item.message}`}
                      className="shrink-0 rounded-lg border border-white/[0.05] bg-white/[0.02] px-2.5 py-1.5 text-[9px] text-white/25"
                    >
                      {
                        item.reference ||
                        item.transactionType ||
                        item.status
                      }
                    </span>
                  ),
                )}
            </div>
          )}
        </div>
      )}
    </section>
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

/* =========================================================
   OVERVIEW CARD
========================================================= */

function OverviewCard({
  eyebrow,
  value,
  description,
  icon,
  footerLabel,
  footerHref,
  progress,
  progressLabel,
  progressValue,
  metrics,
}: {
  eyebrow: string;
  value: string;
  description: string;
  icon: React.ReactNode;
  footerLabel: string;
  footerHref: string;
  progress?: number;
  progressLabel?: string;
  progressValue?: string;
  metrics?: {
    label: string;
    value: string;
  }[];
}) {
  return (
    <div className="min-w-0 overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.025] p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-[0.18em] text-white/25">
            {eyebrow}
          </p>

          <p className="mt-3 text-3xl font-semibold text-white">
            {value}
          </p>

          <p className="mt-1 text-xs text-white/30">
            {description}
          </p>
        </div>

        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-yellow-500/10 text-yellow-400">
          {icon}
        </div>
      </div>

      {progress !==
        undefined && (
        <div className="mt-5">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[10px] text-white/25">
              {progressLabel}
            </span>

            <span className="text-[10px] text-white/40">
              {progressValue}
            </span>
          </div>

          <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
            <div
              className="h-full rounded-full bg-yellow-500 transition-all"
              style={{
                width: `${Math.max(
                  0,
                  Math.min(
                    100,
                    progress,
                  ),
                )}%`,
              }}
            />
          </div>
        </div>
      )}

      {metrics &&
        metrics.length >
          0 && (
          <div className="mt-5 grid grid-cols-3 gap-3">
            {metrics.map(
              (
                metric,
              ) => (
                <MiniMetric
                  key={
                    metric.label
                  }
                  label={
                    metric.label
                  }
                  value={
                    metric.value
                  }
                />
              ),
            )}
          </div>
        )}

      <button
        type="button"
        onClick={() =>
          window.location.assign(
            footerHref,
          )
        }
        className="mt-5 flex items-center gap-2 text-xs font-medium text-yellow-400 transition hover:text-yellow-300"
      >
        <span>
          {footerLabel}
        </span>

        <ArrowRight
          size={14}
          strokeWidth={1.8}
        />
      </button>
    </div>
  );
}

/* =========================================================
   LOAN OVERVIEW
========================================================= */

function LoanOverviewCard({
  loans,
  outstanding,
  defaulters,
}: {
  loans: number;
  outstanding: number;
  defaulters: number;
}) {
  return (
    <div className="min-w-0 overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.025] p-5">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-start gap-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-yellow-500/10 text-yellow-400">
            <HandCoins
              size={20}
              strokeWidth={1.8}
            />
          </div>

          <div className="min-w-0">
            <p className="text-xs uppercase tracking-[0.18em] text-white/25">
              Loan Overview
            </p>

            <p className="mt-2 text-2xl font-semibold text-white">
              {formatCurrency(
                outstanding,
              )}
            </p>

            <p className="mt-1 text-xs text-white/30">
              Outstanding loan balance
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <MiniMetric
            label="Loans"
            value={loans.toLocaleString()}
          />

          <MiniMetric
            label="Outstanding"
            value={formatCurrency(
              outstanding,
            )}
          />

          <MiniMetric
            label="Defaulters"
            value={defaulters.toLocaleString()}
          />
        </div>

        <button
          type="button"
          onClick={() =>
            window.location.assign(
              "/dashboard/loans",
            )
          }
          className="flex shrink-0 items-center gap-2 text-xs font-medium text-yellow-400 transition hover:text-yellow-300"
        >
          <span>
            Open loans
          </span>

          <ArrowRight
            size={14}
            strokeWidth={1.8}
          />
        </button>
      </div>
    </div>
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
        window.location.assign(
          href,
        )
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
        window.location.assign(
          href,
        )
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
        {
          icons[
            activity.type
          ]
        }
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-white/65">
          {
            activity.title
          }
        </p>

        <p className="mt-0.5 truncate text-[10px] text-white/25">
          {
            activity.description
          }
        </p>
      </div>

      <span className="shrink-0 text-[10px] text-white/20">
        {
          activity.time
        }
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
        }).map(
          (
            _,
            index,
          ) => (
            <div
              key={
                index
              }
              className="h-[125px] min-w-0 rounded-2xl border border-white/[0.06] bg-white/[0.025]"
            />
          ),
        )}
      </section>

      <section className="grid w-full min-w-0 grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({
          length: 4,
        }).map(
          (
            _,
            index,
          ) => (
            <div
              key={
                index
              }
              className="h-[85px] rounded-2xl border border-white/[0.06] bg-white/[0.025]"
            />
          ),
        )}
      </section>

      <section className="grid w-full min-w-0 gap-6 lg:grid-cols-[minmax(0,1.45fr)_minmax(300px,0.75fr)]">
        <div className="min-h-[360px] rounded-2xl border border-white/[0.06] bg-white/[0.025]" />

        <div className="min-h-[360px] rounded-2xl border border-white/[0.06] bg-white/[0.025]" />
      </section>

      <section className="grid w-full min-w-0 gap-6 md:grid-cols-2">
        <div className="h-[220px] rounded-2xl border border-white/[0.06] bg-white/[0.025]" />

        <div className="h-[220px] rounded-2xl border border-white/[0.06] bg-white/[0.025]" />
      </section>

      <section>
        <div className="h-[125px] rounded-2xl border border-white/[0.06] bg-white/[0.025]" />
      </section>
    </div>
  );
}