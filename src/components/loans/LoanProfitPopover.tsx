"use client";

import {
  Calculator,
  ChevronDown,
  Loader2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type { Loan } from "@/lib/loans/types";

export default function LoanProfitPopover() {
  const [open, setOpen] = useState(false);
  const [loans, setLoans] = useState<Loan[]>([]);
  const [loading, setLoading] = useState(false);

  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [rate, setRate] = useState("");

  useEffect(() => {
    if (!open || loans.length > 0) return;

    let cancelled = false;

    async function loadLoans() {
      try {
        setLoading(true);

        const response = await fetch("/api/loans", {
          cache: "no-store",
        });

        if (!response.ok) {
          throw new Error("Failed to load loans.");
        }

        const data = await response.json();

        const receivedLoans = Array.isArray(data)
          ? data
          : Array.isArray(data?.loans)
            ? data.loans
            : [];

        if (!cancelled) {
          setLoans(receivedLoans as Loan[]);
        }
      } catch (error) {
        console.error(
          "Unable to load loans for profit calculator:",
          error,
        );
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadLoans();

    return () => {
      cancelled = true;
    };
  }, [open, loans.length]);

  const result = useMemo(() => {
    const interest = Number(rate);

    if (!Number.isFinite(interest) || interest < 0) {
      return {
        count: 0,
        principal: 0,
        profit: 0,
        total: 0,
      };
    }

    const matchingLoans = loans.filter((loan) => {
      const date = loan.disbursementDate;

      if (
        typeof date !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(date)
      ) {
        return false;
      }

      if (from && date < from) {
        return false;
      }

      if (to && date > to) {
        return false;
      }

      return true;
    });

    const principal = matchingLoans.reduce(
      (sum, loan) =>
        sum + Number(loan.principal || 0),
      0,
    );

    const profit =
      principal * (interest / 100);

    return {
      count: matchingLoans.length,
      principal,
      profit,
      total: principal + profit,
    };
  }, [loans, from, to, rate]);

  const formatKES = (value: number) =>
    new Intl.NumberFormat("en-KE", {
      style: "currency",
      currency: "KES",
      maximumFractionDigits: 0,
    }).format(value);

  return (
    <div className="mb-1">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="
          flex
          w-full
          items-center
          gap-3
          rounded-xl
          px-3.5
          py-3
          text-sm
          text-white/60
          transition
          hover:bg-white/[0.06]
          hover:text-white
        "
      >
        <Calculator
          size={18}
          strokeWidth={1.8}
          className="text-yellow-400"
        />

        <span className="flex-1 text-left">
          Loan profit
        </span>

        <ChevronDown
          size={15}
          strokeWidth={1.8}
          className={`
            text-white/30
            transition-transform
            ${open ? "rotate-180" : ""}
          `}
        />
      </button>

      {open && (
        <div className="px-1 pb-1">
          {loading ? (
            <div className="flex items-center justify-center py-5">
              <Loader2
                size={18}
                className="animate-spin text-yellow-400"
              />
            </div>
          ) : (
            <div
              className="
                rounded-xl
                border
                border-white/[0.08]
                bg-white/[0.025]
                p-3
              "
            >
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="mb-1 block text-[10px] text-white/35">
                    From
                  </label>

                  <input
                    type="date"
                    value={from}
                    onChange={(event) =>
                      setFrom(event.target.value)
                    }
                    className="
                      w-full
                      rounded-lg
                      border
                      border-white/10
                      bg-black/30
                      px-2
                      py-2
                      text-[11px]
                      text-white
                      outline-none
                      focus:border-yellow-500/40
                    "
                  />
                </div>

                <div>
                  <label className="mb-1 block text-[10px] text-white/35">
                    To
                  </label>

                  <input
                    type="date"
                    value={to}
                    onChange={(event) =>
                      setTo(event.target.value)
                    }
                    className="
                      w-full
                      rounded-lg
                      border
                      border-white/10
                      bg-black/30
                      px-2
                      py-2
                      text-[11px]
                      text-white
                      outline-none
                      focus:border-yellow-500/40
                    "
                  />
                </div>
              </div>

              <div className="mt-2">
                <label className="mb-1 block text-[10px] text-white/35">
                  Interest %
                </label>

                <div className="relative">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={rate}
                    onChange={(event) =>
                      setRate(event.target.value)
                    }
                    placeholder="e.g. 15"
                    className="
                      w-full
                      rounded-lg
                      border
                      border-white/10
                      bg-black/30
                      px-2.5
                      py-2
                      pr-7
                      text-xs
                      text-white
                      outline-none
                      placeholder:text-white/20
                      focus:border-yellow-500/40
                    "
                  />

                  <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-white/30">
                    %
                  </span>
                </div>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2">
                <div className="rounded-lg bg-white/[0.035] p-2.5">
                  <p className="text-[9px] uppercase tracking-wide text-white/30">
                    Loans
                  </p>

                  <p className="mt-0.5 text-xs font-semibold text-white">
                    {result.count}
                  </p>
                </div>

                <div className="rounded-lg bg-white/[0.035] p-2.5">
                  <p className="text-[9px] uppercase tracking-wide text-white/30">
                    Principal
                  </p>

                  <p className="mt-0.5 truncate text-xs font-semibold text-white">
                    {formatKES(result.principal)}
                  </p>
                </div>

                <div className="rounded-lg bg-yellow-500/[0.08] p-2.5">
                  <p className="text-[9px] uppercase tracking-wide text-yellow-500/50">
                    Profit
                  </p>

                  <p className="mt-0.5 truncate text-xs font-semibold text-yellow-400">
                    {formatKES(result.profit)}
                  </p>
                </div>

                <div className="rounded-lg bg-white/[0.035] p-2.5">
                  <p className="text-[9px] uppercase tracking-wide text-white/30">
                    Total
                  </p>

                  <p className="mt-0.5 truncate text-xs font-semibold text-white">
                    {formatKES(result.total)}
                  </p>
                </div>
              </div>

              <p className="mt-2 text-center text-[9px] text-white/20">
                Principal × {Number(rate || 0)}% = profit
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}