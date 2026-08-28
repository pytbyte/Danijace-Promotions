"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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

import type { Member } from "@/lib/members/types";

type MembersResponse = {
  success: boolean;
  data?: Member[];
  count?: number;
  error?: string;
};

export default function MembersPage() {
  /* =========================================================
     MEMBERS STATE
  ========================================================= */

  const [members, setMembers] = useState<Member[]>([]);

  const [loading, setLoading] = useState(true);

  const [refreshing, setRefreshing] = useState(false);

  const [error, setError] = useState("");

  const [mounted, setMounted] = useState(false);

  /* =========================================================
     VIEW MEMBER
  ========================================================= */

  const [viewMember, setViewMember] =
    useState<Member | null>(null);

  /* =========================================================
     EDIT MEMBER
  ========================================================= */

  const [editMember, setEditMember] =
    useState<Member | null>(null);

  /* =========================================================
     DELETE MEMBER
  ========================================================= */

  const [deleteMember, setDeleteMember] =
    useState<Member | null>(null);

  /* =========================================================
     SEARCH / FILTER
  ========================================================= */

  const [search, setSearch] = useState("");

  const [status, setStatus] =
    useState<MemberStatusFilter>("all");

  /* =========================================================
     ADD MEMBER
  ========================================================= */

  const [addMemberOpen, setAddMemberOpen] =
    useState(false);

  /* =========================================================
     MOUNT
  ========================================================= */

  useEffect(() => {
    setMounted(true);
  }, []);

  /* =========================================================
     LOAD MEMBERS
  ========================================================= */

  const loadMembers = useCallback(
    async (isRefresh = false) => {
      try {
        if (isRefresh) {
          setRefreshing(true);
        } else {
          setLoading(true);
        }

        setError("");

        const response = await fetch("/api/members", {
          method: "GET",
          cache: "no-store",
          headers: {
            Accept: "application/json",
          },
        });

        let result: MembersResponse;

        try {
          result = await response.json();
        } catch {
          throw new Error(
            "The server returned an invalid response."
          );
        }

        if (!response.ok || !result.success) {
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

  /* =========================================================
     INITIAL LOAD
  ========================================================= */

  useEffect(() => {
    if (!mounted) {
      return;
    }

    loadMembers();
  }, [mounted, loadMembers]);

  /* =========================================================
     REFRESH
  ========================================================= */

  function handleRefresh() {
    if (loading || refreshing) {
      return;
    }

    loadMembers(true);
  }

  /* =========================================================
     ADD MEMBER
  ========================================================= */

  function handleAddMember() {
    setAddMemberOpen(true);
  }

  /* =========================================================
     MEMBER ADDED
  ========================================================= */

  function handleMemberAdded() {
    setAddMemberOpen(false);

    loadMembers(true);
  }

  /* =========================================================
     VIEW MEMBER
  ========================================================= */

  function handleView(member: Member) {
    /* ---------------------------------------------
       Close other actions first
    --------------------------------------------- */

    setEditMember(null);
    setDeleteMember(null);

    /* ---------------------------------------------
       Open view
    --------------------------------------------- */

    setViewMember(member);
  }

  /* =========================================================
     CLOSE VIEW MODAL
  ========================================================= */

  function handleCloseMemberView() {
    setViewMember(null);
  }

  /* =========================================================
     EDIT MEMBER
  ========================================================= */

  function handleEdit(member: Member) {
    /* ---------------------------------------------
       Close other actions first
    --------------------------------------------- */

    setViewMember(null);
    setDeleteMember(null);

    /* ---------------------------------------------
       Open edit
    --------------------------------------------- */

    setEditMember(member);
  }

  /* =========================================================
     CLOSE EDIT MODAL
  ========================================================= */

  function handleCloseMemberEdit() {
    setEditMember(null);
  }

  /* =========================================================
     MEMBER UPDATED
  ========================================================= */

  function handleMemberUpdated() {
    setEditMember(null);

    /*
     * Reload from MongoDB so the page always reflects
     * the actual database state.
     */

    loadMembers(true);
  }

  /* =========================================================
     DELETE MEMBER
  ========================================================= */

  function handleDelete(member: Member) {
    /* ---------------------------------------------
       Close other actions first
    --------------------------------------------- */

    setViewMember(null);
    setEditMember(null);

    /* ---------------------------------------------
       Open delete confirmation
    --------------------------------------------- */

    setDeleteMember(member);
  }

  /* =========================================================
     CLOSE DELETE MODAL
  ========================================================= */

  function handleCloseMemberDelete() {
    setDeleteMember(null);
  }

  /* =========================================================
     MEMBER DELETED
  ========================================================= */

  function handleMemberDeleted() {
    setDeleteMember(null);

    /*
     * Reload from MongoDB after deletion.
     */

    loadMembers(true);
  }

  /* =========================================================
     FILTER MEMBERS
  ========================================================= */

  const filteredMembers = useMemo(() => {
    const query = search.trim().toLowerCase();

    return members.filter((member) => {
      /* ---------------------------------------------
         STATUS FILTER
      --------------------------------------------- */

      if (
        status !== "all" &&
        member.status !== status
      ) {
        return false;
      }

      /* ---------------------------------------------
         SEARCH
      --------------------------------------------- */

      if (!query) {
        return true;
      }

      const fullName = [
        member.firstName,
        member.middleName,
        member.lastName,
      ]
        .filter(Boolean)
        .join(" ");

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
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return searchableText.includes(query);
    });
  }, [members, search, status]);

  /* =========================================================
     SERVER-SAFE INITIAL LOADING
  ========================================================= */

  if (!mounted) {
    return (
      <main className="min-h-[100dvh] w-full overflow-x-clip bg-[#050505] text-white">
        <TopBar />

        <div className="w-full min-w-0 pt-16">
          <div className="mx-auto w-full max-w-[1800px] min-w-0 px-4 py-6 sm:px-6 sm:py-8 lg:px-8 xl:px-10 2xl:px-12">
            <MembersLoading />
          </div>
        </div>
      </main>
    );
  }

  /* =========================================================
     PAGE
  ========================================================= */

  return (
    <main className="min-h-[100dvh] w-full max-w-full overflow-x-clip bg-[#050505] text-white">
      <TopBar />

      {/* =====================================================
          PAGE BODY
      ===================================================== */}

      <div className="w-full min-w-0 pt-16">
        <div
          className="
            mx-auto
            w-full
            min-w-0
            max-w-[1800px]
            px-4
            py-6
            sm:px-6
            sm:py-8
            lg:px-8
            lg:py-10
            xl:px-10
            2xl:px-12
          "
        >
          {/* =================================================
              HEADER
          ================================================= */}

          <section className="mb-6 w-full min-w-0 sm:mb-8">
            <div
              className="
                flex
                w-full
                min-w-0
                flex-col
                gap-5
                lg:flex-row
                lg:items-end
                lg:justify-between
              "
            >
              {/* TITLE */}

              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-2">
                  <Users
                    size={16}
                    strokeWidth={1.8}
                    className="shrink-0 text-yellow-400"
                  />

                  <p className="truncate text-xs font-medium uppercase tracking-[0.22em] text-yellow-500/60">
                    Members
                  </p>
                </div>

                <h1 className="mt-2 truncate text-2xl font-semibold tracking-tight text-white sm:text-3xl">
                  Member Management
                </h1>

                <p className="mt-2 max-w-2xl text-sm leading-6 text-white/35">
                  Manage registered members, view their
                  information and maintain membership
                  records.
                </p>
              </div>

              {/* ACTIONS */}

              <div
                className="
                  flex
                  w-full
                  min-w-0
                  shrink-0
                  items-center
                  gap-2
                  lg:w-auto
                "
              >
                <button
                  type="button"
                  onClick={handleRefresh}
                  disabled={
                    loading || refreshing
                  }
                  className="
                    flex
                    h-11
                    w-11
                    shrink-0
                    items-center
                    justify-center
                    rounded-xl
                    border
                    border-white/[0.08]
                    bg-white/[0.025]
                    text-white/45
                    transition
                    hover:border-white/[0.12]
                    hover:bg-white/[0.05]
                    hover:text-white
                    disabled:cursor-not-allowed
                    disabled:opacity-40
                  "
                  aria-label="Refresh members"
                  title="Refresh members"
                >
                  <RefreshCw
                    size={17}
                    strokeWidth={1.8}
                    className={
                      refreshing
                        ? "animate-spin"
                        : ""
                    }
                  />
                </button>

                <button
                  type="button"
                  onClick={handleAddMember}
                  className="
                    flex
                    h-11
                    min-w-0
                    flex-1
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
                    lg:w-auto
                    lg:flex-none
                  "
                >
                  <Plus
                    size={17}
                    strokeWidth={2}
                    className="shrink-0"
                  />

                  <span className="truncate">
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
            <section className="mb-6 w-full min-w-0">
              <div
                className="
                  flex
                  w-full
                  min-w-0
                  flex-col
                  gap-4
                  rounded-2xl
                  border
                  border-red-500/15
                  bg-red-500/[0.05]
                  p-4
                  sm:flex-row
                  sm:items-center
                  sm:justify-between
                  sm:px-5
                "
              >
                <div className="flex min-w-0 items-start gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-red-500/10 text-red-400">
                    <AlertCircle
                      size={18}
                      strokeWidth={1.8}
                    />
                  </div>

                  <div className="min-w-0">
                    <p className="text-sm font-medium text-red-300">
                      Unable to load members
                    </p>

                    <p className="mt-1 break-words text-xs leading-5 text-red-300/50">
                      {error}
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => loadMembers()}
                  className="
                    h-10
                    shrink-0
                    rounded-xl
                    border
                    border-red-400/10
                    bg-red-400/[0.06]
                    px-4
                    text-xs
                    font-medium
                    text-red-300
                    transition
                    hover:bg-red-400/10
                  "
                >
                  Try again
                </button>
              </div>
            </section>
          )}

          {/* =================================================
              CONTENT
          ================================================= */}

          {loading ? (
            <MembersLoading />
          ) : (
            <>
              {/* =================================================
                  SUMMARY
              ================================================= */}

              <div className="mt-6 w-full min-w-0 overflow-hidden">
                <MemberSummary members={members} />
              </div>

              {/* =================================================
                  SEARCH
              ================================================= */}

              {!loading && !error && (
                <MemberSearch
                  search={search}
                  status={status}
                  onSearchChange={setSearch}
                  onStatusChange={setStatus}
                />
              )}

              {/* =================================================
                  DIRECTORY
              ================================================= */}

              <section className="mt-6 w-full min-w-0 overflow-hidden">
                <MemberTable
                  members={filteredMembers}
                  onView={handleView}
                  onEdit={handleEdit}
                  onDelete={handleDelete}
                />

                <MemberList
                  members={filteredMembers}
                  onView={handleView}
                  onEdit={handleEdit}
                  onDelete={handleDelete}
                />
              </section>

              {/* =================================================
                  NO SEARCH RESULTS
              ================================================= */}

              {members.length > 0 &&
                filteredMembers.length === 0 && (
                  <section className="mt-6 w-full min-w-0">
                    <div
                      className="
                        flex
                        min-h-[220px]
                        w-full
                        items-center
                        justify-center
                        rounded-2xl
                        border
                        border-white/[0.08]
                        bg-white/[0.025]
                        p-6
                      "
                    >
                      <div className="max-w-md text-center">
                        <div
                          className="
                            mx-auto
                            flex
                            h-12
                            w-12
                            items-center
                            justify-center
                            rounded-2xl
                            border
                            border-white/[0.08]
                            bg-white/[0.03]
                            text-white/25
                          "
                        >
                          <Users
                            size={21}
                            strokeWidth={1.5}
                          />
                        </div>

                        <h2 className="mt-4 text-sm font-semibold text-white/60">
                          No matching members
                        </h2>

                        <p className="mt-2 text-xs leading-5 text-white/25">
                          No members match your current
                          search or status filter.
                        </p>

                        <button
                          type="button"
                          onClick={() => {
                            setSearch("");
                            setStatus("all");
                          }}
                          className="
                            mt-5
                            inline-flex
                            min-h-10
                            items-center
                            justify-center
                            rounded-xl
                            border
                            border-yellow-500/20
                            bg-yellow-500/10
                            px-4
                            text-xs
                            font-medium
                            text-yellow-400
                            transition
                            hover:border-yellow-500/30
                            hover:bg-yellow-500/15
                          "
                        >
                          Clear filters
                        </button>
                      </div>
                    </div>
                  </section>
                )}

              {/* =================================================
                  EMPTY DIRECTORY
              ================================================= */}

              {members.length === 0 &&
                !error && (
                  <section className="mt-6 w-full min-w-0">
                    <div
                      className="
                        w-full
                        overflow-hidden
                        rounded-2xl
                        border
                        border-yellow-500/10
                        bg-yellow-500/[0.025]
                        p-5
                        sm:p-6
                      "
                    >
                      <div
                        className="
                          flex
                          min-w-0
                          flex-col
                          gap-4
                          sm:flex-row
                          sm:items-center
                          sm:justify-between
                        "
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-white/70">
                            Your member directory is
                            empty
                          </p>

                          <p className="mt-1 text-xs leading-5 text-white/30">
                            Start by registering the
                            first member of your SACCO.
                          </p>
                        </div>

                        <button
                          type="button"
                          onClick={handleAddMember}
                          className="
                            flex
                            h-10
                            w-full
                            shrink-0
                            items-center
                            justify-center
                            gap-2
                            rounded-xl
                            bg-yellow-500
                            px-4
                            text-xs
                            font-semibold
                            text-black
                            transition
                            hover:bg-yellow-400
                            sm:w-auto
                          "
                        >
                          <Plus
                            size={16}
                            strokeWidth={2}
                          />

                          Add First Member
                        </button>
                      </div>
                    </div>
                  </section>
                )}

              {/* =================================================
                  FOOTER
              ================================================= */}

              {members.length > 0 && (
                <div
                  className="
                    mt-5
                    flex
                    w-full
                    min-w-0
                    flex-col
                    gap-1
                    px-1
                    sm:flex-row
                    sm:items-center
                    sm:justify-between
                  "
                >
                  <p className="text-[10px] text-white/20">
                    Showing{" "}
                    {filteredMembers.length.toLocaleString()}{" "}
                    of{" "}
                    {members.length.toLocaleString()}{" "}
                    {members.length === 1
                      ? "member"
                      : "members"}
                  </p>

                  <p className="text-[10px] text-white/20">
                    Data synchronized with MongoDB
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* =====================================================
          ADD MEMBER MODAL
      ===================================================== */}

      {addMemberOpen && (
        <MemberForm
          onClose={() => setAddMemberOpen(false)}
          onSuccess={handleMemberAdded}
        />
      )}

      {/* =====================================================
          VIEW MEMBER MODAL
      ===================================================== */}

      <MemberViewModal
        member={viewMember}
        open={viewMember !== null}
        onClose={handleCloseMemberView}
      />

      {/* =====================================================
          EDIT MEMBER MODAL
      ===================================================== */}

      <MemberEditModal
        member={editMember}
        open={editMember !== null}
        onClose={handleCloseMemberEdit}
        onSuccess={handleMemberUpdated}
      />

      {/* =====================================================
          DELETE MEMBER MODAL
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
   LOADING
========================================================= */

function MembersLoading() {
  return (
    <div className="w-full min-w-0 space-y-5 overflow-hidden sm:space-y-6">
      {/* SUMMARY */}

      <section className="grid w-full min-w-0 grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }).map(
          (_, index) => (
            <div
              key={index}
              className="
                h-[125px]
                min-w-0
                overflow-hidden
                animate-pulse
                rounded-2xl
                border
                border-white/[0.06]
                bg-white/[0.025]
              "
            />
          )
        )}
      </section>

      {/* DESKTOP */}

      <div
        className="
          hidden
          w-full
          min-w-0
          overflow-hidden
          rounded-2xl
          border
          border-white/[0.08]
          bg-white/[0.025]
          lg:block
        "
      >
        <div className="h-20 animate-pulse border-b border-white/[0.06] bg-white/[0.02]" />

        <div className="space-y-1 p-3">
          {Array.from({ length: 5 }).map(
            (_, index) => (
              <div
                key={index}
                className="h-16 w-full animate-pulse rounded-xl bg-white/[0.02]"
              />
            )
          )}
        </div>
      </div>

      {/* MOBILE */}

      <div className="grid w-full min-w-0 gap-3 overflow-hidden lg:hidden">
        {Array.from({ length: 3 }).map(
          (_, index) => (
            <div
              key={index}
              className="
                h-[235px]
                min-w-0
                w-full
                animate-pulse
                rounded-2xl
                border
                border-white/[0.06]
                bg-white/[0.025]
              "
            />
          )
        )}
      </div>
    </div>
  );
}