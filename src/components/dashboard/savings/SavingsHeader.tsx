"use client";

import { Plus } from "lucide-react";

type SavingsHeaderProps = {
  onAddSavings: () => void;
};

export default function SavingsHeader({
  onAddSavings,
}: SavingsHeaderProps) {
  return (
    <header
      className="
        relative
        z-10
        w-full
      "
    >
      <div
        className="
          flex
          w-full
          flex-col
          gap-4
          sm:flex-row
          sm:items-center
          sm:justify-between
        "
      >
        {/* =====================================================
            TITLE
        ===================================================== */}

        <div>
          <div className="flex items-center gap-2">
            <div className="h-1.5 w-1.5 rounded-full bg-sky-400" />

            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-sky-300/60">
              DANIJACE PROMOTIONS
            </p>
          </div>

          <h2 className="mt-1 text-base font-semibold tracking-tight text-white">
            Savings management
          </h2>
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
    </header>
  );
}
