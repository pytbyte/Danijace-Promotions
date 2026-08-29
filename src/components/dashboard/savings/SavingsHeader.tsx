"use client";

import { Plus, Wallet } from "lucide-react";

type SavingsHeaderProps = {
  onAddSavings: () => void;
};

export default function SavingsHeader({
  onAddSavings,
}: SavingsHeaderProps) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      {/* =====================================================
          TITLE
      ===================================================== */}

      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-yellow-500/10 text-yellow-400 ring-1 ring-yellow-500/10">
          <Wallet
            size={21}
            strokeWidth={1.8}
          />
        </div>

        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold tracking-tight text-white sm:text-2xl">
            Savings
          </h1>

          <p className="mt-0.5 text-xs text-white/40 sm:text-sm">
            Manage member savings and transaction history.
          </p>
        </div>
      </div>

      {/* =====================================================
          ADD SAVINGS
      ===================================================== */}

      <button
        type="button"
        onClick={onAddSavings}
        className="
          inline-flex
          h-11
          w-full
          shrink-0
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
          sm:w-auto
        "
      >
        <Plus
          size={18}
          strokeWidth={2}
        />

        <span>Add Savings</span>
      </button>
    </div>
  );
}