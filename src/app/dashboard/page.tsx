"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  ArrowRight,
  Bell,
  HandCoins,
  RefreshCw,
  Users,
  Wallet,
  FileText,
} from "lucide-react";

import TopBar from "@/components/dashboard/TopBar";

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

  return new Date(timestamp).toLocaleDateString("en-KE", {
    day: "numeric",
    month: "short",
  });
}

function formatCurrency(value: number) {
  return `KES ${safeNumber(value).toLocaleString("en-KE", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
}

/* =========================================================
   API RESPONSE EXTRACTION
========================================================= */

function extractRecords<T>(result: ApiResponse): T[] {
  const data = result?.data;

  if (Array.isArray(data)) {
    return data as T[];
  }

  if (data && typeof data === "object") {
    const recordData = data as Record<string, unknown>;

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

  useEffect(() => {
    setMounted(true);
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

        /*
         * Run the domain APIs independently.
         *
         * A failure in one domain must not destroy
         * the entire dashboard.
         */

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

        if (savingsResponse.status === "fulfilled") {
          try {
            const response = savingsResponse.value;

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

        if (membersResponse.status === "fulfilled") {
          try {
            const response = membersResponse.value;

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
                extractRecords<MemberRecord>(json);
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

        if (loansResponse.status === "fulfilled") {
          try {
            const response = loansResponse.value;

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
                extractRecords<LoanRecord>(json);
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

        let notifications: NotificationRecord[] = [];

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
          safeNumber(savings.memberCount);

        const totalMembers =
          members.length ||
          memberCountFromSavings;

        const activeMembers =
          members.length > 0
            ? members.filter((member) => {
                if (member.isActive === true) {
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
          const outstanding = safeNumber(
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
          notifications.filter((notification) => {
            if (notification.read === true) {
              return false;
            }

            if (
              notification.status?.toLowerCase() ===
              "read"
            ) {
              return false;
            }

            return true;
          }).length;

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

        setStats(nextStats);

        /* =================================================
           RECENT ACTIVITY
        ================================================= */

        const nextActivities: DashboardActivity[] =
          [];

        /*
         * MEMBER ACTIVITY
         *
         * The latest member records are converted into
         * dashboard activity rows.
         */

        members
          .slice()
          .sort(
            (a, b) =>
              new Date(getDate(b)).getTime() -
              new Date(getDate(a)).getTime()
          )
          .slice(0, 4)
          .forEach((member, index) => {
            const name =
              member.name ||
              member.fullName ||
              "Member";

            nextActivities.push({
              id: `member-${getId(
                member,
                String(index)
              )}`,

              title: "Member activity",

              description:
                `${name} was recently recorded.`,

              time: formatRelativeTime(
                getDate(member)
              ),

              type: "member",
            });
          });

        /*
         * LOAN ACTIVITY
         *
         * The latest loan records are converted into
         * dashboard activity rows.
         */

        loans
          .slice()
          .sort(
            (a, b) =>
              new Date(getDate(b)).getTime() -
              new Date(getDate(a)).getTime()
          )
          .slice(0, 4)
          .forEach((loan, index) => {
            nextActivities.push({
              id: `loan-${getId(
                loan,
                String(index)
              )}`,

              title: "Loan activity",

              description: loan.memberName
                ? `${loan.memberName} has loan activity.`
                : "A loan record was recently updated.",

              time: formatRelativeTime(
                getDate(loan)
              ),

              type: "loan",
            });
          });

        /*
         * NOTIFICATION ACTIVITY
         */

        notifications
          .slice()
          .sort(
            (a, b) =>
              new Date(getDate(b)).getTime() -
              new Date(getDate(a)).getTime()
          )
          .slice(0, 4)
          .forEach(
            (notification, index) => {
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

                time: formatRelativeTime(
                  getDate(notification)
                ),

                type: "notification",
              });
            }
          );

        /*
         * IMPORTANT:
         *
         * The current /api/savings/summary endpoint only
         * supplies aggregate savings figures.
         *
         * Therefore we do NOT manufacture fake savings
         * activity rows here.
         *
         * Once the savings transaction endpoint is wired
         * into the dashboard, savings activity can be added
         * here safely.
         */

        /*
         * Limit the dashboard activity list.
         *
         * The Activity panel itself is scrollable, so the
         * user can see more than the visible panel height.
         */

        setActivities(
          nextActivities
            .sort((a, b) => {
              /*
               * Activities currently contain formatted
               * relative times. We therefore preserve the
               * API/domain ordering rather than attempting
               * to sort using strings such as "2h ago".
               */
              return 0;
            })
            .slice(0, 12)
        );

        /* =================================================
           PARTIAL API ERRORS
        ================================================= */

        const errors = [
          savingsError,
          membersError,
          loansError,
          notificationsError,
        ].filter(Boolean);

        if (errors.length > 0) {
          setError(errors.join(" "));
        }
      } catch (err) {
        console.error(
          "Failed to load dashboard:",
          err
        );

        if (
          err instanceof TypeError &&
          err.message === "Failed to fetch"
        ) {
          setError(
            "Unable to connect to the server. Check your connection and try again."
          );
        } else if (err instanceof Error) {
          setError(err.message);
        } else {
          setError(
            "Something went wrong while loading the dashboard."
          );
        }
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    []
  );

  /* =======================================================
     INITIAL LOAD
  ======================================================= */

  useEffect(() => {
    if (!mounted) return;

    loadDashboard();
  }, [mounted, loadDashboard]);

  /* =======================================================
     REFRESH
  ======================================================= */

  function handleRefresh() {
    if (loading || refreshing) {
      return;
    }

    loadDashboard(true);
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
                disabled={loading || refreshing}
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
                  onClick={() => loadDashboard()}
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
                  value={stats.members}
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
                  value={stats.loans}
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
                  value={stats.defaulters}
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

                {/* =================================================
                    RECENT ACTIVITY
                   
                    The outer card has a fixed maximum height.
                    The header remains fixed.
                    Only the activity list scrolls.
                   
                    This prevents the dashboard from becoming
                    excessively tall when many activities exist.
                ================================================= */}

                <div className="min-w-0 overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.025]">

                  {/* FIXED ACTIVITY HEADER */}
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

                  {/* 
                   * SCROLLABLE ACTIVITY BODY
                   *
                   * max-h-[280px] controls the height.
                   * overflow-y-auto enables vertical scrolling.
                   *
                   * The scrollbar is intentionally subtle.
                   */}
                  {activities.length === 0 ? (
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
                    <div
                      className="
                        max-h-[280px]
                        overflow-y-auto
                        overscroll-contain
                        scrollbar-thin
                        scrollbar-track-transparent
                        scrollbar-thumb-white/10
                        hover:scrollbar-thumb-white/20
                      "
                    >
                      <div className="divide-y divide-white/[0.05]">
                        {activities.map(
                          (activity) => (
                            <ActivityRow
                              key={activity.id}
                              activity={activity}
                            />
                          )
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* =================================================
                    QUICK ACCESS
                   
                    Reduced height and independently scrollable.
                    The header stays visible while the quick-access
                    items scroll inside their own area.
                ================================================= */}

                <div className="min-w-0 overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.025]">

                  {/* FIXED QUICK ACCESS HEADER */}
                  <div className="border-b border-white/[0.07] px-4 py-4 sm:px-5">
                    <h2 className="text-sm font-semibold text-white">
                      Quick Access
                    </h2>

                    <p className="mt-1 text-xs text-white/30">
                      Frequently used features
                    </p>
                  </div>

                  {/* 
                   * SCROLLABLE QUICK ACCESS BODY
                   *
                   * max-h-[280px] keeps the panel compact.
                   * If more features are added later, the user
                   * can scroll without expanding the dashboard.
                   */}
                  <div
                    className="
                      max-h-[280px]
                      overflow-y-auto
                      overscroll-contain
                      scrollbar-thin
                      scrollbar-track-transparent
                      scrollbar-thumb-white/10
                      hover:scrollbar-thumb-white/20
                    "
                  >
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

                {/* MEMBER OVERVIEW */}

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
                        {stats.members > 0
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
                            stats.members > 0
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
                    <span>Manage members</span>

                    <ArrowRight
                      size={14}
                      strokeWidth={1.8}
                    />
                  </button>
                </div>

                {/* SAVINGS OVERVIEW */}

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
                    <span>Open savings</span>

                    <ArrowRight
                      size={14}
                      strokeWidth={1.8}
                    />
                  </button>
                </div>
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
        {Array.from({ length: 4 }).map(
          (_, index) => (
            <div
              key={index}
              className="h-[125px] min-w-0 rounded-2xl border border-white/[0.06] bg-white/[0.025]"
            />
          )
        )}
      </section>

      <section className="grid w-full min-w-0 grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map(
          (_, index) => (
            <div
              key={index}
              className="h-[85px] rounded-2xl border border-white/[0.06] bg-white/[0.025]"
            />
          )
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
    </div>
  );
}
