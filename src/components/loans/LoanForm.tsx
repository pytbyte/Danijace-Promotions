"use client";

import {
  AlertCircle,
  CalendarDays,
  CheckCircle2,
  CircleDollarSign,
  Loader2,
  Search,
  UserRound,
  X,
} from "lucide-react";
import {
  FormEvent,
  useEffect,
  useMemo,
  useState,
} from "react";

import type {
  CreateLoanInput,
  Loan,
  LoanSettings,
  LoanType,
} from "@/lib/loans/types";

import type { Member } from "@/lib/members/types";

/* =========================================================
   PROPS
========================================================= */

interface LoanFormProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: (loan: Loan) => void;

  /**
   * Optional member supplied by another part of the UI.
   *
   * When supplied, the member selector is locked to
   * that member.
   */
  memberId?: string;
}

/* =========================================================
   API TYPES
========================================================= */

type MembersResponse = {
  success: boolean;
  data?: Member[];
  error?: string;
};

type MemberResponse = {
  success: boolean;
  data?: Member;
  error?: string;
};

type SavingsAccount = {
  id?: string;
  _id?: string;
  accountNumber?: string;
  accountType?: string;
  balance?: number;
  isActive?: boolean;
  status?: string;
};

type SavingsAccountResponse = {
  success: boolean;
  data?: SavingsAccount | null;
  error?: string;
};

type LoanSettingsResponse = {
  success: boolean;
  data?: LoanSettings;
  error?: string;
};

type LoanApiResponse = {
  success: boolean;
  data?: Loan;
  error?: string;
};

/* =========================================================
   HELPERS
========================================================= */

function getMemberId(
  member: Member | null,
): string {
  if (!member) {
    return "";
  }

  const value = member._id;

  return typeof value === "string"
    ? value.trim()
    : "";
}

function getMemberFullName(
  member: Member,
): string {
  return [
    member.firstName,
    member.middleName,
    member.lastName,
  ]
    .filter(
      (value): value is string =>
        typeof value === "string" &&
        value.trim().length > 0,
    )
    .map((value) => value.trim())
    .join(" ")
    .trim();
}

function formatKES(
  value: number,
): string {
  if (
    !Number.isFinite(value)
  ) {
    return "KES 0.00";
  }

  return new Intl.NumberFormat(
    "en-KE",
    {
      style: "currency",
      currency: "KES",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    },
  ).format(value);
}

function parseMoney(
  value: string,
): number | null {
  const cleaned =
    value.replace(/,/g, "").trim();

  if (!cleaned) {
    return null;
  }

  const amount = Number(cleaned);

  if (
    !Number.isFinite(amount) ||
    amount <= 0
  ) {
    return null;
  }

  return Math.round(
    (amount + Number.EPSILON) * 100,
  ) / 100;
}

