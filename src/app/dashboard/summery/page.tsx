"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  AlertCircle,
  ArrowRight,
  Bell,
  FileText,
  HandCoins,
  RefreshCw,
  Users,
  Wallet,
} from "lucide-react";

import { useRouter } from "next/navigation";

import SmsInboxMonitor from "@/components/sms/SmsInboxMonitor";
import TopBar from "@/components/dashboard/TopBar";

/* =========================================================
   CONSTANTS
========================================================= */

const REQUEST_TIMEOUT_MS = 15_000;

const ACTIVE_LOAN_STATUSES = new Set([
  "active",
  "approved",
  "disbursed",
  "running",
  "open",
]);

const DEFAULT_STATS: DashboardStats = {
  members: 0,
  activeMembers: 0,

  savings: 0,
  deposits: 0,
  withdrawals: 0,
  reversals: 0,

  loans: 0,
  outstandingLoans: 0,
  defaulters: 0,
};

/* =========================================================
   TYPES
========================================================= */

type DashboardStats = {
  members: number;
  activeMembers: number;

  savings: number;
  deposits: number;
  withdrawals: number;
  reversals: number;

  loans: number;
  outstandingLoans: number;

  /**
   * Dashboard "Defaulters" count is based on
   * members whose status is "suspended".
   */
  defaulters: number;
};

type DashboardActivity = {
  id: string;
  title: string;
  description: string;
  time: string;
  type: "member" | "saving" | "loan";
  timestamp: number;
};

type SavingsSummary = {
  totalBalance?: unknown;
  totalDeposits?: unknown;

  /**
   * IMPORTANT:
   * The backend/domain field remains totalAdjustments.
   * The dashboard displays this as withdrawals.
   */
  totalAdjustments?: unknown;

  totalReversals?: unknown;
  memberCount?: unknown;
};

type ApiResponse<T = unknown> = {
  success?: boolean;
  data?: T;
  error?: string;
  message?: string;
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

  createdAt?: string;
  updatedAt?: string;

  memberName?: string;
  memberId?: string;

  loanNumber?: string;
};

type FetchResult<T> = {
  ok: boolean;
  data: T | null;
  error: string | null;
  status: number | null;
};

type DashboardModuleFailure = {
  module: "Savings" | "Members" | "Loans";
  endpoint: string;
  error: string;
  status: number | null;
};

/* =========================================================
   SAFE NUMBER
========================================================= */

function safeNumber(
  value: unknown,
): number {
  if (typeof value === "number") {
    return Number.isFinite(value)
      ? value
      : 0;
  }

  if (typeof value === "string") {
    const normalized =
      value
        .replace(/,/g, "")
        .trim();

    if (!normalized) {
      return 0;
    }

    const parsed =
      Number(normalized);

    return Number.isFinite(parsed)
      ? parsed
      : 0;
  }

  return 0;
}

/* =========================================================
   SAFE ID
========================================================= */

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

/* =========================================================
   SAFE DATE
========================================================= */

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

/* =========================================================
   TIMESTAMP
========================================================= */

function getTimestamp(
  value: string,
): number {
  if (!value) {
    return 0;
  }

  const timestamp =
    new Date(value).getTime();

  return Number.isFinite(timestamp)
    ? timestamp
    : 0;
}

/* =========================================================
   RELATIVE TIME
========================================================= */

function formatRelativeTime(
  value: string,
): string {
  const timestamp =
    getTimestamp(value);

  if (!timestamp) {
    return "Unknown time";
  }

  const difference =
    Date.now() - timestamp;

  /*
   * Protect against future timestamps.
   */
  if (difference < 0) {
    const futureSeconds =
      Math.floor(
        Math.abs(difference) /
          1000,
      );

    if (futureSeconds < 60) {
      return "Just now";
    }

    const futureMinutes =
      Math.floor(
        futureSeconds / 60,
      );

    if (futureMinutes < 60) {
      return `In ${futureMinutes}m`;
    }

    const futureHours =
      Math.floor(
        futureMinutes / 60,
      );

    if (futureHours < 24) {
      return `In ${futureHours}h`;
    }

    return new Date(
      timestamp,
    ).toLocaleDateString(
      "en-KE",
      {
        day: "numeric",
        month: "short",
        year: "numeric",
      },
    );
  }

  const seconds =
    Math.floor(
      difference / 1000,
    );

  if (seconds < 60) {
    return "Just now";
  }

  const minutes =
    Math.floor(
      seconds / 60,
    );

  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours =
    Math.floor(
      minutes / 60,
    );

  if (hours < 24) {
    return `${hours}h ago`;
  }

  const days =
    Math.floor(
      hours / 24,
    );

  if (days < 7) {
    return `${days}d ago`;
  }

  return new Date(
    timestamp,
  ).toLocaleDateString(
    "en-KE",
    {
      day: "numeric",
      month: "short",
      year: "numeric",
    },
  );
}

/* =========================================================
   CURRENCY
========================================================= */

