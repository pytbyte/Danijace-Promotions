"use client";

import {
  ArrowUpRight,
  CalendarDays,
} from "lucide-react";
import { Loan } from "@/lib/loans/types";

interface LoanTableProps {
  loans: Loan[];
  onSelectLoan?: (loan: Loan) => void;
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

export default function LoanTable({
  loans,
  onSelectLoan,
}: LoanTableProps) {
  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04]">
      <div className="max-h-[520px] overflow-auto">
        <table className="w-full min-w-[1050px] border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-[#111816]">
            <tr className="border-b border-white/10 text-left text-xs uppercase tracking-wide text-white/40">
              <th className="px-4 py-3 font-medium">
                Loan
              </th>

              <th className="px-4 py-3 font-medium">
                Member
              </th>

              <th className="px-4 py-3 font-medium">
                Type
              </th>

              <th className="px-4 py-3 text-right font-medium">
                Principal
              </th>

              <th className="px-4 py-3 text-right font-medium">
                Paid
              </th>

              <th className="px-4 py-3 text-right font-medium">
                Fines
              </th>

              <th className="px-4 py-3 text-right font-medium">
                Balance
              </th>

              <th className="px-4 py-3 font-medium">
                Due
              </th>

              <th className="px-4 py-3 font-medium">
                Status
              </th>

              <th className="px-4 py-3 text-right font-medium">
                View
              </th>
            </tr>
          </thead>

          <tbody>
            {loans.map((loan) => (
              <tr
                key={loan.id}
                className="border-b border-white/5 transition hover:bg-white/[0.03]"
              >
                <td className="px-4 py-3">
                  <div>
                    <p className="font-medium text-white">
                      {loan.loanNumber}
                    </p>

                    <p className="mt-0.5 text-xs text-white/40">
                      {formatDate(loan.disbursementDate)}
                    </p>
                  </div>
                </td>

                <td className="px-4 py-3">
                  <div>
                    <p className="font-medium text-white">
                      {loan.memberName}
                    </p>

                    <p className="mt-0.5 text-xs text-white/40">
                      {loan.memberNumber}
                    </p>
                  </div>
                </td>

                <td className="px-4 py-3">
                  <span className="capitalize text-white/70">
                    {loan.type}
                  </span>
                </td>

                <td className="px-4 py-3 text-right text-white/80">
                  {formatMoney(loan.principal)}
                </td>

                <td className="px-4 py-3 text-right text-white/80">
                  {formatMoney(loan.amountPaid)}
                </td>

                <td className="px-4 py-3 text-right text-white/80">
                  {formatMoney(loan.totalFines)}
                </td>

                <td className="px-4 py-3 text-right font-semibold text-white">
                  {formatMoney(loan.outstandingBalance)}
                </td>

                <td className="px-4 py-3">
                  <div className="flex items-center gap-1.5 text-white/60">
                    <CalendarDays size={14} />

                    <span>
                      {formatDate(loan.firstDueDate)}
                    </span>
                  </div>
                </td>

                <td className="px-4 py-3">
                  <span
                    className={`inline-flex rounded-full border px-2.5 py-1 text-xs capitalize ${statusClass(
                      loan.status,
                    )}`}
                  >
                    {loan.status}
                  </span>
                </td>

                <td className="px-4 py-3 text-right">
                  <button
                    type="button"
                    onClick={() => onSelectLoan?.(loan)}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-white/5 text-white/60 transition hover:bg-white/10 hover:text-white"
                    aria-label={`View ${loan.loanNumber}`}
                  >
                    <ArrowUpRight size={16} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}