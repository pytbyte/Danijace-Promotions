"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  AlertCircle,
  ArrowUpRight,
  Banknote,
  Eye,
  Plus,
  RefreshCw,
  Settings2,
} from "lucide-react";

import TopBar from "@/components/dashboard/TopBar";

import LoanDashboard from "@/components/loans/LoanDashboard";
import LoanCard from "@/components/loans/LoanCard";
import LoanForm from "@/components/loans/LoanForm";
import LoanSettingsForm from "@/components/loans/LoanSettingsForm";
import LoanRepaymentModal from "@/components/loans/LoanRepaymentForm";
import LoanSearch, {
  DEFAULT_LOAN_FILTERS,
  type LoanSearchFilters,
} from "@/components/loans/LoanSearch";
import LoanTransactionModal from "@/components/loans/LoanTransactionModal";

import type {
  Loan,
  TransactionSource,
} from "@/lib/loans/types";

/* =========================================================
   CONSTANTS
========================================================= */

const LOANS_API = "/api/loans";
const REPAYMENT_API = "/api/loans/repayments";

/* =========================================================
   RESPONSE TYPES
========================================================= */

type LoansResponse = {
  success: boolean;
  data?: Loan[];
  count?: number;
  error?: string;
};

type RepaymentResponse = {
  success: boolean;
  data?: unknown;
  error?: string;
};

/* =========================================================
   PAGE
========================================================= */

