"use client";

import {
  Eye,
  Pencil,
  Trash2,
  UserRound,
} from "lucide-react";

import type { Member } from "@/lib/members/types";

type MemberListProps = {
  members: Member[];
  onView?: (member: Member) => void;
  onEdit?: (member: Member) => void;
  onDelete?: (member: Member) => void;
};

export default function MemberList({
  members,
  onView,
  onEdit,
  onDelete,
}: MemberListProps) {
  if (members.length === 0) {
    return (
      <div className="flex min-h-[280px] items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.025] p-6 lg:hidden">
        <div className="text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.03] text-white/25">
            <UserRound size={21} strokeWidth={1.5} />
          </div>

          <p className="mt-4 text-sm font-medium text-white/50">
            No members found
          </p>

          <p className="mx-auto mt-2 max-w-xs text-xs leading-5 text-white/25">
            Members matching your search will appear here.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3 lg:hidden">
      {/* HEADER */}
      <div className="flex items-center justify-between px-1">
        <div>
          <h2 className="text-sm font-semibold text-white">
            Members
          </h2>

          <p className="mt-1 text-xs text-white/30">
            {members.length.toLocaleString()}{" "}
            {members.length === 1 ? "member" : "members"}
          </p>
        </div>

        {members.length > 1 && (
          <p className="text-[10px] text-white/25">
            Swipe →
          </p>
        )}
      </div>

      {/* HORIZONTAL MEMBER CAROUSEL */}
      <div
        className="
          -mx-1
          overflow-x-auto
          overflow-y-hidden
          px-1
          pb-2
          [scrollbar-width:none]
          [-ms-overflow-style:none]
          [&::-webkit-scrollbar]:hidden
        "
      >
        <div className="flex w-max snap-x snap-mandatory gap-3">
          {members.map((member) => {
            const fullName = [
              member.firstName,
              member.middleName,
              member.lastName,
            ]
              .filter(Boolean)
              .join(" ");

            return (
              <div
                key={
                  member._id ||
                  member.membershipNumber
                }
                className="
                  w-[calc(100vw-56px)]
                  max-w-[390px]
                  shrink-0
                  snap-center
                "
              >
                <MemberCard
                  member={member}
                  fullName={fullName}
                  onView={onView}
                  onEdit={onEdit}
                  onDelete={onDelete}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* =========================================================
   MEMBER CARD
========================================================= */

function MemberCard({
  member,
  fullName,
  onView,
  onEdit,
  onDelete,
}: {
  member: Member;
  fullName: string;
  onView?: (member: Member) => void;
  onEdit?: (member: Member) => void;
  onDelete?: (member: Member) => void;
}) {
  return (
    <article
      className="
        flex
        h-[300px]
        flex-col
        overflow-hidden
        rounded-2xl
        border
        border-white/[0.08]
        bg-white/[0.025]
      "
    >
      {/* MEMBER HEADER */}
      <div className="flex items-center gap-3.5 p-4">
        {member.profileImage ? (
          <img
            src={member.profileImage}
            alt={fullName}
            className="h-12 w-12 shrink-0 rounded-xl object-cover ring-1 ring-white/10"
          />
        ) : (
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-yellow-500/10 text-sm font-semibold text-yellow-400">
            {member.firstName?.charAt(0).toUpperCase()}
            {member.lastName?.charAt(0).toUpperCase()}
          </div>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="truncate text-sm font-semibold text-white">
                {fullName || "Unnamed member"}
              </h3>

              <p className="mt-1 truncate text-[11px] text-white/30">
                {member.membershipNumber || "—"}
              </p>
            </div>

            <StatusBadge status={member.status} />
          </div>
        </div>
      </div>

      {/* MEMBER DETAILS */}
      <div className="grid flex-1 grid-cols-2 gap-px border-t border-white/[0.07] bg-white/[0.05]">
        <div className="bg-[#0b0b0b] px-4 py-3">
          <p className="text-[9px] font-medium uppercase tracking-[0.14em] text-white/25">
            Phone
          </p>

          <p className="mt-1.5 truncate text-xs text-white/60">
            {member.phone || "—"}
          </p>
        </div>

        <div className="bg-[#0b0b0b] px-4 py-3">
          <p className="text-[9px] font-medium uppercase tracking-[0.14em] text-white/25">
            Email
          </p>

          <p className="mt-1.5 truncate text-xs text-white/60">
            {member.email || "—"}
          </p>
        </div>

        <div className="bg-[#0b0b0b] px-4 py-3">
          <p className="text-[9px] font-medium uppercase tracking-[0.14em] text-white/25">
            Joined
          </p>

          <p className="mt-1.5 truncate text-xs text-white/60">
            {formatDate(member.joinDate)}
          </p>
        </div>

        <div className="bg-[#0b0b0b] px-4 py-3">
          <p className="text-[9px] font-medium uppercase tracking-[0.14em] text-white/25">
            County
          </p>

          <p className="mt-1.5 truncate text-xs text-white/60">
            {member.county || "—"}
          </p>
        </div>
      </div>

      {/* ACTIONS */}
      <div className="flex items-center gap-2 border-t border-white/[0.07] p-3">
        <button
          type="button"
          onClick={() => onView?.(member)}
          disabled={!onView}
          className="flex h-10 flex-1 items-center justify-center gap-2 rounded-xl bg-white/[0.04] text-xs font-medium text-white/50 transition hover:bg-white/[0.07] hover:text-white disabled:cursor-default disabled:hover:bg-white/[0.04] disabled:hover:text-white/50"
        >
          <Eye size={16} strokeWidth={1.8} />
          <span>View</span>
        </button>

        <button
          type="button"
          onClick={() => onEdit?.(member)}
          disabled={!onEdit}
          className="flex h-10 flex-1 items-center justify-center gap-2 rounded-xl bg-yellow-500/[0.06] text-xs font-medium text-yellow-400/70 transition hover:bg-yellow-500/10 hover:text-yellow-400 disabled:cursor-default disabled:hover:bg-yellow-500/[0.06] disabled:hover:text-yellow-400/70"
        >
          <Pencil size={16} strokeWidth={1.8} />
          <span>Edit</span>
        </button>

        <button
          type="button"
          onClick={() => onDelete?.(member)}
          disabled={!onDelete}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-500/[0.05] text-red-400/60 transition hover:bg-red-500/10 hover:text-red-400 disabled:cursor-default disabled:hover:bg-red-500/[0.05] disabled:hover:text-red-400/60"
          aria-label={`Delete ${fullName}`}
          title="Delete member"
        >
          <Trash2 size={16} strokeWidth={1.8} />
        </button>
      </div>
    </article>
  );
}

/* =========================================================
   STATUS BADGE
========================================================= */

function StatusBadge({
  status,
}: {
  status: Member["status"];
}) {
  const styles: Record<Member["status"], string> = {
    active:
      "bg-emerald-500/10 text-emerald-400 ring-emerald-500/10",

    inactive:
      "bg-white/[0.06] text-white/45 ring-white/[0.06]",

    suspended:
      "bg-red-500/10 text-red-400 ring-red-500/10",
  };

  const labels: Record<Member["status"], string> = {
    active: "Active",
    inactive: "Inactive",
    suspended: "Suspended",
  };

  const dots: Record<Member["status"], string> = {
    active: "bg-emerald-400",
    inactive: "bg-white/30",
    suspended: "bg-red-400",
  };

  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-lg px-2 py-1 text-[9px] font-medium ring-1 ${styles[status]}`}
    >
      <span
        className={`mr-1.5 h-1.5 w-1.5 rounded-full ${dots[status]}`}
      />

      {labels[status]}
    </span>
  );
}

/* =========================================================
   DATE FORMATTER
========================================================= */

function formatDate(value?: string) {
  if (!value) {
    return "—";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return new Intl.DateTimeFormat("en-KE", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}