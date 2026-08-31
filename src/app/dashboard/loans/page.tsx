"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

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
import LoanRepaymentModal from "@/components/loans/LoanRepaymentForm";

import type {
  Loan,
  TransactionSource,
} from "@/lib/loans/types";

/* =========================================================
   API
========================================================= */

/**
 * Change this ONE constant if your repayment API
 * uses a different route.
 */
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
     STATE
  ======================================================= */

  const [loans, setLoans] = useState<Loan[]>([]);

  const [loading, setLoading] =
    useState(true);

  const [refreshing, setRefreshing] =
    useState(false);

  const [error, setError] =
    useState("");

  const [mounted, setMounted] =
    useState(false);

  /* =======================================================
     LOAN FORM
  ======================================================= */

  const [loanFormOpen, setLoanFormOpen] =
    useState(false);

  /* =======================================================
     SETTINGS
  ======================================================= */

  const [settingsOpen, setSettingsOpen] =
    useState(false);

  /* =======================================================
     REPAYMENT MODAL
  ======================================================= */

  const [repaymentLoan, setRepaymentLoan] =
    useState<Loan | null>(null);

  const [repaymentOpen, setRepaymentOpen] =
    useState(false);

  const [repaymentLoading, setRepaymentLoading] =
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

        const response = await fetch(
          "/api/loans",
          {
            method: "GET",
            cache: "no-store",
            headers: {
              Accept:
                "application/json",
            },
          },
        );

        let result: LoansResponse;

        try {
          result =
            await response.json();
        } catch {
          throw new Error(
            "The server returned an invalid response.",
          );
        }

        if (
          !response.ok ||
          !result.success
        ) {
          throw new Error(
            result.error ||
              `Unable to load loans. Server returned ${response.status}.`,
          );
        }

        setLoans(
          Array.isArray(
            result.data,
          )
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
          err.message ===
            "Failed to fetch"
        ) {
          setError(
            "Unable to connect to the server. Check your connection and try again.",
          );
        } else if (
          err instanceof Error
        ) {
          setError(
            err.message,
          );
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
  }, [
    mounted,
    loadLoans,
  ]);

  /* =======================================================
     REFRESH
  ======================================================= */

  function handleRefresh() {
    if (
      loading ||
      refreshing
    ) {
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
     OPEN REPAYMENT
  ======================================================= */

  function handleOpenRepayment(
    loan: Loan,
  ) {
    /*
     * Only active loans with an outstanding
     * balance should normally be repayable.
     *
     * We still let the backend remain the
     * authoritative validator.
     */
    if (
      loan.status !== "active"
    ) {
      return;
    }

    if (
      !Number.isFinite(
        loan.outstandingBalance,
      ) ||
      loan.outstandingBalance <= 0
    ) {
      return;
    }

    setRepaymentLoan(loan);
    setRepaymentOpen(true);
  }

  /* =======================================================
     CLOSE REPAYMENT
  ======================================================= */

  function handleCloseRepayment() {
    if (
      repaymentLoading
    ) {
      return;
    }

    setRepaymentOpen(false);
    setRepaymentLoan(null);
  }


/* =======================================================
   RECORD REPAYMENT
======================================================= */

async function handleRepaymentSubmit(
  data: {
    loanId: string;
    amount: number;
    transactionReference: string;
    transactionDate: Date;
    source: TransactionSource;
    rawMessage?: string;
  },
) {
  console.group(
    "💰 GEO-SHUA | REPAYMENT SUBMISSION",
  );

  console.log(
    "Repayment data received:",
    data,
  );

  /* -------------------------------------------------------
     DEFENSIVE CHECK
  ------------------------------------------------------- */

  if (!repaymentLoan) {
    console.error(
      "❌ No repayment loan is selected.",
    );

    console.groupEnd();
    return;
  }

  console.log(
    "Selected repayment loan:",
    repaymentLoan,
  );

  /* -------------------------------------------------------
     STALE LOAN CHECK
  ------------------------------------------------------- */

  if (
    repaymentLoan.id !==
    data.loanId
  ) {
    console.error(
      "❌ Loan ID mismatch.",
      {
        selectedLoanId:
          repaymentLoan.id,
        submittedLoanId:
          data.loanId,
      },
    );

    console.groupEnd();

    throw new Error(
      "The selected loan has changed. Please reopen the repayment form.",
    );
  }

  console.log(
    "✅ Loan ID verified:",
    data.loanId,
  );

  try {
    setRepaymentLoading(true);
    setError("");

    /* -------------------------------------------------------
       BUILD REQUEST PAYLOAD
    ------------------------------------------------------- */

    const requestBody = {
      loanId:
        data.loanId,

      amount:
        data.amount,

      transactionReference:
        data.transactionReference,

      transactionDate:
        data.transactionDate.toISOString(),

      source:
        data.source,

      ...(data.rawMessage
        ? {
            rawMessage:
              data.rawMessage,
          }
        : {}),
    };

    console.log(
      "📤 POST repayment request:",
      {
        url: REPAYMENT_API,
        body: requestBody,
      },
    );

    /* -------------------------------------------------------
       SEND REQUEST
    ------------------------------------------------------- */

    const response =
      await fetch(
        REPAYMENT_API,
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",

            Accept:
              "application/json",
          },

          body: JSON.stringify(
            requestBody,
          ),
        },
      );

    /* -------------------------------------------------------
       RESPONSE METADATA
    ------------------------------------------------------- */

    const contentType =
      response.headers.get(
        "content-type",
      ) ?? "";

    console.log(
      "📥 Repayment API response:",
      {
        status:
          response.status,

        statusText:
          response.statusText,

        ok:
          response.ok,

        contentType,
      },
    );

    /* -------------------------------------------------------
       READ RAW RESPONSE
       
       IMPORTANT:
       We use text() first so we can see exactly what
       the server returned if JSON parsing fails.
    ------------------------------------------------------- */

    const rawResponse =
      await response.text();

    console.log(
      "📄 Raw repayment API response:",
      rawResponse,
    );

    /* -------------------------------------------------------
       PARSE JSON
    ------------------------------------------------------- */

    let result:
      | RepaymentResponse
      | null = null;

    try {
      result =
        JSON.parse(
          rawResponse,
        ) as RepaymentResponse;

      console.log(
        "✅ Parsed repayment response:",
        result,
      );
    } catch (parseError) {
      console.error(
        "❌ Repayment API returned invalid JSON.",
        {
          parseError,
          status:
            response.status,
          contentType,
          rawResponse,
        },
      );

      throw new Error(
        `The repayment server returned an invalid response (${response.status}).`,
      );
    }

    /* -------------------------------------------------------
       SERVER/API ERROR
    ------------------------------------------------------- */

    if (
      !response.ok ||
      !result.success
    ) {
      console.error(
        "❌ Repayment API rejected request:",
        {
          status:
            response.status,

          statusText:
            response.statusText,

          result,
        },
      );

      throw new Error(
        result.error ||
          `Unable to record repayment. Server returned ${response.status}.`,
      );
    }

    /* -------------------------------------------------------
       REPAYMENT SUCCESS
    ------------------------------------------------------- */

    console.log(
      "✅ REPAYMENT RECORDED SUCCESSFULLY",
      {
        loanId:
          data.loanId,

        amount:
          data.amount,

        transactionReference:
          data.transactionReference,

        transactionDate:
          data.transactionDate,

        source:
          data.source,

        serverResult:
          result,
      },
    );

    /*
     * IMPORTANT:
     *
     * At this point the repayment API has confirmed
     * success.
     *
     * MongoDB/service layer is authoritative.
     *
     * Do NOT manually update:
     *
     * - amountPaid
     * - outstandingBalance
     * - totalFines
     * - loan status
     */

    setRepaymentOpen(false);
    setRepaymentLoan(null);

    /* -------------------------------------------------------
       REFRESH LOANS
    ------------------------------------------------------- */

    console.log(
      "🔄 Refreshing loans after successful repayment...",
    );

    try {
      await loadLoans(true);

      console.log(
        "✅ Loans refreshed successfully after repayment.",
      );
    } catch (refreshError) {
      /*
       * IMPORTANT:
       *
       * The repayment already succeeded.
       *
       * A failed refresh MUST NOT be reported as a
       * failed repayment because that could cause the
       * user to submit the same payment again.
       */

      console.error(
        "⚠️ Repayment succeeded, but loan refresh failed:",
        refreshError,
      );

      setError(
        "Repayment was recorded successfully, but the loan list could not be refreshed. Please refresh the page.",
      );
    }

    console.log(
      "🏁 Repayment submission completed.",
    );
  } catch (err) {
    console.error(
      "❌ FAILED TO RECORD REPAYMENT:",
      err,
    );

    const message =
      err instanceof Error
        ? err.message
        : "Something went wrong while recording the repayment.";

    console.error(
      "Repayment error message:",
      message,
    );

    setError(message);

    /*
     * Re-throw so the repayment modal can handle
     * its own loading/error state if required.
     */
    throw err;
  } finally {
    setRepaymentLoading(false);

    console.log(
      "🔓 Repayment loading state released.",
    );

    console.groupEnd();
  }
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
      totalPrincipal +=
        Number.isFinite(
          loan.principal,
        )
          ? loan.principal
          : 0;

      totalPaid +=
        Number.isFinite(
          loan.amountPaid,
        )
          ? loan.amountPaid
          : 0;

      totalOutstanding +=
        Number.isFinite(
          loan.outstandingBalance,
        )
          ? loan.outstandingBalance
          : 0;

      totalFines +=
        Number.isFinite(
          loan.totalFines,
        )
          ? loan.totalFines
          : 0;

      switch (
        loan.status
      ) {
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
      totalLoans:
        loans.length,

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
                  Monitor loans, repayments,
                  outstanding balances and fines.
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
                  onClick={
                    handleRefresh
                  }
                  disabled={
                    loading ||
                    refreshing
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
                  onClick={
                    handleOpenSettings
                  }
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
                  onClick={
                    handleNewLoan
                  }
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
                      Loan operation failed
                    </p>

                    <p className="mt-1 break-words text-xs leading-5 text-red-300/50">
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
                {/* =================================================
                    DIRECTORY HEADER
                ================================================= */}

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
                        Loans will appear here
                        after they are created.
                      </p>

                      <button
                        type="button"
                        onClick={
                          handleNewLoan
                        }
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
                        <Plus
                          size={16}
                        />

                        Create First Loan
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    {/* =================================================
                        DESKTOP TABLE
                    ================================================= */}

                    <div className="hidden w-full min-w-0 lg:block">
                      <div
                        className="
                          w-full
                          min-w-0
                          overflow-hidden
                          rounded-2xl
                          border
                          border-white/[0.08]
                          bg-white/[0.025]
                        "
                      >
                        {/* FIXED HEADER */}

                        <div
                          className="
                            grid
                            grid-cols-[1.1fr_1fr_0.8fr_0.8fr_0.7fr_100px]
                            gap-4
                            border-b
                            border-white/[0.06]
                            bg-[#080808]
                            px-4
                            py-3
                            text-[10px]
                            font-medium
                            uppercase
                            tracking-wider
                            text-white/25
                          "
                        >
                          <span>
                            Loan
                          </span>

                          <span>
                            Member
                          </span>

                          <span>
                            Principal
                          </span>

                          <span>
                            Balance
                          </span>

                          <span>
                            Status
                          </span>

                          <span className="text-right">
                            Action
                          </span>
                        </div>

                        {/* SCROLLABLE ROWS */}

                        <div
                          className="
                            max-h-[400px]
                            overflow-y-auto
                            overscroll-contain
                            scrollbar-thin
                            scrollbar-track-transparent
                            scrollbar-thumb-white/10
                          "
                        >
                          <div className="divide-y divide-white/[0.05]">
                            {loans.map(
                              (
                                loan,
                              ) => (
                                <LoanRow
                                  key={
                                    loan.id
                                  }
                                  loan={
                                    loan
                                  }
                                  onRepay={
                                    handleOpenRepayment
                                  }
                                />
                              ),
                            )}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* =================================================
                        MOBILE / TABLET
                    ================================================= */}

                    <div
                      className="
                        grid
                        max-h-[600px]
                        w-full
                        min-w-0
                        gap-3
                        overflow-y-auto
                        overscroll-contain
                        lg:hidden
                        scrollbar-thin
                        scrollbar-track-transparent
                        scrollbar-thumb-white/10
                      "
                    >
                      {loans.map(
                        (
                          loan,
                        ) => (
                          <div
                            key={
                              loan.id
                            }
                            className="min-w-0"
                          >
                            <LoanCard
                              loan={
                                loan
                              }
                            />

                            {/* MOBILE REPAYMENT ACTION */}

                            {loan.status ===
                              "active" &&
                              Number.isFinite(
                                loan.outstandingBalance,
                              ) &&
                              loan.outstandingBalance >
                                0 && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleOpenRepayment(
                                      loan,
                                    )
                                  }
                                  className="
                                    mt-2
                                    flex
                                    h-10
                                    w-full
                                    items-center
                                    justify-center
                                    gap-2
                                    rounded-xl
                                    border
                                    border-yellow-500/15
                                    bg-yellow-500/[0.06]
                                    text-xs
                                    font-semibold
                                    text-yellow-400
                                    transition
                                    hover:border-yellow-500/25
                                    hover:bg-yellow-500/10
                                  "
                                >
                                  <Banknote
                                    size={
                                      15
                                    }
                                  />

                                  Record Repayment
                                </button>
                              )}
                          </div>
                        ),
                      )}
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
                    Data synchronized with
                    MongoDB
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
        open={
          loanFormOpen
        }
        onClose={() =>
          setLoanFormOpen(
            false,
          )
        }
        onSuccess={
          handleLoanCreated
        }
      />

      {/* =====================================================
          LOAN SETTINGS MODAL
      ===================================================== */}

      <LoanSettingsForm
        open={
          settingsOpen
        }
        onClose={
          handleCloseSettings
        }
      />

      {/* =====================================================
          REPAYMENT MODAL
      ===================================================== */}

      <LoanRepaymentModal
        loan={
          repaymentLoan
        }
        open={
          repaymentOpen
        }
        onClose={
          handleCloseRepayment
        }
        onSubmit={
          handleRepaymentSubmit
        }
        loading={
          repaymentLoading
        }
      />
    </main>
  );
}

