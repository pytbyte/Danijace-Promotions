"use client";

import { Search, SlidersHorizontal, X } from "lucide-react";

export type MemberStatusFilter =
  | "all"
  | "active"
  | "inactive"
  | "suspended";

type MemberSearchProps = {
  search: string;
  status: MemberStatusFilter;
  onSearchChange: (value: string) => void;
  onStatusChange: (value: MemberStatusFilter) => void;
};

export default function MemberSearch({
  search,
  status,
  onSearchChange,
  onStatusChange,
}: MemberSearchProps) {
  const hasFilters =
    search.trim() !== "" || status !== "all";

  const clearFilters = () => {
    onSearchChange("");
    onStatusChange("all");
  };

  return (
    <section className="mt-6 w-full min-w-0">
      <div className="w-full min-w-0 rounded-2xl border border-white/[0.08] bg-white/[0.025] p-3 sm:p-4">
        <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-center">
          {/* SEARCH */}

          <div className="relative min-w-0 flex-1">
            <Search
              size={18}
              strokeWidth={1.8}
              className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-white/25"
            />

            <input
              type="search"
              value={search}
              onChange={(event) =>
                onSearchChange(event.target.value)
              }
              placeholder="Search members by name, phone, ID or membership number..."
              aria-label="Search members"
              className="h-11 w-full rounded-xl border border-white/[0.08] bg-black/20 pl-10 pr-10 text-sm text-white outline-none transition placeholder:text-white/20 focus:border-yellow-500/30 focus:bg-black/30 focus:ring-1 focus:ring-yellow-500/10"
            />

            {search && (
              <button
                type="button"
                onClick={() => onSearchChange("")}
                aria-label="Clear search"
                className="absolute right-2.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-white/30 transition hover:bg-white/[0.06] hover:text-white"
              >
                <X size={15} strokeWidth={1.8} />
              </button>
            )}
          </div>

          {/* STATUS */}

          <div className="flex min-w-0 items-center gap-2">
            <div className="flex h-11 min-w-0 shrink-0 items-center gap-2 rounded-xl border border-white/[0.08] bg-black/20 px-3">
              <SlidersHorizontal
                size={16}
                strokeWidth={1.8}
                className="shrink-0 text-white/30"
              />

              <label
                htmlFor="member-status-filter"
                className="sr-only"
              >
                Filter members by status
              </label>

              <select
                id="member-status-filter"
                value={status}
                onChange={(event) =>
                  onStatusChange(
                    event.target.value as MemberStatusFilter
                  )
                }
                className="h-full min-w-[120px] cursor-pointer bg-transparent text-sm text-white/65 outline-none"
              >
                <option
                  value="all"
                  className="bg-[#111] text-white"
                >
                  All members
                </option>

                <option
                  value="active"
                  className="bg-[#111] text-white"
                >
                  Active
                </option>

                <option
                  value="inactive"
                  className="bg-[#111] text-white"
                >
                  Inactive
                </option>

                <option
                  value="suspended"
                  className="bg-[#111] text-white"
                >
                  Suspended
                </option>
              </select>
            </div>

            {hasFilters && (
              <button
                type="button"
                onClick={clearFilters}
                className="h-11 shrink-0 rounded-xl border border-white/[0.08] px-3.5 text-xs font-medium text-white/45 transition hover:border-white/[0.14] hover:bg-white/[0.04] hover:text-white"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        {/* FILTER INDICATOR */}

        {hasFilters && (
          <div className="mt-3 flex min-w-0 flex-wrap items-center gap-2 px-1">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-yellow-400" />

            <p className="text-[11px] text-white/30">
              Filters applied
            </p>

            {search.trim() !== "" && (
              <span className="max-w-[220px] truncate rounded-md bg-white/[0.05] px-2 py-1 text-[10px] font-medium text-white/50">
                "{search.trim()}"
              </span>
            )}

            {status !== "all" && (
              <span className="rounded-md bg-yellow-500/10 px-2 py-1 text-[10px] font-medium capitalize text-yellow-400/80">
                {status}
              </span>
            )}
          </div>
        )}
      </div>
    </section>
  );
}