"use client";

import {
  Check,
  Loader2,
  Search,
  UserRound,
  X,
} from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
} from "react";

import type { Member } from "@/lib/members/types";

/* =========================================================
   TYPES
========================================================= */

type SavingsMemberSelectorProps = {
  value: Member | null;
  onChange: (member: Member | null) => void;
  disabled?: boolean;
};

/* =========================================================
   CONSTANTS
========================================================= */

const SEARCH_DELAY = 300;
const SEARCH_LIMIT = 10;

/* =========================================================
   COMPONENT
========================================================= */

export default function SavingsMemberSelector({
  value,
  onChange,
  disabled = false,
}: SavingsMemberSelectorProps) {
  const [query, setQuery] =
    useState("");

  const [members, setMembers] =
    useState<Member[]>([]);

  const [loading, setLoading] =
    useState(false);

  const [error, setError] =
    useState<string | null>(null);

  const [open, setOpen] =
    useState(false);

  const containerRef =
    useRef<HTMLDivElement>(null);

  const requestId =
    useRef(0);

  /* =======================================================
     SELECTED MEMBER
  ======================================================= */

  useEffect(() => {
    if (value) {
      setQuery(
        [
          value.membershipNumber,
          `${value.firstName} ${value.lastName}`,
        ]
          .filter(Boolean)
          .join(" • ")
      );
    } else {
      setQuery("");
    }
  }, [value]);

  /* =======================================================
     SEARCH
  ======================================================= */

  useEffect(() => {
    if (value) {
      return;
    }

    const cleanQuery =
      query.trim();

    if (!cleanQuery) {
      setMembers([]);
      setError(null);
      setLoading(false);
      return;
    }

    const timeout =
      window.setTimeout(
        async () => {
          const currentRequest =
            ++requestId.current;

          setLoading(true);
          setError(null);

          try {
            const response =
              await fetch(
                `/api/members?search=${encodeURIComponent(
                  cleanQuery
                )}&page=1&limit=${SEARCH_LIMIT}`,
                {
                  method: "GET",
                  cache: "no-store",
                }
              );

            let result:
              | {
                  success?: boolean;
                  data?: Member[];
                  error?: string;
                }
              | null = null;

            try {
              result =
                await response.json();
            } catch {
              result = null;
            }

            /*
             * Ignore stale responses.
             *
             * A slower previous request must never
             * overwrite results from a newer search.
             */
            if (
              currentRequest !==
              requestId.current
            ) {
              return;
            }

            if (
              !response.ok ||
              !result?.success
            ) {
              throw new Error(
                result?.error ||
                  "Failed to search members."
              );
            }

            setMembers(
              Array.isArray(
                result.data
              )
                ? result.data
                : []
            );

            setOpen(true);
          } catch (searchError) {
            if (
              currentRequest !==
              requestId.current
            ) {
              return;
            }

            console.error(
              "Savings member search error:",
              searchError
            );

            setMembers([]);

            setError(
              searchError instanceof Error
                ? searchError.message
                : "Failed to search members."
            );
          } finally {
            if (
              currentRequest ===
              requestId.current
            ) {
              setLoading(false);
            }
          }
        },
        SEARCH_DELAY
      );

    return () => {
      window.clearTimeout(
        timeout
      );
    };
  }, [query, value]);

  /* =======================================================
     CLOSE DROPDOWN WHEN CLICKING OUTSIDE
  ======================================================= */

  useEffect(() => {
    function handlePointerDown(
      event: MouseEvent
    ) {
      if (
        !containerRef.current?.contains(
          event.target as Node
        )
      ) {
        setOpen(false);
      }
    }

    document.addEventListener(
      "mousedown",
      handlePointerDown
    );

    return () => {
      document.removeEventListener(
        "mousedown",
        handlePointerDown
      );
    };
  }, []);

  /* =======================================================
     SELECT
  ======================================================= */

  function handleSelect(
    member: Member
  ) {
    onChange(member);
    setOpen(false);
    setError(null);
  }

  /* =======================================================
     CLEAR
  ======================================================= */

  function handleClear() {
    if (disabled) {
      return;
    }

    requestId.current += 1;

    onChange(null);
    setQuery("");
    setMembers([]);
    setError(null);
    setOpen(false);
  }

  /* =======================================================
     RENDER
  ======================================================= */

  return (
    <div
      ref={containerRef}
      className="relative"
    >
      <label
        htmlFor="savings-member-search"
        className="mb-2 block text-xs font-medium text-white/55"
      >
        Member
      </label>

      {/* ===================================================
          INPUT
      =================================================== */}

      <div className="relative">
        <Search
          size={16}
          strokeWidth={1.8}
          className="
            pointer-events-none
            absolute
            left-3
            top-1/2
            -translate-y-1/2
            text-white/25
          "
        />

        <input
          id="savings-member-search"
          type="text"
          value={query}
          onChange={(event) => {
            if (value) {
              return;
            }

            setQuery(
              event.target.value
            );
            setOpen(true);
          }}
          onFocus={() => {
            if (
              !value &&
              members.length > 0
            ) {
              setOpen(true);
            }
          }}
          placeholder="Search by name, membership number or phone"
          autoComplete="off"
          disabled={disabled}
          className="
            h-12
            w-full
            rounded-xl
            border
            border-white/[0.08]
            bg-black
            pl-10
            pr-10
            text-sm
            text-white
            outline-none
            placeholder:text-white/20
            focus:border-yellow-500/40
            disabled:cursor-not-allowed
            disabled:opacity-50
          "
        />

        {loading && !value && (
          <Loader2
            size={16}
            className="
              absolute
              right-3
              top-1/2
              -translate-y-1/2
              animate-spin
              text-yellow-400
            "
          />
        )}

        {value && !disabled && (
          <button
            type="button"
            onClick={handleClear}
            className="
              absolute
              right-2
              top-1/2
              flex
              h-8
              w-8
              -translate-y-1/2
              items-center
              justify-center
              rounded-lg
              text-white/30
              transition
              hover:bg-white/[0.05]
              hover:text-white
            "
            aria-label="Clear selected member"
          >
            <X
              size={15}
              strokeWidth={1.8}
            />
          </button>
        )}
      </div>

      {/* ===================================================
          SELECTED MEMBER
      =================================================== */}

      {value && (
        <div className="mt-2 flex items-center gap-3 rounded-xl border border-yellow-500/10 bg-yellow-500/[0.04] px-3 py-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-yellow-500/10 text-yellow-400">
            <UserRound
              size={17}
              strokeWidth={1.8}
            />
          </div>

          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-white">
              {[
                value.firstName,
                value.middleName,
                value.lastName,
              ]
                .filter(Boolean)
                .join(" ")}
            </p>

            <p className="mt-0.5 truncate text-[11px] text-white/35">
              {value.membershipNumber}
              {value.phone
                ? ` • ${value.phone}`
                : ""}
            </p>
          </div>

          <Check
            size={17}
            strokeWidth={2}
            className="shrink-0 text-emerald-400"
          />
        </div>
      )}

      {/* ===================================================
          SEARCH RESULTS
      =================================================== */}

      {!value &&
        open &&
        query.trim() && (
          <div className="absolute left-0 right-0 top-full z-20 mt-2 overflow-hidden rounded-xl border border-white/[0.08] bg-[#101010] shadow-2xl">
            {loading && (
              <div className="flex items-center justify-center gap-2 px-4 py-5 text-xs text-white/30">
                <Loader2
                  size={15}
                  className="animate-spin"
                />

                <span>
                  Searching members...
                </span>
              </div>
            )}

            {!loading &&
              error && (
                <div className="px-4 py-4 text-xs leading-5 text-red-400">
                  {error}
                </div>
              )}

            {!loading &&
              !error &&
              members.length === 0 && (
                <div className="px-4 py-5 text-center text-xs text-white/30">
                  No members found.
                </div>
              )}

            {!loading &&
              !error &&
              members.length > 0 && (
                <div className="max-h-64 overflow-y-auto">
                  {members.map(
                    (member) => {
                      const name = [
                        member.firstName,
                        member.middleName,
                        member.lastName,
                      ]
                        .filter(Boolean)
                        .join(" ");

                      return (
                        <button
                          key={
                            member._id ||
                            member.membershipNumber
                          }
                          type="button"
                          onClick={() =>
                            handleSelect(
                              member
                            )
                          }
                          className="
                            flex
                            w-full
                            items-center
                            gap-3
                            border-b
                            border-white/[0.05]
                            px-4
                            py-3
                            text-left
                            transition
                            last:border-b-0
                            hover:bg-white/[0.04]
                          "
                        >
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/[0.04] text-white/35">
                            <UserRound
                              size={16}
                              strokeWidth={1.8}
                            />
                          </div>

                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-white/80">
                              {name}
                            </p>

                            <p className="mt-0.5 truncate text-[11px] text-white/30">
                              {member.membershipNumber}

                              {member.phone
                                ? ` • ${member.phone}`
                                : ""}
                            </p>
                          </div>
                        </button>
                      );
                    }
                  )}
                </div>
              )}
          </div>
        )}
    </div>
  );
}