function formatCurrency(
  value: number,
): string {
  return `KES ${safeNumber(
    value,
  ).toLocaleString("en-KE", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
}

/* =========================================================
   MEMBER NAME
========================================================= */

function getMemberName(
  member: MemberRecord,
): string {
  return (
    member.name ||
    member.fullName ||
    [
      member.firstName,
      member.middleName,
      member.lastName,
    ]
      .filter(Boolean)
      .join(" ") ||
    "Member"
  );
}

/* =========================================================
   STATUS
========================================================= */

function normalizeStatus(
  value: unknown,
): string {
  return typeof value === "string"
    ? value
        .trim()
        .toLowerCase()
    : "";
}

/* =========================================================
   SUSPENDED MEMBER
========================================================= */

/**
 * A dashboard defaulter is a member whose
 * actual database status is "suspended".
 *
 * This is intentionally independent of loan status.
 */
function isSuspendedMember(
  member: MemberRecord,
): boolean {
  return (
    normalizeStatus(
      member.status,
    ) === "suspended"
  );
}

/* =========================================================
   ACTIVE LOAN
========================================================= */

function isActiveLoan(
  loan: LoanRecord,
): boolean {
  const status =
    normalizeStatus(
      loan.status ||
        loan.loanStatus,
    );

  return ACTIVE_LOAN_STATUSES.has(
    status,
  );
}

/* =========================================================
   LOAN DEFAULTER
========================================================= */

/**
 * Retained for loan activity display only.
 *
 * IMPORTANT:
 * This does NOT determine the dashboard
 * "Defaulters" statistic.
 */
function isDefaulter(
  loan: LoanRecord,
): boolean {
  const status =
    normalizeStatus(
      loan.status ||
        loan.loanStatus,
    );

  return [
    "default",
    "defaulted",
    "overdue",
    "defaulter",
  ].includes(status);
}

/* =========================================================
   RECORD EXTRACTION
========================================================= */

function extractRecords<T>(
  result: unknown,
): T[] {
  if (Array.isArray(result)) {
    return result as T[];
  }

  if (
    result &&
    typeof result === "object"
  ) {
    const data =
      result as Record<
        string,
        unknown
      >;

    const candidates = [
      data.members,
      data.loans,
      data.transactions,
      data.items,
      data.results,
      data.data,
    ];

    for (const candidate of candidates) {
      if (
        Array.isArray(candidate)
      ) {
        return candidate as T[];
      }

      /*
       * Handle one additional
       * nested response level.
       */
      if (
        candidate &&
        typeof candidate ===
          "object"
      ) {
        const nested =
          extractRecords<T>(
            candidate,
          );

        if (
          nested.length > 0
        ) {
          return nested;
        }
      }
    }
  }

  return [];
}

/* =========================================================
   FETCH JSON
========================================================= */

async function fetchJson<T>(
  url: string,
  signal: AbortSignal,
): Promise<FetchResult<T>> {
  try {
    const response =
      await fetch(url, {
        method: "GET",
        cache: "no-store",
        credentials:
          "same-origin",
        signal,
        headers: {
          Accept:
            "application/json",
        },
      });

    const contentType =
      response.headers.get(
        "content-type",
      ) || "";

    /*
     * A Next.js 404/500 page may be
     * returned as HTML.
     *
     * Expose the actual HTTP status
     * instead of hiding it behind a
     * JSON parsing error.
     */
    if (
      !contentType.includes(
        "application/json",
      )
    ) {
      return {
        ok: false,
        data: null,
        error:
          response.status === 404
            ? `Endpoint not found: ${url}`
            : `Unexpected response from ${url} (HTTP ${response.status}).`,
        status:
          response.status,
      };
    }

    let json:
      | ApiResponse<T>
      | T
      | null = null;

    try {
      json =
        (await response.json()) as
          | ApiResponse<T>
          | T;
    } catch {
      return {
        ok: false,
        data: null,
        error:
          `Invalid JSON response from ${url}.`,
        status:
          response.status,
      };
    }

    if (!response.ok) {
      const errorBody =
        json &&
        typeof json === "object" &&
        !Array.isArray(json)
          ? (json as ApiResponse<T>)
          : null;

      return {
        ok: false,
        data: null,
        error:
          errorBody?.error ||
          errorBody?.message ||
          `Request failed with HTTP ${response.status}.`,
        status:
          response.status,
      };
    }

    /*
     * Support standard API responses:
     *
     * {
     *   success: true,
     *   data: ...
     * }
     */
    if (
      json &&
      typeof json === "object" &&
      !Array.isArray(json)
    ) {
      const responseBody =
        json as ApiResponse<T>;

      if (
        responseBody.success ===
        false
      ) {
        return {
          ok: false,
          data: null,
          error:
            responseBody.error ||
            responseBody.message ||
            "The server rejected the request.",
          status:
            response.status,
        };
      }

      if (
        responseBody.data !==
        undefined
      ) {
        return {
          ok: true,
          data:
            responseBody.data,
          error: null,
          status:
            response.status,
        };
      }
    }

    /*
     * Also support APIs that return
     * the payload directly.
     */
    return {
      ok: true,
      data: json as T,
      error: null,
      status:
        response.status,
    };
  } catch (error) {
    if (
      error instanceof
        DOMException &&
      error.name ===
        "AbortError"
    ) {
      return {
        ok: false,
        data: null,
        error:
          "Request cancelled.",
        status: null,
      };
    }

    return {
      ok: false,
      data: null,
      error:
        error instanceof Error
          ? error.message
          : "Network request failed.",
      status: null,
    };
  }
}

/* =========================================================
   DASHBOARD PAGE
========================================================= */

export default function DashboardPage() {
  const router =
    useRouter();

  const requestController =
    useRef<AbortController | null>(
      null,
    );

  const mountedRef =
    useRef(false);

  const requestSequence =
    useRef(0);

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

  const [error, setError] =
    useState<string | null>(
      null,
    );

  const [
    moduleFailures,
    setModuleFailures,
  ] = useState<
    DashboardModuleFailure[]
  >([]);

  /* =======================================================
     LOAD DASHBOARD
  ======================================================= */

  const loadDashboard =
    useCallback(
      async (
        isRefresh = false,
      ) => {
        requestController.current?.abort();

        const controller =
          new AbortController();

        requestController.current =
          controller;

        const sequence =
          ++requestSequence.current;

        const timeout =
          window.setTimeout(
            () => {
              controller.abort();
            },
            REQUEST_TIMEOUT_MS,
          );

        if (isRefresh) {
          setRefreshing(true);
        } else {
          setLoading(true);
        }

        setError(null);
        setModuleFailures([]);

        try {
          const [
            savingsResult,
            membersResult,
            loansResult,
          ] =
            await Promise.all([
              fetchJson<SavingsSummary>(
                "/api/savings/summary",
                controller.signal,
              ),

              fetchJson<
                MemberRecord[]
              >(
                "/api/members",
                controller.signal,
              ),

              fetchJson<
                LoanRecord[]
              >(
                "/api/loans",
                controller.signal,
              ),
            ]);

          if (
            controller.signal
              .aborted ||
            !mountedRef.current ||
            sequence !==
              requestSequence.current
          ) {
            return;
          }

          const moduleResults = [
            {
              module:
                "Savings" as const,
              endpoint:
                "/api/savings/summary",
              result:
                savingsResult,
            },

            {
              module:
                "Members" as const,
              endpoint:
                "/api/members",
              result:
                membersResult,
            },

            {
              module:
                "Loans" as const,
              endpoint:
                "/api/loans",
              result:
                loansResult,
            },
          ];

          const failures: DashboardModuleFailure[] =
            moduleResults
              .filter(
                ({
                  result,
                }) =>
                  !result.ok,
              )
              .map(
                ({
                  module,
                  endpoint,
                  result,
                }) => ({
                  module,
                  endpoint,
                  error:
                    result.error ||
                    "Unknown API error.",
                  status:
                    result.status,
                }),
              );

          setModuleFailures(
            failures,
          );

          if (
            failures.length > 0
          ) {
            console.error(
              "[GEO-SHUA Dashboard] Module failures:",
              failures,
            );
          }

          const savings =
            savingsResult.ok &&
            savingsResult.data
              ? savingsResult.data
              : null;

          const members =
            membersResult.ok
              ? extractRecords<MemberRecord>(
                  membersResult.data,
                )
              : [];

          const loans =
            loansResult.ok
              ? extractRecords<LoanRecord>(
                  loansResult.data,
                )
              : [];

          /*
           * IMPORTANT:
           *
           * Dashboard Defaulters are members
           * whose actual member status is
           * "suspended".
           *
           * This is intentionally calculated
           * from the members list and is not
           * derived from loan status.
           */
          const suspendedMembers =
            members.filter(
              isSuspendedMember,
            );

          const suspendedMemberCount =
            suspendedMembers.length;

          let nextStats: DashboardStats;

          setStats(
            (previousStats) => {
              nextStats = {
                ...previousStats,
              };

              if (
                savingsResult.ok &&
                savings
              ) {
                nextStats.savings =
                  Math.max(
                    0,
                    safeNumber(
                      savings.totalBalance,
                    ),
                  );

                nextStats.deposits =
                  Math.max(
                    0,
                    safeNumber(
                      savings.totalDeposits,
                    ),
                  );

                nextStats.withdrawals =
                  Math.abs(
                    safeNumber(
                      savings.totalAdjustments,
                    ),
                  );

                nextStats.reversals =
                  Math.abs(
                    safeNumber(
                      savings.totalReversals,
                    ),
                  );
              }

              if (
                membersResult.ok
              ) {
                const memberCountFromSavings =
                  savings
                    ? safeNumber(
                        savings.memberCount,
                      )
                    : 0;

                const totalMembers =
                  members.length >
                  0
                    ? members.length
                    : memberCountFromSavings;

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
                            normalizeStatus(
                              member.status,
                            ) ===
                            "active"
                          );
                        },
                      ).length
                    : memberCountFromSavings;

                nextStats.members =
                  totalMembers;

                nextStats.activeMembers =
                  Math.min(
                    activeMembers,
                    totalMembers,
                  );

                /*
                 * THIS is the dashboard
                 * Defaulters count.
                 *
                 * It represents the number
                 * of members whose status is
                 * exactly "suspended".
                 */
                nextStats.defaulters =
                  suspendedMemberCount;
              }

              if (
                loansResult.ok
              ) {
                const activeLoans =
                  loans.filter(
                    isActiveLoan,
                  );

                nextStats.loans =
                  activeLoans.length;

                let outstandingLoans =
                  0;

                for (const loan of activeLoans) {
                  const outstanding =
                    Math.max(
                      0,
                      safeNumber(
                        loan.outstandingBalance ??
                          loan.remainingBalance ??
                          loan.balance,
                      ),
                    );

                  if (
                    outstanding > 0
                  ) {
                    outstandingLoans +=
                      outstanding;
                  }
                }

                nextStats.outstandingLoans =
                  outstandingLoans;

                /*
                 * DO NOT set nextStats.defaulters
                 * here.
                 *
                 * Loan default status does not
                 * determine the dashboard
                 * Defaulters count.
                 */
              }

              return nextStats;
            },
          );

          const nextActivities: DashboardActivity[] =
            [];

          if (
            membersResult.ok
          ) {
            members
              .slice()
              .sort(
                (a, b) =>
                  getTimestamp(
                    getDate(b),
                  ) -
                  getTimestamp(
                    getDate(a),
                  ),
              )
              .slice(0, 5)
              .forEach(
                (
                  member,
                  index,
                ) => {
                  const date =
                    getDate(
                      member,
                    );

                  nextActivities.push(
                    {
                      id: `member-${getId(
                        member,
                        String(index),
                      )}`,

                      title:
                        "Member activity",

                      description:
                        `${getMemberName(
                          member,
                        )} was recently recorded.`,

                      time:
                        formatRelativeTime(
                          date,
                        ),

                      type: "member",

                      timestamp:
                        getTimestamp(
                          date,
                        ),
                    },
                  );
                },
              );
          }

          if (
            loansResult.ok
          ) {
            loans
              .slice()
              .sort(
                (a, b) =>
                  getTimestamp(
                    getDate(b),
                  ) -
                  getTimestamp(
                    getDate(a),
                  ),
              )
              .slice(0, 5)
              .forEach(
                (
                  loan,
                  index,
                ) => {
                  const date =
                    getDate(
                      loan,
                    );

                  const status =
                    normalizeStatus(
                      loan.status ||
                        loan.loanStatus,
                    );

                  const title =
                    isDefaulter(
                      loan,
                    )
                      ? "Loan default"
                      : "Loan activity";

                  const description =
                    loan.memberName
                      ? `${loan.memberName} has ${
                          status ||
                          "loan"
                        } activity.`
                      : `A loan record was recently ${
                          status ||
                          "updated"
                        }.`;

                  nextActivities.push(
                    {
                      id: `loan-${getId(
                        loan,
                        String(index),
                      )}`,

                      title,

                      description,

                      time:
                        formatRelativeTime(
                          date,
                        ),

                      type: "loan",

                      timestamp:
                        getTimestamp(
                          date,
                        ),
                    },
                  );
                },
              );
          }

          setActivities(
            nextActivities
              .filter(
                (activity) =>
                  activity.timestamp >
                  0,
              )
              .sort(
                (a, b) =>
                  b.timestamp -
                  a.timestamp,
              )
              .slice(0, 12),
          );

          if (
            failures.length === 3
          ) {
            setError(
              "Unable to load dashboard data. All dashboard modules failed.",
            );
          }
        } catch (requestError) {
          if (
            requestError instanceof
              DOMException &&
            requestError.name ===
              "AbortError"
          ) {
            return;
          }

          console.error(
            "[GEO-SHUA Dashboard] Unexpected dashboard error:",
            requestError,
          );

          if (
            mountedRef.current
          ) {
            setError(
              "Unable to load dashboard data. Please try again.",
            );
          }
        } finally {
          window.clearTimeout(
            timeout,
          );

          if (
            sequence ===
            requestSequence.current
          ) {
            setLoading(false);
            setRefreshing(false);
          }
        }
      },
      [],
    );

  /* =======================================================
     INITIAL LOAD
  ======================================================= */

  useEffect(() => {
    mountedRef.current =
      true;

    void loadDashboard();

    return () => {
      mountedRef.current =
        false;

      requestController.current?.abort();
    };
  }, [loadDashboard]);

  /* =======================================================
     REFRESH
  ======================================================= */

  const handleRefresh =
    useCallback(() => {
      if (
        loading ||
        refreshing
      ) {
        return;
      }

      void loadDashboard(true);
    }, [
      loadDashboard,
      loading,
      refreshing,
    ]);

  /* =======================================================
     LOADING
  ======================================================= */

  if (loading) {
    return (
      <main className="min-h-[100dvh] w-full overflow-x-clip bg-white text-black">
        <TopBar />

        <div className="w-full pt-16">
          <div className="mx-auto w-full max-w-[1800px] px-4 py-5 sm:px-6 sm:py-8 lg:px-8 lg:py-10 xl:px-10 2xl:px-12">
            <DashboardLoading />
          </div>
        </div>
      </main>
    );
  }

  /* =======================================================
     MAIN
  ======================================================= */

  return (
    <main className="min-h-[100dvh] w-full max-w-full overflow-x-clip bg-white text-black">
      <TopBar />

      <div className="w-full pt-16">
        <div className="mx-auto w-full max-w-[1800px] px-4 py-5 sm:px-6 sm:py-8 lg:px-8 lg:py-10 xl:px-10 2xl:px-12">

          {/* =================================================
              ERROR
          ================================================= */}

          {error && (
            <DashboardError
              message={error}
              onRetry={handleRefresh}
              refreshing={refreshing}
            />
          )}

          {/* =================================================
              PARTIAL FAILURE
          ================================================= */}

          {!error &&
            moduleFailures.length >
              0 && (
              <DashboardPartialWarning
                failures={moduleFailures}
                onRetry={handleRefresh}
                refreshing={refreshing}
              />
            )}

          {/* =================================================
              MOBILE
          ================================================= */}

          <div className="lg:hidden">
            <MobileDashboard
              stats={stats}
              activities={activities}
              onRefresh={handleRefresh}
              refreshing={refreshing}
            />
          </div>

          {/* =================================================
              DESKTOP
          ================================================= */}

          <div className="hidden lg:block">

            {/* HEADER */}

            <section className="mb-6">
              <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">

                <div className="min-w-0">

                  <div className="flex items-center gap-2">

                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-yellow-50 text-yellow-600">
                      <FileText
                        size={17}
                        strokeWidth={1.8}
                      />
                    </div>

                    <span className="text-xs font-medium uppercase tracking-[0.22em] text-yellow-600/70">
                      Overview
                    </span>
                  </div>

                  <h1 className="mt-3 text-2xl font-semibold tracking-tight text-black sm:text-3xl">
                    Dashboard
                  </h1>

                  <p className="mt-2 max-w-2xl text-sm leading-6 text-black/50">
                    A clean view of
                    GEO-SHUA members,
                    savings, loans and
                    account activity.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={handleRefresh}
                  disabled={refreshing}
                  aria-label="Refresh dashboard"
                  className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-black/60 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 hover:text-black disabled:cursor-not-allowed disabled:opacity-40 lg:w-auto"
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

                  Refresh
                </button>
              </div>
            </section>

            {/* STATS */}

            <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">

              <StatCard
                title="Members"
                value={stats.members}
                subtitle={`${stats.activeMembers.toLocaleString()} active`}
                icon={
                  <Users
                    size={19}
                    strokeWidth={1.8}
                  />
                }
                href="/dashboard/members"
                onNavigate={router.push}
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
                onNavigate={router.push}
              />

              <StatCard
                title="Loans"
                value={stats.loans}
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
                onNavigate={router.push}
              />

              <StatCard
                title="Defaulters"
                value={stats.defaulters}
                subtitle="Suspended members"
                icon={
                  <Bell
                    size={19}
                    strokeWidth={1.8}
                  />
                }
                href="/dashboard/members"
                onNavigate={router.push}
              />
            </section>

            {/* FINANCIAL BREAKDOWN */}

            <section className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">

              <MetricCard
                label="Deposits"
                value={formatCurrency(
                  stats.deposits,
                )}
              />

              <MetricCard
                label="Withdrawals"
                value={formatCurrency(
                  stats.withdrawals,
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

            {/* MAIN GRID */}

            <section className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1.45fr)_minmax(280px,0.75fr)]">

              {/* RECENT ACTIVITY */}

              <div className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">

                <div className="flex items-center justify-between border-b border-slate-200 px-4 py-4 sm:px-5">

                  <div>
                    <h2 className="text-sm font-semibold text-black">
                      Recent Activity
                    </h2>

                    <p className="mt-1 text-xs text-black/40">
                      Latest recorded
                      activity
                    </p>
                  </div>

                  <span className="flex items-center gap-1.5 rounded-lg bg-slate-50 px-2.5 py-1 text-[10px] text-black/40">
                    <span className="h-1.5 w-1.5 rounded-full bg-[#1683ff]" />
                    Live data
                  </span>
                </div>

                {activities.length ===
                0 ? (
                  <EmptyActivity />
                ) : (
                  <div className="max-h-[300px] overflow-y-auto overscroll-contain scrollbar-thin scrollbar-track-transparent scrollbar-thumb-slate-200 hover:scrollbar-thumb-slate-300">
                    <div className="divide-y divide-slate-100">
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

              <div className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">

                <div className="border-b border-slate-200 px-4 py-4 sm:px-5">

                  <h2 className="text-sm font-semibold text-black">
                    Quick Access
                  </h2>

                  <p className="mt-1 text-xs text-black/40">
                    Core GEO-SHUA
                    modules
                  </p>
                </div>

                <div className="grid gap-1 p-3 sm:p-4">

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
                    onNavigate={router.push}
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
                    onNavigate={router.push}
                  />

                  <QuickAccess
                    label="Loans"
                    description="Manage loans and repayments"
                    icon={
                      <HandCoins
                        size={18}
                        strokeWidth={1.8}
                      />
                    }
                    href="/dashboard/loans"
                    onNavigate={router.push}
                  />
                </div>
              </div>
            </section>

            {/* MEMBER + SAVINGS */}

            <section className="mt-5 grid gap-5 md:grid-cols-2">

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
                onNavigate={router.push}
                progress={
                  stats.members >
                  0
                    ? Math.min(
                        100,
                        (
                          stats.activeMembers /
                          stats.members
                        ) *
                          100,
                      )
                    : 0
                }
                progressLabel="Active members"
                progressValue={
                  stats.members >
                  0
                    ? `${Math.round(
                        (
                          stats.activeMembers /
                          stats.members
                        ) *
                          100,
                      )}%`
                    : "0%"
                }
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
                onNavigate={router.push}
                metrics={[
                  {
                    label: "Deposits",
                    value:
                      formatCurrency(
                        stats.deposits,
                      ),
                  },
                  {
                    label: "Withdrawals",
                    value:
                      formatCurrency(
                        stats.withdrawals,
                      ),
                  },
                  {
                    label: "Reversals",
                    value:
                      formatCurrency(
                        stats.reversals,
                      ),
                  },
                ]}
              />
            </section>

            {/* LOANS */}

            <section className="mt-5">
              <LoanOverviewCard
                loans={stats.loans}
                outstanding={
                  stats.outstandingLoans
                }
                defaulters={
                  stats.defaulters
                }
                onNavigate={router.push}
              />
            </section>

            {/* FOOTER */}

            <div className="mt-5 flex flex-col gap-1 px-1 sm:flex-row sm:items-center sm:justify-between">

              <p className="text-[10px] text-black/30">
                GEO-SHUA SACCO
                Management
              </p>

              <p className="text-[10px] text-black/30">
                Financial data
                sourced from
                domain APIs
              </p>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

/* =========================================================
   DASHBOARD ERROR
========================================================= */

function DashboardError({
  message,
  onRetry,
  refreshing,
}: {
  message: string;
  onRetry: () => void;
  refreshing: boolean;
}) {
  return (
    <section
      role="alert"
      aria-live="assertive"
      className="mb-4 flex flex-col gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex min-w-0 items-start gap-3">

        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-red-100 text-red-600">
          <AlertCircle size={17} />
        </div>

        <div className="min-w-0">

          <p className="text-xs font-semibold text-red-700">
            Dashboard unavailable
          </p>

          <p className="mt-1 text-[10px] leading-5 text-red-600/80">
            {message}
          </p>
        </div>
      </div>

      <button
        type="button"
        onClick={onRetry}
        disabled={refreshing}
        className="flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl border border-red-200 bg-white px-4 text-xs font-medium text-red-600 shadow-sm transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <RefreshCw
          size={14}
          className={
            refreshing
              ? "animate-spin"
              : ""
          }
        />

        Retry
      </button>
    </section>
  );
}

/* =========================================================
   PARTIAL WARNING
========================================================= */

function DashboardPartialWarning({
  failures,
  onRetry,
  refreshing,
}: {
  failures: DashboardModuleFailure[];
  onRetry: () => void;
  refreshing: boolean;
}) {
  if (
    failures.length === 0
  ) {
    return null;
  }

  return (
    <section
      role="status"
      aria-live="polite"
      className="mb-4 overflow-hidden rounded-2xl border border-yellow-200 bg-yellow-50"
    >
      <div className="flex items-start gap-3 px-4 py-3">

        <AlertCircle
          size={15}
          className="mt-0.5 shrink-0 text-yellow-600"
        />

        <div className="min-w-0 flex-1">

          <p className="text-[10px] font-semibold text-yellow-800">
            Some dashboard modules could not be loaded.
          </p>

          <p className="mt-1 text-[10px] leading-5 text-yellow-700/70">
            Successfully loaded data remains
            available. Failed modules are not
            treated as zero values.
          </p>

          <div className="mt-3 space-y-1.5">

            {failures.map(
              (failure) => (
                <div
                  key={
                    failure.module
                  }
                  className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[9px]"
                >
                  <span className="font-semibold text-yellow-800">
                    {failure.module}
                  </span>

                  <span className="text-black/20">
                    —
                  </span>

                  <span className="text-red-600/80">
                    {failure.error}
                  </span>

                  {failure.status !==
                    null && (
                    <span className="rounded-md bg-white px-1.5 py-0.5 font-mono text-black/40">
                      HTTP{" "}
                      {failure.status}
                    </span>
                  )}
                </div>
              ),
            )}
          </div>
        </div>

        <button
          type="button"
          onClick={onRetry}
          disabled={refreshing}
          aria-label="Retry failed dashboard modules"
          className="flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-yellow-200 bg-white px-2.5 text-[9px] font-medium text-yellow-700 transition hover:bg-yellow-50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <RefreshCw
            size={12}
            className={
              refreshing
                ? "animate-spin"
                : ""
            }
          />

          Retry
        </button>
      </div>
    </section>
  );
}

/* =========================================================
   MOBILE DASHBOARD
========================================================= */

function MobileDashboard({
  stats,
  activities,
  onRefresh,
  refreshing,
}: {
  stats: DashboardStats;
  activities: DashboardActivity[];
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const router =
    useRouter();

  const [
    amountsHidden,
    setAmountsHidden,
  ] = useState(false);

  const displayAmount = (
    value: number,
  ): string => {
    if (
      amountsHidden
    ) {
      return "KES ••••••";
    }

    return formatCurrency(
      value,
    );
  };

  return (
    <div className="space-y-3">

      {/* HEADER */}

      <section className="flex items-center justify-between px-1 pb-1">

        <div className="min-w-0">

          <div className="flex items-center gap-2">

            <span className="h-1.5 w-1.5 rounded-full bg-[#1683ff]" />

            <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#1683ff]">
              GEO-SHUA
            </span>
          </div>

          <h1 className="mt-1 text-lg font-semibold tracking-tight text-black">
            Dashboard
          </h1>
        </div>

        <div className="flex items-center gap-2">

          {/* AMOUNT VISIBILITY */}

          <button
            type="button"
            onClick={() =>
              setAmountsHidden(
                (current) =>
                  !current,
              )
            }
            aria-label={
              amountsHidden
                ? "Show amounts"
                : "Hide amounts"
            }
            aria-pressed={
              amountsHidden
            }
            title={
              amountsHidden
                ? "Show amounts"
                : "Hide amounts"
            }
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-black/55 shadow-sm transition active:scale-95 hover:bg-slate-50 hover:text-black"
          >
            {amountsHidden ? (
              <span className="text-xs font-semibold">
                $
              </span>
            ) : (
              <span className="text-xs font-semibold">
                KES
              </span>
            )}
          </button>

          {/* REFRESH */}

          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            aria-label="Refresh dashboard"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-black/55 shadow-sm transition active:scale-95 hover:bg-slate-50 disabled:opacity-40"
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
          </button>
        </div>
      </section>

      {/* MEMBERS */}

      <MobileNavigationCard
        onClick={() =>
          router.push(
            "/dashboard/members",
          )
        }
        icon={
          <Users
            size={17}
            strokeWidth={1.8}
          />
        }
        label="Members"
        description="Membership base"
      >
        <div className="mt-3 flex items-end justify-between">

          <div>
            <p className="text-[28px] font-semibold leading-none tracking-tight text-black">
              {stats.members.toLocaleString()}
            </p>

            <p className="mt-1 text-[10px] text-black/40">
              registered members
            </p>
          </div>

          <div className="text-right">

            <p className="text-sm font-semibold text-[#1683ff]">
              {stats.activeMembers.toLocaleString()}
            </p>

            <p className="text-[9px] uppercase tracking-[0.12em] text-black/35">
              active
            </p>
          </div>
        </div>

        <div className="mt-3 h-1 overflow-hidden rounded-full bg-slate-100">

          <div
            className="h-full rounded-full bg-[#1683ff] transition-all"
            style={{
              width: `${
                stats.members >
                0
                  ? Math.min(
                      100,
                      (
                        stats.activeMembers /
                        stats.members
                      ) *
                        100,
                    )
                  : 0
              }%`,
            }}
          />
        </div>

        <div className="mt-2 flex items-center justify-between">

          <span className="text-[9px] text-black/35">
            Active membership
          </span>

          <span className="text-[9px] font-medium text-black/50">
            {stats.members >
            0
              ? `${Math.round(
                  (
                    stats.activeMembers /
                    stats.members
                  ) *
                    100,
                )}%`
              : "0%"}
          </span>
        </div>
      </MobileNavigationCard>

      {/* SAVINGS */}

      <MobileNavigationCard
        onClick={() =>
          router.push(
            "/dashboard/savings",
          )
        }
        icon={
          <Wallet
            size={17}
            strokeWidth={1.8}
          />
        }
        label="Savings"
        description="Authoritative ledger"
      >
        <div className="mt-3">

          <p className="truncate text-[25px] font-semibold leading-none tracking-tight text-black">
            {displayAmount(
              stats.savings,
            )}
          </p>

          <p className="mt-1 text-[10px] text-black/40">
            current savings
            balance
          </p>
        </div>

        <div className="mt-4 border-t border-slate-100 pt-3">

          <p className="text-[8px] font-semibold uppercase tracking-[0.12em] text-black/30">
            Savings breakdown
          </p>

          <div className="mt-2 space-y-1.5">

            <MobileAmountRow
              label="Deposits"
              value={displayAmount(
                stats.deposits,
              )}
            />

            <MobileAmountRow
              label="− Withdrawals"
              value={displayAmount(
                stats.withdrawals,
              )}
            />

            <MobileAmountRow
              label="− Reversals"
              value={displayAmount(
                stats.reversals,
              )}
            />

            <div className="mt-2 flex items-center justify-between gap-3 border-t border-slate-100 pt-2">

              <span className="text-[9px] font-medium text-black/50">
                Authoritative balance
              </span>

              <span className="text-[10px] font-semibold text-[#1683ff]">
                {displayAmount(
                  stats.savings,
                )}
              </span>
            </div>
          </div>
        </div>
      </MobileNavigationCard>

      {/* LOANS */}

      <MobileNavigationCard
        onClick={() =>
          router.push(
            "/dashboard/loans",
          )
        }
        icon={
          <HandCoins
            size={17}
            strokeWidth={1.8}
          />
        }
        label="Loans"
        description="Lending portfolio"
      >
        <div className="mt-3">

          <p className="truncate text-[25px] font-semibold leading-none tracking-tight text-black">
            {displayAmount(
              stats.outstandingLoans,
            )}
          </p>

          <p className="mt-1 text-[10px] text-black/40">
            outstanding balance
          </p>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 border-t border-slate-100 pt-3">

          <div>

            <p className="text-sm font-semibold text-black/80">
              {stats.loans.toLocaleString()}
            </p>

            <p className="mt-0.5 text-[9px] uppercase tracking-[0.12em] text-black/35">
              Active loans
            </p>
          </div>

          <div className="text-right">

            <p
              className={`text-sm font-semibold ${
                stats.defaulters >
                0
                  ? "text-red-600"
                  : "text-[#1683ff]"
              }`}
            >
              {stats.defaulters.toLocaleString()}
            </p>

            <p className="mt-0.5 text-[9px] uppercase tracking-[0.12em] text-black/35">
              Defaulters
            </p>
          </div>
        </div>
      </MobileNavigationCard>

      {/* SMS */}

      <SmsInboxMonitor />

      {/* RECENT ACTIVITY */}

      <section className="overflow-hidden rounded-[22px] border border-slate-200 bg-white shadow-sm">

        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3.5">

          <div>

            <p className="text-xs font-semibold text-black/75">
              Recent activity
            </p>

            <p className="mt-0.5 text-[9px] text-black/40">
              Latest system
              records
            </p>
          </div>

          <span className="flex items-center gap-1.5 text-[9px] text-[#1683ff]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#1683ff]" />
            Live
          </span>
        </div>

        {activities.length ===
        0 ? (
          <div className="px-4 py-8 text-center">

            <Bell
              size={18}
              className="mx-auto text-black/20"
            />

            <p className="mt-2 text-xs text-black/40">
              No recent activity
            </p>
          </div>
        ) : (
          <div className="max-h-[260px] overflow-y-auto overscroll-contain scrollbar-thin scrollbar-track-transparent scrollbar-thumb-slate-200">

            {activities
              .slice(0, 6)
              .map(
                (
                  activity,
                ) => (
                  <MobileActivityRow
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
        )}
      </section>

      {/* FOOTER */}

      <div className="px-1 pb-3 pt-1 text-center">

        <p className="text-[9px] text-black/25">
          GEO-SHUA SACCO
          Management
        </p>
      </div>
    </div>
  );
}

/* =========================================================
   MOBILE NAVIGATION CARD
========================================================= */

function MobileNavigationCard({
  onClick,
  icon,
  label,
  description,
  children,
}: {
  onClick: () => void;
  icon: ReactNode;
  label: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative w-full overflow-hidden rounded-[22px] border border-[#1683ff]/15 bg-white p-4 text-left shadow-[0_8px_25px_rgba(0,0,0,0.07)] transition active:scale-[0.99] hover:border-[#1683ff]/25"
    >
      <div className="absolute -right-12 -top-12 h-32 w-32 rounded-full bg-[#1683ff]/[0.05] blur-3xl" />

      <div className="relative">

        <div className="flex items-center justify-between">

          <div className="flex items-center gap-2.5">

            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#1683ff]/[0.07] text-[#1683ff]">
              {icon}
            </div>

            <div>

              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-black/55">
                {label}
              </p>

              <p className="text-[9px] text-black/35">
                {description}
              </p>
            </div>
          </div>

          <ArrowRight
            size={15}
            className="text-black/25 transition group-hover:translate-x-0.5 group-hover:text-black/50"
          />
        </div>

        {children}
      </div>
    </button>
  );
}

/* =========================================================
   MOBILE AMOUNT ROW
========================================================= */

function MobileAmountRow({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">

      <span className="text-[9px] text-black/40">
        {label}
      </span>

      <span className="text-[10px] font-medium text-black/60">
        {value}
      </span>
    </div>
  );
}

/* =========================================================
   MOBILE ACTIVITY
========================================================= */

function MobileActivityRow({
  activity,
}: {
  activity: DashboardActivity;
}) {
  const icons: Record<
    DashboardActivity["type"],
    ReactNode
  > = {
    member: (
      <Users
        size={14}
        strokeWidth={1.8}
      />
    ),

    saving: (
      <Wallet
        size={14}
        strokeWidth={1.8}
      />
    ),

    loan: (
      <HandCoins
        size={14}
        strokeWidth={1.8}
      />
    ),
  };

  return (
    <div className="flex min-w-0 items-center gap-3 border-b border-slate-100 px-4 py-3 last:border-b-0">

      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#1683ff]/[0.07] text-[#1683ff]">
        {
          icons[
            activity.type
          ]
        }
      </div>

      <div className="min-w-0 flex-1">

        <p className="truncate text-[10px] font-medium text-black/65">
          {activity.title}
        </p>

        <p className="mt-0.5 truncate text-[9px] text-black/35">
          {activity.description}
        </p>
      </div>

      <span className="shrink-0 text-[8px] text-black/35">
        {activity.time}
      </span>
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
  onNavigate,
  progress,
  progressLabel,
  progressValue,
  metrics,
}: {
  eyebrow: string;
  value: string;
  description: string;
  icon: ReactNode;
  footerLabel: string;
  footerHref: string;
  onNavigate: (
    href: string,
  ) => void;
  progress?: number;
  progressLabel?: string;
  progressValue?: string;
  metrics?: {
    label: string;
    value: string;
  }[];
}) {
  return (
    <div className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">

      <div className="flex items-start justify-between gap-4">

        <div className="min-w-0">

          <p className="text-xs uppercase tracking-[0.18em] text-black/35">
            {eyebrow}
          </p>

          <p className="mt-3 text-3xl font-semibold text-black">
            {value}
          </p>

          <p className="mt-1 text-xs text-black/40">
            {description}
          </p>
        </div>

        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-yellow-50 text-yellow-600">
          {icon}
        </div>
      </div>

      {progress !==
        undefined && (
        <div className="mt-5">

          <div className="mb-2 flex items-center justify-between">

            <span className="text-[10px] text-black/35">
              {progressLabel}
            </span>

            <span className="text-[10px] text-black/50">
              {progressValue}
            </span>
          </div>

          <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">

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
        metrics.length > 0 && (
          <div className="mt-5 grid grid-cols-3 gap-3">

            {metrics.map(
              (metric) => (
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
          onNavigate(
            footerHref,
          )
        }
        className="mt-5 flex items-center gap-2 text-xs font-medium text-yellow-600 transition hover:text-yellow-700"
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
  onNavigate,
}: {
  loans: number;
  outstanding: number;
  defaulters: number;
  onNavigate: (
    href: string,
  ) => void;
}) {
  return (
    <div className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">

      <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">

        <div className="flex min-w-0 items-start gap-4">

          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-yellow-50 text-yellow-600">
            <HandCoins
              size={20}
              strokeWidth={1.8}
            />
          </div>

          <div className="min-w-0">

            <p className="text-xs uppercase tracking-[0.18em] text-black/35">
              Loan Overview
            </p>

            <p className="mt-2 text-2xl font-semibold text-black">
              {formatCurrency(
                outstanding,
              )}
            </p>

            <p className="mt-1 text-xs text-black/40">
              Outstanding loan
              balance
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">

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
            onNavigate(
              "/dashboard/loans",
            )
          }
          className="flex shrink-0 items-center gap-2 text-xs font-medium text-yellow-600 transition hover:text-yellow-700"
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
    <div className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">

      <p className="truncate text-[10px] uppercase tracking-[0.14em] text-black/35">
        {label}
      </p>

      <p className="mt-2 truncate text-sm font-semibold text-black/75">
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

      <p className="truncate text-[9px] uppercase tracking-[0.12em] text-black/30">
        {label}
      </p>

      <p className="mt-1 truncate text-xs font-medium text-black/60">
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
  onNavigate,
}: {
  label: string;
  description: string;
  icon: ReactNode;
  href: string;
  onNavigate: (
    href: string,
  ) => void;
}) {
  return (
    <button
      type="button"
      onClick={() =>
        onNavigate(href)
      }
      className="group flex min-w-0 items-center gap-3 rounded-xl border border-transparent px-3 py-3 text-left transition hover:border-slate-200 hover:bg-slate-50"
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-50 text-black/45 transition group-hover:bg-yellow-50 group-hover:text-yellow-600">
        {icon}
      </div>

      <div className="min-w-0 flex-1">

        <p className="truncate text-xs font-medium text-black/65 group-hover:text-black">
          {label}
        </p>

        <p className="mt-0.5 truncate text-[10px] text-black/35">
          {description}
        </p>
      </div>

      <ArrowRight
        size={14}
        strokeWidth={1.8}
        className="shrink-0 text-black/20 transition group-hover:translate-x-0.5 group-hover:text-black/45"
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
  onNavigate,
}: {
  title: string;
  value: string | number;
  subtitle: string;
  icon: ReactNode;
  href: string;
  onNavigate: (
    href: string,
  ) => void;
}) {
  return (
    <button
      type="button"
      onClick={() =>
        onNavigate(href)
      }
      className="group min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-slate-300 hover:shadow-md sm:p-5"
    >
      <div className="flex items-start justify-between gap-3">

        <div className="min-w-0 flex-1">

          <p className="truncate text-xs font-medium text-black/45">
            {title}
          </p>

          <p className="mt-3 truncate text-2xl font-semibold tracking-tight text-black sm:text-3xl">
            {value}
          </p>

          <p className="mt-2 truncate text-[10px] text-black/35">
            {subtitle}
          </p>
        </div>

        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-yellow-50 text-yellow-600 transition group-hover:bg-yellow-100 sm:h-10 sm:w-10">
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
  const icons: Record<
    DashboardActivity["type"],
    ReactNode
  > = {
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
  };

  return (
    <div className="flex min-w-0 items-center gap-3 px-4 py-3.5 sm:px-5">

      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-50 text-black/40">
        {
          icons[
            activity.type
          ]
        }
      </div>

      <div className="min-w-0 flex-1">

        <p className="truncate text-xs font-medium text-black/70">
          {activity.title}
        </p>

        <p className="mt-0.5 truncate text-[10px] text-black/35">
          {activity.description}
        </p>
      </div>

      <span className="shrink-0 text-[10px] text-black/35">
        {activity.time}
      </span>
    </div>
  );
}

/* =========================================================
   EMPTY ACTIVITY
========================================================= */

function EmptyActivity() {
  return (
    <div className="flex min-h-[180px] items-center justify-center p-6">

      <div className="text-center">

        <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-black/30">

          <Bell
            size={19}
            strokeWidth={1.5}
          />
        </div>

        <p className="mt-4 text-sm font-medium text-black/55">
          No recent activity
        </p>

        <p className="mt-2 text-xs text-black/35">
          New records will appear
          here automatically.
        </p>
      </div>
    </div>
  );
}

/* =========================================================
   DESKTOP LOADING
========================================================= */

function DashboardLoading() {
  return (
    <div className="w-full animate-pulse space-y-5">

      <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">

        {Array.from({
          length: 4,
        }).map(
          (_, index) => (
            <div
              key={index}
              className="h-[125px] rounded-2xl border border-slate-200 bg-slate-50"
            />
          ),
        )}
      </section>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">

        {Array.from({
          length: 4,
        }).map(
          (_, index) => (
            <div
              key={index}
              className="h-[85px] rounded-2xl border border-slate-200 bg-slate-50"
            />
          ),
        )}
      </section>

      <section className="grid gap-5 lg:grid-cols-[minmax(0,1.45fr)_minmax(280px,0.75fr)]">

        <div className="min-h-[330px] rounded-2xl border border-slate-200 bg-slate-50" />

        <div className="min-h-[330px] rounded-2xl border border-slate-200 bg-slate-50" />
      </section>

      <section className="grid gap-5 md:grid-cols-2">

        <div className="h-[220px] rounded-2xl border border-slate-200 bg-slate-50" />

        <div className="h-[220px] rounded-2xl border border-slate-200 bg-slate-50" />
      </section>

      <section>
        <div className="h-[125px] rounded-2xl border border-slate-200 bg-slate-50" />
      </section>
    </div>
  );
}
