"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  AlertCircle,
  ArrowDownLeft,
  ArrowUpRight,
  Banknote,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  CircleUserRound,
  CreditCard,
  FileText,
  Landmark,
  Loader2,
  Mail,
  Phone,
  RefreshCw,
  Settings2,
  ShieldCheck,
  UserRound,
  Wallet,
  X,
} from "lucide-react";

/* =========================================================
   TYPES
========================================================= */

type JsonRecord = Record<string, unknown>;

interface MeData {
  account: JsonRecord | null;
  member: JsonRecord | null;
  loans: JsonRecord[];
  loanRepayments: JsonRecord[];
  loanSettings: JsonRecord | null;
  savings: {
    account: JsonRecord | null;
    summary: JsonRecord | null;
    transactions: JsonRecord[];
  };
}

interface MyAccountModalProps {
  open: boolean;
  onClose: () => void;
}

/* =========================================================
   HELPERS
========================================================= */

function isRecord(
  value: unknown,
): value is JsonRecord {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function getValue(
  object: JsonRecord | null | undefined,
  ...keys: string[]
): unknown {
  if (!object) {
    return undefined;
  }

  for (const key of keys) {
    if (
      Object.prototype.hasOwnProperty.call(
        object,
        key,
      )
    ) {
      const value = object[key];

      if (
        value !== null &&
        value !== undefined &&
        value !== ""
      ) {
        return value;
      }
    }
  }

  return undefined;
}

function getString(
  object: JsonRecord | null | undefined,
  ...keys: string[]
): string {
  const value = getValue(
    object,
    ...keys,
  );

  if (
    typeof value === "string" ||
    typeof value === "number"
  ) {
    return String(value);
  }

  return "";
}

function getNumber(
  object: JsonRecord | null | undefined,
  ...keys: string[]
): number | null {
  const value = getValue(
    object,
    ...keys,
  );

  if (typeof value === "number") {
    return Number.isFinite(value)
      ? value
      : null;
  }

  if (typeof value === "string") {
    const parsed = Number(
      value.replace(/,/g, ""),
    );

    return Number.isFinite(parsed)
      ? parsed
      : null;
  }

  return null;
}

function formatMoney(
  value: number | null | undefined,
): string {
  if (
    value === null ||
    value === undefined ||
    !Number.isFinite(value)
  ) {
    return "KES 0.00";
  }

  return `KES ${value.toLocaleString(
    "en-KE",
    {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    },
  )}`;
}

function formatDate(
  value: unknown,
): string {
  if (!value) {
    return "—";
  }

  const date =
    value instanceof Date
      ? value
      : new Date(String(value));

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleDateString(
    "en-KE",
    {
      day: "2-digit",
      month: "short",
      year: "numeric",
    },
  );
}

function formatDateTime(
  value: unknown,
): string {
  if (!value) {
    return "—";
  }

  const date =
    value instanceof Date
      ? value
      : new Date(String(value));

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleString(
    "en-KE",
    {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    },
  );
}

function formatLabel(
  value: string,
): string {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) =>
      char.toUpperCase(),
    );
}

function getInitials(
  name: string,
): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (parts.length === 0) {
    return "U";
  }

  if (parts.length === 1) {
    return parts[0]
      .slice(0, 2)
      .toUpperCase();
  }

  return (
    parts[0][0] +
    parts[parts.length - 1][0]
  ).toUpperCase();
}

function normalizeStatus(
  value: unknown,
): string {
  if (
    value === null ||
    value === undefined
  ) {
    return "";
  }

  return String(value)
    .trim()
    .toLowerCase();
}

function isPositiveStatus(
  value: unknown,
): boolean {
  const status =
    normalizeStatus(value);

  return [
    "active",
    "approved",
    "completed",
    "paid",
    "open",
    "verified",
    "success",
    "successful",
  ].includes(status);
}

function isNegativeStatus(
  value: unknown,
): boolean {
  const status =
    normalizeStatus(value);

  return [
    "failed",
    "rejected",
    "cancelled",
    "canceled",
    "overdue",
    "suspended",
  ].includes(status);
}

