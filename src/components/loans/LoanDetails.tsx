"use client";

import {
  ArrowLeft,
  Banknote,
  CalendarDays,
  CircleDollarSign,
  FileText,
  ShieldCheck,
  TriangleAlert,
  UserRound,
} from "lucide-react";

import type { Loan } from "@/lib/loans/types";

interface LoanDetailsProps {
  loan: Loan;
  onBack?: () => void;
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

function formatDate(value: Date | string): string {
  const date =
    value instanceof Date
      ? value
      : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return date.toLocaleDateString("en-KE", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatDateTime(
  value: Date | string,
): string {
  const date =
    value instanceof Date
      ? value
      : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return date.toLocaleString("en-KE", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
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

interface InfoRowProps {
  label: string;
  value: React.ReactNode;
}

function InfoRow({
  label,
  value,
}: InfoRowProps) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-white/5 py-3 last:border-b-0">
      <span className="text-sm text-white/45">
        {label}
      </span>

      <span className="text-right text-sm font-medium text-white">
        {value}
      </span>
    </div>
  );
}

function MoneyCard({
  label,
  value,
}: {
  label: string;
  value: number;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
      <p className="text-xs uppercase tracking-wide text-white/40">
        {label}
      </p>

      <p className="mt-2 text-lg font-semibold text-white">
        {formatMoney(value)}
      </p>
    </div>
  );
}

export default function LoanDetails({
  loan,
  onBack,
}: LoanDetailsProps) {
  return (
    <section className="space-y-4">
      {/* HEADER */}
      <div className="flex items-center gap-3">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-white/70 transition hover:bg-white/[0.08] hover:text-white"
            aria-label="Back to loans"
          >
            <ArrowLeft size={18} />
          </button>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold text-white">
              {loan.loanNumber}
            </h1>

            <span
              className={`rounded-full border px-2.5 py-1 text-[10px] font-medium capitalize ${statusClass(
                loan.status,
              )}`}
            >
              {loan.status}
            </span>
          </div>

          <p className="mt-1 text-sm text-white/50">
            {loan.memberName} · {loan.memberNumber}
          </p>
        </div>
      </div>

      {/* FINANCIAL SUMMARY */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MoneyCard
          label="Principal"
          value={loan.principal}
        />

        <MoneyCard
          label="Total Due"
          value={loan.totalDue}
        />

        <MoneyCard
          label="Amount Paid"
          value={loan.amountPaid}
        />

        <MoneyCard
          label="Outstanding"
          value={loan.outstandingBalance}
        />
      </div>

      {/* LOAN INFORMATION */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
          <div className="mb-2 flex items-center gap-2">
            <FileText
              size={17}
              className="text-white/60"
            />

            <h2 className="text-sm font-semibold text-white">
              Loan Information
            </h2>
          </div>

          <InfoRow
            label="Loan number"
            value={loan.loanNumber}
          />

          <InfoRow
            label="Member"
            value={loan.memberName}
          />

          <InfoRow
            label="Member number"
            value={loan.memberNumber}
          />

          <InfoRow
            label="Loan type"
            value={
              <span className="capitalize">
                {loan.type}
              </span>
            }
          />

          <InfoRow
            label="Interest rate"
            value={`${(
              loan.interestRate * 100
            ).toFixed(2)}%`}
          />

          <InfoRow
            label="Interest amount"
            value={formatMoney(
              loan.interestAmount,
            )}
          />
        </div>

        {/* DATES */}
        <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
          <div className="mb-2 flex items-center gap-2">
            <CalendarDays
              size={17}
              className="text-white/60"
            />

            <h2 className="text-sm font-semibold text-white">
              Dates
            </h2>
          </div>

          <InfoRow
            label="Disbursement date"
            value={formatDate(
              loan.disbursementDate,
            )}
          />

          <InfoRow
            label="First due date"
            value={formatDate(
              loan.firstDueDate,
            )}
          />

          <InfoRow
            label="Fine status"
            value={
              <span className="capitalize">
                {loan.fineStatus}
              </span>
            }
          />

          <InfoRow
            label="Daily fine"
            value={formatMoney(
              loan.dailyFine,
            )}
          />

          <InfoRow
            label="Fine source"
            value={
              <span className="capitalize">
                {loan.fineSource}
              </span>
            }
          />

          <InfoRow
            label="Total fines"
            value={formatMoney(
              loan.totalFines,
            )}
          />
        </div>
      </div>

      {/* GUARANTOR */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
        <div className="mb-2 flex items-center gap-2">
          <UserRound
            size={17}
            className="text-white/60"
          />

          <h2 className="text-sm font-semibold text-white">
            Guarantor
          </h2>
        </div>

        <InfoRow
          label="Name"
          value={loan.guarantor.name}
        />

        <InfoRow
          label="Phone"
          value={loan.guarantor.phone}
        />

        <InfoRow
          label="ID number"
          value={
            loan.guarantor.idNumber ||
            "Not provided"
          }
        />
      </div>

      {/* AUDIT / AUTHORIZATION */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
        <div className="mb-2 flex items-center gap-2">
          <ShieldCheck
            size={17}
            className="text-white/60"
          />

          <h2 className="text-sm font-semibold text-white">
            Authorization & Audit
          </h2>
        </div>

        <InfoRow
          label="Created by"
          value={
            <div>
              <p>{loan.createdBy.name}</p>
              <p className="text-xs font-normal text-white/40">
                {loan.createdBy.email}
              </p>
            </div>
          }
        />

        <InfoRow
          label="Authorized by"
          value={
            <div>
              <p>{loan.authorizedBy.name}</p>
              <p className="text-xs font-normal text-white/40">
                {loan.authorizedBy.email}
              </p>
            </div>
          }
        />

        <InfoRow
          label="Authorized at"
          value={formatDateTime(
            loan.authorizedAt,
          )}
        />

        <InfoRow
          label="Created at"
          value={formatDateTime(
            loan.createdAt,
          )}
        />

        <InfoRow
          label="Last updated"
          value={formatDateTime(
            loan.updatedAt,
          )}
        />
      </div>

      {/* REPAYMENT STATUS */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
        <div className="mb-3 flex items-center gap-2">
          <Banknote
            size={17}
            className="text-white/60"
          />

          <h2 className="text-sm font-semibold text-white">
            Repayment Position
          </h2>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-xl bg-black/20 p-3">
            <p className="text-xs text-white/40">
              Total due
            </p>

            <p className="mt-1 font-semibold text-white">
              {formatMoney(loan.totalDue)}
            </p>
          </div>

          <div className="rounded-xl bg-black/20 p-3">
            <p className="text-xs text-white/40">
              Paid
            </p>

            <p className="mt-1 font-semibold text-white">
              {formatMoney(loan.amountPaid)}
            </p>
          </div>

          <div className="rounded-xl bg-black/20 p-3">
            <p className="text-xs text-white/40">
              Outstanding
            </p>

            <p className="mt-1 font-semibold text-white">
              {formatMoney(
                loan.outstandingBalance,
              )}
            </p>
          </div>
        </div>

        {loan.totalFines > 0 && (
          <div className="mt-3 flex items-center gap-2 rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-sm text-amber-300">
            <TriangleAlert size={16} />

            <span>
              This loan has{" "}
              {formatMoney(
                loan.totalFines,
              )}{" "}
              in fines.
            </span>
          </div>
        )}
      </div>
    </section>
  );
}