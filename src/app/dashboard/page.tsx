"use client";

import {
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from "react";

import {
  ArrowRight,
  Bell,
  FileText,
  HandCoins,
  RefreshCw,
  Users,
  Wallet,
} from "lucide-react";
 

import SmsInboxMonitor from "@/components/sms/SmsInboxMonitor";

import TopBar from "@/components/dashboard/TopBar";

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

  /*
   * Backend/domain name remains "totalAdjustments".
   * UI presents this as "Withdrawals".
   */
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
   DEFAULTS
========================================================= */

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

  notifications: 0,
};

/* =========================================================
   SAFE HELPERS
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

/*
 * IMPORTANT:
 * This function uses Date.now() and locale formatting.
 *
 * It is only called after the component has mounted,
 * so it cannot produce a server/client hydration mismatch.
 */
function formatRelativeTime(
  value: string,
): string {
  if (!value) {
    return "";
  }

  const timestamp =
    new Date(value).getTime();

  if (!Number.isFinite(timestamp)) {
    return "";
  }

  const difference = Math.max(
    0,
    Date.now() - timestamp,
  );

  const seconds =
    Math.floor(difference / 1000);

  if (seconds < 60) {
    return "Just now";
  }

  const minutes =
    Math.floor(seconds / 60);

  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours =
    Math.floor(minutes / 60);

  if (hours < 24) {
    return `${hours}h ago`;
  }

  const days =
    Math.floor(hours / 24);

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

function extractRecords<T>(
  result: ApiResponse,
): T[] {
  const data = result.data;

  if (Array.isArray(data)) {
    return data as T[];
  }

  if (
    data &&
    typeof data === "object"
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
      const candidate of candidates
    ) {
      if (
        Array.isArray(candidate)
      ) {
        return candidate as T[];
      }
    }
  }

  return [];
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

  /*
   * Hydration guard.
   *
   * Server:
   *   mounted = false
   *
   * First client render:
   *   mounted = false
   *
   * Therefore both render the exact same tree.
   *
   * Only after hydration do we switch to the
   * real dashboard.
   */
  const [mounted, setMounted] =
    useState(false);

  /* =======================================================
     LOAD DASHBOARD
  ======================================================= */

  const loadDashboard =
    useCallback(
      async (
        isRefresh = false,
      ) => {
        if (isRefresh) {
          setRefreshing(true);
        } else {
          setLoading(true);
        }

        try {
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
                    method: "GET",
                    cache: "no-store",
                    credentials:
                      "same-origin",
                    headers: {
                      Accept:
                        "application/json",
                    },
                  },
                ),

                fetch(
                  "/api/members",
                  {
                    method: "GET",
                    cache: "no-store",
                    credentials:
                      "same-origin",
                    headers: {
                      Accept:
                        "application/json",
                    },
                  },
                ),

                fetch(
                  "/api/loans",
                  {
                    method: "GET",
                    cache: "no-store",
                    credentials:
                      "same-origin",
                    headers: {
                      Accept:
                        "application/json",
                    },
                  },
                ),

                fetch(
                  "/api/notifications",
                  {
                    method: "GET",
                    cache: "no-store",
                    credentials:
                      "same-origin",
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
            SavingsSummary = {};

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
                json.success !== false
              ) {
                savings =
                  json.data || {};
              }
            } catch {
              savings = {};
            }
          }

          /* =================================================
             MEMBERS
          ================================================= */

          let members:
            MemberRecord[] = [];

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
                json.success !== false
              ) {
                members =
                  extractRecords<MemberRecord>(
                    json,
                  );
              }
            } catch {
              members = [];
            }
          }

          /* =================================================
             LOANS
          ================================================= */

          let loans:
            LoanRecord[] = [];

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
                json.success !== false
              ) {
                loans =
                  extractRecords<LoanRecord>(
                    json,
                  );
              }
            } catch {
              loans = [];
            }
          }

          /* =================================================
             NOTIFICATIONS
          ================================================= */

          let notifications:
            NotificationRecord[] = [];

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
                json.success !== false
              ) {
                notifications =
                  extractRecords<NotificationRecord>(
                    json,
                  );
              }
            } catch {
              notifications = [];
            }
          }

          /* =================================================
             MEMBER STATS
          ================================================= */

          const memberCountFromSavings =
            safeNumber(
              savings.memberCount,
            );

          const totalMembers =
            members.length > 0
              ? members.length
              : memberCountFromSavings;

          const activeMembers =
            members.length > 0
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
            const loan of loans
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

            const status = (
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
              ].includes(status)
            ) {
              defaulters += 1;
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

                return (
                  notification.status
                    ?.trim()
                    .toLowerCase() !==
                  "read"
                );
              },
            ).length;

          /* =================================================
             SAVINGS FINANCIAL VALUES
          ================================================= */

          const savingsBalance =
            safeNumber(
              savings.totalBalance,
            );

          const savingsDeposits =
            safeNumber(
              savings.totalDeposits,
            );

          /*
           * Backend still calls this "adjustments".
           *
           * The dashboard calls it "withdrawals".
           *
           * Math.abs() protects the UI from legacy signed
           * adjustment records.
           */
          const savingsWithdrawals =
            Math.abs(
              safeNumber(
                savings.totalAdjustments,
              ),
            );

          const savingsReversals =
            Math.abs(
              safeNumber(
                savings.totalReversals,
              ),
            );

          /* =================================================
             STATS
          ================================================= */

          setStats({
            members:
              totalMembers,

            activeMembers,

            savings:
              savingsBalance,

            deposits:
              savingsDeposits,

            withdrawals:
              savingsWithdrawals,

            reversals:
              savingsReversals,

            loans:
              loanCount,

            outstandingLoans,

            defaulters,

            notifications:
              notificationCount,
          });

          /* =================================================
             RECENT ACTIVITY
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
              (a, b) =>
                new Date(
                  getDate(b),
                ).getTime() -
                new Date(
                  getDate(a),
                ).getTime(),
            )
            .slice(0, 5)
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
                    .join(" ") ||
                  "Member";

                const date =
                  getDate(member);

                nextActivities.push(
                  {
                    id: `member-${getId(
                      member,
                      String(index),
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
              (a, b) =>
                new Date(
                  getDate(b),
                ).getTime() -
                new Date(
                  getDate(a),
                ).getTime(),
            )
            .slice(0, 5)
            .forEach(
              (
                loan,
                index,
              ) => {
                const date =
                  getDate(loan);

                nextActivities.push(
                  {
                    id: `loan-${getId(
                      loan,
                      String(index),
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
              (a, b) =>
                new Date(
                  getDate(b),
                ).getTime() -
                new Date(
                  getDate(a),
                ).getTime(),
            )
            .slice(0, 5)
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
                      String(index),
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
                (a, b) =>
                  b.sortTimestamp -
                  a.sortTimestamp,
              )
              .slice(0, 12)
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
          setLoading(false);
          setRefreshing(false);
        }
      },
      [],
    );

  /* =======================================================
     INITIAL LOAD
  ======================================================= */

  useEffect(() => {
    setMounted(true);

    void loadDashboard();
  }, [
    loadDashboard,
  ]);

  /* =======================================================
     REFRESH
  ======================================================= */

  const handleRefresh =
    useCallback(() => {
      if (
        loading === true ||
        refreshing === true
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
     HYDRATION GUARD
  ======================================================= */

  if (mounted === false) {
    return (
      <main className="min-h-[100dvh] w-full overflow-x-clip bg-[#050505] text-white">
        <TopBar />

        <div className="w-full pt-16">
          <div className="mx-auto w-full max-w-[1800px] px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
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
    <main className="min-h-[100dvh] w-full max-w-full overflow-x-clip bg-[#050505] text-white">
      <TopBar />

      <div className="w-full pt-16">
        <div className="mx-auto w-full max-w-[1800px] px-4 py-5 sm:px-6 sm:py-8 lg:px-8 lg:py-10 xl:px-10 2xl:px-12">

          {/* =================================================
              MOBILE DASHBOARD
          ================================================= */}

          <div className="lg:hidden">
            {loading === true ? (
              <MobileDashboardLoading />
            ) : (
              <MobileDashboard
                stats={stats}
                activities={activities}
                onRefresh={
                  handleRefresh
                }
                refreshing={
                  refreshing === true
                }
              />
            )}
          </div>

          {/* =================================================
              DESKTOP DASHBOARD
          ================================================= */}

          <div className="hidden lg:block">

            {/* =================================================
                HEADER
            ================================================= */}

            <section className="mb-6">
              <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-yellow-500/10 text-yellow-400">
                      <FileText
                        size={17}
                        strokeWidth={1.8}
                      />
                    </div>

                    <span className="text-xs font-medium uppercase tracking-[0.22em] text-yellow-500/60">
                      Overview
                    </span>
                  </div>

                  <h1 className="mt-3 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
                    Dashboard
                  </h1>

                  <p className="mt-2 max-w-2xl text-sm leading-6 text-white/35">
                    A clean view of GEO-SHUA
                    members, savings, loans and
                    account activity.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={
                    handleRefresh
                  }
                  disabled={
                    loading === true ||
                    refreshing === true
                  }
                  className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.025] px-4 text-sm font-medium text-white/55 transition hover:border-white/[0.14] hover:bg-white/[0.05] hover:text-white disabled:cursor-not-allowed disabled:opacity-40 lg:w-auto"
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

            {/* =================================================
                STATS
            ================================================= */}

            {loading === true ? (
              <DashboardLoading />
            ) : (
              <>
                <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
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

                {/* =================================================
                    MAIN GRID
                ================================================= */}

                <section className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1.45fr)_minmax(280px,0.75fr)]">

                  {/* RECENT ACTIVITY */}

                  <div className="min-w-0 overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.025]">
                    <div className="flex items-center justify-between border-b border-white/[0.07] px-4 py-4 sm:px-5">
                      <div>
                        <h2 className="text-sm font-semibold text-white">
                          Recent Activity
                        </h2>

                        <p className="mt-1 text-xs text-white/30">
                          Latest recorded activity
                        </p>
                      </div>

                      <span className="rounded-lg bg-white/[0.04] px-2.5 py-1 text-[10px] text-white/25">
                        Live data
                      </span>
                    </div>

                    {activities.length ===
                    0 ? (
                      <div className="flex min-h-[180px] items-center justify-center p-6">
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
                            New records will appear
                            here automatically.
                          </p>
                        </div>
                      </div>
                    ) : (
                      <div className="max-h-[300px] overflow-y-auto overscroll-contain scrollbar-thin scrollbar-track-transparent scrollbar-thumb-white/10 hover:scrollbar-thumb-white/20">
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
                        Core GEO-SHUA modules
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
                        description="Manage loans and repayments"
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
                </section>

                {/* =================================================
                    MEMBER + SAVINGS
                ================================================= */}

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
                    progress={
                      stats.members > 0
                        ? Math.min(
                            100,
                            (
                              stats.activeMembers /
                              stats.members
                            ) * 100,
                          )
                        : 0
                    }
                    progressLabel="Active members"
                    progressValue={
                      stats.members > 0
                        ? `${Math.round(
                            (
                              stats.activeMembers /
                              stats.members
                            ) * 100,
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
                          "Withdrawals",
                        value:
                          formatCurrency(
                            stats.withdrawals,
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
                    LOANS
                ================================================= */}

                <section className="mt-5">
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
                <SmsInboxMonitor />

                {/* =================================================
                    FOOTER
                ================================================= */}

                <div className="mt-5 flex flex-col gap-1 px-1 sm:flex-row sm:items-center sm:justify-between">
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
      </div>
    </main>
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
  /*
   * This calculation is presentation-only.
   *
   * The API remains authoritative through stats.savings.
   * This gives the mobile user visibility into how the
   * balance is constructed.
   */
  const calculatedSavings =
    stats.deposits -
    stats.withdrawals -
    stats.reversals;

  return (
    <div className="space-y-3">

      {/* =====================================================
          HEADER
      ===================================================== */}

      <section className="flex items-center justify-between px-1 pb-1">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-[#1683ff] shadow-[0_0_10px_rgba(22,131,255,0.8)]" />

            <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#1683ff]">
              GEO-SHUA
            </span>
          </div>

          <h1 className="mt-1 text-lg font-semibold tracking-tight text-white">
            Dashboard
          </h1>

          </div>

        <button
          type="button"
          onClick={onRefresh}
          disabled={
            refreshing === true
          }
          aria-label="Refresh dashboard"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.035] text-white/55 transition active:scale-95 disabled:opacity-40"
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
      </section>

      {/* =====================================================
          MEMBERS
      ===================================================== */}

      <button
        type="button"
        onClick={() =>
          window.location.assign(
            "/dashboard/members",
          )
        }
        className="group relative w-full overflow-hidden rounded-[22px] border border-[#1683ff]/15 bg-gradient-to-br from-[#0b1c30] via-[#081521] to-[#060b11] p-4 text-left shadow-[0_12px_35px_rgba(0,0,0,0.25)] transition active:scale-[0.99]"
      >
        <div className="absolute -right-10 -top-10 h-28 w-28 rounded-full bg-[#1683ff]/10 blur-2xl" />

        <div className="relative">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#1683ff]/10 text-[#4da3ff]">
                <Users
                  size={17}
                  strokeWidth={1.8}
                />
              </div>

              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/35">
                  Members
                </p>

                <p className="text-[9px] text-white/20">
                  Membership base
                </p>
              </div>
            </div>

            <ArrowRight
              size={15}
              className="text-white/20"
            />
          </div>

          <div className="mt-3 flex items-end justify-between">
            <div>
              <p className="text-[28px] font-semibold leading-none tracking-tight text-white">
                {stats.members.toLocaleString()}
              </p>

              <p className="mt-1 text-[10px] text-white/30">
                registered members
              </p>
            </div>

            <div className="text-right">
              <p className="text-sm font-semibold text-[#4da3ff]">
                {stats.activeMembers.toLocaleString()}
              </p>

              <p className="text-[9px] uppercase tracking-[0.12em] text-white/25">
                active
              </p>
            </div>
          </div>

          <div className="mt-3 h-1 overflow-hidden rounded-full bg-white/[0.06]">
            <div
              className="h-full rounded-full bg-[#1683ff] transition-all"
              style={{
                width: `${
                  stats.members > 0
                    ? Math.min(
                        100,
                        (
                          stats.activeMembers /
                          stats.members
                        ) * 100,
                      )
                    : 0
                }%`,
              }}
            />
          </div>

          <div className="mt-2 flex items-center justify-between">
            <span className="text-[9px] text-white/25">
              Active membership
            </span>

            <span className="text-[9px] font-medium text-white/40">
              {stats.members > 0
                ? `${Math.round(
                    (
                      stats.activeMembers /
                      stats.members
                    ) * 100,
                  )}%`
                : "0%"}
            </span>
          </div>
        </div>
      </button>

      {/* =====================================================
          SAVINGS
      ===================================================== */}

      <button
        type="button"
        onClick={() =>
          window.location.assign(
            "/dashboard/savings",
          )
        }
        className="group relative w-full overflow-hidden rounded-[22px] border border-[#1683ff]/15 bg-gradient-to-br from-[#0a1928] via-[#07131e] to-[#060b11] p-4 text-left shadow-[0_12px_35px_rgba(0,0,0,0.25)] transition active:scale-[0.99]"
      >
        <div className="absolute -right-12 -top-12 h-32 w-32 rounded-full bg-[#1683ff]/10 blur-3xl" />

        <div className="relative">

          {/* HEADER */}

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#1683ff]/10 text-[#4da3ff]">
                <Wallet
                  size={17}
                  strokeWidth={1.8}
                />
              </div>

              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/35">
                  Savings
                </p>

                <p className="text-[9px] text-white/20">
                  Authoritative ledger
                </p>
              </div>
            </div>

            <ArrowRight
              size={15}
              className="text-white/20"
            />
          </div>

          {/* BALANCE */}

          <div className="mt-3">
            <p className="truncate text-[25px] font-semibold leading-none tracking-tight text-white">
              {formatCurrency(
                stats.savings,
              )}
            </p>

            <p className="mt-1 text-[10px] text-white/30">
              current savings balance
            </p>
          </div>

          {/* CALCULATION */}

          <div className="mt-4 border-t border-white/[0.06] pt-3">

            <div className="flex items-center justify-between">
              <p className="text-[8px] font-semibold uppercase tracking-[0.12em] text-white/20">
                Balance calculation
              </p>

              <span
                className={
                  Math.abs(
                    calculatedSavings -
                      stats.savings,
                  ) < 0.01
                    ? "text-[8px] font-medium text-[#4da3ff]/70"
                    : "text-[8px] font-medium text-red-400"
                }
              >
                {Math.abs(
                  calculatedSavings -
                    stats.savings,
                ) < 0.01
                  ? "Balanced"
                  : "Check ledger"}
              </span>
            </div>

            <div className="mt-2 space-y-1.5">

              {/* DEPOSITS */}

              <div className="flex items-center justify-between gap-3">
                <span className="text-[9px] text-white/30">
                  Deposits
                </span>

                <span className="text-[10px] font-medium text-white/55">
                  {formatCurrency(
                    stats.deposits,
                  )}
                </span>
              </div>

              {/* WITHDRAWALS */}

              <div className="flex items-center justify-between gap-3">
                <span className="text-[9px] text-white/30">
                  − Withdrawals
                </span>

                <span className="text-[10px] font-medium text-white/50">
                  {formatCurrency(
                    stats.withdrawals,
                  )}
                </span>
              </div>

              {/* REVERSALS */}

              <div className="flex items-center justify-between gap-3">
                <span className="text-[9px] text-white/30">
                  − Reversals
                </span>

                <span className="text-[10px] font-medium text-white/50">
                  {formatCurrency(
                    stats.reversals,
                  )}
                </span>
              </div>

              {/* CURRENT BALANCE */}

              <div className="mt-2 flex items-center justify-between gap-3 border-t border-white/[0.06] pt-2">
                <span className="text-[9px] font-medium text-white/40">
                  Current balance
                </span>

                <span className="text-[10px] font-semibold text-[#4da3ff]">
                  {formatCurrency(
                    calculatedSavings,
                  )}
                </span>
              </div>
            </div>
          </div>
        </div>
      </button>

      {/* =====================================================
          LOANS
      ===================================================== */}

      <button
        type="button"
        onClick={() =>
          window.location.assign(
            "/dashboard/loans",
          )
        }
        className="group relative w-full overflow-hidden rounded-[22px] border border-[#1683ff]/15 bg-gradient-to-br from-[#0a1826] via-[#07131e] to-[#060b11] p-4 text-left shadow-[0_12px_35px_rgba(0,0,0,0.25)] transition active:scale-[0.99]"
      >
        <div className="absolute -bottom-12 -right-10 h-32 w-32 rounded-full bg-[#1683ff]/10 blur-3xl" />

        <div className="relative">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#1683ff]/10 text-[#4da3ff]">
                <HandCoins
                  size={17}
                  strokeWidth={1.8}
                />
              </div>

              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/35">
                  Loans
                </p>

                <p className="text-[9px] text-white/20">
                  Lending portfolio
                </p>
              </div>
            </div>

            <ArrowRight
              size={15}
              className="text-white/20"
            />
          </div>

          <div className="mt-3">
            <p className="truncate text-[25px] font-semibold leading-none tracking-tight text-white">
              {formatCurrency(
                stats.outstandingLoans,
              )}
            </p>

            <p className="mt-1 text-[10px] text-white/30">
              outstanding balance
            </p>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2 border-t border-white/[0.06] pt-3">
            <div>
              <p className="text-sm font-semibold text-white/80">
                {stats.loans.toLocaleString()}
              </p>

              <p className="mt-0.5 text-[9px] uppercase tracking-[0.12em] text-white/25">
                Active loans
              </p>
            </div>

            <div className="text-right">
              <p
                className={`text-sm font-semibold ${
                  stats.defaulters > 0
                    ? "text-red-400"
                    : "text-[#4da3ff]"
                }`}
              >
                {stats.defaulters.toLocaleString()}
              </p>

              <p className="mt-0.5 text-[9px] uppercase tracking-[0.12em] text-white/25">
                Defaulters
              </p>
            </div>
          </div>
        </div>
      </button>

      {/* =====================================================
          RECENT ACTIVITY
      ===================================================== */}

      <section className="overflow-hidden rounded-[22px] border border-white/[0.07] bg-white/[0.025]">
        <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3.5">
          <div>
            <p className="text-xs font-semibold text-white/75">
              Recent activity
            </p>

            <p className="mt-0.5 text-[9px] text-white/25">
              Latest system records
            </p>
          </div>

          <span className="flex items-center gap-1.5 text-[9px] text-[#4da3ff]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#1683ff]" />
            Live
          </span>
        </div>

        {activities.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <Bell
              size={18}
              className="mx-auto text-white/20"
            />

            <p className="mt-2 text-xs text-white/35">
              No recent activity
            </p>
          </div>
        ) : (
          <div className="max-h-[260px] overflow-y-auto overscroll-contain scrollbar-thin scrollbar-track-transparent scrollbar-thumb-white/10">
            {activities
              .slice(0, 6)
              .map(
                (activity) => (
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

      {/* =====================================================
          MOBILE FOOTER
      ===================================================== */}

      <div className="px-1 pb-3 pt-1 text-center">
        <p className="text-[9px] text-white/15">
          GEO-SHUA SACCO Management
        </p>
      </div>
    </div>
  );
}

/* =========================================================
   MOBILE SNAPSHOT
========================================================= */

function MobileSnapshot({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="min-w-0 rounded-xl border border-white/[0.05] bg-white/[0.025] px-3 py-2.5">
      <p className="truncate text-[8px] uppercase tracking-[0.1em] text-white/20">
        {label}
      </p>

      <p className="mt-1 truncate text-xs font-semibold text-white/70">
        {value}
      </p>
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

    notification: (
      <Bell
        size={14}
        strokeWidth={1.8}
      />
    ),
  };

  return (
    <div className="flex min-w-0 items-center gap-3 border-b border-white/[0.045] px-4 py-3 last:border-b-0">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#1683ff]/[0.07] text-[#4da3ff]/70">
        {icons[activity.type]}
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate text-[10px] font-medium text-white/60">
          {activity.title}
        </p>

        <p className="mt-0.5 truncate text-[9px] text-white/20">
          {activity.description}
        </p>
      </div>

      <span className="shrink-0 text-[8px] text-white/20">
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
        metrics.length > 0 && (
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
  icon: ReactNode;
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
  icon: ReactNode;
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
              className="h-[125px] rounded-2xl border border-white/[0.06] bg-white/[0.025]"
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
              className="h-[85px] rounded-2xl border border-white/[0.06] bg-white/[0.025]"
            />
          ),
        )}
      </section>

      <section className="grid gap-5 lg:grid-cols-[minmax(0,1.45fr)_minmax(280px,0.75fr)]">
        <div className="min-h-[330px] rounded-2xl border border-white/[0.06] bg-white/[0.025]" />

        <div className="min-h-[330px] rounded-2xl border border-white/[0.06] bg-white/[0.025]" />
      </section>

      <section className="grid gap-5 md:grid-cols-2">
        <div className="h-[220px] rounded-2xl border border-white/[0.06] bg-white/[0.025]" />

        <div className="h-[220px] rounded-2xl border border-white/[0.06] bg-white/[0.025]" />
      </section>

      <section>
        <div className="h-[125px] rounded-2xl border border-white/[0.06] bg-white/[0.025]" />
      </section>
    </div>
  );
}

/* =========================================================
   MOBILE LOADING
========================================================= */

function MobileDashboardLoading() {
  return (
    <div className="animate-pulse space-y-3">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <div className="h-2.5 w-20 rounded bg-white/[0.06]" />

          <div className="mt-2 h-5 w-28 rounded bg-white/[0.06]" />

          <div className="mt-2 h-2.5 w-36 rounded bg-white/[0.04]" />
        </div>

        <div className="h-10 w-10 rounded-xl bg-white/[0.05]" />
      </div>

      {Array.from({
        length: 3,
      }).map(
        (_, index) => (
          <div
            key={index}
            className="h-[137px] rounded-[22px] border border-white/[0.06] bg-white/[0.025]"
          />
        ),
      )}

      <div className="h-[170px] rounded-[22px] border border-white/[0.06] bg-white/[0.025]" />

      <div className="h-[220px] rounded-[22px] border border-white/[0.06] bg-white/[0.025]" />
    </div>
  );
}