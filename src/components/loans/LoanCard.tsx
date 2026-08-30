"use client";

import {
  ArrowRight,
  CalendarDays,
  CircleDollarSign,
  UserRound,
} from "lucide-react";
import { Loan } from "@/lib/loans/types";

interface LoanCardProps {
  loan: Loan;
  onClick?: () => void;
}

function formatMoney(value: number): string {
  if (!Number.isFinite(value)) {
    return "KES 0.00";
  }

  return `KES ${value.toLocaleString("en-KE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatDate(value: Date): string {
  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return date.toLocaleDateString("en-KE", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function statusClass(status: Loan["status"]): string {
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

export default function LoanCard({
  loan,
  onClick,
}: LoanCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full rounded-2xl border border-white/10 bg-white/[0.04] p-4 text-left transition hover:bg-white/[0.07] active:scale-[0.99]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-white/40">
            {loan.loanNumber}
          </p>

          <h3 className="mt-1 truncate text-base font-semibold text-white">
            {loan.memberName}
          </h3>

          <p className="mt-1 text-xs text-white/45">
            {loan.memberNumber}
          </p>
        </div>

        <span
          className={`shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-medium capitalize ${statusClass(
            loan.status,
          )}`}
        >
          {loan.status}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-black/20 p-3">
          <div className="flex items-center gap-2 text-white/40">
            <CircleDollarSign size={14} />

            <span className="text-[10px] uppercase tracking-wide">
              Principal
            </span>
          </div>

          <p className="mt-1 text-sm font-semibold text-white">
            {formatMoney(loan.principal)}
          </p>
        </div>

        <div className="rounded-xl bg-black/20 p-3">
          <div className="flex items-center gap-2 text-white/40">
            <CircleDollarSign size={14} />

            <span className="text-[10px] uppercase tracking-wide">
              Balance
            </span>
          </div>

          <p className="mt-1 text-sm font-semibold text-white">
            {formatMoney(loan.outstandingBalance)}
          </p>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between text-xs">
        <div className="flex items-center gap-1.5 text-white/45">
          <CalendarDays size={14} />

          <span>
            Due {formatDate(loan.firstDueDate)}
          </span>
        </div>

        <div className="flex items-center gap-1.5 text-white/50">
          <UserRound size={14} />

          <span className="capitalize">
            {loan.type}
          </span>

          <ArrowRight size={14} />
        </div>
      </div>
    </button>
  );
}