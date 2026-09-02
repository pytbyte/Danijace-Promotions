
"use client";

import {
  ArrowDownLeft,
  ArrowUpRight,
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
  description: string;
  icon: React.ReactNode;
  variant?: "primary" | "default" | "danger";
  children?: React.ReactNode;
};

function formatKES(amount: number): string {
  if (!Number.isFinite(amount)) {
    return "KES 0.00";
  }

  return new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return "0";
  }

  return new Intl.NumberFormat("en-KE").format(
    Math.max(0, Math.floor(value))
  );
}

function SummaryCard({
  label,
  value,
  description,
  icon,
  variant = "default",
  children,
}: SummaryCardProps) {
  const isPrimary = variant === "primary";
  const isDanger = variant === "danger";

  return (
    <article
      className={`
        relative
        overflow-hidden
        rounded-[22px]
        border
        p-4
        transition-all
        duration-200
        sm:p-5
        ${
          isPrimary
            ? `
              border-blue-400/[0.18]
              bg-gradient-to-br
              from-blue-600/[0.20]
              via-[#0A1729]
              to-[#07111F]
              shadow-[0_18px_50px_rgba(37,99,235,0.12)]
            `
            : isDanger
              ? `
                border-red-400/[0.10]
                bg-gradient-to-br
                from-red-500/[0.055]
                via-[#0A1626]
                to-[#07111F]
                shadow-[0_12px_40px_rgba(0,0,0,0.20)]
              `
              : `
                border-blue-300/[0.08]
                bg-gradient-to-br
                from-[#0B1A2D]
                via-[#091626]
                to-[#07111F]
                shadow-[0_12px_40px_rgba(0,0,0,0.20)]
              `
        }
      `}
    >
      {/* =====================================================
          AMBIENT GLOW
      ====================================================== */}

      {isPrimary && (
        <>
          <div
            className="
              pointer-events-none
              absolute
              -right-20
              -top-20
              h-44
              w-44
              rounded-full
              bg-blue-500/[0.12]
              blur-3xl
            "
          />

          <div
            className="
              pointer-events-none
              absolute
              -bottom-20
              -left-16
              h-36
              w-36
              rounded-full
              bg-yellow-400/[0.055]
              blur-3xl
            "
          />
        </>
      )}

      <div className="relative">
        {/* ===================================================
            HEADER
        ==================================================== */}

        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <div
              className={`
                flex
                h-9
                w-9
                shrink-0
                items-center
                justify-center
                rounded-xl
                ${
                  isPrimary
                    ? "border border-blue-300/[0.10] bg-blue-400/[0.10] text-[#F0C85A]"
                    : isDanger
                      ? "border border-red-400/[0.08] bg-red-400/[0.08] text-red-300"
                      : "border border-yellow-400/[0.06] bg-yellow-400/[0.055] text-yellow-300/70"
                }
              `}
            >
              {icon}
            </div>

            <p
              className={`
                truncate
                text-xs
                font-medium
                ${
                  isPrimary
                    ? "text-blue-100/65"
                    : isDanger
                      ? "text-red-100/50"
                      : "text-blue-100/45"
                }
              `}
            >
              {label}
            </p>
          </div>

          {isPrimary && (
            <span
              className="
                rounded-full
                border
                border-yellow-400/[0.12]
                bg-yellow-400/[0.06]
                px-2
                py-1
                text-[9px]
                font-medium
                text-[#E8C45A]/80
              "
            >
              Live
            </span>
          )}
        </div>

        {/* ===================================================
            VALUE
        ==================================================== */}

        <p
          className={`
            mt-5
            truncate
            tracking-tight
            ${
              isPrimary
                ? "text-2xl font-semibold text-white sm:text-[28px]"
                : "text-xl font-semibold text-white sm:text-2xl"
            }
          `}
        >
          {value}
        </p>

        {/* ===================================================
            DESCRIPTION
        ==================================================== */}

        <p
          className="
            mt-2
            truncate
            text-[10px]
            leading-5
            text-blue-100/30
            sm:text-[11px]
          "
        >
          {description}
        </p>

        {/* ===================================================
            OPTIONAL EXTRA CONTENT
        ==================================================== */}

        {children}
      </div>
    </article>
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
        <div
          className="
            h-[154px]
            animate-pulse
            rounded-[22px]
            border
            border-blue-400/[0.10]
            bg-[#0A1626]
            sm:h-[160px]
          "
        />

        {Array.from({ length: 4 }).map((_, index) => (
          <div
            key={index}
            className="
              h-[154px]
              animate-pulse
              rounded-[22px]
              border
              border-blue-300/[0.06]
              bg-[#091626]
              sm:h-[160px]
            "
          />
        ))}
      </section>
    );
  }

  const withdrawals = Math.abs(
    Number.isFinite(totalAdjustments)
      ? totalAdjustments
      : 0
  );

  const reversals = Math.abs(
    Number.isFinite(totalReversals)
      ? totalReversals
      : 0
  );

  const deposits = Number.isFinite(totalDeposits)
    ? totalDeposits
    : 0;

  const calculatedBalance =
    deposits -
    withdrawals -
    reversals;

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
      {/* =====================================================
          TOTAL SAVINGS
      ====================================================== */}

      <SummaryCard
        label="Total Savings"
        value={formatKES(totalBalance)}
        description="Confirmed ledger balance"
        variant="primary"
        icon={
          <Wallet
            size={18}
            strokeWidth={1.8}
          />
        }
      >
        {/* MOBILE CALCULATION */}

        <div
          className="
            mt-4
            border-t
            border-blue-300/[0.08]
            pt-3
            sm:hidden
          "
        >
          <p
            className="
              mb-2
              text-[9px]
              font-medium
              uppercase
              tracking-[0.12em]
              text-blue-100/25
            "
          >
            Balance calculation
          </p>

          <div className="space-y-1.5">
            {/* DEPOSITS */}

            <div className="flex items-center justify-between gap-3">
              <span className="text-[10px] text-blue-100/40">
                Deposits
              </span>

              <span className="text-[10px] font-medium text-blue-50/65">
                {formatKES(deposits)}
              </span>
            </div>

            {/* WITHDRAWALS */}

            <div className="flex items-center justify-between gap-3">
              <span className="text-[10px] text-blue-100/40">
                − Withdrawals
              </span>

              <span className="text-[10px] font-medium text-blue-50/55">
                {formatKES(withdrawals)}
              </span>
            </div>

            {/* REVERSALS */}

            <div className="flex items-center justify-between gap-3">
              <span className="text-[10px] text-blue-100/40">
                − Reversals
              </span>

              <span className="text-[10px] font-medium text-blue-50/55">
                {formatKES(reversals)}
              </span>
            </div>

            {/* RESULT */}

            <div
              className="
                mt-2
                flex
                items-center
                justify-between
                gap-3
                border-t
                border-yellow-400/[0.10]
                pt-2
              "
            >
              <span className="text-[10px] font-medium text-blue-100/50">
                Current balance
              </span>

              <span className="text-[11px] font-semibold text-[#F0C85A]">
                {formatKES(calculatedBalance)}
              </span>
            </div>
          </div>
        </div>
      </SummaryCard>

      {/* =====================================================
          DEPOSITS
      ====================================================== */}

      <SummaryCard
        label="Deposits"
        value={formatKES(deposits)}
        description="Confirmed money received"
        icon={
          <ArrowDownLeft
            size={18}
            strokeWidth={1.8}
          />
        }
      />

      {/* =====================================================
          WITHDRAWALS
      ====================================================== */}

      <SummaryCard
        label="Withdrawals"
        value={formatKES(withdrawals)}
        description="Money withdrawn from savings"
        icon={
          <ArrowUpRight
            size={18}
            strokeWidth={1.8}
          />
        }
      />

      {/* =====================================================
          REVERSALS
      ====================================================== */}

      <SummaryCard
        label="Reversals"
        value={formatKES(reversals)}
        description="Confirmed value reversed"
        variant="danger"
        icon={
          <ArrowUpRight
            size={18}
            strokeWidth={1.8}
          />
        }
      />

      {/* =====================================================
          MEMBERS
      ====================================================== */}

      <SummaryCard
        label="Members"
        value={formatNumber(memberCount)}
        description="Members with savings accounts"
        icon={
          <Users
            size={18}
            strokeWidth={1.8}
          />
        }
      />
    </section>
  );
}