function getDefaultDate(): string {
  const now = new Date();

  const year =
    now.getFullYear();

  const month =
    String(
      now.getMonth() + 1,
    ).padStart(2, "0");

  const day =
    String(
      now.getDate(),
    ).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function addDays(
  date: string,
  days: number,
): string {
  const result =
    new Date(
      `${date}T00:00:00`,
    );

  if (
    Number.isNaN(
      result.getTime(),
    )
  ) {
    return "";
  }

  result.setDate(
    result.getDate() + days,
  );

  const year =
    result.getFullYear();

  const month =
    String(
      result.getMonth() + 1,
    ).padStart(2, "0");

  const day =
    String(
      result.getDate(),
    ).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

/* =========================================================
   COMPONENT
========================================================= */

export default function LoanForm({
  open,
  onClose,
  onSuccess,
  memberId = "",
}: LoanFormProps) {
  /* =======================================================
     MEMBER
  ======================================================= */

  const [member, setMember] =
    useState<Member | null>(null);

  const [members, setMembers] =
    useState<Member[]>([]);

  const [memberSearch, setMemberSearch] =
    useState("");

  const [loadingMembers, setLoadingMembers] =
    useState(false);

  /* =======================================================
     SAVINGS
  ======================================================= */

  const [
    savingsAccount,
    setSavingsAccount,
  ] = useState<SavingsAccount | null>(
    null,
  );

  const [
    loadingSavings,
    setLoadingSavings,
  ] = useState(false);

  /* =======================================================
     SETTINGS
  ======================================================= */

  const [
    settings,
    setSettings,
  ] = useState<LoanSettings | null>(
    null,
  );

  const [
    loadingSettings,
    setLoadingSettings,
  ] = useState(false);

  /* =======================================================
     FORM
  ======================================================= */

  const [type, setType] =
    useState<LoanType>("regular");

  const [principal, setPrincipal] =
    useState("");

  const [dailyFine, setDailyFine] =
    useState("");

  const [
    disbursementDate,
    setDisbursementDate,
  ] = useState(
    getDefaultDate(),
  );

  /* =======================================================
     GUARANTOR
  ======================================================= */

  const [guarantorName, setGuarantorName] =
    useState("");

  const [guarantorPhone, setGuarantorPhone] =
    useState("");

  const [guarantorIdNumber, setGuarantorIdNumber] =
    useState("");

  /* =======================================================
     STATE
  ======================================================= */

  const [error, setError] =
    useState<string | null>(null);

  const [submitting, setSubmitting] =
    useState(false);

  /* =======================================================
     RESET
  ======================================================= */

  function resetForm() {
    setMember(null);
    setMembers([]);
    setMemberSearch("");

    setSavingsAccount(null);
    setSettings(null);

    setType("regular");
    setPrincipal("");
    setDailyFine("");

    setDisbursementDate(
      getDefaultDate(),
    );

    setGuarantorName("");
    setGuarantorPhone("");
    setGuarantorIdNumber("");

    setError(null);

    setLoadingMembers(false);
    setLoadingSavings(false);
    setLoadingSettings(false);
    setSubmitting(false);
  }

  /* =======================================================
     LOAD SETTINGS
  ======================================================= */

  useEffect(() => {
    if (!open) {
      return;
    }

    let cancelled = false;

    async function loadSettings() {
      setLoadingSettings(true);

      try {
        /*
         * The settings route is intentionally isolated from
         * the create-loan route.
         *
         * If your route uses a different path, only this
         * fetch URL needs to change.
         */
        const response =
          await fetch(
            "/api/loans/settings",
            {
              method: "GET",
              cache: "no-store",
              headers: {
                Accept:
                  "application/json",
              },
            },
          );

        let result:
          | LoanSettingsResponse
          | null = null;

        try {
          result =
            await response.json();
        } catch {
          result = null;
        }

        if (cancelled) {
          return;
        }

        if (
          !response.ok ||
          !result?.success ||
          !result.data
        ) {
          throw new Error(
            result?.error ||
              "Unable to load loan settings.",
          );
        }

        setSettings(
          result.data,
        );
      } catch (loadError) {
        if (cancelled) {
          return;
        }

        console.error(
          "Loan settings loading error:",
          loadError,
        );

        /*
         * Do not silently invent settings.
         *
         * The service itself has defaults, but the UI should
         * not present a potentially inaccurate preview.
         */
        setSettings(null);

        setError(
          loadError instanceof Error
            ? loadError.message
            : "Unable to load loan settings.",
        );
      } finally {
        if (!cancelled) {
          setLoadingSettings(false);
        }
      }
    }

    loadSettings();

    return () => {
      cancelled = true;
    };
  }, [open]);

  /* =======================================================
     LOAD PRESELECTED MEMBER
  ======================================================= */

  useEffect(() => {
    if (!open) {
      return;
    }

    const cleanMemberId =
      memberId.trim();

    if (!cleanMemberId) {
      return;
    }

    let cancelled = false;

    async function loadSelectedMember() {
      try {
        setError(null);

        const response =
          await fetch(
            `/api/members?search=${encodeURIComponent(
              cleanMemberId,
            )}&page=1&limit=10`,
            {
              method: "GET",
              cache: "no-store",
              headers: {
                Accept:
                  "application/json",
              },
            },
          );

        let result:
          | MembersResponse
          | null = null;

        try {
          result =
            await response.json();
        } catch {
          result = null;
        }

        if (cancelled) {
          return;
        }

        if (
          !response.ok ||
          !result?.success ||
          !Array.isArray(
            result.data,
          )
        ) {
          throw new Error(
            result?.error ||
              "Unable to load member.",
          );
        }

        const found =
          result.data.find(
            (item) =>
              item._id ===
              cleanMemberId,
          );

        if (!found) {
          throw new Error(
            "The selected member could not be found.",
          );
        }

        setMember(found);
      } catch (loadError) {
        if (cancelled) {
          return;
        }

        console.error(
          "Loan member loading error:",
          loadError,
        );

        setMember(null);

        setError(
          loadError instanceof Error
            ? loadError.message
            : "Unable to load member.",
        );
      }
    }

    loadSelectedMember();

    return () => {
      cancelled = true;
    };
  }, [open, memberId]);

  /* =======================================================
     MEMBER SEARCH
  ======================================================= */

  useEffect(() => {
    if (!open) {
      return;
    }

    /*
     * When a member was supplied by the parent, there is
     * no reason to search for another member.
     */
    if (memberId.trim()) {
      return;
    }

    let cancelled = false;

    async function searchMembers() {
      const query =
        memberSearch.trim();

      if (!query) {
        setMembers([]);
        return;
      }

      setLoadingMembers(true);

      try {
        const response =
          await fetch(
            `/api/members?search=${encodeURIComponent(
              query,
            )}&page=1&limit=20`,
            {
              method: "GET",
              cache: "no-store",
              headers: {
                Accept:
                  "application/json",
              },
            },
          );

        let result:
          | MembersResponse
          | null = null;

        try {
          result =
            await response.json();
        } catch {
          result = null;
        }

        if (cancelled) {
          return;
        }

        if (
          !response.ok ||
          !result?.success
        ) {
          throw new Error(
            result?.error ||
              "Unable to search members.",
          );
        }

        setMembers(
          Array.isArray(
            result.data,
          )
            ? result.data.filter(
                (item) =>
                  item.status ===
                  "active",
              )
            : [],
        );
      } catch (searchError) {
        if (cancelled) {
          return;
        }

        console.error(
          "Loan member search error:",
          searchError,
        );

        setMembers([]);

        setError(
          searchError instanceof Error
            ? searchError.message
            : "Unable to search members.",
        );
      } finally {
        if (!cancelled) {
          setLoadingMembers(false);
        }
      }
    }

    const timer =
      window.setTimeout(
        searchMembers,
        250,
      );

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    open,
    memberSearch,
    memberId,
  ]);

  /* =======================================================
     LOAD SAVINGS ACCOUNT
  ======================================================= */

  useEffect(() => {
    if (!open) {
      return;
    }

    const selectedMemberId =
      getMemberId(member);

    if (!selectedMemberId) {
      setSavingsAccount(null);
      setLoadingSavings(false);
      return;
    }

    let cancelled = false;

    async function loadSavingsAccount() {
      setLoadingSavings(true);

      try {
        const response =
          await fetch(
            `/api/savings/accounts?memberId=${encodeURIComponent(
              selectedMemberId,
            )}`,
            {
              method: "GET",
              cache: "no-store",
              headers: {
                Accept:
                  "application/json",
              },
            },
          );

        let result:
          | SavingsAccountResponse
          | null = null;

        try {
          result =
            await response.json();
        } catch {
          result = null;
        }

        if (cancelled) {
          return;
        }

        if (!response.ok) {
          throw new Error(
            result?.error ||
              "Unable to load savings account.",
          );
        }

        if (!result?.success) {
          throw new Error(
            result?.error ||
              "Unable to load savings account.",
          );
        }

        setSavingsAccount(
          result.data || null,
        );
      } catch (accountError) {
        if (cancelled) {
          return;
        }

        console.error(
          "Loan savings account loading error:",
          accountError,
        );

        setSavingsAccount(null);

        setError(
          accountError instanceof Error
            ? accountError.message
            : "Unable to load savings account.",
        );
      } finally {
        if (!cancelled) {
          setLoadingSavings(false);
        }
      }
    }

    loadSavingsAccount();

    return () => {
      cancelled = true;
    };
  }, [open, member]);

  /* =======================================================
     ELIGIBILITY
  ======================================================= */

  const savingsBalance =
    typeof savingsAccount?.balance ===
      "number" &&
    Number.isFinite(
      savingsAccount.balance,
    )
      ? savingsAccount.balance
      : 0;

  const regularEligible =
    Boolean(
      settings &&
        savingsBalance >=
          settings.regularMinimumSavings,
    );

  const maximumRegularLoan =
    settings
      ? Math.max(
          0,
          savingsBalance *
            settings.regularSavingsMultiplier,
        )
      : 0;

  const parsedPrincipal =
    parseMoney(principal);

  const calculatedInterest =
    parsedPrincipal !== null &&
    settings
      ? parsedPrincipal *
        (type === "emergency"
          ? settings.emergencyInterestRate
          : settings.regularInterestRate)
      : 0;

  const calculatedTotalDue =
    parsedPrincipal !== null
      ? parsedPrincipal +
        calculatedInterest
      : 0;

  const calculatedFine =
    dailyFine.trim()
      ? parseMoney(dailyFine) || 0
      : settings?.defaultDailyFine || 0;

  const calculatedDueDate =
    settings &&
    disbursementDate
      ? addDays(
          disbursementDate,
          settings.repaymentGraceDays,
        )
      : "";

  const exceedsRegularLimit =
    type === "regular" &&
    parsedPrincipal !== null &&
    parsedPrincipal >
      maximumRegularLoan;

  const belowRegularMinimum =
    type === "regular" &&
    settings !== null &&
    savingsBalance <
      settings.regularMinimumSavings;

  /* =======================================================
     MEMBER SELECTION
  ======================================================= */

  function handleSelectMember(
    selectedMember: Member,
  ) {
    if (submitting) {
      return;
    }

    if (
      selectedMember.status !==
      "active"
    ) {
      setError(
        "Only active members can receive loans.",
      );

      return;
    }

    setMember(
      selectedMember,
    );

    setMemberSearch("");
    setMembers([]);
    setError(null);
  }

  function clearMember() {
    if (
      submitting ||
      memberId.trim()
    ) {
      return;
    }

    setMember(null);
    setSavingsAccount(null);
    setMemberSearch("");
    setError(null);
  }

  /* =======================================================
     TYPE CHANGE
  ======================================================= */

  function handleTypeChange(
    nextType: LoanType,
  ) {
    if (submitting) {
      return;
    }

    setType(nextType);
    setError(null);

    /*
     * Emergency and regular loans use different rates.
     * The preview updates automatically.
     */
  }

  /* =======================================================
     SUBMIT
  ======================================================= */

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    if (submitting) {
      return;
    }

    setError(null);

    /* -----------------------------------------------------
       MEMBER
    ----------------------------------------------------- */

    const selectedMember =
      member;

    if (!selectedMember) {
      setError(
        "Select a member before creating the loan.",
      );

      return;
    }

    const selectedMemberId =
      getMemberId(
        selectedMember,
      );

    if (!selectedMemberId) {
      setError(
        "Selected member has no valid member ID.",
      );

      return;
    }

    if (
      selectedMember.status !==
      "active"
    ) {
      setError(
        "Only active members can receive loans.",
      );

      return;
    }

    /* -----------------------------------------------------
       SAVINGS ACCOUNT
    ----------------------------------------------------- */

    if (
      type === "regular" &&
      !savingsAccount
    ) {
      setError(
        "The member does not have an active fixed savings account.",
      );

      return;
    }

    if (
      type === "regular" &&
      savingsAccount
    ) {
      const accountStatus =
        savingsAccount.status;

      const active =
        savingsAccount.isActive !==
          false &&
        accountStatus !==
          "inactive";

      if (!active) {
        setError(
          "The member's fixed savings account is inactive.",
        );

        return;
      }
    }

    /* -----------------------------------------------------
       SETTINGS
    ----------------------------------------------------- */

    if (!settings) {
      setError(
        "Loan settings are not available. Please refresh and try again.",
      );

      return;
    }

    /* -----------------------------------------------------
       TYPE ENABLED
    ----------------------------------------------------- */

    if (
      type === "emergency" &&
      !settings.emergencyLoansEnabled
    ) {
      setError(
        "Emergency loans are currently disabled.",
      );

      return;
    }

    if (
      type === "regular" &&
      !settings.regularLoansEnabled
    ) {
      setError(
        "Regular loans are currently disabled.",
      );

      return;
    }

    /* -----------------------------------------------------
       PRINCIPAL
    ----------------------------------------------------- */

    const amount =
      parseMoney(principal);

    if (amount === null) {
      setError(
        "Enter a valid loan amount greater than zero.",
      );

      return;
    }

    /* -----------------------------------------------------
       REGULAR ELIGIBILITY
    ----------------------------------------------------- */

    if (
      type === "regular" &&
      belowRegularMinimum
    ) {
      setError(
        `Regular loan requires minimum savings of ${formatKES(
          settings.regularMinimumSavings,
        )}.`,
      );

      return;
    }

    if (
      type === "regular" &&
      exceedsRegularLimit
    ) {
      setError(
        `Regular loan cannot exceed ${formatKES(
          maximumRegularLoan,
        )} based on the member's current savings.`,
      );

      return;
    }

    /* -----------------------------------------------------
       DAILY FINE
    ----------------------------------------------------- */

    let customDailyFine:
      | number
      | undefined;

    if (
      dailyFine.trim()
    ) {
      customDailyFine =
        parseMoney(
          dailyFine,
        ) ?? undefined;

      if (
        customDailyFine ===
        undefined
      ) {
        setError(
          "Enter a valid daily fine or leave it blank to use the configured default.",
        );

        return;
      }
    }

    /* -----------------------------------------------------
       DATE
    ----------------------------------------------------- */

    if (
      !disbursementDate
    ) {
      setError(
        "Disbursement date is required.",
      );

      return;
    }

    const parsedDate =
      new Date(
        `${disbursementDate}T00:00:00`,
      );

    if (
      Number.isNaN(
        parsedDate.getTime(),
      )
    ) {
      setError(
        "Enter a valid disbursement date.",
      );

      return;
    }

    /* -----------------------------------------------------
       GUARANTOR
    ----------------------------------------------------- */

    const cleanGuarantorName =
      guarantorName.trim();

    const cleanGuarantorPhone =
      guarantorPhone.trim();

    const cleanGuarantorId =
      guarantorIdNumber.trim();

    if (!cleanGuarantorName) {
      setError(
        "Guarantor name is required.",
      );

      return;
    }

    if (!cleanGuarantorPhone) {
      setError(
        "Guarantor phone number is required.",
      );

      return;
    }

    /* -----------------------------------------------------
       BUILD INPUT
    ----------------------------------------------------- */

    const input: CreateLoanInput = {
      memberId:
        selectedMemberId,

      type,

      principal:
        amount,

      guarantor: {
        name:
          cleanGuarantorName,

        phone:
          cleanGuarantorPhone,

        ...(cleanGuarantorId
          ? {
              idNumber:
                cleanGuarantorId,
            }
          : {}),
      },

      ...(customDailyFine !==
      undefined
        ? {
            dailyFine:
              customDailyFine,
          }
        : {}),

      disbursementDate:
        parsedDate,
    };

    /* -----------------------------------------------------
       SUBMIT
    ----------------------------------------------------- */

    setSubmitting(true);

    try {
      const response =
        await fetch(
          "/api/loans",
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/json",
              Accept:
                "application/json",
            },

            body: JSON.stringify({
              ...input,

              /*
               * Date is serialized explicitly.
               */
              disbursementDate:
                parsedDate.toISOString(),
            }),
          },
        );

      let result:
        | LoanApiResponse
        | null = null;

      try {
        result =
          await response.json();
      } catch {
        result = null;
      }

      if (!response.ok) {
        throw new Error(
          result?.error ||
            `Failed to create loan. Server returned ${response.status}.`,
        );
      }

      if (
        !result?.success ||
        !result.data
      ) {
        throw new Error(
          result?.error ||
            "Loan was created but the server returned no loan.",
        );
      }

      onSuccess?.(
        result.data,
      );

      resetForm();
      onClose();
    } catch (submitError) {
      console.error(
        "Loan form submission error:",
        submitError,
      );

      setError(
        submitError instanceof Error
          ? submitError.message
          : "Failed to create loan.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  /* =======================================================
     CLOSE
  ======================================================= */

  function handleClose() {
    if (submitting) {
      return;
    }

    resetForm();
    onClose();
  }

  /* =======================================================
     CLOSED
  ======================================================= */

  if (!open) {
    return null;
  }

  /* =======================================================
     UI
  ======================================================= */

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-4">
      <div
        className="flex max-h-[95dvh] w-full max-w-3xl flex-col overflow-hidden rounded-t-3xl border border-white/10 bg-[#0b0f0e] shadow-2xl sm:rounded-3xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="loan-form-title"
      >
        {/* =================================================
            HEADER
        ================================================= */}

        <div className="flex shrink-0 items-center justify-between border-b border-white/10 px-5 py-4 sm:px-6">
          <div>
            <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-emerald-400/70">
              Loan management
            </p>

            <h2
              id="loan-form-title"
              className="mt-1 text-lg font-semibold text-white"
            >
              Create Loan
            </h2>

            <p className="mt-0.5 text-xs text-white/40">
              Loan terms are captured when the loan is created.
            </p>
          </div>

          <button
            type="button"
            onClick={handleClose}
            disabled={submitting}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/5 text-white/50 transition hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="Close loan form"
          >
            <X size={18} />
          </button>
        </div>

        {/* =================================================
            BODY
        ================================================= */}

        <form
          onSubmit={handleSubmit}
          className="min-h-0 flex-1 overflow-y-auto"
        >
          <div className="space-y-5 p-5 sm:p-6">

            {/* =============================================
                ERROR
            ============================================= */}

            {error && (
              <div className="flex items-start gap-3 rounded-2xl border border-red-500/20 bg-red-500/10 p-3.5">
                <AlertCircle
                  size={18}
                  className="mt-0.5 shrink-0 text-red-400"
                />

                <p className="text-sm leading-5 text-red-200">
                  {error}
                </p>
              </div>
            )}

            {/* =============================================
                MEMBER
            ============================================= */}

            <section className="rounded-2xl border border-white/10 bg-white/[0.025] p-4">
              <div className="mb-4">
                <h3 className="text-sm font-semibold text-white">
                  Member
                </h3>

                <p className="mt-1 text-xs text-white/40">
                  Select the active member receiving this loan.
                </p>
              </div>

              {!member ? (
                <div className="relative">
                  <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/20 px-3">
                    <Search
                      size={16}
                      className="shrink-0 text-white/30"
                    />

                    <input
                      type="search"
                      value={memberSearch}
                      onChange={(event) =>
                        setMemberSearch(
                          event.target.value,
                        )
                      }
                      placeholder="Search name, member number, phone..."
                      disabled={
                        submitting ||
                        Boolean(
                          memberId.trim(),
                        )
                      }
                      className="h-11 min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-white/25"
                    />

                    {loadingMembers && (
                      <Loader2
                        size={16}
                        className="animate-spin text-white/40"
                      />
                    )}
                  </div>

                  {memberSearch.trim() &&
                    !memberId.trim() && (
                      <div className="absolute left-0 right-0 top-[calc(100%+0.5rem)] z-20 max-h-64 overflow-auto rounded-2xl border border-white/10 bg-[#111816] p-1 shadow-2xl">
                        {loadingMembers ? (
                          <div className="p-4 text-center text-xs text-white/40">
                            Searching members...
                          </div>
                        ) : members.length ===
                          0 ? (
                          <div className="p-4 text-center text-xs text-white/40">
                            No active members found.
                          </div>
                        ) : (
                          members.map(
                            (
                              item,
                            ) => {
                              const itemId =
                                item._id;

                              if (
                                typeof itemId !==
                                "string"
                              ) {
                                return null;
                              }

                              return (
                                <button
                                  key={
                                    itemId
                                  }
                                  type="button"
                                  onClick={() =>
                                    handleSelectMember(
                                      item,
                                    )
                                  }
                                  className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition hover:bg-white/5"
                                >
                                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-300">
                                    <UserRound
                                      size={
                                        16
                                      }
                                    />
                                  </div>

                                  <div className="min-w-0 flex-1">
                                    <p className="truncate text-sm font-medium text-white">
                                      {getMemberFullName(
                                        item,
                                      )}
                                    </p>

                                    <p className="mt-0.5 truncate text-xs text-white/40">
                                      {
                                        item.membershipNumber
                                      }
                                      {item.phone
                                        ? ` • ${item.phone}`
                                        : ""}
                                    </p>
                                  </div>

                                  <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-1 text-[10px] capitalize text-emerald-300">
                                    active
                                  </span>
                                </button>
                              );
                            },
                          )
                        )}
                      </div>
                    )}
                </div>
              ) : (
                <div className="flex items-center gap-3 rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.06] p-3.5">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-300">
                    <UserRound size={18} />
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-white">
                      {getMemberFullName(
                        member,
                      )}
                    </p>

                    <p className="mt-0.5 text-xs text-white/45">
                      {member.membershipNumber}
                      {member.phone
                        ? ` • ${member.phone}`
                        : ""}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="hidden items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-1 text-[10px] text-emerald-300 sm:flex">
                      <CheckCircle2
                        size={11}
                      />
                      Active
                    </span>

                    {!memberId.trim() && (
                      <button
                        type="button"
                        onClick={
                          clearMember
                        }
                        disabled={
                          submitting
                        }
                        className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/5 text-white/40 hover:bg-white/10 hover:text-white"
                        aria-label="Change member"
                      >
                        <X size={15} />
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* SAVINGS STATUS */}

              {member && (
                <div className="mt-3 rounded-xl bg-black/20 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-[10px] uppercase tracking-wide text-white/35">
                        Fixed savings
                      </p>

                      {loadingSavings ? (
                        <div className="mt-1 flex items-center gap-2 text-xs text-white/40">
                          <Loader2
                            size={13}
                            className="animate-spin"
                          />
                          Loading balance...
                        </div>
                      ) : savingsAccount ? (
                        <p className="mt-1 text-sm font-semibold text-white">
                          {formatKES(
                            savingsBalance,
                          )}
                        </p>
                      ) : (
                        <p className="mt-1 text-sm font-medium text-red-300">
                          No active account
                        </p>
                      )}
                    </div>

                    {savingsAccount && (
                      <div className="text-right">
                        <p className="text-[10px] uppercase tracking-wide text-white/35">
                          Account
                        </p>

                        <p className="mt-1 text-xs text-white/55">
                          {savingsAccount.accountNumber ||
                            "—"}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </section>

            {/* =============================================
                LOAN TYPE
            ============================================= */}

            <section className="rounded-2xl border border-white/10 bg-white/[0.025] p-4">
              <div className="mb-4">
                <h3 className="text-sm font-semibold text-white">
                  Loan type
                </h3>

                <p className="mt-1 text-xs text-white/40">
                  Choose the loan product to use.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  disabled={
                    submitting ||
                    Boolean(
                      settings &&
                        !settings.regularLoansEnabled,
                    )
                  }
                  onClick={() =>
                    handleTypeChange(
                      "regular",
                    )
                  }
                  className={`rounded-2xl border p-4 text-left transition ${
                    type === "regular"
                      ? "border-emerald-500/40 bg-emerald-500/10"
                      : "border-white/10 bg-black/20 hover:bg-white/[0.04]"
                  } disabled:cursor-not-allowed disabled:opacity-40`}
                >
                  <p
                    className={`text-sm font-semibold ${
                      type === "regular"
                        ? "text-emerald-300"
                        : "text-white"
                    }`}
                  >
                    Regular
                  </p>

                  <p className="mt-1 text-[11px] leading-4 text-white/40">
                    Based on fixed savings eligibility.
                  </p>

                  {settings && (
                    <p className="mt-3 text-xs text-white/60">
                      Interest{" "}
                      <span className="font-semibold text-white">
                        {(
                          settings.regularInterestRate *
                          100
                        ).toFixed(0)}
                        %
                      </span>
                    </p>
                  )}
                </button>

                <button
                  type="button"
                  disabled={
                    submitting ||
                    Boolean(
                      settings &&
                        !settings.emergencyLoansEnabled,
                    )
                  }
                  onClick={() =>
                    handleTypeChange(
                      "emergency",
                    )
                  }
                  className={`rounded-2xl border p-4 text-left transition ${
                    type === "emergency"
                      ? "border-amber-500/40 bg-amber-500/10"
                      : "border-white/10 bg-black/20 hover:bg-white/[0.04]"
                  } disabled:cursor-not-allowed disabled:opacity-40`}
                >
                  <p
                    className={`text-sm font-semibold ${
                      type === "emergency"
                        ? "text-amber-300"
                        : "text-white"
                    }`}
                  >
                    Emergency
                  </p>

                  <p className="mt-1 text-[11px] leading-4 text-white/40">
                    Manually entered emergency loan amount.
                  </p>

                  {settings && (
                    <p className="mt-3 text-xs text-white/60">
                      Interest{" "}
                      <span className="font-semibold text-white">
                        {(
                          settings.emergencyInterestRate *
                          100
                        ).toFixed(0)}
                        %
                      </span>
                    </p>
                  )}
                </button>
              </div>

              {/* REGULAR ELIGIBILITY */}

              {type === "regular" &&
                settings &&
                member && (
                  <div className="mt-3 rounded-xl border border-white/10 bg-black/20 p-3">
                    <div className="flex items-center justify-between gap-3 text-xs">
                      <span className="text-white/45">
                        Minimum savings
                      </span>

                      <span className="font-medium text-white">
                        {formatKES(
                          settings.regularMinimumSavings,
                        )}
                      </span>
                    </div>

                    <div className="mt-2 flex items-center justify-between gap-3 text-xs">
                      <span className="text-white/45">
                        Maximum regular loan
                      </span>

                      <span className="font-semibold text-emerald-300">
                        {formatKES(
                          maximumRegularLoan,
                        )}
                      </span>
                    </div>

                    {belowRegularMinimum && (
                      <div className="mt-3 flex items-start gap-2 text-[11px] leading-4 text-amber-300">
                        <AlertCircle
                          size={14}
                          className="mt-0.5 shrink-0"
                        />

                        <span>
                          This member's savings are below the configured regular-loan minimum.
                        </span>
                      </div>
                    )}
                  </div>
                )}
            </section>

            {/* =============================================
                LOAN TERMS
            ============================================= */}

            <section className="rounded-2xl border border-white/10 bg-white/[0.025] p-4">
              <div className="mb-4">
                <h3 className="text-sm font-semibold text-white">
                  Loan terms
                </h3>

                <p className="mt-1 text-xs text-white/40">
                  Enter the requested principal and disbursement details.
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1.5 block text-xs font-medium text-white/55">
                    Principal
                  </span>

                  <div className="flex items-center rounded-xl border border-white/10 bg-black/20 px-3">
                    <CircleDollarSign
                      size={16}
                      className="mr-2 shrink-0 text-white/30"
                    />

                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      inputMode="decimal"
                      value={principal}
                      onChange={(event) =>
                        setPrincipal(
                          event.target.value,
                        )
                      }
                      placeholder="0.00"
                      disabled={
                        submitting
                      }
                      className="h-11 w-full bg-transparent text-sm text-white outline-none placeholder:text-white/25"
                    />
                  </div>
                </label>

                <label className="block">
                  <span className="mb-1.5 block text-xs font-medium text-white/55">
                    Disbursement date
                  </span>

                  <div className="flex items-center rounded-xl border border-white/10 bg-black/20 px-3">
                    <CalendarDays
                      size={16}
                      className="mr-2 shrink-0 text-white/30"
                    />

                    <input
                      type="date"
                      value={
                        disbursementDate
                      }
                      onChange={(event) =>
                        setDisbursementDate(
                          event.target.value,
                        )
                      }
                      disabled={
                        submitting
                      }
                      className="h-11 w-full bg-transparent text-sm text-white outline-none"
                    />
                  </div>
                </label>

                <label className="block sm:col-span-2">
                  <span className="mb-1.5 block text-xs font-medium text-white/55">
                    Daily overdue fine
                    <span className="ml-1 text-white/25">
                      optional
                    </span>
                  </span>

                  <div className="flex items-center rounded-xl border border-white/10 bg-black/20 px-3">
                    <CircleDollarSign
                      size={16}
                      className="mr-2 shrink-0 text-white/30"
                    />

                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      inputMode="decimal"
                      value={dailyFine}
                      onChange={(event) =>
                        setDailyFine(
                          event.target.value,
                        )
                      }
                      placeholder={
                        settings
                          ? `Default: ${settings.defaultDailyFine}`
                          : "Use configured default"
                      }
                      disabled={
                        submitting
                      }
                      className="h-11 w-full bg-transparent text-sm text-white outline-none placeholder:text-white/25"
                    />
                  </div>

                  <p className="mt-1.5 text-[10px] text-white/30">
                    Leave blank to use the current configured default.
                  </p>
                </label>
              </div>

              {/* PREVIEW */}

              {parsedPrincipal !==
                null && (
                <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <div className="rounded-xl bg-black/20 p-3">
                    <p className="text-[9px] uppercase tracking-wide text-white/30">
                      Principal
                    </p>

                    <p className="mt-1 text-xs font-semibold text-white">
                      {formatKES(
                        parsedPrincipal,
                      )}
                    </p>
                  </div>

                  <div className="rounded-xl bg-black/20 p-3">
                    <p className="text-[9px] uppercase tracking-wide text-white/30">
                      Interest
                    </p>

                    <p className="mt-1 text-xs font-semibold text-white">
                      {formatKES(
                        calculatedInterest,
                      )}
                    </p>
                  </div>

                  <div className="rounded-xl bg-black/20 p-3">
                    <p className="text-[9px] uppercase tracking-wide text-white/30">
                      Total due
                    </p>

                    <p className="mt-1 text-xs font-semibold text-white">
                      {formatKES(
                        calculatedTotalDue,
                      )}
                    </p>
                  </div>

                  <div className="rounded-xl bg-black/20 p-3">
                    <p className="text-[9px] uppercase tracking-wide text-white/30">
                      First due
                    </p>

                    <p className="mt-1 text-xs font-semibold text-white">
                      {calculatedDueDate ||
                        "—"}
                    </p>
                  </div>
                </div>
              )}

              {type === "regular" &&
                exceedsRegularLimit && (
                  <div className="mt-3 flex items-start gap-2 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-200">
                    <AlertCircle
                      size={15}
                      className="mt-0.5 shrink-0"
                    />

                    <span>
                      Requested amount exceeds the member's current regular-loan limit of{" "}
                      <strong>
                        {formatKES(
                          maximumRegularLoan,
                        )}
                      </strong>
                      .
                    </span>
                  </div>
                )}
            </section>

            {/* =============================================
                GUARANTOR
            ============================================= */}

            <section className="rounded-2xl border border-white/10 bg-white/[0.025] p-4">
              <div className="mb-4">
                <h3 className="text-sm font-semibold text-white">
                  Guarantor
                </h3>

                <p className="mt-1 text-xs text-white/40">
                  Guarantor details are stored as part of the loan record.
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block sm:col-span-2">
                  <span className="mb-1.5 block text-xs font-medium text-white/55">
                    Full name
                  </span>

                  <input
                    type="text"
                    value={guarantorName}
                    onChange={(event) =>
                      setGuarantorName(
                        event.target.value,
                      )
                    }
                    placeholder="Guarantor full name"
                    disabled={
                      submitting
                    }
                    className="h-11 w-full rounded-xl border border-white/10 bg-black/20 px-3 text-sm text-white outline-none placeholder:text-white/25 focus:border-white/20"
                  />
                </label>

                <label className="block">
                  <span className="mb-1.5 block text-xs font-medium text-white/55">
                    Phone number
                  </span>

                  <input
                    type="tel"
                    value={guarantorPhone}
                    onChange={(event) =>
                      setGuarantorPhone(
                        event.target.value,
                      )
                    }
                    placeholder="07xx xxx xxx"
                    disabled={
                      submitting
                    }
                    className="h-11 w-full rounded-xl border border-white/10 bg-black/20 px-3 text-sm text-white outline-none placeholder:text-white/25 focus:border-white/20"
                  />
                </label>

                <label className="block">
                  <span className="mb-1.5 block text-xs font-medium text-white/55">
                    National ID
                    <span className="ml-1 text-white/25">
                      optional
                    </span>
                  </span>

                  <input
                    type="text"
                    value={
                      guarantorIdNumber
                    }
                    onChange={(event) =>
                      setGuarantorIdNumber(
                        event.target.value,
                      )
                    }
                    placeholder="Guarantor ID number"
                    disabled={
                      submitting
                    }
                    className="h-11 w-full rounded-xl border border-white/10 bg-black/20 px-3 text-sm text-white outline-none placeholder:text-white/25 focus:border-white/20"
                  />
                </label>
              </div>
            </section>

            {/* =============================================
                FINAL SUMMARY
            ============================================= */}

            {parsedPrincipal !==
              null && (
              <section className="rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.05] p-4">
                <div className="flex items-center gap-2">
                  <CircleDollarSign
                    size={16}
                    className="text-emerald-300"
                  />

                  <h3 className="text-sm font-semibold text-white">
                    Loan summary
                  </h3>
                </div>

                <div className="mt-3 space-y-2 text-xs">
                  <div className="flex justify-between gap-4">
                    <span className="text-white/45">
                      Member
                    </span>

                    <span className="text-right font-medium text-white">
                      {member
                        ? getMemberFullName(
                            member,
                          )
                        : "—"}
                    </span>
                  </div>

                  <div className="flex justify-between gap-4">
                    <span className="text-white/45">
                      Loan type
                    </span>

                    <span className="font-medium capitalize text-white">
                      {type}
                    </span>
                  </div>

                  <div className="flex justify-between gap-4">
                    <span className="text-white/45">
                      Principal
                    </span>

                    <span className="font-semibold text-white">
                      {formatKES(
                        parsedPrincipal,
                      )}
                    </span>
                  </div>

                  <div className="flex justify-between gap-4">
                    <span className="text-white/45">
                      Interest
                    </span>

                    <span className="text-white">
                      {formatKES(
                        calculatedInterest,
                      )}
                    </span>
                  </div>

                  <div className="flex justify-between gap-4">
                    <span className="text-white/45">
                      Daily fine
                    </span>

                    <span className="text-white">
                      {formatKES(
                        calculatedFine,
                      )}
                    </span>
                  </div>

                  <div className="border-t border-white/10 pt-2">
                    <div className="flex justify-between gap-4">
                      <span className="font-medium text-white/60">
                        Initial total due
                      </span>

                      <span className="text-sm font-bold text-emerald-300">
                        {formatKES(
                          calculatedTotalDue,
                        )}
                      </span>
                    </div>
                  </div>
                </div>
              </section>
            )}
          </div>

          {/* =============================================
              FOOTER
          ============================================= */}

          <div className="sticky bottom-0 border-t border-white/10 bg-[#0b0f0e]/95 px-5 py-4 backdrop-blur sm:px-6">
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={handleClose}
                disabled={
                  submitting
                }
                className="h-11 rounded-xl border border-white/10 bg-white/[0.03] px-5 text-sm font-medium text-white/60 transition hover:bg-white/[0.06] hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                Cancel
              </button>

              <button
                type="submit"
                disabled={
                  submitting ||
                  !member ||
                  !settings ||
                  !parsedPrincipal ||
                  !guarantorName.trim() ||
                  !guarantorPhone.trim() ||
                  (type ===
                    "regular" &&
                    (!savingsAccount ||
                      belowRegularMinimum ||
                      exceedsRegularLimit))
                }
                className="flex h-11 items-center justify-center gap-2 rounded-xl bg-emerald-500 px-6 text-sm font-semibold text-black transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {submitting ? (
                  <>
                    <Loader2
                      size={16}
                      className="animate-spin"
                    />
                    Creating loan...
                  </>
                ) : (
                  <>
                    <CheckCircle2
                      size={16}
                    />
                    Create Loan
                  </>
                )}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}