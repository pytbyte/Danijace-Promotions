"use client";

import { UserPlus, Users } from "lucide-react";
import type { Member } from "@/lib/members/types";
import MemberSummary from "./MemberSummary";

type MembersViewProps = {
  members?: Member[];
  loading?: boolean;
  onAddMember?: () => void;
};

export default function MembersView({
  members = [],
  loading = false,
  onAddMember,
}: MembersViewProps) {
  return (
    <div className="w-full">
      {/* Header */}
      <section className="mb-6 sm:mb-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-yellow-500/10 text-yellow-400">
                <Users size={17} strokeWidth={1.8} />
              </div>

              <p className="text-xs font-medium uppercase tracking-[0.22em] text-yellow-500/60">
                Members
              </p>
            </div>

            <h1 className="mt-3 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
              Members
            </h1>

            <p className="mt-2 max-w-2xl text-sm leading-6 text-white/35">
              Manage registered members, their personal information,
              membership status and account details.
            </p>
          </div>

          <button
            type="button"
            onClick={onAddMember}
            disabled={!onAddMember}
            className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-yellow-500 px-4 text-sm font-semibold text-black shadow-lg shadow-yellow-500/10 transition-all hover:bg-yellow-400 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 sm:px-5"
          >
            <UserPlus size={17} strokeWidth={2} />
            <span>Add Member</span>
          </button>
        </div>
      </section>

      {loading ? (
        <MembersLoading />
      ) : (
        <>
          {/* Member summary */}
          <MemberSummary members={members} />

          {/* Temporary members area */}
          <section className="mt-6">
            <div className="min-h-[320px] rounded-2xl border border-white/[0.08] bg-white/[0.025]">
              <div className="flex min-h-[320px] items-center justify-center p-6">
                <div className="max-w-md text-center">
                  <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.03] text-white/30">
                    <Users size={21} strokeWidth={1.5} />
                  </div>

                  <h2 className="mt-4 text-sm font-semibold text-white/60">
                    {members.length === 0
                      ? "No members yet"
                      : `${members.length.toLocaleString()} members`}
                  </h2>

                  <p className="mx-auto mt-2 max-w-sm text-xs leading-5 text-white/25">
                    {members.length === 0
                      ? "Registered members will appear here. Add your first member to get started."
                      : "Member management tools will appear here."}
                  </p>

                  {members.length === 0 && onAddMember && (
                    <button
                      type="button"
                      onClick={onAddMember}
                      className="mt-5 inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-yellow-500/20 bg-yellow-500/10 px-4 text-xs font-medium text-yellow-400 transition hover:border-yellow-500/30 hover:bg-yellow-500/15"
                    >
                      <UserPlus size={16} strokeWidth={1.8} />
                      <span>Add your first member</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function MembersLoading() {
  return (
    <div className="space-y-6" aria-label="Loading members">
      {/* Summary skeletons */}
      <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div
            key={index}
            className="animate-pulse rounded-2xl border border-white/[0.08] bg-white/[0.025] p-4 sm:p-5"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1">
                <div className="h-3 w-20 rounded bg-white/[0.06]" />

                <div className="mt-4 h-7 w-16 rounded bg-white/[0.06]" />

                <div className="mt-3 h-2.5 w-28 rounded bg-white/[0.04]" />
              </div>

              <div className="h-9 w-9 rounded-xl bg-white/[0.06] sm:h-10 sm:w-10" />
            </div>
          </div>
        ))}
      </section>

      {/* Main skeleton */}
      <div className="min-h-[320px] animate-pulse rounded-2xl border border-white/[0.08] bg-white/[0.025]">
        <div className="border-b border-white/[0.07] p-5">
          <div className="h-4 w-32 rounded bg-white/[0.06]" />
          <div className="mt-2 h-3 w-48 rounded bg-white/[0.04]" />
        </div>

        <div className="flex min-h-[240px] items-center justify-center">
          <div className="h-10 w-32 rounded-xl bg-white/[0.04]" />
        </div>
      </div>
    </div>
  );
}