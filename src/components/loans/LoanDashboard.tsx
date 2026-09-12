"use client";

import {
  Banknote,
  CircleDollarSign,
  Clock3,
  FileCheck2,
  ReceiptText,
  TriangleAlert,
  TrendingUp,
} from "lucide-react";

interface LoanDashboardProps {
  totalLoans?: number;
  activeLoans?: number;
  pendingLoans?: number;
  completedLoans?: number;
  totalPrincipal?: number;
  totalPaid?: number;
  totalOutstanding?: number;
  totalFines?: number;
}

interface StatCardProps {
  label: string;
  value: string;
  icon: React.ReactNode;
}

function StatCard({ label, value, icon }: StatCardProps) {
  return (
    <div className="rounded-2xl border border-slate-300 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            {label}
          </p>

          <p className="mt-2 text-xl font-bold text-slate-950">
            {value}
          </p>
        </div>

        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-100 text-sky-700">
          {icon}
        </div>
      </div>
    </div>
  );
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

function formatCompactMoney(value: number): string {
  if (!Number.isFinite(value)) {
    return "KES 0";
  }

  return `KES ${value.toLocaleString("en-KE", {
    maximumFractionDigits: 0,
  })}`;
}

export default function LoanDashboard({
  totalLoans = 0,
  activeLoans = 0,
  pendingLoans = 0,
  completedLoans = 0,
  totalPrincipal = 0,
  totalPaid = 0,
  totalOutstanding = 0,
  totalFines = 0,
}: LoanDashboardProps) {
  /*
   * Recovery percentage.
   *
   * We calculate this from:
   *
   * paid / (paid + outstanding)
   *
   * rather than using principal, because outstanding includes
   * the current financial liability after interest/fines.
   */
  const recoveryBase =
    Math.max(0, totalPaid) + Math.max(0, totalOutstanding);

  const recoveryPercentage =
    recoveryBase > 0
      ? Math.min(
          100,
          Math.max(
            0,
            (Math.max(0, totalPaid) / recoveryBase) * 100,
          ),
        )
      : 0;

  return (
    <section className="space-y-4">
      {/* =====================================================
          MOBILE
          Single rich portfolio card
      ====================================================== */}
      <div className="lg:hidden">
        <article className="relative overflow-hidden rounded-3xl border border-slate-300 bg-white p-5 shadow-sm">
          {/* Decorative glow */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full bg-sky-200/50 blur-3xl"
          />

          {/* Header */}
          <div className="relative flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-100 text-sky-700">
                <Banknote size={19} />
              </div>

              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Loan Portfolio
                </p>

                <p className="mt-0.5 text-xs text-slate-500">
                  {totalLoans.toLocaleString("en-KE")} total loans
                </p>
              </div>
            </div>

            <TrendingUp
              size={17}
              className="text-sky-600"
            />
          </div>

          {/* Outstanding */}
          <div className="relative mt-6">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
              Outstanding Balance
            </p>

            <p className="mt-1 text-[30px] font-bold leading-tight tracking-tight text-slate-950">
              {formatCompactMoney(totalOutstanding)}
            </p>
          </div>

          {/* Recovery progress */}
          <div className="relative mt-5">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[10px] font-medium text-slate-500">
                Portfolio recovery
              </span>

              <span className="text-xs font-bold text-sky-700">
                {recoveryPercentage.toFixed(0)}%
              </span>
            </div>

            <div className="h-2 overflow-hidden rounded-full bg-slate-200">
              <div
                className="h-full rounded-full bg-sky-500 transition-all"
                style={{
                  width: `${recoveryPercentage}%`,
                }}
              />
            </div>
          </div>

          {/* Loan status */}
          <div className="relative mt-6 grid grid-cols-3 divide-x divide-slate-200 rounded-2xl border border-slate-200 bg-slate-50 py-3">
            <div className="px-3">
              <p className="text-[9px] font-medium uppercase tracking-wide text-slate-500">
                Active
              </p>

              <p className="mt-1 text-base font-bold text-slate-950">
                {activeLoans.toLocaleString("en-KE")}
              </p>
            </div>

            <div className="px-3">
              <p className="text-[9px] font-medium uppercase tracking-wide text-slate-500">
                Pending
              </p>

              <p className="mt-1 text-base font-bold text-slate-950">
                {pendingLoans.toLocaleString("en-KE")}
              </p>
            </div>

            <div className="px-3">
              <p className="text-[9px] font-medium uppercase tracking-wide text-slate-500">
                Completed
              </p>

              <p className="mt-1 text-base font-bold text-slate-950">
                {completedLoans.toLocaleString("en-KE")}
              </p>
            </div>
          </div>

          {/* Financial breakdown */}
          <div className="relative mt-5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CircleDollarSign
                  size={14}
                  className="text-slate-400"
                />

                <span className="text-xs font-medium text-slate-600">
                  Principal issued
                </span>
              </div>

              <span className="text-xs font-semibold text-slate-900">
                {formatMoney(totalPrincipal)}
              </span>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Banknote
                  size={14}
                  className="text-slate-400"
                />

                <span className="text-xs font-medium text-slate-600">
                  Total paid
                </span>
              </div>

              <span className="text-xs font-semibold text-slate-900">
                {formatMoney(totalPaid)}
              </span>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <TriangleAlert
                  size={14}
                  className="text-slate-400"
                />

                <span className="text-xs font-medium text-slate-600">
                  Total fines
                </span>
              </div>

              <span className="text-xs font-semibold text-slate-900">
                {formatMoney(totalFines)}
              </span>
            </div>
          </div>
        </article>
      </div>

      {/* =====================================================
          DESKTOP
          Original dashboard layout preserved
      ====================================================== */}
      <div className="hidden lg:block">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            label="Total Loans"
            value={totalLoans.toLocaleString("en-KE")}
            icon={<ReceiptText size={20} />}
          />

          <StatCard
            label="Active Loans"
            value={activeLoans.toLocaleString("en-KE")}
            icon={<Banknote size={20} />}
          />

          <StatCard
            label="Pending"
            value={pendingLoans.toLocaleString("en-KE")}
            icon={<Clock3 size={20} />}
          />

          <StatCard
            label="Completed"
            value={completedLoans.toLocaleString("en-KE")}
            icon={<FileCheck2 size={20} />}
          />
        </div>

        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Principal Issued"
            value={formatMoney(totalPrincipal)}
            icon={<CircleDollarSign size={20} />}
          />

          <StatCard
            label="Total Paid"
            value={formatMoney(totalPaid)}
            icon={<Banknote size={20} />}
          />

          <StatCard
            label="Outstanding"
            value={formatMoney(totalOutstanding)}
            icon={<CircleDollarSign size={20} />}
          />

          <StatCard
            label="Total Fines"
            value={formatMoney(totalFines)}
            icon={<TriangleAlert size={20} />}
          />
        </div>
      </div>
    </section>
  );
}