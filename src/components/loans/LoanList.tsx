"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";

import type { Loan } from "@/lib/loans/types";
import LoanCard from "@/components/loans/LoanCard";

interface LoanListProps {
  loans: Loan[];
  loading?: boolean;
  onSelectLoan?: (loan: Loan) => void;
  onView?: (loan: Loan) => void;
  onEdit?: (loan: Loan) => void;
  onRepay?: (loan: Loan) => void;
  onDelete?: (loan: Loan) => void;
}

/* =========================================================
   LOADING CARD
========================================================= */

function LoanLoadingCard() {
  return (
    <div
      className="
        w-full
        animate-pulse
        overflow-hidden
        rounded-3xl
        border
        border-border/60
        bg-background
        dark:border-white/10
      "
    >
      <div className="border-b border-border/50 px-5 pb-4 pt-5 dark:border-white/10">
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 rounded-2xl bg-muted" />

          <div className="flex-1 space-y-2">
            <div className="h-3 w-32 rounded bg-muted" />
            <div className="h-2.5 w-24 rounded bg-muted" />
          </div>

          <div className="h-6 w-16 rounded-full bg-muted" />
        </div>

        <div className="mt-4 h-3 w-28 rounded bg-muted" />
      </div>

      <div className="px-5 py-5">
        <div className="rounded-2xl bg-muted p-4">
          <div className="h-2.5 w-28 rounded bg-background/70" />
          <div className="mt-2 h-7 w-40 rounded bg-background/70" />
          <div className="mt-5 h-1.5 w-full rounded-full bg-background/70" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-px bg-muted">
        <div className="space-y-2 bg-background px-5 py-4">
          <div className="h-2.5 w-16 rounded bg-muted" />
          <div className="h-4 w-24 rounded bg-muted" />
        </div>

        <div className="space-y-2 bg-background px-5 py-4">
          <div className="h-2.5 w-16 rounded bg-muted" />
          <div className="h-4 w-24 rounded bg-muted" />
        </div>

        <div className="space-y-2 bg-background px-5 py-4">
          <div className="h-2.5 w-16 rounded bg-muted" />
          <div className="h-4 w-24 rounded bg-muted" />
        </div>

        <div className="space-y-2 bg-background px-5 py-4">
          <div className="h-2.5 w-16 rounded bg-muted" />
          <div className="h-4 w-24 rounded bg-muted" />
        </div>
      </div>

      <div className="px-5 py-4">
        <div className="h-4 w-full rounded bg-muted" />
      </div>

      <div className="grid grid-cols-2 gap-3 px-5 pb-5">
        <div className="h-11 rounded-2xl bg-muted" />
        <div className="h-11 rounded-2xl bg-muted" />
      </div>
    </div>
  );
}

/* =========================================================
   EMPTY STATE
========================================================= */

function EmptyLoans() {
  return (
    <div
      className="
        flex
        min-h-[260px]
        w-full
        flex-col
        items-center
        justify-center
        rounded-3xl
        border
        border-dashed
        border-border
        bg-background
        px-6
        text-center
        dark:border-white/10
      "
    >
      <div
        className="
          flex
          h-12
          w-12
          items-center
          justify-center
          rounded-2xl
          bg-sky-500/10
          text-sky-600
          dark:text-sky-400
        "
      >
        <span className="text-lg font-bold">0</span>
      </div>

      <h3 className="mt-4 text-sm font-semibold text-foreground">
        No loans found
      </h3>

      <p className="mt-1 max-w-xs text-xs leading-5 text-muted-foreground">
        There are currently no loans matching the selected filters.
      </p>
    </div>
  );
}

/* =========================================================
   COMPONENT
========================================================= */

export default function LoanList({
  loans,
  loading = false,
  onSelectLoan,
  onView,
  onEdit,
  onRepay,
  onDelete,
}: LoanListProps){
  if (loading) {
    return (
      <div className="w-full lg:hidden">
        <div
          className="
            flex
            w-full
            snap-x
            snap-mandatory
            overflow-x-auto
            overscroll-x-contain
            scrollbar-none
          "
        >
          <div className="w-full min-w-full shrink-0 snap-center px-4 sm:px-6">
            <LoanLoadingCard />
          </div>
        </div>
      </div>
    );
  }

  if (loans.length === 0) {
    return (
      <div className="w-full px-4 sm:px-6 lg:hidden">
        <EmptyLoans />
      </div>
    );
  }

  return (
    <div className="w-full lg:hidden">
      {/* =====================================================
          MOBILE CAROUSEL
      ====================================================== */}

      <div
        className="
          flex
          w-full
          snap-x
          snap-mandatory
          overflow-x-auto
          overscroll-x-contain
          scrollbar-none
        "
      >
        {loans.map((loan) => (
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
              onView={() => {
                onView?.(loan);
              }}
              onEdit={() => {
                onEdit?.(loan);
              }}
              onRepay={() => {
                onRepay?.(loan);
              }}
              onDelete={() => {
                onDelete?.(loan);
              }}
            />
          </div>
        ))}
      </div>

      {/* =====================================================
          MOBILE NAVIGATION HINT
      ====================================================== */}

      {loans.length > 1 && (
        <div className="mt-3 flex items-center justify-center gap-3">
          <button
            type="button"
            aria-label="Previous loan"
            className="
              flex
              h-8
              w-8
              items-center
              justify-center
              rounded-full
              border
              border-border
              bg-background
              text-muted-foreground
              dark:border-white/10
            "
          >
            <ChevronLeft className="h-4 w-4" />
          </button>

          <div className="flex items-center gap-1">
            {loans.slice(0, 5).map((loan, index) => (
              <span
                key={loan.id}
                className={`
                  h-1.5
                  rounded-full
                  transition-all
                  ${
                    index === 0
                      ? "w-5 bg-sky-500"
                      : "w-1.5 bg-muted"
                  }
                `}
              />
            ))}
          </div>

          <button
            type="button"
            aria-label="Next loan"
            className="
              flex
              h-8
              w-8
              items-center
              justify-center
              rounded-full
              border
              border-border
              bg-background
              text-muted-foreground
              dark:border-white/10
            "
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* =====================================================
          ACCESSIBILITY / DESKTOP FALLBACK NOTE
      ====================================================== */}

      {onSelectLoan && (
        <div className="sr-only">
          {loans.map((loan) => (
            <button
              key={`select-${loan.id}`}
              type="button"
              onClick={() => onSelectLoan(loan)}
            >
              Select {loan.loanNumber}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
