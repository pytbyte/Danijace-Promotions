"use client";

import {
  Banknote,
  CircleDollarSign,
  Clock3,
  FileCheck2,
  ReceiptText,
  TriangleAlert,
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
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-white/50">
            {label}
          </p>

          <p className="mt-2 text-xl font-semibold text-white">
            {value}
          </p>
        </div>

        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 text-white">
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
  return (
    <section className="space-y-4">
      
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

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
    </section>
  );
}