/* =========================================================
   DEFAULT DATA
========================================================= */

const EMPTY_DATA: MeData = {
  account: null,
  member: null,
  loans: [],
  loanRepayments: [],
  loanSettings: null,
  savings: {
    account: null,
    summary: null,
    transactions: [],
  },
};

/* =========================================================
   COMPONENT
========================================================= */

export default function MyAccountModal({
  open,
  onClose,
}: MyAccountModalProps) {
  const [data, setData] =
    useState<MeData>(EMPTY_DATA);

  const [loading, setLoading] =
    useState(false);

  const [refreshing, setRefreshing] =
    useState(false);

  const [error, setError] =
    useState<string | null>(null);

  const [expanded, setExpanded] =
    useState({
      profile: true,
      savings: true,
      loans: true,
      repayments: false,
      settings: false,
    });

  /* =======================================================
     FETCH /api/me
  ======================================================= */

  const fetchMe = useCallback(
    async (
      silent = false,
    ) => {
      if (!silent) {
        setLoading(true);
      } else {
        setRefreshing(true);
      }

      setError(null);

      try {
        const response =
          await fetch(
            "/api/me",
            {
              method: "GET",
              headers: {
                Accept:
                  "application/json",
              },
              cache: "no-store",
            },
          );

        const payload: unknown =
          await response.json();

        if (!response.ok) {
          const message =
            isRecord(payload) &&
            typeof payload.error ===
              "string"
              ? payload.error
              : `Unable to load account data (${response.status}).`;

          throw new Error(message);
        }

        if (!isRecord(payload)) {
          throw new Error(
            "The account API returned an invalid response.",
          );
        }

        const savings =
          isRecord(payload.savings)
            ? payload.savings
            : {};

        const normalized: MeData = {
          account:
            isRecord(
              payload.account,
            )
              ? payload.account
              : null,

          member:
            isRecord(
              payload.member,
            )
              ? payload.member
              : null,

          loans: Array.isArray(
            payload.loans,
          )
            ? payload.loans.filter(
                isRecord,
              )
            : [],

          loanRepayments:
            Array.isArray(
              payload.loanRepayments,
            )
              ? payload.loanRepayments.filter(
                  isRecord,
                )
              : [],

          loanSettings:
            isRecord(
              payload.loanSettings,
            )
              ? payload.loanSettings
              : null,

          savings: {
            account:
              isRecord(
                savings.account,
              )
                ? savings.account
                : null,

            summary:
              isRecord(
                savings.summary,
              )
                ? savings.summary
                : null,

            transactions:
              Array.isArray(
                savings.transactions,
              )
                ? savings.transactions.filter(
                    isRecord,
                  )
                : [],
          },
        };

        setData(normalized);
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : "Unable to load your account.";

        setError(message);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [],
  );

  /* =======================================================
     LOAD WHEN OPEN
  ======================================================= */

  useEffect(() => {
    if (!open) {
      return;
    }

    void fetchMe();
  }, [
    open,
    fetchMe,
  ]);

  /* =======================================================
     ESCAPE KEY
  ======================================================= */

  useEffect(() => {
    if (!open) {
      return;
    }

    const handleKeyDown = (
      event: KeyboardEvent,
    ) => {
      if (
        event.key === "Escape"
      ) {
        onClose();
      }
    };

    window.addEventListener(
      "keydown",
      handleKeyDown,
    );

    return () => {
      window.removeEventListener(
        "keydown",
        handleKeyDown,
      );
    };
  }, [
    open,
    onClose,
  ]);

  /* =======================================================
     LOCK BODY SCROLL
  ======================================================= */

  useEffect(() => {
    if (!open) {
      return;
    }

    const originalOverflow =
      document.body.style.overflow;

    document.body.style.overflow =
      "hidden";

    return () => {
      document.body.style.overflow =
        originalOverflow;
    };
  }, [open]);

  /* =======================================================
     DERIVED DATA
  ======================================================= */

  const accountName =
    getString(
      data.account,
      "name",
      "fullName",
      "displayName",
    ) ||
    getString(
      data.member,
      "name",
      "fullName",
      "memberName",
    ) ||
    "My Account";

  const email =
    getString(
      data.account,
      "email",
      "userEmail",
    ) ||
    getString(
      data.member,
      "email",
      "memberEmail",
    );

  const phone =
    getString(
      data.account,
      "phone",
      "phoneNumber",
      "mobile",
    ) ||
    getString(
      data.member,
      "phone",
      "phoneNumber",
      "mobile",
    );

  const memberId =
    getString(
      data.member,
      "memberId",
      "id",
      "_id",
    );

  const memberStatus =
    getString(
      data.member,
      "status",
      "memberStatus",
    );

  const savingsBalance =
    getNumber(
      data.savings.summary,
      "balance",
      "currentBalance",
      "availableBalance",
      "savingsBalance",
    ) ??
    getNumber(
      data.savings.account,
      "balance",
      "currentBalance",
      "availableBalance",
    ) ??
    0;

  const savingsTransactions =
    data.savings.transactions;

  const savingsDeposits =
    useMemo(
      () =>
        savingsTransactions.filter(
          (transaction) => {
            const type =
              normalizeStatus(
                getValue(
                  transaction,
                  "type",
                  "transactionType",
                  "direction",
                ),
              );

            return (
              type.includes(
                "deposit",
              ) ||
              type.includes(
                "credit",
              ) ||
              type.includes(
                "contribution",
              )
            );
          },
        ),
      [savingsTransactions],
    );

  const savingsWithdrawals =
    useMemo(
      () =>
        savingsTransactions.filter(
          (transaction) => {
            const type =
              normalizeStatus(
                getValue(
                  transaction,
                  "type",
                  "transactionType",
                  "direction",
                ),
              );

            return (
              type.includes(
                "withdraw",
              ) ||
              type.includes(
                "debit",
              )
            );
          },
        ),
      [savingsTransactions],
    );

  const totalLoanBalance =
    useMemo(
      () =>
        data.loans.reduce(
          (total, loan) =>
            total +
            (getNumber(
              loan,
              "outstandingBalance",
              "balance",
              "remainingBalance",
              "amountOutstanding",
            ) ?? 0),
          0,
        ),
      [data.loans],
    );

  const totalLoanAmount =
    useMemo(
      () =>
        data.loans.reduce(
          (total, loan) =>
            total +
            (getNumber(
              loan,
              "principal",
              "principalAmount",
              "loanAmount",
              "amount",
            ) ?? 0),
          0,
        ),
      [data.loans],
    );

  const totalRepayments =
    useMemo(
      () =>
        data.loanRepayments.reduce(
          (total, repayment) =>
            total +
            (getNumber(
              repayment,
              "amount",
              "paymentAmount",
              "repaymentAmount",
            ) ?? 0),
          0,
        ),
      [data.loanRepayments],
    );

  const activeLoans =
    useMemo(
      () =>
        data.loans.filter(
          (loan) =>
            ![
              "paid",
              "completed",
              "closed",
              "cancelled",
              "canceled",
            ].includes(
              normalizeStatus(
                getValue(
                  loan,
                  "status",
                  "loanStatus",
                ),
              ),
            ),
        ),
      [data.loans],
    );

  /* =======================================================
     TOGGLE
  ======================================================= */

  const toggleSection = (
    section: keyof typeof expanded,
  ) => {
    setExpanded((current) => ({
      ...current,
      [section]:
        !current[section],
    }));
  };

  /* =======================================================
     CLOSE
  ======================================================= */

  if (!open) {
    return null;
  }

  /* =======================================================
     RENDER
  ======================================================= */

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center bg-black/60 backdrop-blur-sm md:items-center md:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="my-account-title"
      onMouseDown={(event) => {
        if (
          event.target ===
          event.currentTarget
        ) {
          onClose();
        }
      }}
    >
      <div
        className="flex h-[100dvh] w-full flex-col overflow-hidden bg-white shadow-2xl dark:bg-slate-950 md:h-[92vh] md:max-w-4xl md:rounded-2xl"
        onMouseDown={(event) =>
          event.stopPropagation()
        }
      >
        {/* =================================================
            HEADER
        ================================================= */}

        <header className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-950 md:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-600 text-sm font-bold text-white">
              {getInitials(
                accountName,
              )}
            </div>

            <div className="min-w-0">
              <h2
                id="my-account-title"
                className="truncate text-base font-bold text-slate-900 dark:text-white md:text-lg"
              >
                My Account
              </h2>

              <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                {accountName}
              </p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() =>
                void fetchMe(true)
              }
              disabled={
                loading ||
                refreshing
              }
              className="flex h-10 w-10 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-slate-800 dark:hover:text-white"
              aria-label="Refresh account"
              title="Refresh"
            >
              <RefreshCw
                className={`h-4 w-4 ${
                  refreshing
                    ? "animate-spin"
                    : ""
                }`}
              />
            </button>

            <button
              type="button"
              onClick={onClose}
              className="flex h-10 w-10 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-white"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </header>

        {/* =================================================
            CONTENT
        ================================================= */}

        <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-slate-50 px-3 py-4 dark:bg-slate-900 md:px-6 md:py-6">
          {/* ===============================================
              ERROR
          =============================================== */}

          {error && (
            <div className="mb-4 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />

              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">
                  Unable to load account
                  data
                </p>

                <p className="mt-1 text-xs opacity-80">
                  {error}
                </p>

                <button
                  type="button"
                  onClick={() =>
                    void fetchMe()
                  }
                  className="mt-3 rounded-lg bg-red-600 px-3 py-2 text-xs font-semibold text-white hover:bg-red-700"
                >
                  Try again
                </button>
              </div>
            </div>
          )}

          {/* ===============================================
              LOADING
          =============================================== */}

          {loading ? (
            <LoadingState />
          ) : (
            <div className="space-y-4">
              {/* =========================================
                  QUICK SUMMARY
              ========================================= */}

              <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <SummaryCard
                  icon={
                    <Wallet className="h-4 w-4" />
                  }
                  label="Savings"
                  value={formatMoney(
                    savingsBalance,
                  )}
                />

                <SummaryCard
                  icon={
                    <Landmark className="h-4 w-4" />
                  }
                  label="Loan Balance"
                  value={formatMoney(
                    totalLoanBalance,
                  )}
                />

                <SummaryCard
                  icon={
                    <Banknote className="h-4 w-4" />
                  }
                  label="Loans"
                  value={String(
                    activeLoans.length,
                  )}
                />

                <SummaryCard
                  icon={
                    <CreditCard className="h-4 w-4" />
                  }
                  label="Repayments"
                  value={formatMoney(
                    totalRepayments,
                  )}
                />
              </section>

              {/* =========================================
                  PROFILE
              ========================================= */}

              <Section
                title="My Profile"
                icon={
                  <CircleUserRound className="h-5 w-5" />
                }
                expanded={
                  expanded.profile
                }
                onToggle={() =>
                  toggleSection(
                    "profile",
                  )
                }
              >
                <div className="grid gap-3 md:grid-cols-2">
                  <InfoItem
                    icon={
                      <UserRound className="h-4 w-4" />
                    }
                    label="Name"
                    value={
                      accountName
                    }
                  />

                  <InfoItem
                    icon={
                      <Mail className="h-4 w-4" />
                    }
                    label="Email"
                    value={
                      email || "—"
                    }
                  />

                  <InfoItem
                    icon={
                      <Phone className="h-4 w-4" />
                    }
                    label="Phone"
                    value={
                      phone || "—"
                    }
                  />

                  <InfoItem
                    icon={
                      <ShieldCheck className="h-4 w-4" />
                    }
                    label="Member Status"
                    value={
                      memberStatus ||
                      "—"
                    }
                    status={
                      memberStatus
                    }
                  />

                  <InfoItem
                    icon={
                      <FileText className="h-4 w-4" />
                    }
                    label="Member ID"
                    value={
                      memberId || "—"
                    }
                    mono
                  />

                  <InfoItem
                    icon={
                      <CalendarDays className="h-4 w-4" />
                    }
                    label="Joined"
                    value={formatDate(
                      getValue(
                        data.member,
                        "createdAt",
                        "joinedAt",
                        "registrationDate",
                      ),
                    )}
                  />
                </div>
              </Section>

              {/* =========================================
                  SAVINGS
              ========================================= */}

              <Section
                title="Savings"
                icon={
                  <Wallet className="h-5 w-5" />
                }
                expanded={
                  expanded.savings
                }
                onToggle={() =>
                  toggleSection(
                    "savings",
                  )
                }
                badge={
                  savingsTransactions.length
                    ? String(
                        savingsTransactions.length,
                      )
                    : undefined
                }
              >
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  <Metric
                    label="Balance"
                    value={formatMoney(
                      savingsBalance,
                    )}
                  />

                  <Metric
                    label="Deposits"
                    value={String(
                      savingsDeposits.length,
                    )}
                  />

                  <Metric
                    label="Withdrawals"
                    value={String(
                      savingsWithdrawals.length,
                    )}
                  />

                  <Metric
                    label="Transactions"
                    value={String(
                      savingsTransactions.length,
                    )}
                  />
                </div>

                {data.savings.account && (
                  <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950">
                    <h4 className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-500">
                      Savings Account
                    </h4>

                    <DynamicFields
                      data={
                        data.savings.account
                      }
                      exclude={[
                        "id",
                        "_id",
                        "memberId",
                        "createdAt",
                        "updatedAt",
                      ]}
                    />
                  </div>
                )}

                {savingsTransactions.length >
                  0 && (
                  <div className="mt-4">
                    <h4 className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">
                      Recent Transactions
                    </h4>

                    <div className="space-y-2">
                      {savingsTransactions
                        .slice(0, 10)
                        .map(
                          (
                            transaction,
                            index,
                          ) => (
                            <TransactionRow
                              key={
                                getString(
                                  transaction,
                                  "id",
                                  "_id",
                                ) ||
                                `saving-${index}`
                              }
                              transaction={
                                transaction
                              }
                            />
                          ),
                        )}
                    </div>

                    {savingsTransactions.length >
                      10 && (
                      <p className="mt-3 text-center text-xs text-slate-500">
                        Showing the 10 most
                        recent
                        transactions.
                      </p>
                    )}
                  </div>
                )}

                {!data.savings.account &&
                  savingsTransactions.length ===
                    0 && (
                    <EmptyState text="No savings information is available." />
                  )}
              </Section>

              {/* =========================================
                  LOANS
              ========================================= */}

              <Section
                title="Loans"
                icon={
                  <Landmark className="h-5 w-5" />
                }
                expanded={
                  expanded.loans
                }
                onToggle={() =>
                  toggleSection(
                    "loans",
                  )
                }
                badge={
                  data.loans.length
                    ? String(
                        data.loans.length,
                      )
                    : undefined
                }
              >
                <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                  <Metric
                    label="Active"
                    value={String(
                      activeLoans.length,
                    )}
                  />

                  <Metric
                    label="Principal"
                    value={formatMoney(
                      totalLoanAmount,
                    )}
                  />

                  <Metric
                    label="Outstanding"
                    value={formatMoney(
                      totalLoanBalance,
                    )}
                  />
                </div>

                {data.loans.length >
                0 ? (
                  <div className="mt-4 space-y-3">
                    {data.loans.map(
                      (
                        loan,
                        index,
                      ) => (
                        <LoanCard
                          key={
                            getString(
                              loan,
                              "id",
                              "_id",
                              "loanId",
                            ) ||
                            `loan-${index}`
                          }
                          loan={
                            loan
                          }
                        />
                      ),
                    )}
                  </div>
                ) : (
                  <EmptyState text="No loans found for your account." />
                )}
              </Section>

              {/* =========================================
                  REPAYMENTS
              ========================================= */}

              <Section
                title="Loan Repayments"
                icon={
                  <CreditCard className="h-5 w-5" />
                }
                expanded={
                  expanded.repayments
                }
                onToggle={() =>
                  toggleSection(
                    "repayments",
                  )
                }
                badge={
                  data.loanRepayments
                    .length
                    ? String(
                        data.loanRepayments.length,
                      )
                    : undefined
                }
              >
                {data.loanRepayments
                  .length > 0 ? (
                  <div className="space-y-2">
                    {data.loanRepayments.map(
                      (
                        repayment,
                        index,
                      ) => (
                        <RepaymentRow
                          key={
                            getString(
                              repayment,
                              "id",
                              "_id",
                              "repaymentId",
                            ) ||
                            `repayment-${index}`
                          }
                          repayment={
                            repayment
                          }
                        />
                      ),
                    )}
                  </div>
                ) : (
                  <EmptyState text="No loan repayments found." />
                )}
              </Section>

              {/* =========================================
                  LOAN SETTINGS
              ========================================= */}

              <Section
                title="Loan Settings"
                icon={
                  <Settings2 className="h-5 w-5" />
                }
                expanded={
                  expanded.settings
                }
                onToggle={() =>
                  toggleSection(
                    "settings",
                  )
                }
              >
                {data.loanSettings ? (
                  <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950">
                    <DynamicFields
                      data={
                        data.loanSettings
                      }
                    />
                  </div>
                ) : (
                  <EmptyState text="No loan settings are available." />
                )}
              </Section>
            </div>
          )}
        </main>

        {/* =================================================
            FOOTER
        ================================================= */}

        <footer className="shrink-0 border-t border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-950 md:px-6">
          <div className="flex items-center justify-between gap-3">
            <p className="hidden text-xs text-slate-500 sm:block">
              Account information is loaded
              securely from DANIJACE PROMOTIONS.
            </p>

            <button
              type="button"
              onClick={onClose}
              className="ml-auto rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
            >
              Done
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

/* =========================================================
   SECTION
========================================================= */

function Section({
  title,
  icon,
  expanded,
  onToggle,
  badge,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  expanded: boolean;
  onToggle: () => void;
  badge?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-4 py-4 text-left transition hover:bg-slate-50 dark:hover:bg-slate-900 md:px-5"
        aria-expanded={expanded}
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400">
          {icon}
        </span>

        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold text-slate-900 dark:text-white">
            {title}
          </span>
        </span>

        {badge && (
          <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            {badge}
          </span>
        )}

        {expanded ? (
          <ChevronDown className="h-5 w-5 shrink-0 text-slate-400" />
        ) : (
          <ChevronRight className="h-5 w-5 shrink-0 text-slate-400" />
        )}
      </button>

      {expanded && (
        <div className="border-t border-slate-100 px-4 pb-5 pt-4 dark:border-slate-800 md:px-5">
          {children}
        </div>
      )}
    </section>
  );
}

/* =========================================================
   SUMMARY CARD
========================================================= */

function SummaryCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="min-w-0 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-slate-950 md:p-4">
      <div className="mb-2 flex items-center gap-2 text-blue-600 dark:text-blue-400">
        {icon}

        <span className="truncate text-[10px] font-bold uppercase tracking-wide text-slate-500">
          {label}
        </span>
      </div>

      <p className="truncate text-sm font-bold text-slate-900 dark:text-white md:text-base">
        {value}
      </p>
    </div>
  );
}

