"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Banknote,
  Plus,
  RefreshCw,
  Settings2,
} from "lucide-react";

import TopBar from "@/components/dashboard/TopBar";

import LoanDashboard from "@/components/loans/LoanDashboard";
import LoanCard from "@/components/loans/LoanCard";
import LoanForm from "@/components/loans/LoanForm";
import LoanSettingsForm from "@/components/loans/LoanSettingsForm";

import type { Loan } from "@/lib/loans/types";

/* =========================================================
   RESPONSE TYPE
========================================================= */

type LoansResponse = {
  success: boolean;
  data?: Loan[];
  count?: number;
  error?: string;
};

/* =========================================================
   PAGE
========================================================= */

export default function LoansPage() {
  /* =======================================================
     STATE
  ======================================================= */

  const [loans, setLoans] = useState<Loan[]>([]);

  const [loading, setLoading] = useState(true);

  const [refreshing, setRefreshing] = useState(false);

  const [error, setError] = useState("");

  const [mounted, setMounted] = useState(false);

  /* =======================================================
     MODALS
  ======================================================= */

  const [loanFormOpen, setLoanFormOpen] = useState(false);

  const [settingsOpen, setSettingsOpen] = useState(false);

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

        const response = await fetch("/api/loans", {
          method: "GET",
          cache: "no-store",
          headers: {
            Accept: "application/json",
          },
        });

        let result: LoansResponse;

        try {
          result = await response.json();
        } catch {
          throw new Error(
            "The server returned an invalid response.",
          );
        }

        if (!response.ok || !result.success) {
          throw new Error(
            result.error ||
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
            "Unable to connect to the server. Check your connection and try again.",
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
     REFRESH
  ======================================================= */

  function handleRefresh() {
    if (loading || refreshing) {
      return;
    }

    void loadLoans(true);
  }

  /* =======================================================
     NEW LOAN
  ======================================================= */

  function handleNewLoan() {
    setLoanFormOpen(true);
  }

  /* =======================================================
     LOAN CREATED
  ======================================================= */

  function handleLoanCreated() {
    setLoanFormOpen(false);

    /*
     * Reload from MongoDB so the dashboard and
     * directory reflect the authoritative database state.
     */

    void loadLoans(true);
  }

  /* =======================================================
     SETTINGS
  ======================================================= */

  function handleOpenSettings() {
    setSettingsOpen(true);
  }

  function handleCloseSettings() {
    setSettingsOpen(false);
  }

  /* =======================================================
     DASHBOARD STATISTICS
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
        ? loan.outstandingBalance
        : 0;

      totalFines += Number.isFinite(
        loan.totalFines,
      )
        ? loan.totalFines
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
     SERVER-SAFE INITIAL STATE
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
     PAGE
  ======================================================= */

  return (
    <main className="min-h-[100dvh] w-full max-w-full overflow-x-clip bg-[#050505] text-white">
      {/* =====================================================
          TOP BAR
      ===================================================== */}

      <TopBar />

      {/* =====================================================
          PAGE BODY
      ===================================================== */}

      <div className="w-full min-w-0 pt-16">
        <div
          className="
            mx-auto
            w-full
            min-w-0
            max-w-[1800px]
            px-4
            py-6
            sm:px-6
            sm:py-8
            lg:px-8
            lg:py-10
            xl:px-10
            2xl:px-12
          "
        >
          {/* =================================================
              HEADER
          ================================================= */}

          <section className="mb-6 w-full min-w-0 sm:mb-8">
            <div
              className="
                flex
                w-full
                min-w-0
                flex-col
                gap-5
                lg:flex-row
                lg:items-end
                lg:justify-between
              "
            >
              {/* TITLE */}

              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-2">
                  <Banknote
                    size={16}
                    strokeWidth={1.8}
                    className="shrink-0 text-yellow-400"
                  />

                  <p className="truncate text-xs font-medium uppercase tracking-[0.22em] text-yellow-500/60">
                    Loans
                  </p>
                </div>

                <h1 className="mt-2 truncate text-2xl font-semibold tracking-tight text-white sm:text-3xl">
                  Loan Management
                </h1>

                <p className="mt-2 max-w-2xl text-sm leading-6 text-white/35">
                  Monitor loans, repayments, outstanding
                  balances and fines.
                </p>
              </div>

              {/* ACTIONS */}

              <div
                className="
                  flex
                  w-full
                  min-w-0
                  shrink-0
                  items-center
                  gap-2
                  lg:w-auto
                "
              >
                {/* REFRESH */}

                <button
                  type="button"
                  onClick={handleRefresh}
                  disabled={
                    loading || refreshing
                  }
                  className="
                    flex
                    h-11
                    w-11
                    shrink-0
                    items-center
                    justify-center
                    rounded-xl
                    border
                    border-white/[0.08]
                    bg-white/[0.025]
                    text-white/45
                    transition
                    hover:border-white/[0.12]
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
                  onClick={handleOpenSettings}
                  className="
                    flex
                    h-11
                    min-w-0
                    flex-1
                    items-center
                    justify-center
                    gap-2
                    rounded-xl
                    border
                    border-white/[0.08]
                    bg-white/[0.025]
                    px-4
                    text-sm
                    font-medium
                    text-white/65
                    transition
                    hover:border-yellow-500/20
                    hover:bg-white/[0.05]
                    hover:text-white
                    lg:w-auto
                    lg:flex-none
                  "
                  aria-label="Open loan settings"
                >
                  <Settings2
                    size={17}
                    strokeWidth={1.8}
                    className="shrink-0"
                  />

                  <span className="truncate">
                    Loan Settings
                  </span>
                </button>

                {/* NEW LOAN */}

                <button
                  type="button"
                  onClick={handleNewLoan}
                  className="
                    flex
                    h-11
                    min-w-0
                    flex-1
                    items-center
                    justify-center
                    gap-2
                    rounded-xl
                    bg-yellow-500
                    px-4
                    text-sm
                    font-semibold
                    text-black
                    transition
                    hover:bg-yellow-400
                    active:scale-[0.98]
                    lg:w-auto
                    lg:flex-none
                  "
                >
                  <Plus
                    size={17}
                    strokeWidth={2}
                    className="shrink-0"
                  />

                  <span className="truncate">
                    New Loan
                  </span>
                </button>
              </div>
            </div>
          </section>

          {/* =================================================
              ERROR
          ================================================= */}

          {error && (
            <section className="mb-6 w-full min-w-0">
              <div
                className="
                  flex
                  w-full
                  min-w-0
                  flex-col
                  gap-4
                  rounded-2xl
                  border
                  border-red-500/15
                  bg-red-500/[0.05]
                  p-4
                  sm:flex-row
                  sm:items-center
                  sm:justify-between
                  sm:px-5
                "
              >
                <div className="flex min-w-0 items-start gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-red-500/10 text-red-400">
                    <AlertCircle
                      size={18}
                      strokeWidth={1.8}
                    />
                  </div>

                  <div className="min-w-0">
                    <p className="text-sm font-medium text-red-300">
                      Unable to load loans
                    </p>

                    <p className="mt-1 break-words text-xs leading-5 text-red-300/50">
                      {error}
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() =>
                    void loadLoans()
                  }
                  className="
                    h-10
                    shrink-0
                    rounded-xl
                    border
                    border-red-400/10
                    bg-red-400/[0.06]
                    px-4
                    text-xs
                    font-medium
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
              <section className="w-full min-w-0">
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
                  LOAN DIRECTORY
              ================================================= */}

              <section className="mt-6 w-full min-w-0">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-sm font-semibold text-white">
                      Loan Directory
                    </h2>

                    <p className="mt-1 text-xs text-white/30">
                      {loans.length.toLocaleString(
                        "en-KE",
                      )}{" "}
                      {loans.length === 1
                        ? "loan"
                        : "loans"}{" "}
                      recorded
                    </p>
                  </div>
                </div>

                {/* =================================================
                    EMPTY
                ================================================= */}

                {loans.length === 0 ? (
                  <div
                    className="
                      flex
                      min-h-[220px]
                      w-full
                      items-center
                      justify-center
                      rounded-2xl
                      border
                      border-yellow-500/10
                      bg-yellow-500/[0.025]
                      p-6
                    "
                  >
                    <div className="max-w-md text-center">
                      <div
                        className="
                          mx-auto
                          flex
                          h-12
                          w-12
                          items-center
                          justify-center
                          rounded-2xl
                          border
                          border-white/[0.08]
                          bg-white/[0.03]
                          text-white/25
                        "
                      >
                        <Banknote
                          size={21}
                          strokeWidth={1.5}
                        />
                      </div>

                      <h2 className="mt-4 text-sm font-semibold text-white/60">
                        No loans recorded
                      </h2>

                      <p className="mt-2 text-xs leading-5 text-white/25">
                        Loans will appear here after
                        they are created.
                      </p>

                      <button
                        type="button"
                        onClick={handleNewLoan}
                        className="
                          mt-5
                          inline-flex
                          min-h-10
                          items-center
                          justify-center
                          gap-2
                          rounded-xl
                          bg-yellow-500
                          px-4
                          text-xs
                          font-semibold
                          text-black
                          transition
                          hover:bg-yellow-400
                        "
                      >
                        <Plus size={16} />

                        Create First Loan
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    {/* =================================================
                        DESKTOP
                    ================================================= */}

                    <div className="hidden w-full min-w-0 lg:block">
                      <div className="overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.025]">
                        <div className="grid grid-cols-[1.2fr_1fr_0.8fr_0.8fr_0.8fr_40px] gap-4 border-b border-white/[0.06] px-4 py-3 text-[10px] font-medium uppercase tracking-wider text-white/25">
                          <span>Loan</span>
                          <span>Member</span>
                          <span>Principal</span>
                          <span>Balance</span>
                          <span>Status</span>
                          <span />
                        </div>

                        <div className="divide-y divide-white/[0.05]">
                          {loans.map((loan) => (
                            <LoanRow
                              key={loan.id}
                              loan={loan}
                            />
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* =================================================
                        MOBILE / TABLET
                    ================================================= */}

                    <div className="grid w-full min-w-0 gap-3 lg:hidden">
                      {loans.map((loan) => (
                        <LoanCard
                          key={loan.id}
                          loan={loan}
                        />
                      ))}
                    </div>
                  </>
                )}
              </section>

              {/* =================================================
                  FOOTER
              ================================================= */}

              {loans.length > 0 && (
                <div
                  className="
                    mt-5
                    flex
                    w-full
                    min-w-0
                    flex-col
                    gap-1
                    px-1
                    sm:flex-row
                    sm:items-center
                    sm:justify-between
                  "
                >
                  <p className="text-[10px] text-white/20">
                    Showing{" "}
                    {loans.length.toLocaleString(
                      "en-KE",
                    )}{" "}
                    {loans.length === 1
                      ? "loan"
                      : "loans"}
                  </p>

                  <p className="text-[10px] text-white/20">
                    Data synchronized with MongoDB
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* =====================================================
          LOAN FORM MODAL
      ===================================================== */}

      <LoanForm
        open={loanFormOpen}
        onClose={() => setLoanFormOpen(false)}
        onSuccess={handleLoanCreated}
      />

      {/* =====================================================
          LOAN SETTINGS MODAL
      ===================================================== */}

      <LoanSettingsForm
        open={settingsOpen}
        onClose={handleCloseSettings}
      />
    </main>
  );
}

/* =========================================================
   DESKTOP LOAN ROW
========================================================= */

function LoanRow({
  loan,
}: {
  loan: Loan;
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
        return "bg-emerald-500/10 text-emerald-300 border-emerald-500/20";

      case "pending":
        return "bg-amber-500/10 text-amber-300 border-amber-500/20";

      case "completed":
        return "bg-blue-500/10 text-blue-300 border-blue-500/20";

      case "cancelled":
        return "bg-red-500/10 text-red-300 border-red-500/20";

      default:
        return "bg-white/5 text-white/60 border-white/10";
    }
  }

  return (
    <div className="grid grid-cols-[1.2fr_1fr_0.8fr_0.8fr_0.8fr_40px] items-center gap-4 px-4 py-4 transition hover:bg-white/[0.025]">
      <div className="min-w-0">
        <p className="truncate text-xs font-medium text-white">
          {loan.loanNumber}
        </p>

        <p className="mt-1 truncate text-[10px] text-white/30">
          {loan.type} loan
        </p>
      </div>

      <div className="min-w-0">
        <p className="truncate text-xs text-white/70">
          {loan.memberName}
        </p>

        <p className="mt-1 truncate text-[10px] text-white/30">
          {loan.memberNumber}
        </p>
      </div>

      <p className="truncate text-xs font-medium text-white/70">
        {formatMoney(loan.principal)}
      </p>

      <p className="truncate text-xs font-medium text-white/70">
        {formatMoney(
          loan.outstandingBalance,
        )}
      </p>

      <span
        className={`w-fit rounded-full border px-2.5 py-1 text-[10px] capitalize ${statusClass(
          loan.status,
        )}`}
      >
        {loan.status}
      </span>

      <button
        type="button"
        className="
          flex
          h-8
          w-8
          items-center
          justify-center
          rounded-lg
          text-white/30
          transition
          hover:bg-white/[0.05]
          hover:text-white
        "
        aria-label={`View ${loan.loanNumber}`}
      >
        →
      </button>
    </div>
  );
}

/* =========================================================
   LOADING
========================================================= */

function LoansLoading() {
  return (
    <div className="w-full min-w-0 space-y-5 sm:space-y-6">
      {/* DASHBOARD */}

      <section className="grid w-full grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 8 }).map(
          (_, index) => (
            <div
              key={index}
              className="
                h-[105px]
                animate-pulse
                rounded-2xl
                border
                border-white/[0.06]
                bg-white/[0.025]
              "
            />
          ),
        )}
      </section>

      {/* MOBILE */}

      <section className="grid w-full gap-3 lg:hidden">
        {Array.from({ length: 3 }).map(
          (_, index) => (
            <div
              key={index}
              className="
                h-[210px]
                animate-pulse
                rounded-2xl
                border
                border-white/[0.06]
                bg-white/[0.025]
              "
            />
          ),
        )}
      </section>

      {/* DESKTOP */}

      <section className="hidden h-[400px] animate-pulse rounded-2xl border border-white/[0.06] bg-white/[0.025] lg:block" />
    </div>
  );
}