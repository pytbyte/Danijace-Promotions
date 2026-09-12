
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
  useRef,
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
  memberId?: string;
  loan?: Loan | null;
}

/* =========================================================
   API TYPES
========================================================= */

type MembersResponse = {
  success: boolean;
  data?: Member[];
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
   ERROR SECTIONS
========================================================= */

type ErrorSection =
  | "member"
  | "savings"
  | "settings"
  | "type"
  | "principal"
  | "dates"
  | "guarantor"
  | "general"
  | null;

/* =========================================================
   HELPERS
========================================================= */

function getMemberId(member: Member | null): string {
  if (!member) {
    return "";
  }

  return typeof member._id === "string"
    ? member._id.trim()
    : "";
}

function getMemberFullName(member: Member): string {
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

function formatKES(value: number): string {
  if (!Number.isFinite(value)) {
    return "KES 0.00";
  }

  return new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function parseMoney(value: string): number | null {
  const cleaned = value.replace(/,/g, "").trim();

  if (!cleaned) {
    return null;
  }

  const amount = Number(cleaned);

  if (!Number.isFinite(amount) || amount <= 0) {
    return null;
  }

  return (
    Math.round(
      (amount + Number.EPSILON) * 100,
    ) / 100
  );
}

function getDefaultDate(): string {
  const now = new Date();

  const year = now.getFullYear();

  const month = String(
    now.getMonth() + 1,
  ).padStart(2, "0");

  const day = String(
    now.getDate(),
  ).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function addDays(
  date: string,
  days: number,
): string {
  if (
    !date ||
    !Number.isInteger(days) ||
    days < 0
  ) {
    return "";
  }

  const result = new Date(
    `${date}T00:00:00`,
  );

  if (Number.isNaN(result.getTime())) {
    return "";
  }

  result.setDate(
    result.getDate() + days,
  );

  const year = result.getFullYear();

  const month = String(
    result.getMonth() + 1,
  ).padStart(2, "0");

  const day = String(
    result.getDate(),
  ).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function getDateObject(
  value: string,
): Date | null {
  if (!value) {
    return null;
  }

  const date = new Date(
    `${value}T00:00:00`,
  );

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date;
}

/* =========================================================
   INLINE ERROR
========================================================= */

function FieldError({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <p
      role="alert"
      className="mt-1.5 flex items-start gap-1.5 text-[11px] leading-4 text-red-300"
    >
      <AlertCircle
        size={12}
        className="mt-0.5 shrink-0"
      />

      <span>{children}</span>
    </p>
  );
}

/* =========================================================
   SECTION ERROR
========================================================= */

function SectionError({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div
      role="alert"
      className="mt-3 flex items-start gap-2 rounded-xl border border-red-500/15 bg-red-500/[0.06] px-3 py-2.5"
    >
      <AlertCircle
        size={14}
        className="mt-0.5 shrink-0 text-red-400"
      />

      <p className="text-xs leading-5 text-red-200/80">
        {children}
      </p>
    </div>
  );
}

/* =========================================================
   COMPONENT
========================================================= */

export default function LoanForm({
  open,
  onClose,
  onSuccess,
  memberId,
  loan,
}: LoanFormProps) {
  const isEditMode = Boolean(loan);

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

  const [savingsAccount, setSavingsAccount] =
    useState<SavingsAccount | null>(null);

  const [loadingSavings, setLoadingSavings] =
    useState(false);

  /* =======================================================
     SETTINGS
  ======================================================= */

  const [settings, setSettings] =
    useState<LoanSettings | null>(null);

  const [loadingSettings, setLoadingSettings] =
    useState(false);

  /* =======================================================
     LOAN FORM
  ======================================================= */

  const [type, setType] =
    useState<LoanType>("regular");

  const [principal, setPrincipal] =
    useState("");

  const [installmentAmount, setInstallmentAmount] =
    useState("");

  const [disbursementDate, setDisbursementDate] =
    useState(getDefaultDate());

  const [repaymentDate, setRepaymentDate] =
    useState("");

  const [endDate, setEndDate] =
    useState("");

  /*
   * These flags prevent automatic date calculation
   * from overwriting dates manually selected by the user.
   */
  const repaymentDateAuto =
    useRef(true);

  const endDateAuto =
    useRef(true);

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
     ERROR / SUBMISSION STATE
  ======================================================= */

  const [error, setError] =
    useState<string | null>(null);

  const [errorSection, setErrorSection] =
    useState<ErrorSection>(null);

  const [submitting, setSubmitting] =
    useState(false);

  /* =========================================================
     ERROR HELPERS
  ========================================================= */

  function showError(
    message: string,
    section: Exclude<ErrorSection, null>,
  ) {
    setError(message);
    setErrorSection(section);
  }

  function clearError() {
    setError(null);
    setErrorSection(null);
  }

  function clearSectionError(
    section: Exclude<ErrorSection, null>,
  ) {
    if (errorSection === section) {
      setError(null);
      setErrorSection(null);
    }
  }

  /* =========================================================
     RESET FORM
  ========================================================= */

  function resetForm() {
    setMember(null);
    setMembers([]);
    setMemberSearch("");

    setSavingsAccount(null);
    setSettings(null);

    setType("regular");
    setPrincipal("");
    setInstallmentAmount("");

    setDisbursementDate(
      getDefaultDate(),
    );

    setRepaymentDate("");
    setEndDate("");

    repaymentDateAuto.current = true;
    endDateAuto.current = true;

    setGuarantorName("");
    setGuarantorPhone("");
    setGuarantorIdNumber("");

    clearError();

    setLoadingMembers(false);
    setLoadingSavings(false);
    setLoadingSettings(false);
    setSubmitting(false);
  }

  /* =========================================================
     INITIALIZE EDIT FORM
  ========================================================= */

  useEffect(() => {
    if (!open || !loan) {
      return;
    }

    setType(loan.type);

    setPrincipal(
      String(loan.principal),
    );

    /*
     * IMPORTANT:
     *
     * The contractual repayment installment is stored on
     * the loan as installmentAmount.
     *
     * Load it into the edit form so PATCH does not send
     * an empty/null installment when the user edits another
     * field.
     */
    setInstallmentAmount(
      String(loan.installmentAmount),
    );

    const loanDisbursementDate =
      new Date(
        loan.disbursementDate,
      );

    const loanRepaymentDate =
      new Date(
        loan.repaymentDate,
      );

    const loanEndDate =
      new Date(
        loan.endDate,
      );

    if (
      !Number.isNaN(
        loanDisbursementDate.getTime(),
      )
    ) {
      setDisbursementDate(
        loanDisbursementDate
          .toISOString()
          .slice(0, 10),
      );
    }

    if (
      !Number.isNaN(
        loanRepaymentDate.getTime(),
      )
    ) {
      setRepaymentDate(
        loanRepaymentDate
          .toISOString()
          .slice(0, 10),
      );
    }

    if (
      !Number.isNaN(
        loanEndDate.getTime(),
      )
    ) {
      setEndDate(
        loanEndDate
          .toISOString()
          .slice(0, 10),
      );
    }

    /*
     * Existing dates are authoritative while editing.
     * Do not let the repayment-cycle effect overwrite them.
     */
    repaymentDateAuto.current = false;
    endDateAuto.current = false;

    setGuarantorName(
      loan.guarantor?.name ?? "",
    );

    setGuarantorPhone(
      loan.guarantor?.phone ?? "",
    );

    setGuarantorIdNumber(
      loan.guarantor?.idNumber ?? "",
    );

    clearError();
  }, [open, loan]);

  /* =========================================================
     AUTO-CALCULATE REPAYMENT DATE
  ========================================================= */

  useEffect(() => {
    if (!settings || !disbursementDate) {
      return;
    }

    const cycleDays =
      settings.repaymentCycleDays;

    if (
      !Number.isInteger(cycleDays) ||
      cycleDays <= 0
    ) {
      return;
    }

    const defaultRepaymentDate =
      addDays(
        disbursementDate,
        cycleDays,
      );

    if (!defaultRepaymentDate) {
      return;
    }

    if (repaymentDateAuto.current) {
      setRepaymentDate(
        defaultRepaymentDate,
      );
    }

    if (endDateAuto.current) {
      setEndDate(
        defaultRepaymentDate,
      );
    }
  }, [
    settings,
    disbursementDate,
  ]);

  /* =========================================================
     LOAD LOAN SETTINGS
  ========================================================= */

  useEffect(() => {
    if (!open) {
      return;
    }

    let cancelled = false;

    async function loadSettings() {
      setLoadingSettings(true);

      try {
        const response = await fetch(
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

        setSettings(result.data);

        if (
          errorSection ===
          "settings"
        ) {
          clearError();
        }
      } catch (loadError) {
        if (cancelled) {
          return;
        }

        console.error(
          "Loan settings loading error:",
          loadError,
        );

        setSettings(null);

        showError(
          loadError instanceof Error
            ? loadError.message
            : "Unable to load loan settings.",
          "settings",
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

  /* =========================================================
     LOAD MEMBER

     CREATE:
       Uses memberId prop if supplied and forLoan=true.

     EDIT:
       Uses loan.memberId and does NOT use forLoan=true.
       Existing borrowers must still be loadable.
  ========================================================= */

  useEffect(() => {
    if (!open) {
      return;
    }

    const cleanMemberId =
      loan?.memberId?.trim() ??
      memberId?.trim() ??
      "";

    if (!cleanMemberId) {
      setMember(null);

      if (!isEditMode) {
        setMemberSearch("");
      }

      return;
    }

    let cancelled = false;

    async function loadSelectedMember() {
      try {
        clearSectionError("member");

        /*
         * EDIT MODE
         *
         * A loan already contains the exact MongoDB
         * member ID. Use the dedicated member endpoint.
         *
         * We deliberately do NOT use the paginated/search
         * members endpoint here.
         */
        if (isEditMode) {
          const response = await fetch(
            `/api/members/${encodeURIComponent(
              cleanMemberId,
            )}`,
            {
              method: "GET",
              cache: "no-store",
              headers: {
                Accept: "application/json",
              },
            },
          );

          let result:
            | {
                success?: boolean;
                data?: Member;
                error?: string;
              }
            | null = null;

          try {
            result = await response.json();
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
                "Unable to load the member attached to this loan.",
            );
          }

          setMember(result.data);

          /*
           * The member is locked in edit mode.
           *
           * We intentionally do not modify memberSearch
           * because the member cannot be changed.
           */
          return;
        }

        /*
         * CREATE MODE
         *
         * Preserve the existing loan-eligible member search.
         */
        const response = await fetch(
          `/api/members?search=${encodeURIComponent(
            cleanMemberId,
          )}&page=1&limit=10&forLoan=true`,
          {
            method: "GET",
            cache: "no-store",
            headers: {
              Accept: "application/json",
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
          !Array.isArray(result.data)
        ) {
          throw new Error(
            result?.error ||
              "Unable to load member.",
          );
        }

        const found = result.data.find(
          (item) =>
            String(item._id) ===
            cleanMemberId,
        );

        if (!found) {
          throw new Error(
            "The selected member could not be found or is not eligible for a new loan.",
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

        showError(
          loadError instanceof Error
            ? loadError.message
            : "Unable to load member.",
          "member",
        );
      }
    }

    void loadSelectedMember();

    return () => {
      cancelled = true;
    };
  }, [
    open,
    loan,
    memberId,
    isEditMode,
  ]);

  /* =========================================================
     MEMBER SEARCH
  ========================================================= */

  useEffect(() => {
    if (
      !open ||
      isEditMode ||
      memberId?.trim()
    ) {
      return;
    }

    let cancelled = false;

    async function searchMembers() {
      const query =
        memberSearch.trim();

      if (!query) {
        setMembers([]);
        setLoadingMembers(false);
        return;
      }

      setLoadingMembers(true);

      try {
        const response = await fetch(
          `/api/members?search=${encodeURIComponent(
            query,
          )}&page=1&limit=20&forLoan=true`,
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

        clearSectionError(
          "member",
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

        showError(
          searchError instanceof Error
            ? searchError.message
            : "Unable to search members.",
          "member",
        );
      } finally {
        if (!cancelled) {
          setLoadingMembers(
            false,
          );
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
    isEditMode,
  ]);

  /* =========================================================
     LOAD SAVINGS ACCOUNT
  ========================================================= */

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
        const response = await fetch(
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

        if (
          !response.ok ||
          !result?.success
        ) {
          throw new Error(
            result?.error ||
              "Unable to load savings account.",
          );
        }

        setSavingsAccount(
          result.data || null,
        );

        clearSectionError(
          "savings",
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

        showError(
          accountError instanceof Error
            ? accountError.message
            : "Unable to load savings account.",
          "savings",
        );
      } finally {
        if (!cancelled) {
          setLoadingSavings(
            false,
          );
        }
      }
    }

    loadSavingsAccount();

    return () => {
      cancelled = true;
    };
  }, [open, member]);

  /* =========================================================
     CALCULATIONS
  ========================================================= */

  const savingsBalance =
    typeof savingsAccount?.balance ===
      "number" &&
    Number.isFinite(
      savingsAccount.balance,
    )
      ? savingsAccount.balance
      : 0;

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

  const parsedInstallment =
    parseMoney(installmentAmount);

  const interestRate =
    settings
      ? type === "emergency"
        ? settings.emergencyInterestRate
        : settings.regularInterestRate
      : 0;

  const calculatedInterest =
    parsedPrincipal !== null
      ? parsedPrincipal *
        interestRate
      : 0;

  const calculatedTotalDue =
    parsedPrincipal !== null
      ? parsedPrincipal +
        calculatedInterest
      : 0;

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

  /* =========================================================
     MEMBER SELECTION
  ========================================================= */

  function handleSelectMember(
    selectedMember: Member,
  ) {
    if (
      submitting ||
      isEditMode
    ) {
      return;
    }

    if (
      selectedMember.status !==
      "active"
    ) {
      showError(
        "Only active members can receive loans.",
        "member",
      );

      return;
    }

    setMember(selectedMember);
    setMemberSearch("");
    setMembers([]);

    clearError();
  }

  function clearMember() {
    if (
      submitting ||
      isEditMode ||
      memberId?.trim()
    ) {
      return;
    }

    setMember(null);
    setSavingsAccount(null);
    setMemberSearch("");

    clearError();
  }

  /* =========================================================
     LOAN TYPE
  ========================================================= */

  function handleTypeChange(
    nextType: LoanType,
  ) {
    if (submitting) {
      return;
    }

    setType(nextType);

    clearSectionError(
      "type",
    );
  }

  /* =========================================================
     DATE HANDLERS
  ========================================================= */

  function handleDisbursementDateChange(
    value: string,
  ) {
    if (submitting) {
      return;
    }

    setDisbursementDate(value);

    clearSectionError(
      "dates",
    );
  }

  function handleRepaymentDateChange(
    value: string,
  ) {
    if (submitting) {
      return;
    }

    repaymentDateAuto.current =
      false;

    setRepaymentDate(value);

    clearSectionError(
      "dates",
    );
  }

  function handleEndDateChange(
    value: string,
  ) {
    if (submitting) {
      return;
    }

    endDateAuto.current = false;

    setEndDate(value);

    clearSectionError(
      "dates",
    );
  }

  /* =========================================================
     PRINCIPAL HANDLER
  ========================================================= */

  function handlePrincipalChange(
    value: string,
  ) {
    if (submitting) {
      return;
    }

    setPrincipal(value);

    clearSectionError(
      "principal",
    );
  }

  /* =========================================================
     INSTALLMENT HANDLER
  ========================================================= */

  function handleInstallmentChange(
    value: string,
  ) {
    if (submitting) {
      return;
    }

    setInstallmentAmount(value);

    clearSectionError(
      "principal",
    );
  }

  /* =========================================================
     GUARANTOR HANDLERS
  ========================================================= */

  function handleGuarantorNameChange(
    value: string,
  ) {
    if (submitting) {
      return;
    }

    setGuarantorName(value);

    clearSectionError(
      "guarantor",
    );
  }

  function handleGuarantorPhoneChange(
    value: string,
  ) {
    if (submitting) {
      return;
    }

    setGuarantorPhone(value);

    clearSectionError(
      "guarantor",
    );
  }

  function handleGuarantorIdChange(
    value: string,
  ) {
    if (submitting) {
      return;
    }

    setGuarantorIdNumber(value);

    clearSectionError(
      "guarantor",
    );
  }

/* =========================================================
   SUBMIT
========================================================= */

async function handleSubmit(
  event: FormEvent<HTMLFormElement>,
) {
  event.preventDefault();

  if (submitting) {
    return;
  }

  clearError();

  /* -------------------------------------------------------
     MEMBER
  ------------------------------------------------------- */

  if (!member) {
    showError(
      isEditMode
        ? "Unable to load the loan member."
        : "Select a member before creating the loan.",
      "member",
    );

    return;
  }

  const selectedMemberId =
    getMemberId(member);

  if (!selectedMemberId) {
    showError(
      "Selected member has no valid member ID.",
      "member",
    );

    return;
  }

  if (
    member.status !==
    "active"
  ) {
    showError(
      "Only active members can receive loans.",
      "member",
    );

    return;
  }

  /* -------------------------------------------------------
     SAVINGS

     These checks apply only to CREATE.

     During EDIT, the backend decides whether the loan
     itself is editable. We do not treat an edit as a
     brand-new loan application.
  ------------------------------------------------------- */

  if (
    !isEditMode &&
    type === "regular" &&
    !savingsAccount
  ) {
    showError(
      "The member does not have an active fixed savings account.",
      "savings",
    );

    return;
  }

  if (
    !isEditMode &&
    type === "regular" &&
    savingsAccount
  ) {
    const active =
      savingsAccount.isActive !==
        false &&
      savingsAccount.status !==
        "inactive";

    if (!active) {
      showError(
        "The member's fixed savings account is inactive.",
        "savings",
      );

      return;
    }
  }

  /* -------------------------------------------------------
     SETTINGS
  ------------------------------------------------------- */

  if (!settings) {
    showError(
      "Loan settings are not available. Please refresh and try again.",
      "settings",
    );

    return;
  }

  if (
    !Number.isInteger(
      settings.repaymentCycleDays,
    ) ||
    settings.repaymentCycleDays <=
      0
  ) {
    showError(
      "Loan repayment cycle settings are invalid.",
      "settings",
    );

    return;
  }

  if (
    !Number.isFinite(
      settings.fineRate,
    ) ||
    settings.fineRate < 0 ||
    settings.fineRate > 1
  ) {
    showError(
      "Loan fine rate settings are invalid.",
      "settings",
    );

    return;
  }

  /* -------------------------------------------------------
     LOAN TYPE ENABLED
  ------------------------------------------------------- */

  if (
    type === "emergency" &&
    !settings.emergencyLoansEnabled
  ) {
    showError(
      "Emergency loans are currently disabled.",
      "type",
    );

    return;
  }

  if (
    type === "regular" &&
    !settings.regularLoansEnabled
  ) {
    showError(
      "Regular loans are currently disabled.",
      "type",
    );

    return;
  }

  /* -------------------------------------------------------
     PRINCIPAL
  ------------------------------------------------------- */

  const amount =
    parseMoney(principal);

  if (amount === null) {
    showError(
      "Enter a valid loan amount greater than zero.",
      "principal",
    );

    return;
  }

  /* -------------------------------------------------------
     REPAYMENT INSTALLMENT

     Applies to BOTH CREATE and EDIT.

     This is the contractual amount expected from the
     member during every repayment cycle.
  ------------------------------------------------------- */

  const installment =
    parseMoney(
      installmentAmount,
    );

  if (
    installment === null ||
    installment <= 0
  ) {
    showError(
      "Enter a valid repayment installment greater than zero.",
      "principal",
    );

    return;
  }

  if (installment > amount) {
    showError(
      "Repayment installment cannot exceed the loan amount.",
      "principal",
    );

    return;
  }

  /* -------------------------------------------------------
     REGULAR ELIGIBILITY

     New loans only.
  ------------------------------------------------------- */

  if (
    !isEditMode &&
    type === "regular" &&
    belowRegularMinimum
  ) {
    showError(
      `Regular loan requires minimum savings of ${formatKES(
        settings.regularMinimumSavings,
      )}.`,
      "savings",
    );

    return;
  }

  if (
    !isEditMode &&
    type === "regular" &&
    exceedsRegularLimit
  ) {
    showError(
      `Regular loan cannot exceed ${formatKES(
        maximumRegularLoan,
      )} based on the member's current savings.`,
      "principal",
    );

    return;
  }

  /* -------------------------------------------------------
     LOAN CALENDAR DATES

     These values come from <input type="date"> and should
     remain YYYY-MM-DD strings.

     DO NOT convert them to JavaScript Date objects here.

     DO NOT use:
       new Date(value)
       value.toISOString()

     The API is responsible for converting the validated
     calendar date into the canonical database representation.
  ------------------------------------------------------- */

  const validCalendarDate =
    (value: unknown): value is string => {
      if (
        typeof value !== "string"
      ) {
        return false;
      }

      const trimmed =
        value.trim();

      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(
          trimmed,
        )
      ) {
        return false;
      }

      const match =
        /^(\d{4})-(\d{2})-(\d{2})$/.exec(
          trimmed,
        );

      if (!match) {
        return false;
      }

      const year =
        Number(match[1]);

      const month =
        Number(match[2]);

      const day =
        Number(match[3]);

      const daysInMonth =
        new Date(
          Date.UTC(
            year,
            month,
            0,
          ),
        ).getUTCDate();

      return (
        Number.isInteger(year) &&
        Number.isInteger(month) &&
        Number.isInteger(day) &&
        month >= 1 &&
        month <= 12 &&
        day >= 1 &&
        day <= daysInMonth
      );
    };

  /* -------------------------------------------------------
     DISBURSEMENT DATE
  ------------------------------------------------------- */

  if (
    !validCalendarDate(
      disbursementDate,
    )
  ) {
    showError(
      "Enter a valid disbursement date.",
      "dates",
    );

    return;
  }

  /* -------------------------------------------------------
     REPAYMENT DATE
  ------------------------------------------------------- */

  if (
    !validCalendarDate(
      repaymentDate,
    )
  ) {
    showError(
      "A valid repayment date is required.",
      "dates",
    );

    return;
  }

  /*
   * YYYY-MM-DD strings sort chronologically, so this
   * comparison is timezone-independent.
   */
  if (
    repaymentDate <
    disbursementDate
  ) {
    showError(
      "Repayment date cannot be before the disbursement date.",
      "dates",
    );

    return;
  }

  /* -------------------------------------------------------
     END DATE
  ------------------------------------------------------- */

  if (
    !validCalendarDate(
      endDate,
    )
  ) {
    showError(
      "A valid loan end date is required.",
      "dates",
    );

    return;
  }

  if (
    endDate <
    repaymentDate
  ) {
    showError(
      "End date cannot be before the repayment date.",
      "dates",
    );

    return;
  }

  /* -------------------------------------------------------
     GUARANTOR
  ------------------------------------------------------- */

  const cleanGuarantorName =
    guarantorName.trim();

  const cleanGuarantorPhone =
    guarantorPhone.trim();

  const cleanGuarantorId =
    guarantorIdNumber.trim();

  if (!cleanGuarantorName) {
    showError(
      "Guarantor name is required.",
      "guarantor",
    );

    return;
  }

  if (!cleanGuarantorPhone) {
    showError(
      "Guarantor phone number is required.",
      "guarantor",
    );

    return;
  }

  /* -------------------------------------------------------
     SUBMIT
  ------------------------------------------------------- */

  setSubmitting(true);

  try {
    /* =====================================================
       EDIT LOAN
    ===================================================== */

    if (isEditMode) {
      if (!loan?.id) {
        throw new Error(
          "The loan does not have a valid ID.",
        );
      }

      /*
       * Only editable fields are sent.
       *
       * We deliberately do NOT send:
       * - memberId
       * - loanNumber
       * - amountPaid
       * - totalFines
       * - totalWaivedFines
       * - outstandingBalance
       * - fineStatus
       * - repaymentStatus
       * - createdBy
       * - authorizedBy
       * - createdAt
       * - interest
       * - totalDue
       *
       * The backend remains authoritative for those.
       *
       * IMPORTANT:
       *
       * Calendar dates remain YYYY-MM-DD strings.
       * They are NOT converted to ISO timestamps.
       */

      const editInput = {
        type,

        principal:
          amount,

        installmentAmount:
          installment,

        disbursementDate:
          disbursementDate,

        repaymentDate:
          repaymentDate,

        endDate:
          endDate,

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
      };

      const response =
        await fetch(
          `/api/loans/${encodeURIComponent(
            loan.id,
          )}`,
          {
            method: "PATCH",

            headers: {
              "Content-Type":
                "application/json",

              Accept:
                "application/json",
            },

            body: JSON.stringify(
              editInput,
            ),
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
            `Failed to update loan. Server returned ${response.status}.`,
        );
      }

      if (
        !result?.success ||
        !result.data
      ) {
        throw new Error(
          result?.error ||
            "Loan was updated but the server returned no loan.",
        );
      }

      onSuccess?.(
        result.data,
      );

      resetForm();
      onClose();

      return;
    }

    /* =====================================================
       CREATE LOAN
    ===================================================== */

    /*
     * Keep the date values as calendar-date strings when
     * sending them to the API.
     *
     * The API/service will normalize them into the canonical
     * database representation.
     */
    const input = {
      memberId:
        selectedMemberId,

      type,

      principal:
        amount,

      installmentAmount:
        installment,

      fineRate:
        settings.fineRate,

      disbursementDate:
        disbursementDate,

      repaymentDate:
        repaymentDate,

      endDate:
        endDate,

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
    };

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

          body: JSON.stringify(
            input,
          ),
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
      isEditMode
        ? "Loan update error:"
        : "Loan creation error:",
      submitError,
    );

    showError(
      submitError instanceof Error
        ? submitError.message
        : isEditMode
          ? "Failed to update loan."
          : "Failed to create loan.",
      "general",
    );
  } finally {
    setSubmitting(false);
  }
}

  /* =========================================================
     CLOSE
  ========================================================= */

  function handleClose() {
    if (submitting) {
      return;
    }

    resetForm();
    onClose();
  }

  /* =========================================================
     CLOSED
  ========================================================= */

  if (!open) {
    return null;
  }

  /* =========================================================
     UI
  ========================================================= */

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
              {isEditMode
                ? "Edit Loan"
                : "Create Loan"}
            </h2>

            <p className="mt-0.5 text-xs text-white/40">
              {isEditMode
                ? "Update the editable terms of this loan."
                : "Loan terms are captured when the loan is created."}
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
            FORM
        ================================================= */}

        <form
          onSubmit={handleSubmit}
          className="min-h-0 flex-1 overflow-y-auto"
        >
          <div className="space-y-5 p-5 sm:p-6">

            {/* =================================================
                SYSTEM ERROR
            ================================================= */}

            {error &&
              errorSection ===
                "general" && (
                <div
                  role="alert"
                  className="flex items-start gap-3 rounded-2xl border border-red-400/20 bg-red-500/[0.07] px-4 py-3"
                >
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-red-500/10">
                    <AlertCircle
                      size={15}
                      className="text-red-400"
                    />
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-red-200">
                      {isEditMode
                        ? "Unable to update loan"
                        : "Unable to create loan"}
                    </p>

                    <p className="mt-0.5 text-xs leading-5 text-red-200/70">
                      {error}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={
                      clearError
                    }
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-red-300/50 transition hover:bg-red-500/10 hover:text-red-200"
                    aria-label="Dismiss error"
                  >
                    <X size={14} />
                  </button>
                </div>
              )}

            {/* =================================================
                MEMBER
            ================================================= */}

            <section
              className={`rounded-2xl border bg-white/[0.025] p-4 ${
                errorSection ===
                "member"
                  ? "border-red-500/25"
                  : "border-white/10"
              }`}
            >
              <div className="mb-4">
                <h3 className="text-sm font-semibold text-white">
                  Member
                </h3>

                <p className="mt-1 text-xs text-white/40">
                  {isEditMode
                    ? "The borrower cannot be changed after the loan is created."
                    : "Select the active member receiving this loan."}
                </p>
              </div>

              {!member ? (
                <div className="relative">
                  <div
                    className={`flex items-center gap-2 rounded-xl border bg-black/20 px-3 ${
                      errorSection ===
                      "member"
                        ? "border-red-500/30"
                        : "border-white/10"
                    }`}
                  >
                    <Search
                      size={16}
                      className="shrink-0 text-white/30"
                    />

                    <input
                      type="search"
                      value={
                        memberSearch
                      }
                      onChange={(
                        event,
                      ) => {
                        setMemberSearch(
                          event.target
                            .value,
                        );

                        clearSectionError(
                          "member",
                        );
                      }}
                      placeholder="Search member first and middle name"
                      disabled={
                        submitting ||
                        isEditMode ||
                        Boolean(
                          memberId?.trim(),
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
                    !isEditMode &&
                    !memberId?.trim() && (
                      <div className="absolute left-0 right-0 top-[calc(100%+0.5rem)] z-20 max-h-64 overflow-auto rounded-2xl border border-white/10 bg-[#111816] p-1 shadow-2xl">
                        {loadingMembers ? (
                          <div className="p-4 text-center text-xs text-white/40">
                            Searching members...
                          </div>
                        ) : members.length ===
                          0 ? (
                          <div className="p-4 text-center text-xs text-white/40">
                            No eligible active members found.
                          </div>
                        ) : (
                          members.map(
                            (item) => {
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
                                    eligible
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
                      {
                        member.membershipNumber
                      }

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

                      {isEditMode
                        ? "Borrower"
                        : "Eligible"}
                    </span>

                    {!isEditMode &&
                      !memberId?.trim() && (
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

              {error &&
                errorSection ===
                  "member" && (
                  <SectionError>
                    {error}
                  </SectionError>
                )}

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

              {error &&
                errorSection ===
                  "savings" && (
                  <SectionError>
                    {error}
                  </SectionError>
                )}
            </section>

            {/* =================================================
                LOAN TYPE
            ================================================= */}

            <section
              className={`rounded-2xl border bg-white/[0.025] p-4 ${
                errorSection ===
                "type"
                  ? "border-red-500/25"
                  : "border-white/10"
              }`}
            >
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

              {error &&
                errorSection ===
                  "type" && (
                  <SectionError>
                    {error}
                  </SectionError>
                )}

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

            {/* =================================================
                LOAN TERMS
            ================================================= */}

            <section
              className={`rounded-2xl border bg-white/[0.025] p-4 ${
                errorSection ===
                  "principal" ||
                errorSection ===
                  "dates"
                  ? "border-red-500/25"
                  : "border-white/10"
              }`}
            >
              <div className="mb-4">
                <h3 className="text-sm font-semibold text-white">
                  Loan terms
                </h3>

                <p className="mt-1 text-xs text-white/40">
                  {isEditMode
                    ? "Update the editable principal, installment and repayment schedule."
                    : "Enter the principal, repayment installment and repayment schedule."}
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                {/* PRINCIPAL */}

                <label className="block">
                  <span className="mb-1.5 block text-xs font-medium text-white/55">
                    Principal
                  </span>

                  <div
                    className={`flex items-center rounded-xl border bg-black/20 px-3 ${
                      errorSection ===
                      "principal"
                        ? "border-red-500/30"
                        : "border-white/10"
                    }`}
                  >
                    <CircleDollarSign
                      size={16}
                      className="mr-2 shrink-0 text-white/30"
                    />

                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      inputMode="decimal"
                      value={
                        principal
                      }
                      onChange={(
                        event,
                      ) =>
                        handlePrincipalChange(
                          event.target
                            .value,
                        )
                      }
                      placeholder="0.00"
                      disabled={
                        submitting
                      }
                      className="h-11 w-full bg-transparent text-sm text-white outline-none placeholder:text-white/25"
                    />
                  </div>

                  {error &&
                    errorSection ===
                      "principal" && (
                      <FieldError>
                        {error}
                      </FieldError>
                    )}
                </label>

                {/* REPAYMENT INSTALLMENT */}

                <div className="space-y-2">
                  <label
                    htmlFor="installment-amount"
                    className="text-sm font-medium text-white/80"
                  >
                    Repayment installment
                  </label>

                  <input
                    id="installment-amount"
                    type="number"
                    min="1"
                    step="0.01"
                    inputMode="decimal"
                    value={
                      installmentAmount
                    }
                    onChange={(
                      event,
                    ) =>
                      handleInstallmentChange(
                        event.target
                          .value,
                      )
                    }
                    placeholder="e.g. 5,000"
                    disabled={
                      submitting
                    }
                    className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none transition placeholder:text-white/30 focus:border-sky-400/50 focus:ring-2 focus:ring-sky-400/20"
                  />

                  <p className="text-xs text-white/40">
                    Amount the member is expected to pay every repayment cycle.
                  </p>

                  {parsedInstallment !==
                    null &&
                    parsedPrincipal !==
                      null &&
                    parsedInstallment >
                      parsedPrincipal && (
                      <FieldError>
                        Repayment installment cannot exceed the loan amount.
                      </FieldError>
                    )}
                </div>

                {/* DISBURSEMENT */}

                <label className="block">
                  <span className="mb-1.5 block text-xs font-medium text-white/55">
                    Disbursement date
                  </span>

                  <div
                    className={`flex items-center rounded-xl border bg-black/20 px-3 ${
                      errorSection ===
                      "dates"
                        ? "border-red-500/30"
                        : "border-white/10"
                    }`}
                  >
                    <CalendarDays
                      size={16}
                      className="mr-2 shrink-0 text-white/30"
                    />

                    <input
                      type="date"
                      value={
                        disbursementDate
                      }
                      onChange={(
                        event,
                      ) =>
                        handleDisbursementDateChange(
                          event.target
                            .value,
                        )
                      }
                      disabled={
                        submitting
                      }
                      className="h-11 w-full bg-transparent text-sm text-white outline-none"
                    />
                  </div>
                </label>

                {/* REPAYMENT */}

                <label className="block">
                  <span className="mb-1.5 block text-xs font-medium text-white/55">
                    Repayment date
                  </span>

                  <div
                    className={`flex items-center rounded-xl border bg-black/20 px-3 ${
                      errorSection ===
                      "dates"
                        ? "border-red-500/30"
                        : "border-white/10"
                    }`}
                  >
                    <CalendarDays
                      size={16}
                      className="mr-2 shrink-0 text-emerald-400/60"
                    />

                    <input
                      type="date"
                      value={
                        repaymentDate
                      }
                      min={
                        disbursementDate ||
                        undefined
                      }
                      onChange={(
                        event,
                      ) =>
                        handleRepaymentDateChange(
                          event.target
                            .value,
                        )
                      }
                      disabled={
                        submitting
                      }
                      className="h-11 w-full bg-transparent text-sm text-white outline-none"
                    />
                  </div>

                  <p className="mt-1.5 text-[10px] leading-4 text-white/30">
                    Defaults to the configured repayment cycle from disbursement.
                  </p>
                </label>

                {/* END DATE */}

                <label className="block">
                  <span className="mb-1.5 block text-xs font-medium text-white/55">
                    Loan end date
                  </span>

                  <div
                    className={`flex items-center rounded-xl border bg-black/20 px-3 ${
                      errorSection ===
                      "dates"
                        ? "border-red-500/30"
                        : "border-white/10"
                    }`}
                  >
                    <CalendarDays
                      size={16}
                      className="mr-2 shrink-0 text-amber-400/60"
                    />

                    <input
                      type="date"
                      value={
                        endDate
                      }
                      min={
                        repaymentDate ||
                        disbursementDate ||
                        undefined
                      }
                      onChange={(
                        event,
                      ) =>
                        handleEndDateChange(
                          event.target
                            .value,
                        )
                      }
                      disabled={
                        submitting
                      }
                      className="h-11 w-full bg-transparent text-sm text-white outline-none"
                    />
                  </div>

                  <p className="mt-1.5 text-[10px] leading-4 text-white/30">
                    The final date by which the loan should be completed.
                  </p>
                </label>
              </div>

              {error &&
                errorSection ===
                  "dates" && (
                  <SectionError>
                    {error}
                  </SectionError>
                )}

              {/* CONFIGURED TERMS */}

              {settings && (
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                    <p className="text-[9px] uppercase tracking-wide text-white/30">
                      Repayment cycle
                    </p>

                    <p className="mt-1 text-sm font-semibold text-white">
                      {
                        settings.repaymentCycleDays
                      }{" "}
                      days
                    </p>

                    <p className="mt-1 text-[10px] leading-4 text-white/30">
                      Measured from the disbursement date.
                    </p>
                  </div>

                  <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                    <p className="text-[9px] uppercase tracking-wide text-white/30">
                      Fine rate
                    </p>

                    <p className="mt-1 text-sm font-semibold text-white">
                      {(
                        settings.fineRate *
                        100
                      ).toFixed(2)}
                      %
                    </p>

                    <p className="mt-1 text-[10px] leading-4 text-white/30">
                      Applied once per completed repayment cycle to the unpaid installment amount.
                    </p>
                  </div>
                </div>
              )}

              {/* PREVIEW */}

              {parsedPrincipal !==
                null && (
                <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-6">
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
                      Installment
                    </p>

                    <p className="mt-1 text-xs font-semibold text-sky-300">
                      {parsedInstallment !==
                      null
                        ? formatKES(
                            parsedInstallment,
                          )
                        : "—"}
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
                      Repayment
                    </p>

                    <p className="mt-1 text-xs font-semibold text-white">
                      {repaymentDate ||
                        "—"}
                    </p>
                  </div>

                  <div className="rounded-xl bg-black/20 p-3">
                    <p className="text-[9px] uppercase tracking-wide text-white/30">
                      End date
                    </p>

                    <p className="mt-1 text-xs font-semibold text-white">
                      {endDate ||
                        "—"}
                    </p>
                  </div>
                </div>
              )}

              {/* REGULAR LIMIT */}

              {!isEditMode &&
                type === "regular" &&
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

            {/* =================================================
                SETTINGS ERROR
            ================================================= */}

            {error &&
              errorSection ===
                "settings" && (
                <SectionError>
                  {error}
                </SectionError>
              )}

            {/* =================================================
                GUARANTOR
            ================================================= */}

            <section
              className={`rounded-2xl border bg-white/[0.025] p-4 ${
                errorSection ===
                "guarantor"
                  ? "border-red-500/25"
                  : "border-white/10"
              }`}
            >
              <div className="mb-4">
                <h3 className="text-sm font-semibold text-white">
                  Guarantor
                </h3>

                <p className="mt-1 text-xs text-white/40">
                  Guarantor details are stored as part of the loan record.
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                {/* NAME */}

                <label className="block sm:col-span-2">
                  <span className="mb-1.5 block text-xs font-medium text-white/55">
                    Full name
                  </span>

                  <input
                    type="text"
                    value={
                      guarantorName
                    }
                    onChange={(
                      event,
                    ) =>
                      handleGuarantorNameChange(
                        event.target
                          .value,
                      )
                    }
                    placeholder="Guarantor full name"
                    disabled={
                      submitting
                    }
                    className={`h-11 w-full rounded-xl border bg-black/20 px-3 text-sm text-white outline-none placeholder:text-white/25 focus:border-white/20 ${
                      errorSection ===
                      "guarantor"
                        ? "border-red-500/30"
                        : "border-white/10"
                    }`}
                  />
                </label>

                {/* PHONE */}

                <label className="block">
                  <span className="mb-1.5 block text-xs font-medium text-white/55">
                    Phone number
                  </span>

                  <input
                    type="tel"
                    value={
                      guarantorPhone
                    }
                    onChange={(
                      event,
                    ) =>
                      handleGuarantorPhoneChange(
                        event.target
                          .value,
                      )
                    }
                    placeholder="07xx xxx xxx"
                    disabled={
                      submitting
                    }
                    className={`h-11 w-full rounded-xl border bg-black/20 px-3 text-sm text-white outline-none placeholder:text-white/25 focus:border-white/20 ${
                      errorSection ===
                      "guarantor"
                        ? "border-red-500/30"
                        : "border-white/10"
                    }`}
                  />
                </label>

                {/* ID */}

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
                    onChange={(
                      event,
                    ) =>
                      handleGuarantorIdChange(
                        event.target
                          .value,
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

              {error &&
                errorSection ===
                  "guarantor" && (
                  <SectionError>
                    {error}
                  </SectionError>
                )}
            </section>

            {/* =================================================
                FINAL SUMMARY
            ================================================= */}

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
                      Repayment installment
                    </span>

                    <span className="font-semibold text-sky-300">
                      {parsedInstallment !==
                      null
                        ? formatKES(
                            parsedInstallment,
                          )
                        : "—"}
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
                      Repayment date
                    </span>

                    <span className="font-medium text-white">
                      {repaymentDate ||
                        "—"}
                    </span>
                  </div>

                  <div className="flex justify-between gap-4">
                    <span className="text-white/45">
                      Loan end date
                    </span>

                    <span className="font-medium text-white">
                      {endDate ||
                        "—"}
                    </span>
                  </div>

                  <div className="flex justify-between gap-4">
                    <span className="text-white/45">
                      Repayment cycle
                    </span>

                    <span className="font-medium text-white">
                      {settings
                        ? `${settings.repaymentCycleDays} days`
                        : "—"}
                    </span>
                  </div>

                  <div className="flex justify-between gap-4">
                    <span className="text-white/45">
                      Fine rate
                    </span>

                    <span className="font-medium text-white">
                      {settings
                        ? `${(
                            settings.fineRate *
                            100
                          ).toFixed(2)}%`
                        : "—"}
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

          {/* =================================================
              FOOTER
          ================================================= */}

          <div className="sticky bottom-0 border-t border-white/10 bg-[#0b0f0e]/95 px-5 py-4 backdrop-blur sm:px-6">
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={
                  handleClose
                }
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
                  loadingSettings
                }
                className="flex h-11 items-center justify-center gap-2 rounded-xl bg-emerald-500 px-6 text-sm font-semibold text-black transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {submitting ? (
                  <>
                    <Loader2
                      size={16}
                      className="animate-spin"
                    />

                    {isEditMode
                      ? "Updating loan..."
                      : "Creating loan..."}
                  </>
                ) : (
                  <>
                    <CheckCircle2
                      size={16}
                    />

                    {isEditMode
                      ? "Update Loan"
                      : "Create Loan"}
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