/* =========================================================
   METRIC
========================================================= */

function Metric({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-900">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </p>

      <p className="mt-1 truncate text-sm font-bold text-slate-900 dark:text-white">
        {value}
      </p>
    </div>
  );
}

/* =========================================================
   INFO ITEM
========================================================= */

function InfoItem({
  icon,
  label,
  value,
  status,
  mono = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  status?: string;
  mono?: boolean;
}) {
  const positive =
    status &&
    isPositiveStatus(status);

  const negative =
    status &&
    isNegativeStatus(status);

  return (
    <div className="flex min-w-0 items-start gap-3 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-950">
      <span className="mt-0.5 shrink-0 text-slate-400">
        {icon}
      </span>

      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
          {label}
        </p>

        {status ? (
          <span
            className={`mt-1 inline-flex rounded-full px-2 py-1 text-xs font-semibold ${
              positive
                ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400"
                : negative
                  ? "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400"
                  : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
            }`}
          >
            {formatLabel(value)}
          </span>
        ) : (
          <p
            className={`mt-1 break-all text-sm font-medium text-slate-900 dark:text-white ${
              mono
                ? "font-mono text-xs"
                : ""
            }`}
          >
            {value}
          </p>
        )}
      </div>
    </div>
  );
}

/* =========================================================
   TRANSACTION ROW
========================================================= */