export default function LoansPage() {
  /* =======================================================
     CORE STATE
  ======================================================= */

  const [loans, setLoans] = useState<Loan[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [mounted, setMounted] = useState(false);

  /* =======================================================
     SEARCH / FILTERS
  ======================================================= */

  const [loanFilters, setLoanFilters] =
    useState<LoanSearchFilters>(
      DEFAULT_LOAN_FILTERS,
    );

  /* =======================================================
     LOAN MODALS
  ======================================================= */

  const [loanFormOpen, setLoanFormOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  /* =======================================================
     REPAYMENT MODAL
  ======================================================= */

  const [repaymentLoan, setRepaymentLoan] =
    useState<Loan | null>(null);

  const [repaymentOpen, setRepaymentOpen] = useState(false);
  const [repaymentLoading, setRepaymentLoading] =
    useState(false);

  /* =======================================================
     TRANSACTION HISTORY MODAL
  ======================================================= */

  const [selectedLoan, setSelectedLoan] =
    useState<Loan | null>(null);

  const [transactionHistoryOpen, setTransactionHistoryOpen] =
    useState(false);

  /* =======================================================
     MOUNT
  ======================================================= */

  useEffect(() => {
    setMounted(true);
  }, []);

  /* =======================================================
     LOAD LOANS
  ======================================================= */

  const loadLoans = useCallback(
    async (isRefresh = false) => {
      try {
        if (isRefresh) {
          setRefreshing(true);
        } else {
          setLoading(true);
        }

        setError("");

        const response = await fetch(LOANS_API, {
          method: "GET",
          cache: "no-store",
          credentials: "same-origin",
          headers: {
            Accept: "application/json",
          },
        });

        let result: LoansResponse | null = null;

        try {
          result =
            (await response.json()) as LoansResponse;
        } catch {
          throw new Error(
            "The server returned an invalid response.",
          );
        }

        if (!response.ok || !result?.success) {
          throw new Error(
            result?.error ||
              `Unable to load loans. Server returned ${response.status}.`,
          );
        }

        setLoans(
          Array.isArray(result.data)
            ? result.data
            : [],
        );
      } catch (err) {
        console.error(
          "Failed to load loans:",
          err,
        );

        if (
          err instanceof TypeError &&
          err.message === "Failed to fetch"
        ) {
          setError(
            "Unable to connect to the server. Check your internet connection and try again.",
          );
        } else if (err instanceof Error) {
          setError(err.message);
        } else {
          setError(
            "Something went wrong while loading loans.",
          );
        }
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
    if (!mounted) {
      return;
    }

    void loadLoans();
  }, [mounted, loadLoans]);

  /* =======================================================
     FILTERED LOANS
  ======================================================= */

  const filteredLoans = useMemo(() => {
    const search = loanFilters.search
      .trim()
      .toLowerCase();

    return loans.filter((loan) => {
      /* SEARCH */

      if (search) {
        const searchableText = [
          loan.loanNumber,
          loan.memberName,
          loan.memberNumber,
          loan.type,
        ]
          .filter(
            (value) =>
              typeof value === "string" &&
              value.trim().length > 0,
          )
          .join(" ")
          .toLowerCase();

        if (!searchableText.includes(search)) {
          return false;
        }
      }

      /* STATUS */

      if (
        loanFilters.status &&
        loan.status !== loanFilters.status
      ) {
        return false;
      }

      /* TYPE */

      if (
        loanFilters.type &&
        loan.type.trim().toLowerCase() !==
          loanFilters.type.trim().toLowerCase()
      ) {
        return false;
      }

      return true;
    });
  }, [loans, loanFilters]);

  /* =======================================================
     LOAN TYPES
  ======================================================= */

  const loanTypes = useMemo(() => {
    return Array.from(
      new Set(
        loans
          .map((loan) =>
            typeof loan.type === "string"
              ? loan.type.trim()
              : "",
          )
          .filter(Boolean),
      ),
    );
  }, [loans]);

  /* =======================================================
     REFRESH
  ======================================================= */

  const handleRefresh = useCallback(() => {
    if (loading || refreshing) {
      return;
    }

    void loadLoans(true);
  }, [loading, refreshing, loadLoans]);

  /* =======================================================
     NEW LOAN
  ======================================================= */

  const handleNewLoan = useCallback(() => {
    setError("");
    setLoanFormOpen(true);
  }, []);

  const handleLoanCreated = useCallback(() => {
    setLoanFormOpen(false);
    void loadLoans(true);
  }, [loadLoans]);

  /* =======================================================
     SETTINGS
  ======================================================= */

  const handleOpenSettings = useCallback(() => {
    setSettingsOpen(true);
  }, []);

  const handleCloseSettings = useCallback(() => {
    setSettingsOpen(false);
  }, []);

  /* =======================================================
     REPAYMENT
  ======================================================= */

  const handleOpenRepayment = useCallback(
    (loan: Loan) => {
      if (!isRepayable(loan)) {
        return;
      }

      setError("");
      setRepaymentLoan(loan);
      setRepaymentOpen(true);
    },
    [],
  );

  const handleCloseRepayment = useCallback(() => {
    if (repaymentLoading) {
      return;
    }

    setRepaymentOpen(false);
    setRepaymentLoan(null);
  }, [repaymentLoading]);

  /* =======================================================
     VIEW LOAN TRANSACTION HISTORY
  ======================================================= */

  const handleViewLoanHistory = useCallback(
    (loan: Loan) => {
      if (
        !loan ||
        typeof loan.id !== "string" ||
        !loan.id.trim()
      ) {
        setError(
          "This loan does not have a valid ID.",
        );

        return;
      }

      setSelectedLoan(loan);
      setTransactionHistoryOpen(true);
    },
    [],
  );

  const handleCloseLoanHistory = useCallback(() => {
    setTransactionHistoryOpen(false);
    setSelectedLoan(null);
  }, []);

  /* =======================================================
     REPAYMENT SUBMISSION
  ======================================================= */

  const handleRepaymentSubmit = useCallback(
    async (data: {
      loanId: string;
      amount: number;
      transactionReference: string;
      transactionDate: Date;
      source: TransactionSource;
      rawMessage?: string;
    }) => {
      const currentLoan = repaymentLoan;

      if (!currentLoan) {
        throw new Error(
          "No repayment loan is selected.",
        );
      }

      if (currentLoan.id !== data.loanId) {
        throw new Error(
          "The selected loan has changed. Please reopen the repayment form.",
        );
      }

      if (
        !Number.isFinite(data.amount) ||
        data.amount <= 0
      ) {
        throw new Error(
          "Repayment amount must be greater than zero.",
        );
      }

      setRepaymentLoading(true);
      setError("");

      try {
        const requestBody = {
          loanId: data.loanId,
          amount: data.amount,

          ...(data.transactionReference?.trim()
            ? {
                transactionReference:
                  data.transactionReference.trim(),
              }
            : {}),

          transactionDate:
            data.transactionDate.toISOString(),

          source: data.source,

          ...(data.rawMessage?.trim()
            ? {
                rawMessage:
                  data.rawMessage.trim(),
              }
            : {}),
        };

        const response = await fetch(
          REPAYMENT_API,
          {
            method: "POST",
            credentials: "same-origin",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify(requestBody),
          },
        );

        const rawResponse =
          await response.text();

        let result: RepaymentResponse | null =
          null;

        try {
          result =
            JSON.parse(
              rawResponse,
            ) as RepaymentResponse;
        } catch {
          throw new Error(
            `The repayment server returned an invalid response (${response.status}).`,
          );
        }

        if (!response.ok || !result?.success) {
          throw new Error(
            result?.error ||
              `Unable to record repayment. Server returned ${response.status}.`,
          );
        }

        /*
         * Server remains authoritative for all
         * financial calculations.
         */

        setRepaymentOpen(false);
        setRepaymentLoan(null);

        /*
         * Refresh authoritative balances.
         */

        try {
          await loadLoans(true);
        } catch (refreshError) {
          console.error(
            "Repayment succeeded but loan refresh failed:",
            refreshError,
          );

          setError(
            "Repayment was recorded successfully, but the loan list could not be refreshed. Please refresh the page.",
          );
        }
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : "Something went wrong while recording the repayment.";

        setError(message);

        throw err;
      } finally {
        setRepaymentLoading(false);
      }
    },
    [repaymentLoan, loadLoans],
  );

  /* =======================================================
     STATISTICS
  ======================================================= */

  const statistics = useMemo(() => {
    let totalPrincipal = 0;
    let totalPaid = 0;
    let totalOutstanding = 0;
    let totalFines = 0;

    let activeLoans = 0;
    let pendingLoans = 0;
    let completedLoans = 0;

    for (const loan of loans) {
      totalPrincipal += Number.isFinite(
        loan.principal,
      )
        ? loan.principal
        : 0;

      totalPaid += Number.isFinite(
        loan.amountPaid,
      )
        ? loan.amountPaid
        : 0;

      totalOutstanding += Number.isFinite(
        loan.outstandingBalance,
      )
        ? Math.max(
            0,
            loan.outstandingBalance,
          )
        : 0;

      totalFines += Number.isFinite(
        loan.totalFines,
      )
        ? Math.max(0, loan.totalFines)
        : 0;

      switch (loan.status) {
        case "active":
          activeLoans += 1;
          break;

        case "pending":
          pendingLoans += 1;
          break;

        case "completed":
          completedLoans += 1;
          break;

        default:
          break;
      }
    }

    return {
      totalLoans: loans.length,
      activeLoans,
      pendingLoans,
      completedLoans,
      totalPrincipal,
      totalPaid,
      totalOutstanding,
      totalFines,
    };
  }, [loans]);

  /* =======================================================
     HYDRATION
  ======================================================= */

  if (!mounted) {
    return (
      <main className="min-h-[100dvh] w-full overflow-x-clip bg-[#050505] text-white">
        <TopBar />

        <div className="w-full min-w-0 pt-16">
          <div className="mx-auto w-full max-w-[1800px] px-4 py-6 sm:px-6 sm:py-8 lg:px-8 xl:px-10 2xl:px-12">
            <LoansLoading />
          </div>
        </div>
      </main>
    );
  }

  /* =======================================================
     MAIN PAGE
  ======================================================= */

  return (
    <main className="min-h-[100dvh] w-full max-w-full overflow-x-clip bg-[#050505] text-white">
      <TopBar />

      <div className="w-full min-w-0 pt-16">
        <div className="mx-auto w-full min-w-0 max-w-[1800px] px-4 py-6 sm:px-6 sm:py-8 lg:px-8 lg:py-10 xl:px-10 2xl:px-12">

          {/* =================================================
              HEADER
          ================================================= */}

          <header className="mb-6">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <div className="h-1.5 w-1.5 rounded-full bg-sky-400" />

                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-sky-300/60">
                    GEO-SHUA
                  </p>
                </div>

                <h2 className="mt-1 text-base font-semibold tracking-tight text-white">
                  Loan Management
                </h2>
              </div>

              <div className="flex w-full gap-2 sm:w-auto">
                {/* REFRESH */}

                <button
                  type="button"
                  onClick={handleRefresh}
                  disabled={
                    loading || refreshing
                  }
                  className="
                    flex h-11 w-11 shrink-0
                    items-center justify-center
                    rounded-xl
                    border border-white/[0.08]
                    bg-white/[0.025]
                    text-white/45
                    transition
                    hover:border-white/[0.14]
                    hover:bg-white/[0.05]
                    hover:text-white
                    disabled:cursor-not-allowed
                    disabled:opacity-40
                  "
                  aria-label="Refresh loans"
                  title="Refresh loans"
                >
                  <RefreshCw
                    size={17}
                    strokeWidth={1.8}
                    className={
                      refreshing
                        ? "animate-spin"
                        : ""
                    }
                  />
                </button>

                {/* SETTINGS */}

                <button
                  type="button"
                  onClick={
                    handleOpenSettings
                  }
                  className="
                    flex h-11 min-w-0 flex-1
                    items-center justify-center gap-2
                    rounded-xl
                    border border-white/[0.08]
                    bg-white/[0.025]
                    px-4
                    text-sm font-medium
                    text-white/60
                    transition
                    hover:border-yellow-500/20
                    hover:bg-white/[0.05]
                    hover:text-white
                    sm:flex-none
                  "
                >
                  <Settings2
                    size={17}
                    strokeWidth={1.8}
                  />

                  <span>Settings</span>
                </button>

                {/* NEW LOAN */}

                <button
                  type="button"
                  onClick={handleNewLoan}
                  className="
                    flex h-11 min-w-0 flex-1
                    items-center justify-center gap-2
                    rounded-xl
                    bg-yellow-500
                    px-4
                    text-sm font-semibold
                    text-black
                    shadow-[0_8px_30px_rgba(234,179,8,0.08)]
                    transition
                    hover:bg-yellow-400
                    active:scale-[0.98]
                    sm:flex-none
                  "
                >
                  <Plus
                    size={17}
                    strokeWidth={2}
                  />

                  <span>New Loan</span>
                </button>
              </div>
            </div>
          </header>

          {/* =================================================
              ERROR
          ================================================= */}

          {error && (
            <section className="mb-6">
              <div className="flex flex-col gap-4 rounded-2xl border border-red-500/15 bg-red-500/[0.045] p-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                <div className="flex min-w-0 items-start gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-red-500/10 text-red-400">
                    <AlertCircle
                      size={18}
                      strokeWidth={1.8}
                    />
                  </div>

                  <div className="min-w-0">
                    <p className="text-sm font-medium text-red-300">
                      Loan operation failed
                    </p>

                    <p className="mt-1 break-words text-xs leading-5 text-red-300/55">
                      {error}
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setError("");
                    void loadLoans();
                  }}
                  className="
                    h-10 shrink-0 rounded-xl
                    border border-red-400/10
                    bg-red-400/[0.06]
                    px-4
                    text-xs font-medium
                    text-red-300
                    transition
                    hover:bg-red-400/10
                  "
                >
                  Try again
                </button>
              </div>
            </section>
          )}

          {/* =================================================
              DASHBOARD
          ================================================= */}

          {loading ? (
            <LoansLoading />
          ) : (
            <>
              <section>
                <LoanDashboard
                  totalLoans={
                    statistics.totalLoans
                  }
                  activeLoans={
                    statistics.activeLoans
                  }
                  pendingLoans={
                    statistics.pendingLoans
                  }
                  completedLoans={
                    statistics.completedLoans
                  }
                  totalPrincipal={
                    statistics.totalPrincipal
                  }
                  totalPaid={
                    statistics.totalPaid
                  }
                  totalOutstanding={
                    statistics.totalOutstanding
                  }
                  totalFines={
                    statistics.totalFines
                  }
                />
              </section>

              {/* =================================================
                  SEARCH
              ================================================= */}

              <section className="mt-7">
                <LoanSearch
                  value={loanFilters}
                  onChange={setLoanFilters}
                  onReset={() =>
                    setLoanFilters(
                      DEFAULT_LOAN_FILTERS,
                    )
                  }
                  loanTypes={loanTypes}
                />
              </section>

              {/* =================================================
                  GEO-SHUA
              ================================================= */}

              <section className="mt-5">
                <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                  
                </div>

                {/* =================================================
                    EMPTY STATES
                ================================================= */}

                {filteredLoans.length === 0 ? (
                  loans.length === 0 ? (
                    <EmptyLoans
                      onCreate={handleNewLoan}
                    />
                  ) : (
                    <NoMatchingLoans
                      onReset={() =>
                        setLoanFilters(
                          DEFAULT_LOAN_FILTERS,
                        )
                      }
                    />
                  )
                ) : (
                  <>
                    {/* =================================================
                        DESKTOP
                    ================================================= */}

                    <div className="hidden lg:block">
                      <div className="overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.02] shadow-[0_20px_80px_rgba(0,0,0,0.18)]">
                        {/* HEADER */}

                        <div className="grid grid-cols-[1.1fr_1fr_0.8fr_0.8fr_0.7fr_120px] gap-4 border-b border-white/[0.06] bg-[#080808] px-4 py-3 text-[9px] font-medium uppercase tracking-[0.14em] text-white/25">
                          <span>Loan</span>
                          <span>Member</span>
                          <span>Principal</span>
                          <span>Balance</span>
                          <span>Status</span>
                          <span className="text-right">
                            Actions
                          </span>
                        </div>

                        {/* BODY */}

                        <div className="h-[200px] overflow-y-auto overscroll-contain scrollbar-thin scrollbar-track-transparent scrollbar-thumb-white/10 hover:scrollbar-thumb-white/20">
                          <div className="divide-y divide-white/[0.05]">
                            {filteredLoans.map(
                              (loan) => (
                                <LoanRow
                                  key={loan.id}
                                  loan={loan}
                                  onRepay={
                                    handleOpenRepayment
                                  }
                                  onView={
                                    handleViewLoanHistory
                                  }
                                />
                              ),
                            )}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* =================================================
                        MOBILE
                        
                        ONE FULL-WIDTH CARD PER VIEW
                    ================================================= */}

                    <div className="lg:hidden">
                      <div className="relative -mx-4 overflow-hidden sm:-mx-6">
                        <div
                          className="
                            flex
                            w-full
                            snap-x
                            snap-mandatory
                            gap-0
                            overflow-x-auto
                            overscroll-x-contain
                            scroll-smooth
                            scrollbar-none
                            touch-pan-x
                          "
                          style={{
                            WebkitOverflowScrolling:
                              "touch",
                          }}
                        >
                          {filteredLoans.map(
                            (loan) => (
                              <div
                                key={loan.id}
                                className="
                                  w-full
                                  min-w-full
                                  shrink-0
                                  snap-center
                                  px-4
                                  sm:px-6
                                "
                              >
                                <LoanCard
                                  loan={loan}
                                  onView={() =>
                                    handleViewLoanHistory(
                                      loan,
                                    )
                                  }
                                  onRepay={() =>
                                    handleOpenRepayment(
                                      loan,
                                    )
                                  }
                                />
                              </div>
                            ),
                          )}
                        </div>
                      </div>

                      {/* MOBILE CAROUSEL INDICATOR */}

                      {filteredLoans.length > 1 && (
                        <div className="mt-4 flex items-center justify-between px-1">
                          <p className="text-[9px] tracking-wide text-white/20">
                            {filteredLoans.length}{" "}
                            loans
                          </p>

                          <div className="flex items-center gap-1.5">
                            <span className="text-[9px] text-white/20">
                              Swipe
                            </span>

                            <ArrowUpRight
                              size={11}
                              strokeWidth={1.5}
                              className="rotate-45 text-white/20"
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </section>

              {/* =================================================
                  FOOTER
              ================================================= */}

              {loans.length > 0 && (
                <div className="mt-5 flex flex-col gap-2 px-1 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-[10px] text-white/20">
                    Showing{" "}
                    {filteredLoans.length.toLocaleString(
                      "en-KE",
                    )}{" "}
                    of{" "}
                    {loans.length.toLocaleString(
                      "en-KE",
                    )}{" "}
                    loans
                  </p>

                  <p className="text-[10px] text-white/20">
                    Financial records remain
                    authoritative in the domain
                    services.
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* =====================================================
          NEW LOAN MODAL
      ===================================================== */}

      <LoanForm
        open={loanFormOpen}
        onClose={() =>
          setLoanFormOpen(false)
        }
        onSuccess={handleLoanCreated}
      />

      {/* =====================================================
          SETTINGS MODAL
      ===================================================== */}

      <LoanSettingsForm
        open={settingsOpen}
        onClose={handleCloseSettings}
      />

      {/* =====================================================
          REPAYMENT MODAL
      ===================================================== */}

      <LoanRepaymentModal
        loan={repaymentLoan}
        open={repaymentOpen}
        onClose={handleCloseRepayment}
        onSubmit={handleRepaymentSubmit}
        loading={repaymentLoading}
      />

      {/* =====================================================
          LOAN TRANSACTION HISTORY MODAL
      ===================================================== */}

      <LoanTransactionModal
        loan={selectedLoan}
        open={transactionHistoryOpen}
        onClose={handleCloseLoanHistory}
      />
    </main>
  );
}

/* =========================================================
   REPAYMENT HELPER
========================================================= */

function isRepayable(loan: Loan): boolean {
  return (
    loan.status === "active" &&
    Number.isFinite(loan.outstandingBalance) &&
    loan.outstandingBalance > 0
  );
}

/* =========================================================
   EMPTY LOANS
========================================================= */

function EmptyLoans({
  onCreate,
}: {
  onCreate: () => void;
}) {
  return (
    <div className="flex min-h-[280px] items-center justify-center rounded-2xl border border-yellow-500/10 bg-yellow-500/[0.018] p-6">
      <div className="max-w-md text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.03] text-yellow-400/70">
          <Banknote
            size={24}
            strokeWidth={1.5}
          />
        </div>

        <h2 className="mt-5 text-base font-semibold text-white/70">
          No loans yet
        </h2>

        <p className="mt-2 text-xs leading-6 text-white/25">
          Create the first loan to start
          tracking lending, repayments and
          outstanding balances.
        </p>

        <button
          type="button"
          onClick={onCreate}
          className="
            mt-6 inline-flex h-10
            items-center justify-center gap-2
            rounded-xl
            bg-yellow-500
            px-4
            text-xs font-semibold
            text-black
            transition
            hover:bg-yellow-400
            active:scale-[0.98]
          "
        >
          <Plus
            size={16}
            strokeWidth={2}
          />

          Create First Loan
        </button>
      </div>
    </div>
  );
}

/* =========================================================
   NO MATCHING LOANS
========================================================= */

function NoMatchingLoans({
  onReset,
}: {
  onReset: () => void;
}) {
  return (
    <div className="flex min-h-[200px] items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.02] p-6">
      <div className="text-center">
        <p className="text-sm font-medium text-white/55">
          No matching loans
        </p>

        <p className="mt-1 text-xs leading-5 text-white/25">
          Try changing your search or filters.
        </p>

        <button
          type="button"
          onClick={onReset}
          className="
            mt-4 inline-flex h-9
            items-center justify-center
            rounded-xl
            border border-white/[0.08]
            bg-white/[0.03]
            px-4
            text-xs font-medium
            text-white/45
            transition
            hover:bg-white/[0.06]
            hover:text-white
          "
        >
          Clear filters
        </button>
      </div>
    </div>
  );
}

/* =========================================================
   DESKTOP LOAN ROW
========================================================= */

function LoanRow({
  loan,
  onRepay,
  onView,
}: {
  loan: Loan;
  onRepay: (loan: Loan) => void;
  onView: (loan: Loan) => void;
}) {
  function formatMoney(value: number): string {
    if (!Number.isFinite(value)) {
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

  function statusClass(
    status: Loan["status"],
  ): string {
    switch (status) {
      case "active":
        return "border-emerald-500/20 bg-emerald-500/10 text-emerald-300";

      case "pending":
        return "border-amber-500/20 bg-amber-500/10 text-amber-300";

      case "completed":
        return "border-blue-500/20 bg-blue-500/10 text-blue-300";

      case "cancelled":
        return "border-red-500/20 bg-red-500/10 text-red-300";

      default:
        return "border-white/10 bg-white/5 text-white/60";
    }
  }

  const canRepay = isRepayable(loan);

  return (
    <div className="grid grid-cols-[1.1fr_1fr_0.8fr_0.8fr_0.7fr_120px] items-center gap-4 px-4 py-3.5 transition hover:bg-white/[0.022]">
      {/* LOAN */}

      <div className="min-w-0">
        <p className="truncate text-xs font-semibold text-white/85">
          {loan.loanNumber || "—"}
        </p>

        <p className="mt-1 truncate text-[10px] text-white/25">
          {loan.type || "loan"} loan
        </p>
      </div>

      {/* MEMBER */}

      <div className="min-w-0">
        <p className="truncate text-xs text-white/70">
          {loan.memberName ||
            "Unknown member"}
        </p>

        <p className="mt-1 truncate text-[10px] text-white/25">
          {loan.memberNumber || "—"}
        </p>
      </div>

      {/* PRINCIPAL */}

      <p className="truncate text-xs font-medium text-white/65">
        {formatMoney(loan.principal)}
      </p>

      {/* BALANCE */}

      <p className="truncate text-xs font-medium text-white/70">
        {formatMoney(
          loan.outstandingBalance,
        )}
      </p>

      {/* STATUS */}

      <span
        className={`w-fit rounded-full border px-2.5 py-1 text-[9px] font-medium capitalize ${statusClass(
          loan.status,
        )}`}
      >
        {loan.status}
      </span>

      {/* ACTIONS */}

      <div className="flex items-center justify-end gap-1">
        {/* VIEW */}

        <button
          type="button"
          onClick={() => onView(loan)}
          className="
            flex h-8 w-8 shrink-0
            items-center justify-center
            rounded-lg
            text-white/30
            transition
            hover:bg-white/[0.06]
            hover:text-white
            focus:outline-none
            focus:ring-1
            focus:ring-white/15
          "
          aria-label={`View transaction history for ${loan.loanNumber}`}
          title="View transaction history"
        >
          <Eye
            size={15}
            strokeWidth={1.8}
          />
        </button>

        {/* REPAY */}

        {canRepay ? (
          <button
            type="button"
            onClick={() => onRepay(loan)}
            className="
              inline-flex h-8
              items-center justify-center gap-1.5
              rounded-lg
              bg-yellow-500
              px-3
              text-[10px] font-semibold
              text-black
              transition
              hover:bg-yellow-400
              active:scale-[0.98]
            "
            aria-label={`Record repayment for ${loan.loanNumber}`}
            title={`Record repayment for ${loan.loanNumber}`}
          >
            <Banknote
              size={14}
              strokeWidth={2}
            />

            Repay
          </button>
        ) : (
          <span className="px-1 text-[10px] text-white/15">
            —
          </span>
        )}
      </div>
    </div>
  );
}

/* =========================================================
   LOADING STATE
========================================================= */

function LoansLoading() {
  return (
    <div className="w-full min-w-0 animate-pulse space-y-6">
      <section className="grid w-full grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 8 }).map(
          (_, index) => (
            <div
              key={index}
              className="
                h-[105px]
                rounded-2xl
                border border-white/[0.06]
                bg-white/[0.025]
              "
            />
          ),
        )}
      </section>

      <section className="h-[72px] rounded-2xl border border-white/[0.06] bg-white/[0.025]" />

      <section className="hidden h-[280px] rounded-2xl border border-white/[0.06] bg-white/[0.025] lg:block" />

      <section className="lg:hidden">
        <div className="h-[230px] rounded-2xl border border-white/[0.06] bg-white/[0.025]" />
      </section>
    </div>
  );
}