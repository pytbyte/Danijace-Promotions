"use client";

import {
  MoreHorizontal,
  Pencil,
  Trash2,
  Eye,
  UserRound,
} from "lucide-react";

import type { Member } from "@/lib/members/types";

type MemberTableProps = {
  members: Member[];
  onView?: (member: Member) => void;
  onEdit?: (member: Member) => void;
  onDelete?: (member: Member) => void;
};

export default function MemberTable({
  members,
  onView,
  onEdit,
  onDelete,
}: MemberTableProps) {
  if (members.length === 0) {
    return (
      <div className="hidden min-h-[300px] w-full min-w-0 items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.025] p-6 lg:flex">
        <div className="text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.03] text-white/25">
            <UserRound size={21} strokeWidth={1.5} />
          </div>

          <p className="mt-4 text-sm font-medium text-white/50">
            No members found
          </p>

          <p className="mt-2 text-xs text-white/25">
            Members matching your search will appear here.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="hidden w-full min-w-0 overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.025] lg:block">
      {/* HEADER */}
      <div className="flex min-w-0 items-center justify-between border-b border-white/[0.07] px-4 py-4 xl:px-5">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-white">
            Member Directory
          </h2>

          <p className="mt-1 text-xs text-white/30">
            {members.length.toLocaleString()}{" "}
            {members.length === 1 ? "member" : "members"}
          </p>
        </div>
      </div>

      {/* TABLE SCROLL AREA */}
      <div className="max-h-[260px] overflow-auto">
        <table className="w-full min-w-[760px] table-fixed border-collapse text-left">
          <colgroup>
            <col className="w-[32%]" />
            <col className="w-[19%]" />
            <col className="w-[17%]" />
            <col className="w-[13%]" />
            <col className="w-[19%]" />
          </colgroup>

          {/* STICKY TABLE HEADER */}
          <thead className="sticky top-0 z-10 bg-[#0b0b0b]">
            <tr className="border-b border-white/[0.08]">
              <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/25 xl:px-5">
                Member
              </th>

              <th className="px-3 py-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/25">
                Membership No.
              </th>

              <th className="px-3 py-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/25">
                Phone
              </th>

              <th className="px-3 py-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/25">
                Status
              </th>

              <th className="px-3 py-3 text-right text-[10px] font-semibold uppercase tracking-[0.14em] text-white/25 xl:px-5">
                Actions
              </th>
            </tr>
          </thead>

          <tbody>
            {members.map((member) => {
              const fullName = [
                member.firstName,
                member.middleName,
                member.lastName,
              ]
                .filter(Boolean)
                .join(" ");

              return (
                <tr
                  key={
                    member._id ||
                    member.membershipNumber
                  }
                  className="border-b border-white/[0.05] transition-colors last:border-b-0 hover:bg-white/[0.025]"
                >
                  {/* MEMBER */}
                  <td className="min-w-0 px-4 py-4 xl:px-5">
                    <div className="flex min-w-0 items-center gap-3">
                      {member.profileImage ? (
                        <img
                          src={member.profileImage}
                          alt={fullName}
                          className="h-9 w-9 shrink-0 rounded-xl object-cover ring-1 ring-white/10"
                        />
                      ) : (
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-yellow-500/10 text-xs font-semibold text-yellow-400">
                          {member.firstName
                            ?.charAt(0)
                            .toUpperCase()}

                          {member.lastName
                            ?.charAt(0)
                            .toUpperCase()}
                        </div>
                      )}

                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-white">
                          {fullName ||
                            "Unnamed member"}
                        </p>

                        <p className="mt-1 truncate text-[11px] text-white/30">
                          {member.email ||
                            "No email"}
                        </p>
                      </div>
                    </div>
                  </td>

                  {/* MEMBERSHIP NUMBER */}
                  <td className="min-w-0 px-3 py-4">
                    <span className="block truncate font-mono text-xs text-white/55">
                      {member.membershipNumber ||
                        "—"}
                    </span>
                  </td>

                  {/* PHONE */}
                  <td className="min-w-0 px-3 py-4">
                    <span className="block truncate text-xs text-white/50">
                      {member.phone || "—"}
                    </span>
                  </td>

                  {/* STATUS */}
                  <td className="px-3 py-4">
                    <StatusBadge
                      status={member.status}
                    />
                  </td>

                  {/* ACTIONS */}
                  <td className="px-3 py-4 xl:px-5">
                    <div className="flex items-center justify-end gap-0.5">
                      <button
                        type="button"
                        onClick={() =>
                          onView?.(member)
                        }
                        disabled={!onView}
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white/30 transition hover:bg-white/[0.06] hover:text-white disabled:cursor-default disabled:hover:bg-transparent disabled:hover:text-white/30"
                        aria-label={`View ${fullName}`}
                        title="View member"
                      >
                        <Eye
                          size={15}
                          strokeWidth={1.8}
                        />
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          onEdit?.(member)
                        }
                        disabled={!onEdit}
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white/30 transition hover:bg-yellow-500/10 hover:text-yellow-400 disabled:cursor-default disabled:hover:bg-transparent disabled:hover:text-white/30"
                        aria-label={`Edit ${fullName}`}
                        title="Edit member"
                      >
                        <Pencil
                          size={15}
                          strokeWidth={1.8}
                        />
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          onDelete?.(member)
                        }
                        disabled={!onDelete}
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white/30 transition hover:bg-red-500/10 hover:text-red-400 disabled:cursor-default disabled:hover:bg-transparent disabled:hover:text-white/30"
                        aria-label={`Delete ${fullName}`}
                        title="Delete member"
                      >
                        <Trash2
                          size={15}
                          strokeWidth={1.8}
                        />
                      </button>

                      <button
                        type="button"
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white/25 transition hover:bg-white/[0.06] hover:text-white"
                        aria-label={`More actions for ${fullName}`}
                        title="More actions"
                      >
                        <MoreHorizontal
                          size={16}
                          strokeWidth={1.8}
                        />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
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
      className={`inline-flex max-w-full shrink-0 items-center rounded-lg px-2 py-1 text-[9px] font-medium ring-1 ${styles[status]}`}
    >
      <span
        className={`mr-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${dots[status]}`}
      />

      <span className="truncate">
        {labels[status]}
      </span>
    </span>
  );
}