/* =========================================================
   DESKTOP LOAN ROW
========================================================= */

function LoanRow({
  loan,
  onRepay,
}: {
  loan: Loan;
  onRepay: (loan: Loan) => void;
}) {
  function formatMoney(
    value: number,
  ): string {
    if (
      !Number.isFinite(
        value,
      )
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

  function statusClass(
    status: Loan["status"],
  ): string {
    switch (
      status
    ) {
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

  const canRepay =
    loan.status ===
      "active" &&
    Number.isFinite(
      loan.outstandingBalance,
    ) &&
    loan.outstandingBalance >
      0;

  return (
    <div
      className="
        grid
        grid-cols-[1.1fr_1fr_0.8fr_0.8fr_0.7fr_100px]
        items-center
        gap-4
        px-4
        py-4
        transition
        hover:bg-white/[0.025]
      "
    >
      {/* LOAN */}

      <div className="min-w-0">
        <p className="truncate text-xs font-medium text-white">
          {loan.loanNumber}
        </p>

        <p className="mt-1 truncate text-[10px] text-white/30">
          {loan.type} loan
        </p>
      </div>

      {/* MEMBER */}

      <div className="min-w-0">
        <p className="truncate text-xs text-white/70">
          {loan.memberName}
        </p>

        <p className="mt-1 truncate text-[10px] text-white/30">
          {loan.memberNumber}
        </p>
      </div>

      {/* PRINCIPAL */}

      <p className="truncate text-xs font-medium text-white/70">
        {formatMoney(
          loan.principal,
        )}
      </p>

      {/* BALANCE */}

      <p className="truncate text-xs font-medium text-white/70">
        {formatMoney(
          loan.outstandingBalance,
        )}
      </p>

      {/* STATUS */}

      <span
        className={`w-fit rounded-full border px-2.5 py-1 text-[10px] capitalize ${statusClass(
          loan.status,
        )}`}
      >
        {loan.status}
      </span>

      {/* ACTION */}

      <div className="flex justify-end">
        {canRepay ? (
          <button
            type="button"
            onClick={() =>
              onRepay(
                loan,
              )
            }
            className="
              inline-flex
              h-8
              items-center
              justify-center
              gap-1.5
              rounded-lg
              bg-yellow-500
              px-3
              text-[10px]
              font-semibold
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
          <span className="text-[10px] text-white/15">
            —
          </span>
        )}
      </div>
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
        {Array.from({
          length: 8,
        }).map(
          (
            _,
            index,
          ) => (
            <div
              key={
                index
              }
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
        {Array.from({
          length: 3,
        }).map(
          (
            _,
            index,
          ) => (
            <div
              key={
                index
              }
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