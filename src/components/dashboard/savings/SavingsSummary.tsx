"use client";

import {
  ArrowDownLeft,
  ArrowUpRight,
  Landmark,
  Users,
  Wallet,
} from "lucide-react";

type SavingsSummaryProps = {
  totalBalance: number;
  totalDeposits: number;
  totalAdjustments: number;
  totalReversals: number;
  memberCount: number;
  loading?: boolean;
};

type SummaryCardProps = {
  label: string;
  value: string;
  icon: React.ReactNode;
  description: string;
};

function SummaryCard({
  label,
  value,
  icon,
  description,
}: SummaryCardProps) {
  return (
    <div
      className="
        min-w-0
        rounded-2xl
        border
        border-white/[0.08]
        bg-[#0b0b0b]
        p-4
        shadow-[0_12px_40px_rgba(0,0,0,0.18)]
        sm:p-5
      "
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-xs font-medium text-white/40">
            {label}
          </p>

          <p className="mt-2 truncate text-xl font-semibold tracking-tight text-white sm:text-2xl">
            {value}
          </p>
        </div>

        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-yellow-500/10 text-yellow-400">
          {icon}
        </div>
      </div>

      <p className="mt-3 truncate text-[11px] text-white/25">
        {description}
      </p>
    </div>
  );
}

function formatKES(
  amount: number
): string {
  if (!Number.isFinite(amount)) {
    return "KES 0.00";
  }

  return new Intl.NumberFormat(
    "en-KE",
    {
      style: "currency",
      currency: "KES",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }
  ).format(amount);
}

function formatNumber(
  value: number
): string {
  if (!Number.isFinite(value)) {
    return "0";
  }

  return new Intl.NumberFormat(
    "en-KE"
  ).format(
    Math.max(
      0,
      Math.floor(value)
    )
  );
}

export default function SavingsSummary({
  totalBalance,
  totalDeposits,
  totalAdjustments,
  totalReversals,
  memberCount,
  loading = false,
}: SavingsSummaryProps) {
  if (loading) {
    return (
      <section
        aria-label="Savings summary"
        className="
          grid
          grid-cols-1
          gap-3
          sm:grid-cols-2
          xl:grid-cols-5
        "
      >
        {Array.from({
          length: 5,
        }).map(
          (_, index) => (
            <div
              key={index}
              className="
                h-[128px]
                animate-pulse
                rounded-2xl
                border
                border-white/[0.08]
                bg-[#0b0b0b]
              "
            />
          )
        )}
      </section>
    );
  }

  return (
    <section
      aria-label="Savings summary"
      className="
        grid
        grid-cols-1
        gap-3
        sm:grid-cols-2
        xl:grid-cols-5
      "
    >
      {/* TOTAL BALANCE */}

      <SummaryCard
        label="Total Savings"
        value={formatKES(
          totalBalance
        )}
        icon={
          <Wallet
            size={18}
            strokeWidth={1.8}
          />
        }
        description="Authoritative ledger balance"
      />

      {/* DEPOSITS */}

      <SummaryCard
        label="Deposits"
        value={formatKES(
          totalDeposits
        )}
        icon={
          <ArrowDownLeft
            size={18}
            strokeWidth={1.8}
          />
        }
        description="Confirmed deposit transactions"
      />

      {/* ADJUSTMENTS */}

      <SummaryCard
        label="Adjustments"
        value={formatKES(
          totalAdjustments
        )}
        icon={
          <Landmark
            size={18}
            strokeWidth={1.8}
          />
        }
        description="Ledger corrections"
      />

      {/* REVERSALS */}

      <SummaryCard
        label="Reversals"
        value={formatKES(
          totalReversals
        )}
        icon={
          <ArrowUpRight
            size={18}
            strokeWidth={1.8}
          />
        }
        description="Reversed transaction value"
      />

      {/* MEMBERS */}

      <SummaryCard
        label="Members"
        value={formatNumber(
          memberCount
        )}
        icon={
          <Users
            size={18}
            strokeWidth={1.8}
          />
        }
        description="Members with savings accounts"
      />
    </section>
  );
}