function TransactionRow({
  transaction,
}: {
  transaction: JsonRecord;
}) {
  const type =
    getString(
      transaction,
      "type",
      "transactionType",
      "direction",
    );

  const amount =
    getNumber(
      transaction,
      "amount",
      "transactionAmount",
      "credit",
      "debit",
    ) ?? 0;

  const description =
    getString(
      transaction,
      "description",
      "narration",
      "reference",
      "reason",
    ) || "Savings transaction";

  const date =
    getValue(
      transaction,
      "transactionDate",
      "date",
      "createdAt",
    );

  const outgoing =
    normalizeStatus(type).includes(
      "withdraw",
    ) ||
    normalizeStatus(type).includes(
      "debit",
    );

  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-950">
      <div
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
          outgoing
            ? "bg-red-50 text-red-600 dark:bg-red-950/30 dark:text-red-400"
            : "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/30 dark:text-emerald-400"
        }`}
      >
        {outgoing ? (
          <ArrowUpRight className="h-4 w-4" />
        ) : (
          <ArrowDownLeft className="h-4 w-4" />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-semibold text-slate-900 dark:text-white">
          {description}
        </p>

        <p className="mt-1 text-[10px] text-slate-500">
          {formatDateTime(date)}
        </p>
      </div>

      <div className="shrink-0 text-right">
        <p
          className={`text-xs font-bold ${
            outgoing
              ? "text-red-600 dark:text-red-400"
              : "text-emerald-600 dark:text-emerald-400"
          }`}
        >
          {outgoing
            ? "-"
            : "+"}
          {formatMoney(
            amount,
          )}
        </p>

        {type && (
          <p className="mt-1 text-[9px] uppercase text-slate-400">
            {formatLabel(type)}
          </p>
        )}
      </div>
    </div>
  );
}

/* =========================================================
   LOAN CARD
========================================================= */

function LoanCard({
  loan,
}: {
  loan: JsonRecord;
}) {
  const loanId =
    getString(
      loan,
      "loanNumber",
      "loanId",
      "id",
      "_id",
    );

  const principal =
    getNumber(
      loan,
      "principal",
      "principalAmount",
      "loanAmount",
      "amount",
    ) ?? 0;

  const balance =
    getNumber(
      loan,
      "outstandingBalance",
      "remainingBalance",
      "amountOutstanding",
      "balance",
    ) ?? 0;

  const status =
    getString(
      loan,
      "status",
      "loanStatus",
    );

  const loanType =
    getString(
      loan,
      "type",
      "loanType",
      "product",
    );

  const date =
    getValue(
      loan,
      "createdAt",
      "loanDate",
      "disbursementDate",
    );

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-bold text-slate-900 dark:text-white">
            {loanType
              ? formatLabel(
                  loanType,
                )
              : "Loan"}
          </p>

          <p className="mt-1 truncate font-mono text-[10px] text-slate-500">
            {loanId || "No loan ID"}
          </p>
        </div>

        {status && (
          <span
            className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-semibold ${
              isPositiveStatus(
                status,
              )
                ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400"
                : isNegativeStatus(
                      status,
                    )
                  ? "bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-400"
                  : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
            }`}
          >
            {formatLabel(
              status,
            )}
          </span>
        )}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3">
        <Metric
          label="Principal"
          value={formatMoney(
            principal,
          )}
        />

        <Metric
          label="Outstanding"
          value={formatMoney(
            balance,
          )}
        />

        <Metric
          label="Date"
          value={formatDate(
            date,
          )}
        />
      </div>
    </div>
  );
}

