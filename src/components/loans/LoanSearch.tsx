
"use client";

import {
  Filter,
  RotateCcw,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { useState } from "react";

/* =========================================================
   TYPES
========================================================= */

export type LoanSearchFilters = {
  search: string;
  status:
    | ""
    | "pending"
    | "active"
    | "completed"
    | "cancelled";
  type: string;
};

type LoanSearchProps = {
  value: LoanSearchFilters;

  onChange: (
    filters: LoanSearchFilters
  ) => void;

  onReset?: () => void;

  loanTypes?: string[];
};

/* =========================================================
   DEFAULTS
========================================================= */

export const DEFAULT_LOAN_FILTERS: LoanSearchFilters = {
  search: "",
  status: "",
  type: "",
};

/* =========================================================
   COMPONENT
========================================================= */

export default function LoanSearch({
  value,
  onChange,
  onReset,
  loanTypes = [],
}: LoanSearchProps) {
  const [filtersOpen, setFiltersOpen] =
    useState(false);

  const hasFilters =
    value.search.trim() !== "" ||
    value.status !== "" ||
    value.type !== "";

  /* =======================================================
     UPDATE FILTER
  ======================================================= */

  const updateFilter = <
    K extends keyof LoanSearchFilters
  >(
    key: K,
    filterValue: LoanSearchFilters[K]
  ) => {
    onChange({
      ...value,
      [key]: filterValue,
    });
  };

  /* =======================================================
     RESET
  ======================================================= */

  const resetFilters = () => {
    onChange(
      DEFAULT_LOAN_FILTERS
    );

    onReset?.();
  };

  /* =======================================================
     UNIQUE TYPES
  ======================================================= */

  const uniqueLoanTypes =
    Array.from(
      new Set(
        loanTypes
          .filter(
            (
              type
            ) =>
              typeof type ===
                "string" &&
              type.trim() !== ""
          )
          .map(
            (
              type
            ) =>
              type.trim()
          )
      )
    );

  return (
    <section className="rounded-2xl border border-white/[0.08] bg-[#0b0b0b] p-3 sm:p-4">
      {/* ===================================================
          SEARCH ROW
      =================================================== */}

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">

        {/* SEARCH */}

        <div className="relative min-w-0 flex-1">
          <Search
            size={18}
            strokeWidth={1.8}
            className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-white/30"
          />

          <input
            type="search"
            value={
              value.search
            }
            onChange={(
              event
            ) =>
              updateFilter(
                "search",
                event.target.value
              )
            }
            placeholder="Search loan number, member or member number..."
            className="
              h-11
              w-full
              rounded-xl
              border
              border-white/[0.08]
              bg-white/[0.03]
              pl-10
              pr-10
              text-sm
              text-white
              outline-none
              placeholder:text-white/25
              transition
              focus:border-yellow-500/30
              focus:bg-white/[0.04]
              focus:ring-2
              focus:ring-yellow-500/10
            "
          />

          {value.search && (
            <button
              type="button"
              onClick={() =>
                updateFilter(
                  "search",
                  ""
                )
              }
              className="
                absolute
                right-2.5
                top-1/2
                flex
                h-7
                w-7
                -translate-y-1/2
                items-center
                justify-center
                rounded-lg
                text-white/30
                transition
                hover:bg-white/[0.06]
                hover:text-white
              "
              aria-label="Clear loan search"
            >
              <X
                size={15}
                strokeWidth={1.8}
              />
            </button>
          )}
        </div>

        {/* FILTER */}

        <button
          type="button"
          onClick={() =>
            setFiltersOpen(
              (
                current
              ) =>
                !current
            )
          }
          className={`
            inline-flex
            h-11
            shrink-0
            items-center
            justify-center
            gap-2
            rounded-xl
            border
            px-4
            text-sm
            font-medium
            transition
            ${
              filtersOpen ||
              hasFilters
                ? "border-yellow-500/20 bg-yellow-500/10 text-yellow-400"
                : "border-white/[0.08] bg-white/[0.03] text-white/55 hover:bg-white/[0.06] hover:text-white"
            }
          `}
        >
          <SlidersHorizontal
            size={17}
            strokeWidth={1.8}
          />

          <span>
            Filters
          </span>

          {hasFilters && (
            <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-yellow-500 px-1.5 text-[10px] font-bold text-black">
              {
                [
                  value.status,
                  value.type,
                ].filter(Boolean)
                  .length +
                (value.search.trim()
                  ? 1
                  : 0)
              }
            </span>
          )}
        </button>

        {/* RESET */}

        {hasFilters && (
          <button
            type="button"
            onClick={
              resetFilters
            }
            className="
              inline-flex
              h-11
              shrink-0
              items-center
              justify-center
              gap-2
              rounded-xl
              px-3
              text-sm
              text-white/35
              transition
              hover:bg-white/[0.05]
              hover:text-white
            "
          >
            <RotateCcw
              size={16}
              strokeWidth={1.8}
            />

            <span className="hidden sm:inline">
              Reset
            </span>
          </button>
        )}
      </div>

      {/* ===================================================
          FILTER PANEL
      =================================================== */}

      {filtersOpen && (
        <div className="mt-3 border-t border-white/[0.06] pt-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">

            {/* STATUS */}

            <FilterSelect
              label="Loan status"
              icon={
                <Filter
                  size={14}
                  strokeWidth={1.8}
                />
              }
              value={
                value.status
              }
              onChange={(
                nextValue
              ) =>
                updateFilter(
                  "status",
                  nextValue as LoanSearchFilters["status"]
                )
              }
              options={[
                {
                  value: "",
                  label: "All statuses",
                },
                {
                  value:
                    "pending",
                  label: "Pending",
                },
                {
                  value:
                    "active",
                  label: "Active",
                },
                {
                  value:
                    "completed",
                  label: "Completed",
                },
                {
                  value:
                    "cancelled",
                  label: "Cancelled",
                },
              ]}
            />

            {/* TYPE */}

            <FilterSelect
              label="Loan type"
              value={
                value.type
              }
              onChange={(
                nextValue
              ) =>
                updateFilter(
                  "type",
                  nextValue
                )
              }
              options={[
                {
                  value: "",
                  label: "All loan types",
                },
                ...uniqueLoanTypes.map(
                  (
                    type
                  ) => ({
                    value:
                      type,
                    label:
                      type
                        .charAt(
                          0
                        )
                        .toUpperCase() +
                      type.slice(
                        1
                      ),
                  })
                ),
              ]}
            />
          </div>
        </div>
      )}
    </section>
  );
}

/* =========================================================
   FILTER SELECT
========================================================= */

type FilterSelectProps = {
  label: string;

  value: string;

  onChange: (
    value: string
  ) => void;

  options: {
    value: string;
    label: string;
  }[];

  icon?: React.ReactNode;
};

function FilterSelect({
  label,
  value,
  onChange,
  options,
  icon,
}: FilterSelectProps) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-center gap-1.5 px-1 text-[10px] font-semibold uppercase tracking-[0.15em] text-white/25">
        {icon}
        {label}
      </span>

      <select
        value={value}
        onChange={(
          event
        ) =>
          onChange(
            event.target
              .value
          )
        }
        className="
          h-10
          w-full
          rounded-xl
          border
          border-white/[0.08]
          bg-[#111111]
          px-3
          text-sm
          text-white/70
          outline-none
          transition
          focus:border-yellow-500/30
          focus:ring-2
          focus:ring-yellow-500/10
        "
      >
        {options.map(
          (
            option
          ) => (
            <option
              key={
                option.value
              }
              value={
                option.value
              }
              className="bg-[#111111] text-white"
            >
              {
                option.label
              }
            </option>
          )
        )}
      </select>
    </label>
  );
}
