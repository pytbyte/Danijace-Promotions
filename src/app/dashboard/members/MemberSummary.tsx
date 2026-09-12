"use client";

import {
  AlertTriangle,
  Users,
  UserCheck,
  UserX,
} from "lucide-react";

import type { Member } from "@/lib/members/types";

type MemberSummaryProps = {
  members: Member[];
};

export default function MemberSummary({
  members,
}: MemberSummaryProps) {
  const total = members.length;

  const active = members.filter(
    (member) => member.status === "active"
  ).length;

  const inactive = members.filter(
    (member) => member.status === "inactive"
  ).length;

  const suspended = members.filter(
    (member) => member.status === "suspended"
  ).length;

  return (
    <section
      aria-label="Member summary"
      className="grid grid-cols-2 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4"
    >
      <SummaryCard
        label="Total Members"
        value={total}
        description="Registered members"
        icon={<Users size={19} strokeWidth={1.8} />}
        iconClass="bg-blue-50 text-blue-600"
      />

      <SummaryCard
        label="Active"
        value={active}
        description="Currently active"
        icon={<UserCheck size={19} strokeWidth={1.8} />}
        iconClass="bg-emerald-50 text-emerald-600"
      />

      <SummaryCard
        label="Inactive"
        value={inactive}
        description="Inactive members"
        icon={<UserX size={19} strokeWidth={1.8} />}
        iconClass="bg-slate-100 text-slate-500"
      />

      <SummaryCard
        label="Suspended"
        value={suspended}
        description="Require attention"
        icon={<AlertTriangle size={19} strokeWidth={1.8} />}
        iconClass="bg-red-50 text-red-600"
      />
    </section>
  );
}

/* =========================================================
   SUMMARY CARD
========================================================= */

function SummaryCard({
  label,
  value,
  description,
  icon,
  iconClass,
}: {
  label: string;
  value: number;
  description: string;
  icon: React.ReactNode;
  iconClass: string;
}) {
  return (
    <div
      className="
        rounded-2xl
        border border-slate-200
        bg-white
        p-4
        transition-colors
        hover:border-slate-300
        hover:bg-slate-50
        sm:p-5
      "
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-xs font-medium text-black">
            {label}
          </p>

          <p className="mt-3 text-xl font-semibold tracking-tight text-black sm:text-2xl">
            {value.toLocaleString()}
          </p>

          <p className="mt-2 truncate text-[10px] text-black/60 sm:text-[11px]">
            {description}
          </p>
        </div>

        <div
          className={`
            flex h-9 w-9 shrink-0
            items-center justify-center
            rounded-xl
            sm:h-10 sm:w-10
            ${iconClass}
          `}
        >
          {icon}
        </div>
      </div>
    </div>
  );
}