/* =========================================================
   REPAYMENT ROW
========================================================= */

function RepaymentRow({
  repayment,
}: {
  repayment: JsonRecord;
}) {
  const amount =
    getNumber(
      repayment,
      "amount",
      "paymentAmount",
      "repaymentAmount",
    ) ?? 0;

  const status =
    getString(
      repayment,
      "status",
      "paymentStatus",
    );

  const reference =
    getString(
      repayment,
      "reference",
      "transactionReference",
      "externalReference",
      "id",
      "_id",
    );

  const date =
    getValue(
      repayment,
      "transactionDate",
      "paymentDate",
      "date",
      "createdAt",
    );

  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-950">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-600 dark:bg-blue-950/30 dark:text-blue-400">
        <Banknote className="h-4 w-4" />
      </div>

      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold text-slate-900 dark:text-white">
          {formatMoney(amount)}
        </p>

        <p className="mt-1 truncate font-mono text-[10px] text-slate-500">
          {reference || "No reference"}
        </p>

        <p className="mt-1 text-[10px] text-slate-500">
          {formatDateTime(date)}
        </p>
      </div>

      {status && (
        <span
          className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-semibold ${
            isPositiveStatus(
              status,
            )
              ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400"
              : isNegativeStatus(
                    status,
                  )
                ? "bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-400"
                : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
          }`}
        >
          {formatLabel(
            status,
          )}
        </span>
      )}
    </div>
  );
}

/* =========================================================
   DYNAMIC FIELDS
========================================================= */

function DynamicFields({
  data,
  exclude = [],
}: {
  data: JsonRecord;
  exclude?: string[];
}) {
  const entries =
    Object.entries(data).filter(
      ([key, value]) => {
        if (
          exclude.includes(key)
        ) {
          return false;
        }

        if (
          value === null ||
          value === undefined ||
          value === ""
        ) {
          return false;
        }

        if (
          typeof value ===
            "object" &&
          !Array.isArray(value)
        ) {
          return false;
        }

        if (Array.isArray(value)) {
          return false;
        }

        return true;
      },
    );

  if (entries.length === 0) {
    return (
      <EmptyState text="No additional information is available." />
    );
  }

  return (
    <div className="grid gap-3 md:grid-cols-2">
      {entries.map(
        ([key, value]) => {
          let displayValue =
            String(value);

          if (
            typeof value ===
            "boolean"
          ) {
            displayValue =
              value
                ? "Yes"
                : "No";
          }

          if (
            key
              .toLowerCase()
              .includes("date") ||
            key === "createdAt" ||
            key === "updatedAt"
          ) {
            displayValue =
              formatDateTime(
                value,
              );
          }

          return (
            <div
              key={key}
              className="rounded-xl bg-slate-50 p-3 dark:bg-slate-900"
            >
              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                {formatLabel(
                  key,
                )}
              </p>

              <p className="mt-1 break-words text-xs font-medium text-slate-900 dark:text-white">
                {displayValue}
              </p>
            </div>
          );
        },
      )}
    </div>
  );
}

/* =========================================================
   EMPTY STATE
========================================================= */

function EmptyState({
  text,
}: {
  text: string;
}) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center dark:border-slate-700 dark:bg-slate-900">
      <p className="text-xs text-slate-500 dark:text-slate-400">
        {text}
      </p>
    </div>
  );
}

/* =========================================================
   LOADING STATE
========================================================= */

function LoadingState() {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-blue-600" />

      <p className="mt-3 text-sm font-medium text-slate-600 dark:text-slate-300">
        Loading your account...
      </p>

      <p className="mt-1 text-xs text-slate-400">
        Gathering your savings,
        loans and repayments.
      </p>
    </div>
  );
}