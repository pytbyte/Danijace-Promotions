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
      <div className="hidden min-h-[300px] w-full min-w-0 items-center justify-center rounded-2xl border border-slate-200 bg-white p-6 lg:flex">
        <div className="text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-slate-200 bg-white text-black">
            <UserRound
              size={21}
              strokeWidth={1.5}
            />
          </div>

          <p className="mt-4 text-sm font-medium text-black">
            No members found
          </p>

          <p className="mt-2 text-xs text-black/50">
            Members matching your search will appear here.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="hidden w-full min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white lg:block">
      {/* HEADER */}
      <div className="flex min-w-0 items-center justify-between border-b border-slate-200 bg-white px-4 py-4 xl:px-5">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-black">
            Member Directory
          </h2>

          <p className="mt-1 text-xs text-black/50">
            {members.length.toLocaleString()}{" "}
            {members.length === 1
              ? "member"
              : "members"}
          </p>
        </div>
      </div>

      {/* TABLE SCROLL AREA */}
      <div className="max-h-[260px] overflow-auto bg-white">
        <table className="w-full min-w-[760px] table-fixed border-collapse bg-white text-left">
          <colgroup>
            <col className="w-[32%]" />
            <col className="w-[19%]" />
            <col className="w-[17%]" />
            <col className="w-[13%]" />
            <col className="w-[19%]" />
          </colgroup>

          {/* STICKY TABLE HEADER */}
          <thead className="sticky top-0 z-10 bg-white">
            <tr className="border-b border-slate-200 bg-white">
              <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-black xl:px-5">
                Member
              </th>

              <th className="px-3 py-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-black">
                Membership No.
              </th>

              <th className="px-3 py-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-black">
                Phone
              </th>

              <th className="px-3 py-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-black">
                Status
              </th>

              <th className="px-3 py-3 text-right text-[10px] font-semibold uppercase tracking-[0.14em] text-black xl:px-5">
                Actions
              </th>
            </tr>
          </thead>

          <tbody className="bg-white">
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
                  className="border-b border-slate-100 bg-white transition-colors last:border-b-0 hover:bg-slate-50"
                >
                  {/* MEMBER */}
                  <td className="min-w-0 bg-white px-4 py-4 xl:px-5">
                    <div className="flex min-w-0 items-center gap-3">
                      {member.profileImage ? (
                        <img
                          src={member.profileImage}
                          alt={fullName}
                          className="h-9 w-9 shrink-0 rounded-xl object-cover ring-1 ring-slate-200"
                        />
                      ) : (
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-yellow-50 text-xs font-semibold text-yellow-700 ring-1 ring-yellow-200">
                          {member.firstName
                            ?.charAt(0)
                            .toUpperCase()}

                          {member.lastName
                            ?.charAt(0)
                            .toUpperCase()}
                        </div>
                      )}

                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-black">
                          {fullName ||
                            "Unnamed member"}
                        </p>

                        <p className="mt-1 truncate text-[11px] text-black/50">
                          {member.email ||
                            "No email"}
                        </p>
                      </div>
                    </div>
                  </td>

                  {/* MEMBERSHIP NUMBER */}
                  <td className="min-w-0 bg-white px-3 py-4">
                    <span className="block truncate font-mono text-xs text-black">
                      {member.membershipNumber ||
                        "—"}
                    </span>
                  </td>

                  {/* PHONE */}
                  <td className="min-w-0 bg-white px-3 py-4">
                    <span className="block truncate text-xs text-black">
                      {member.phone || "—"}
                    </span>
                  </td>

                  {/* STATUS */}
                  <td className="bg-white px-3 py-4">
                    <StatusBadge
                      status={member.status}
                    />
                  </td>

                  {/* ACTIONS */}
                  <td className="bg-white px-3 py-4 xl:px-5">
                    <div className="flex items-center justify-end gap-0.5">
                      <button
                        type="button"
                        onClick={() =>
                          onView?.(member)
                        }
                        disabled={!onView}
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-black transition hover:bg-slate-100 hover:text-black disabled:cursor-default disabled:hover:bg-transparent disabled:hover:text-black"
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
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-black transition hover:bg-yellow-50 hover:text-yellow-700 disabled:cursor-default disabled:hover:bg-transparent disabled:hover:text-black"
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
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-black transition hover:bg-red-50 hover:text-red-600 disabled:cursor-default disabled:hover:bg-transparent disabled:hover:text-black"
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
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-black transition hover:bg-slate-100 hover:text-black"
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
  const normalizedStatus =
    typeof status === "string"
      ? status.trim().toLowerCase()
      : "";

  const item =
    normalizedStatus === "active"
      ? {
          label: "Active",
          badge:
            "bg-emerald-50 text-emerald-700 ring-emerald-200",
          dot: "bg-emerald-500",
        }
      : normalizedStatus === "inactive"
        ? {
            label: "Inactive",
            badge:
              "bg-slate-100 text-black ring-slate-200",
            dot: "bg-black/40",
          }
        : normalizedStatus === "suspended"
          ? {
              label: "Blacklisted",
              badge:
                "bg-red-50 text-red-700 ring-red-200",
              dot: "bg-red-500",
            }
          : {
              label: "Unknown",
              badge:
                "bg-slate-100 text-slate-600 ring-slate-200",
              dot: "bg-slate-400",
            };

  return (
    <span
      className={`
        inline-flex
        max-w-full
        shrink-0
        items-center
        rounded-lg
        px-2
        py-1
        text-[9px]
        font-medium
        ring-1
        ${item.badge}
      `}
    >
      <span
        className={`
          mr-1.5
          h-1.5
          w-1.5
          shrink-0
          rounded-full
          ${item.dot}
        `}
      />

      <span className="truncate">
        {item.label}
      </span>
    </span>
  );
}

