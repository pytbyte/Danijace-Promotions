"use client";

import { Loan } from "@/lib/loans/types";
import LoanCard from "./LoanCard";
import LoanTable from "./LoanTable";

interface LoanListProps {
  loans: Loan[];
  onSelectLoan?: (loan: Loan) => void;
}

export default function LoanList({
  loans,
  onSelectLoan,
}: LoanListProps) {
  if (loans.length === 0) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-8 text-center">
        <p className="text-sm font-medium text-white">
          No loans found.
        </p>

        <p className="mt-1 text-xs text-white/50">
          Loans will appear here once they are created.
        </p>
      </div>
    );
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-white">
          Loans
        </h2>

        <span className="text-xs text-white/50">
          {loans.length.toLocaleString("en-KE")}{" "}
          {loans.length === 1 ? "loan" : "loans"}
        </span>
      </div>

      <div className="md:hidden">
        <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2">
          {loans.map((loan) => (
            <div
              key={loan.id}
              className="w-[calc(100vw-2rem)] shrink-0 snap-start"
            >
              <LoanCard
                loan={loan}
                onClick={() => onSelectLoan?.(loan)}
              />
            </div>
          ))}
        </div>
      </div>

      <div className="hidden md:block">
        <LoanTable
          loans={loans}
          onSelectLoan={onSelectLoan}
        />
      </div>
    </section>
  );
}