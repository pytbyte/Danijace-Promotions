"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  AlertCircle,
  Plus,
  RefreshCw,
  Users,
} from "lucide-react";

import TopBar from "@/components/dashboard/TopBar";

import MemberList from "@/app/dashboard/members/MemberList";
import MemberSummary from "@/app/dashboard/members/MemberSummary";
import MemberTable from "@/app/dashboard/members/MemberTable";
import MemberSearch, {
  type MemberStatusFilter,
} from "@/app/dashboard/members/MemberSearch";
import MemberForm from "@/app/dashboard/members/MemberForm";

import MemberViewModal from "@/app/dashboard/members/MemberDetails";
import MemberEditModal from "@/app/dashboard/members/MemberEditModal";
import MemberDeleteModal from "@/app/dashboard/members/MemberDeleteModal";

import type {
  Member,
  MemberWithFinancialSummary,
} from "@/lib/members/types";

/* =========================================================
   API RESPONSE
========================================================= */

type MembersResponse = {
  success: boolean;
  data?: MemberWithFinancialSummary[];
  count?: number;
  error?: string;
};

/* =========================================================
   PAGE
========================================================= */

export default function MembersPage() {
  /* =======================================================
     MEMBERS
  ======================================================= */

  const [members, setMembers] =
    useState<MemberWithFinancialSummary[]>([]);

  const [loading, setLoading] =
    useState(true);

  const [refreshing, setRefreshing] =
    useState(false);

  const [error, setError] =
    useState("");

  const [mounted, setMounted] =
    useState(false);

  /* =======================================================
     MODAL STATE
  ======================================================= */

  const [viewMember, setViewMember] =
    useState<MemberWithFinancialSummary | null>(null);

  const [editMember, setEditMember] =
    useState<Member | null>(null);

  const [deleteMember, setDeleteMember] =
    useState<Member | null>(null);

  /* =======================================================
     SEARCH
  ======================================================= */

  const [search, setSearch] =
    useState("");

  const [status, setStatus] =
    useState<MemberStatusFilter>("all");

  /* =======================================================
     ADD MEMBER
  ======================================================= */

  const [addMemberOpen, setAddMemberOpen] =
    useState(false);

  /* =======================================================
     MOUNT
  ======================================================= */

  useEffect(() => {
    setMounted(true);
  }, []);

  /* =======================================================
     LOAD MEMBERS
  ======================================================= */

  const loadMembers = useCallback(
    async (isRefresh = false) => {
      try {
        if (isRefresh) {
          setRefreshing(true);
        } else {
          setLoading(true);
        }

        setError("");

        const response = await fetch(
          "/api/members",
          {
            method: "GET",
            cache: "no-store",
            headers: {
              Accept: "application/json",
            },
          }
        );

        let result: MembersResponse;

        try {
          result = await response.json();
        } catch {
          throw new Error(
            "The server returned an invalid response."
          );
        }

        if (
          !response.ok ||
          !result.success
        ) {
          throw new Error(
            result.error ||
              `Unable to load members. Server returned ${response.status}.`
          );
        }

        setMembers(
          Array.isArray(result.data)
            ? result.data
            : []
        );
      } catch (err) {
        console.error(
          "Failed to load members:",
          err
        );

        if (
          err instanceof TypeError &&
          err.message === "Failed to fetch"
        ) {
          setError(
            "Unable to connect to the server. Check your connection and try again."
          );
        } else if (err instanceof Error) {
          setError(err.message);
        } else {
          setError(
            "Something went wrong while loading members."
          );
        }
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    []
  );

  /* =======================================================
     INITIAL LOAD
  ======================================================= */

  useEffect(() => {
    if (!mounted) {
      return;
    }

    void loadMembers();
  }, [mounted, loadMembers]);

  /* =======================================================
     REFRESH
  ======================================================= */

  function handleRefresh() {
    if (loading || refreshing) {
      return;
    }

    void loadMembers(true);
  }

  /* =======================================================
     ADD MEMBER
  ======================================================= */

  function handleAddMember() {
    setAddMemberOpen(true);
  }

  function handleMemberAdded() {
    setAddMemberOpen(false);

    void loadMembers(true);
  }

  /* =======================================================
     VIEW MEMBER
  ======================================================= */

  /**
   * Plain Member handler.
   *
   * MemberTable may expose a plain Member to this callback.
   * We therefore resolve the corresponding enriched member
   * from the current members state before opening the view.
   */
  function handleView(member: Member) {
    setEditMember(null);
    setDeleteMember(null);

    const enrichedMember =
      members.find(
        (item) =>
          item._id === member._id ||
          item.membershipNumber ===
            member.membershipNumber
      );

    if (!enrichedMember) {
      console.warn(
        "Unable to find enriched member:",
        member.membershipNumber
      );

      return;
    }

    setViewMember(enrichedMember);
  }

  /**
   * Enriched member handler.
   *
   * Used by MemberList and MemberViewModal where the
   * financial summary is already available.
   */
  function handleViewEnriched(
    member: MemberWithFinancialSummary
  ) {
    setEditMember(null);
    setDeleteMember(null);

    setViewMember(member);
  }

  function handleCloseMemberView() {
    setViewMember(null);
  }

  /* =======================================================
     EDIT MEMBER
  ======================================================= */

  function handleEdit(member: Member) {
    setViewMember(null);
    setDeleteMember(null);

    setEditMember(member);
  }

  function handleEditEnriched(
    member: MemberWithFinancialSummary
  ) {
    handleEdit(member);
  }

  function handleCloseMemberEdit() {
    setEditMember(null);
  }

  function handleMemberUpdated() {
    setEditMember(null);

    void loadMembers(true);
  }

  /* =======================================================
     DELETE MEMBER
  ======================================================= */

  function handleDelete(member: Member) {
    setViewMember(null);
    setEditMember(null);

    setDeleteMember(member);
  }

  function handleDeleteEnriched(
    member: MemberWithFinancialSummary
  ) {
    handleDelete(member);
  }

  function handleCloseMemberDelete() {
    setDeleteMember(null);
  }

  function handleMemberDeleted() {
    setDeleteMember(null);

    void loadMembers(true);
  }



/* =======================================================
   FILTER MEMBERS
======================================================= */

const filteredMembers = useMemo(() => {
  const query = search.trim().toLowerCase();

  const selectedStatus =
    typeof status === "string"
      ? status.trim().toLowerCase()
      : "all";

  return members.filter((member) => {
    /* ---------------------------------------------------
       NORMALIZE MEMBER STATUS
    --------------------------------------------------- */

    const memberStatus =
      typeof member.status === "string"
        ? member.status.trim().toLowerCase()
        : "";

    /* ---------------------------------------------------
       STATUS FILTER
    --------------------------------------------------- */

    if (
      selectedStatus !== "all" &&
      memberStatus !== selectedStatus
    ) {
      return false;
    }

    /* ---------------------------------------------------
       NO SEARCH QUERY
    --------------------------------------------------- */

    if (!query) {
      return true;
    }

    /* ---------------------------------------------------
       FULL NAME
    --------------------------------------------------- */

    const fullName = [
      member.firstName,
      member.middleName,
      member.lastName,
    ]
      .filter(
        (value): value is string =>
          typeof value === "string" &&
          value.trim().length > 0
      )
      .join(" ");

    /* ---------------------------------------------------
       SEARCHABLE FIELDS
    --------------------------------------------------- */

    const searchableText = [
      fullName,
      member.membershipNumber,
      member.phone,
      member.email,
      member.nationalId,
      member.address,
      member.city,
      member.county,
      member.occupation,
      member.nextOfKinName,
      member.nextOfKinPhone,
      member.nextOfKinRelationship,
    ]
      .filter(
        (value): value is string =>
          typeof value === "string" &&
          value.trim().length > 0
      )
      .join(" ")
      .toLowerCase();

    return searchableText.includes(query);
  });
}, [members, search, status]);



  /* =======================================================
     SSR / HYDRATION GUARD
  ======================================================= */

  if (!mounted) {
    return (
      <main className="min-h-[100dvh] w-full overflow-x-clip bg-white text-black">
        <TopBar />

        <div className="w-full min-w-0 pt-16">
          <div className="mx-auto w-full max-w-[1800px] min-w-0 px-4 py-6 sm:px-6 sm:py-8 lg:px-8 xl:px-10 2xl:px-12">
            <MembersLoading />
          </div>
        </div>
      </main>
    );
  }

  /* =======================================================
     PAGE
  ======================================================= */

  return (
    <main className="min-h-[100dvh] w-full max-w-full overflow-x-clip bg-white text-black">
      <TopBar />

      <div className="w-full min-w-0 pt-16">
        <div className="mx-auto w-full min-w-0 max-w-[1800px] px-4 py-6 sm:px-6 sm:py-8 lg:px-8 lg:py-10 xl:px-10 2xl:px-12">
          {/* =================================================
              HEADER
          ================================================= */}

          <section className="mb-6 w-full min-w-0 sm:mb-8">
            <div className="flex w-full min-w-0 flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
              <div className="mb-3 flex items-end justify-between px-1">
                <div>
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-1.5 rounded-full bg-sky-500" />

                    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-sky-600">
                      DANIJACE PROMOTIONS
                    </p>
                  </div>

                  <h2 className="mt-1 text-base font-semibold tracking-tight text-black">
                    Members Management
                  </h2>
                </div>

                <p className="text-xs text-black/50">
                  {members.length.toLocaleString()}{" "}
                  {members.length === 1
                    ? "member"
                    : "members"}
                </p>
              </div>

              <div className="flex w-full min-w-0 shrink-0 items-center gap-2 lg:w-auto">
                <button
                  type="button"
                  onClick={handleRefresh}
                  disabled={
                    loading || refreshing
                  }
                  className="
                    flex
                    h-10
                    items-center
                    justify-center
                    gap-2
                    rounded-xl
                    border
                    border-slate-200
                    bg-white
                    px-3
                    text-xs
                    font-medium
                    text-black
                    shadow-sm
                    transition
                    hover:bg-slate-50
                    hover:border-slate-300
                    disabled:cursor-not-allowed
                    disabled:opacity-40
                  "
                >
                  <RefreshCw
                    className={`h-4 w-4 ${
                      refreshing
                        ? "animate-spin"
                        : ""
                    }`}
                  />

                  <span className="hidden sm:inline">
                    Refresh
                  </span>
                </button>

                <button
                  type="button"
                  onClick={handleAddMember}
                  className="
                    flex
                    h-10
                    items-center
                    justify-center
                    gap-2
                    rounded-xl
                    bg-sky-400
                    px-4
                    text-xs
                    font-semibold
                    text-black
                    transition
                    hover:bg-sky-300
                    active:scale-[0.98]
                  "
                >
                  <Plus className="h-4 w-4" />

                  <span>
                    Add Member
                  </span>
                </button>
              </div>
            </div>
          </section>

          {/* =================================================
              ERROR
          ================================================= */}

          {error && (
            <div className="mb-6 flex items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4">
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-rose-600" />

              <div className="min-w-0">
                <p className="text-sm font-medium text-black">
                  Unable to load members
                </p>

                <p className="mt-1 text-xs leading-5 text-black/60">
                  {error}
                </p>
              </div>

              <button
                type="button"
                onClick={() =>
                  void loadMembers(true)
                }
                className="ml-auto shrink-0 rounded-lg px-2 py-1 text-xs font-medium text-black transition hover:bg-rose-100"
              >
                Retry
              </button>
            </div>
          )}

          {/* =================================================
              CONTENT
          ================================================= */}

          {loading ? (
            <MembersLoading />
          ) : (
            <>
              {/* MEMBER SUMMARY */}

              <div className="mt-6 w-full min-w-0 overflow-hidden">
                <MemberSummary
                  members={members}
                />
              </div>

              {/* SEARCH */}

              {!error && (
                <MemberSearch
                  search={search}
                  status={status}
                  onSearchChange={setSearch}
                  onStatusChange={setStatus}
                />
              )}

              {/* MEMBER TABLE + MOBILE LIST */}

              <section className="mt-6 w-full min-w-0 overflow-hidden">
                <MemberTable
                  members={filteredMembers}
                  onView={handleView}
                  onEdit={handleEdit}
                  onDelete={handleDelete}
                />

                <MemberList
                  members={filteredMembers}
                  onView={handleViewEnriched}
                  onEdit={handleEditEnriched}
                  onDelete={handleDeleteEnriched}
                />
              </section>

              {/* NO SEARCH RESULTS */}

              {members.length > 0 &&
                filteredMembers.length === 0 && (
                  <div className="mt-6 rounded-2xl border border-slate-200 bg-white px-5 py-10 text-center shadow-sm">
                    <Users className="mx-auto mb-3 h-8 w-8 text-black/25" />

                    <p className="text-sm font-medium text-black">
                      No matching members
                    </p>

                    <p className="mt-1 text-xs text-black/50">
                      Try a different name, phone,
                      membership number, or status.
                    </p>
                  </div>
                )}

              {/* EMPTY DIRECTORY */}

              {members.length === 0 &&
                !error && (
                  <div className="mt-6 rounded-2xl border border-slate-200 bg-white px-5 py-12 text-center shadow-sm">
                    <Users className="mx-auto mb-3 h-9 w-9 text-black/25" />

                    <p className="text-sm font-medium text-black">
                      No members yet
                    </p>

                    <p className="mt-1 text-xs text-black/50">
                      Add your first DANIJACE PROMOTIONS member
                      to get started.
                    </p>

                    <button
                      type="button"
                      onClick={handleAddMember}
                      className="mt-5 inline-flex items-center gap-2 rounded-xl bg-sky-400 px-4 py-2.5 text-xs font-semibold text-black transition hover:bg-sky-300"
                    >
                      <Plus className="h-4 w-4" />

                      Add Member
                    </button>
                  </div>
                )}

              {/* FOOTER */}

              {members.length > 0 && (
                <div className="mt-6 flex items-center justify-between border-t border-slate-200 pt-4">
                  <p className="text-[11px] text-black/50">
                    Showing{" "}
                    {filteredMembers.length.toLocaleString()}{" "}
                    of{" "}
                    {members.length.toLocaleString()}{" "}
                    members
                  </p>

                  {filteredMembers.length !==
                    members.length && (
                    <p className="text-[11px] font-medium text-sky-600">
                      Filter active
                    </p>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* =====================================================
          ADD MEMBER
      ===================================================== */}

      {addMemberOpen && (
        <MemberForm
          onClose={() =>
            setAddMemberOpen(false)
          }
          onSuccess={handleMemberAdded}
        />
      )}

      {/* =====================================================
          VIEW MEMBER
      ===================================================== */}

      <MemberViewModal
        member={viewMember}
        open={viewMember !== null}
        onClose={handleCloseMemberView}
        onEdit={handleEditEnriched}
        onDelete={handleDeleteEnriched}
      />

      {/* =====================================================
          EDIT MEMBER
      ===================================================== */}

      <MemberEditModal
        member={editMember}
        open={editMember !== null}
        onClose={handleCloseMemberEdit}
        onSuccess={handleMemberUpdated}
      />

      {/* =====================================================
          DELETE MEMBER
      ===================================================== */}

      <MemberDeleteModal
        member={deleteMember}
        open={deleteMember !== null}
        onClose={handleCloseMemberDelete}
        onSuccess={handleMemberDeleted}
      />
    </main>
  );
}

/* =========================================================
   LOADING SKELETON
========================================================= */

function MembersLoading() {
  return (
    <div className="w-full min-w-0">
      <div className="animate-pulse space-y-6">
        {/* HEADER */}

        <div className="flex items-end justify-between">
          <div>
            <div className="h-2.5 w-16 rounded bg-slate-200" />

            <div className="mt-2 h-5 w-28 rounded bg-slate-200" />
          </div>

          <div className="h-3 w-20 rounded bg-slate-100" />
        </div>

        {/* SUMMARY */}

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }).map(
            (_, index) => (
              <div
                key={index}
                className="h-24 rounded-2xl border border-slate-200 bg-white shadow-sm"
              />
            )
          )}
        </div>

        {/* SEARCH */}

        <div className="h-12 rounded-2xl border border-slate-200 bg-white shadow-sm" />

        {/* TABLE / CARDS */}

        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="h-12 border-b border-slate-200 bg-slate-50" />

          {Array.from({ length: 5 }).map(
            (_, index) => (
              <div
                key={index}
                className="h-16 border-b border-slate-100 bg-white"
              />
            )
          )}
        </div>
      </div>
    </div>
  );
}