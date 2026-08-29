"use client";

import {
  Loader2,
  Plus,
  Wallet,
  X,
} from "lucide-react";

import {
  FormEvent,
  useEffect,
  useState,
} from "react";

import type { Member } from "@/lib/members/types";

import type {
  SavingsAccount,
  SavingsTransaction,
} from "@/lib/savings/types";

import SavingsMemberSelector from "./SavingsMemberSelector";

/* =========================================================
   TYPES
========================================================= */

type SavingsFormProps = {
  open: boolean;
  onClose: () => void;

  onSuccess?: (
    transaction: SavingsTransaction
  ) => void;

  memberId?: string;
  savingsAccountId?: string;
  memberName?: string;
};

type MemberApiResponse = {
  success?: boolean;
  data?: Member[];
  error?: string;
};

type SavingsAccountApiResponse = {
  success?: boolean;
  data?: SavingsAccount | null;
  error?: string;
};

type SavingsTransactionApiResponse = {
  success?: boolean;
  data?: SavingsTransaction;
  error?: string;
};

/* =========================================================
   HELPERS
========================================================= */

function getDefaultDateTime(): string {
  const now = new Date();

  const offset =
    now.getTimezoneOffset();

  const localDate =
    new Date(
      now.getTime() -
        offset * 60 * 1000
    );

  return localDate
    .toISOString()
    .slice(0, 16);
}

function parseAmount(
  value: string
): number | null {
  const cleanValue =
    value.trim();

  if (!cleanValue) {
    return null;
  }

  const amount =
    Number(cleanValue);

  if (
    !Number.isFinite(amount) ||
    amount <= 0
  ) {
    return null;
  }

  return amount;
}

function formatKES(
  amount: number
): string {
  if (!Number.isFinite(amount)) {
    return "KES 0.00";
  }

  return new Intl.NumberFormat(
    "en-KE",
    {
      style: "currency",
      currency: "KES",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }
  ).format(amount);
}

function getMemberFullName(
  member: Member
): string {
  return [
    member.firstName,
    member.middleName,
    member.lastName,
  ]
    .filter(
      (
        value
      ): value is string =>
        typeof value === "string" &&
        value.trim().length > 0
    )
    .map(
      (value) =>
        value.trim()
    )
    .join(" ")
    .trim();
}

/* =========================================================
   COMPONENT
========================================================= */

export default function SavingsForm({
  open,
  onClose,
  onSuccess,
  memberId = "",
}: SavingsFormProps) {
  /* =======================================================
     MEMBER
  ======================================================= */

  const [member, setMember] =
    useState<Member | null>(null);

  /* =======================================================
     SAVINGS ACCOUNT
  ======================================================= */

  const [
    savingsAccount,
    setSavingsAccount,
  ] = useState<SavingsAccount | null>(
    null
  );

  const [
    loadingAccount,
    setLoadingAccount,
  ] = useState(false);

  /* =======================================================
     FORM
  ======================================================= */

  const [amount, setAmount] =
    useState("");

  const [reference, setReference] =
    useState("");

  const [
    transactionAt,
    setTransactionAt,
  ] = useState(
    getDefaultDateTime()
  );

  /* =======================================================
     STATE
  ======================================================= */

  const [error, setError] =
    useState<string | null>(null);

  const [submitting, setSubmitting] =
    useState(false);

  /* =======================================================
     LOAD MEMBER WHEN MEMBER ID IS PROVIDED
  ======================================================= */

  useEffect(() => {
    if (!open) {
      return;
    }

    const cleanMemberId =
      memberId.trim();

    /*
     * If no member ID was supplied by the parent,
     * SavingsMemberSelector is responsible for
     * selecting the member.
     */
    if (!cleanMemberId) {
      setMember(null);
      setSavingsAccount(null);
      setLoadingAccount(false);
      setError(null);
      return;
    }

    let cancelled = false;

    async function loadMember() {
      try {
        setError(null);

        const response =
          await fetch(
            `/api/members?search=${encodeURIComponent(
              cleanMemberId
            )}&page=1&limit=10`,
            {
              method: "GET",
              cache: "no-store",
            }
          );

        let result:
          | MemberApiResponse
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
              "Failed to load member."
          );
        }

        if (
          !result?.success ||
          !Array.isArray(
            result.data
          )
        ) {
          throw new Error(
            result?.error ||
              "Failed to load member."
          );
        }

        /*
         * Member _id is the authoritative
         * identifier.
         */
        const foundMember =
          result.data.find(
            (
              item: Member
            ) =>
              item._id ===
              cleanMemberId
          );

        if (!foundMember) {
          setMember(null);
          setSavingsAccount(null);

          setError(
            "The selected member could not be found."
          );

          return;
        }

        setMember(
          foundMember
        );

        /*
         * The account-loading effect will now
         * load the fixed account using this
         * member's _id.
         */
        setSavingsAccount(null);
      } catch (loadError) {
        if (cancelled) {
          return;
        }

        console.error(
          "Failed to load savings member:",
          loadError
        );

        setMember(null);
        setSavingsAccount(null);

        setError(
          loadError instanceof Error
            ? loadError.message
            : "Failed to load member."
        );
      }
    }

    loadMember();

    return () => {
      cancelled = true;
    };
  }, [open, memberId]);

  /* =========================================================
     LOAD SAVINGS ACCOUNT BY MEMBER ID
  ========================================================= */

  useEffect(() => {
    if (!open) {
      return;
    }

    /*
     * The savings account belongs to the member.
     *
     * Therefore the lookup is always:
     *
     *     member._id
     *          ↓
     *     savings_accounts.memberId
     *
     * No SACCO information is involved.
     */
    const currentMemberId =
      member?._id;

    if (
      typeof currentMemberId !==
        "string" ||
      !currentMemberId.trim()
    ) {
      setSavingsAccount(null);
      setLoadingAccount(false);
      return;
    }

    const cleanMemberId =
      currentMemberId.trim();

    let cancelled = false;

    async function loadSavingsAccount() {
      setLoadingAccount(true);
      setError(null);

      try {
        const response =
          await fetch(
            `/api/savings/accounts?memberId=${encodeURIComponent(
              cleanMemberId
            )}`,
            {
              method: "GET",
              cache: "no-store",
            }
          );

        let result:
          | SavingsAccountApiResponse
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
              "Failed to load savings account."
          );
        }

        if (!result?.success) {
          throw new Error(
            result?.error ||
              "Failed to load savings account."
          );
        }

        /*
         * A valid member with no account.
         *
         * This is a legitimate business state,
         * although new members should normally
         * receive an account automatically.
         */
        if (!result.data) {
          setSavingsAccount(null);

          setError(
            "This member does not have a savings account yet."
          );

          return;
        }

        /*
         * Client-side ownership verification.
         *
         * The API/service remains authoritative,
         * but the client should never silently
         * display another member's account.
         */
        if (
          result.data.memberId !==
          cleanMemberId
        ) {
          console.error(
            "Savings account member mismatch.",
            {
              requestedMemberId:
                cleanMemberId,
              returnedMemberId:
                result.data.memberId,
              accountId:
                result.data.id,
            }
          );

          setSavingsAccount(null);

          setError(
            "The savings account returned by the server does not belong to this member."
          );

          return;
        }

        setSavingsAccount(
          result.data
        );
      } catch (accountError) {
        if (cancelled) {
          return;
        }

        console.error(
          "Savings account loading error:",
          accountError
        );

        setSavingsAccount(null);

        setError(
          accountError instanceof Error
            ? accountError.message
            : "Failed to load savings account."
        );
      } finally {
        if (!cancelled) {
          setLoadingAccount(false);
        }
      }
    }

    loadSavingsAccount();

    return () => {
      cancelled = true;
    };
  }, [open, member]);

  /* =========================================================
     RESET FORM
  ========================================================= */

  function resetForm() {
    setMember(null);
    setSavingsAccount(null);

    setAmount("");
    setReference("");

    setTransactionAt(
      getDefaultDateTime()
    );

    setError(null);
    setSubmitting(false);
    setLoadingAccount(false);
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
     MEMBER CHANGE
  ========================================================= */

  function handleMemberChange(
    selectedMember: Member | null
  ) {
    if (submitting) {
      return;
    }

    /*
     * Change the member first.
     *
     * The account lookup effect automatically
     * searches for this member's fixed account.
     */
    setMember(
      selectedMember
    );

    /*
     * Never retain the previous member's
     * savings account.
     */
    setSavingsAccount(null);

    setError(null);
  }

  /* =========================================================
     SUBMIT
  ========================================================= */

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    if (submitting) {
      return;
    }

    setError(null);

    /* -------------------------------------------------------
       MEMBER
    ------------------------------------------------------- */

    const selectedMember =
      member;

    if (!selectedMember) {
      setError(
        "Select a member before recording savings."
      );

      return;
    }

    const selectedMemberId =
      selectedMember._id;

    if (
      typeof selectedMemberId !==
        "string" ||
      !selectedMemberId.trim()
    ) {
      setError(
        "Selected member has no valid member ID."
      );

      return;
    }

    const cleanSelectedMemberId =
      selectedMemberId.trim();

    /* -------------------------------------------------------
       SAVINGS ACCOUNT
    ------------------------------------------------------- */

    const selectedAccount =
      savingsAccount;

    if (!selectedAccount) {
      setError(
        "The member does not have a savings account."
      );

      return;
    }

    const selectedAccountId =
      selectedAccount.id;

    if (
      typeof selectedAccountId !==
        "string" ||
      !selectedAccountId.trim()
    ) {
      setError(
        "The savings account has no valid account ID."
      );

      return;
    }

    const cleanSelectedAccountId =
      selectedAccountId.trim();

    /*
     * The account MUST belong to the selected
     * member.
     */
    if (
      selectedAccount.memberId !==
      cleanSelectedMemberId
    ) {
      setError(
        "The selected savings account does not belong to this member."
      );

      return;
    }

    /*
     * Only active accounts can receive
     * new savings deposits.
     */
    if (
      !selectedAccount.isActive
    ) {
      setError(
        "This savings account is inactive."
      );

      return;
    }

    /* -------------------------------------------------------
       AMOUNT
    ------------------------------------------------------- */

    const parsedAmount =
      parseAmount(amount);

    if (parsedAmount === null) {
      setError(
        "Enter a valid savings amount greater than zero."
      );

      return;
    }

    /* -------------------------------------------------------
       TRANSACTION DATE
    ------------------------------------------------------- */

    const cleanTransactionAt =
      transactionAt.trim();

    if (!cleanTransactionAt) {
      setError(
        "Transaction date is required."
      );

      return;
    }

    const parsedDate =
      new Date(
        cleanTransactionAt
      );

    if (
      Number.isNaN(
        parsedDate.getTime()
      )
    ) {
      setError(
        "Enter a valid transaction date."
      );

      return;
    }

    /* -------------------------------------------------------
       MEMBER NAME
    ------------------------------------------------------- */

    const cleanMemberName =
      getMemberFullName(
        selectedMember
      );

    if (!cleanMemberName) {
      setError(
        "Selected member does not have a valid name."
      );

      return;
    }

    /* -------------------------------------------------------
       REFERENCE
    ------------------------------------------------------- */

    const cleanReference =
      reference.trim();

    /* -------------------------------------------------------
       SUBMIT
    ------------------------------------------------------- */

    setSubmitting(true);

    try {
      /*
       * The server receives the two authoritative
       * identifiers:
       *
       * memberId
       * savingsAccountId
       *
       * The server MUST verify that the account
       * belongs to the member.
       */
      const payload = {
        savingsAccountId:
          cleanSelectedAccountId,

        memberId:
          cleanSelectedMemberId,

        memberName:
          cleanMemberName,

        amount:
          parsedAmount,

        source:
          "manual",

        reference:
          cleanReference ||
          undefined,

        transactionAt:
          parsedDate.toISOString(),
      };

      const response =
        await fetch(
          "/api/savings/transactions",
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/json",
            },

            body: JSON.stringify(
              payload
            ),
          }
        );

      let result:
        | SavingsTransactionApiResponse
        | null = null;

      try {
        result =
          await response.json();
      } catch {
        result = null;
      }

      /* -----------------------------------------------------
         RESPONSE VALIDATION
      ----------------------------------------------------- */

      if (!response.ok) {
        throw new Error(
          result?.error ||
            "Failed to record savings."
        );
      }

      if (!result?.success) {
        throw new Error(
          result?.error ||
            "Failed to record savings."
        );
      }

      if (!result.data) {
        throw new Error(
          "Savings was recorded but the server returned no transaction."
        );
      }

      /* -----------------------------------------------------
         SUCCESS
      ----------------------------------------------------- */

      onSuccess?.(
        result.data
      );

      resetForm();
      onClose();
    } catch (submitError) {
      console.error(
        "Savings form submission error:",
        submitError
      );

      setError(
        submitError instanceof Error
          ? submitError.message
          : "Failed to record savings."
      );
    } finally {
      setSubmitting(false);
    }
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
    <div
      className="
        fixed
        inset-0
        z-50
        flex
        items-end
        justify-center
        bg-black/70
        p-0
        backdrop-blur-sm
        sm:items-center
        sm:p-4
      "
      role="dialog"
      aria-modal="true"
      aria-labelledby="savings-form-title"
    >
      <div
        className="
          flex
          max-h-[92vh]
          w-full
          flex-col
          overflow-hidden
          rounded-t-3xl
          border
          border-white/[0.08]
          bg-[#0b0b0b]
          shadow-2xl
          sm:max-w-lg
          sm:rounded-3xl
        "
      >
        {/* =================================================
            HEADER
        ================================================= */}

        <div
          className="
            flex
            shrink-0
            items-center
            justify-between
            border-b
            border-white/[0.06]
            px-5
            py-4
          "
        >
          <div
            className="
              flex
              min-w-0
              items-center
              gap-3
            "
          >
            <div
              className="
                flex
                h-10
                w-10
                shrink-0
                items-center
                justify-center
                rounded-xl
                bg-yellow-500/10
                text-yellow-400
              "
            >
              <Wallet
                size={19}
                strokeWidth={1.8}
              />
            </div>

            <div className="min-w-0">
              <h2
                id="savings-form-title"
                className="
                  text-sm
                  font-semibold
                  text-white
                "
              >
                Add Savings
              </h2>

              <p
                className="
                  mt-0.5
                  text-xs
                  text-white/30
                "
              >
                Record a manual savings deposit
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={
              handleClose
            }
            disabled={
              submitting
            }
            className="
              flex
              h-9
              w-9
              shrink-0
              items-center
              justify-center
              rounded-xl
              text-white/35
              transition
              hover:bg-white/[0.05]
              hover:text-white
              disabled:cursor-not-allowed
              disabled:opacity-40
            "
            aria-label="Close"
          >
            <X
              size={18}
              strokeWidth={1.8}
            />
          </button>
        </div>

        {/* =================================================
            FORM
        ================================================= */}

        <form
          onSubmit={
            handleSubmit
          }
          className="overflow-y-auto"
        >
          <div
            className="
              space-y-5
              p-5
            "
          >
            {/* =============================================
                MEMBER
            ============================================= */}

            <SavingsMemberSelector
              value={
                member
              }
              onChange={
                handleMemberChange
              }
              disabled={
                submitting
              }
            />

            {/* =============================================
                SAVINGS ACCOUNT
            ============================================= */}

            {member && (
              <div>
                <label
                  className="
                    mb-2
                    block
                    text-xs
                    font-medium
                    text-white/55
                  "
                >
                  Savings Account
                </label>

                {loadingAccount ? (
                  <div
                    className="
                      flex
                      h-16
                      items-center
                      justify-center
                      gap-2
                      rounded-xl
                      border
                      border-white/[0.08]
                      bg-black
                      text-xs
                      text-white/30
                    "
                  >
                    <Loader2
                      size={15}
                      className="animate-spin"
                    />

                    <span>
                      Finding member savings account...
                    </span>
                  </div>
                ) : savingsAccount ? (
                  <div
                    className="
                      rounded-xl
                      border
                      border-white/[0.08]
                      bg-black
                      px-4
                      py-3
                    "
                  >
                    <div
                      className="
                        flex
                        items-center
                        justify-between
                        gap-3
                      "
                    >
                      <div className="min-w-0">
                        <p
                          className="
                            truncate
                            font-mono
                            text-xs
                            text-white/45
                          "
                        >
                          {
                            savingsAccount.accountNumber
                          }
                        </p>

                        <p
                          className="
                            mt-1
                            text-[11px]
                            text-white/25
                          "
                        >
                          Fixed savings account
                        </p>

                        {!savingsAccount.isActive && (
                          <p
                            className="
                              mt-1
                              text-[10px]
                              font-medium
                              text-red-400
                            "
                          >
                            Inactive account
                          </p>
                        )}
                      </div>

                      <div
                        className="
                          shrink-0
                          text-right
                        "
                      >
                        <p
                          className="
                            text-[9px]
                            font-semibold
                            uppercase
                            tracking-[0.15em]
                            text-white/20
                          "
                        >
                          Balance
                        </p>

                        <p
                          className="
                            mt-1
                            text-sm
                            font-semibold
                            text-yellow-400
                          "
                        >
                          {formatKES(
                            Number(
                              savingsAccount.balance
                            )
                          )}
                        </p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div
                    className="
                      rounded-xl
                      border
                      border-yellow-500/10
                      bg-yellow-500/[0.03]
                      px-4
                      py-3
                      text-xs
                      leading-5
                      text-yellow-400/70
                    "
                  >
                    This member does not have
                    a savings account yet.
                  </div>
                )}
              </div>
            )}

            {/* =============================================
                AMOUNT
            ============================================= */}

            <div>
              <label
                htmlFor="savings-amount"
                className="
                  mb-2
                  block
                  text-xs
                  font-medium
                  text-white/55
                "
              >
                Amount
              </label>

              <div className="relative">
                <span
                  className="
                    pointer-events-none
                    absolute
                    left-3
                    top-1/2
                    -translate-y-1/2
                    text-xs
                    font-medium
                    text-white/30
                  "
                >
                  KES
                </span>

                <input
                  id="savings-amount"
                  type="number"
                  inputMode="decimal"
                  min="0.01"
                  step="0.01"
                  value={
                    amount
                  }
                  onChange={(
                    event
                  ) =>
                    setAmount(
                      event.target.value
                    )
                  }
                  placeholder="0.00"
                  disabled={
                    submitting ||
                    !savingsAccount ||
                    !savingsAccount.isActive
                  }
                  className="
                    h-12
                    w-full
                    rounded-xl
                    border
                    border-white/[0.08]
                    bg-black
                    pl-12
                    pr-3
                    text-lg
                    font-semibold
                    text-white
                    outline-none
                    placeholder:text-white/15
                    focus:border-yellow-500/40
                    disabled:cursor-not-allowed
                    disabled:opacity-50
                  "
                />
              </div>
            </div>

            {/* =============================================
                REFERENCE
            ============================================= */}

            <div>
              <label
                htmlFor="savings-reference"
                className="
                  mb-2
                  block
                  text-xs
                  font-medium
                  text-white/55
                "
              >
                Reference

                <span
                  className="
                    ml-1
                    text-white/20
                  "
                >
                  optional
                </span>
              </label>

              <input
                id="savings-reference"
                value={
                  reference
                }
                onChange={(
                  event
                ) =>
                  setReference(
                    event.target.value
                  )
                }
                placeholder="Receipt or manual reference"
                autoComplete="off"
                disabled={
                  submitting
                }
                className="
                  h-11
                  w-full
                  rounded-xl
                  border
                  border-white/[0.08]
                  bg-black
                  px-3
                  font-mono
                  text-sm
                  text-white
                  outline-none
                  placeholder:font-sans
                  placeholder:text-white/20
                  focus:border-yellow-500/40
                  disabled:cursor-not-allowed
                  disabled:opacity-50
                "
              />
            </div>

            {/* =============================================
                DATE
            ============================================= */}

            <div>
              <label
                htmlFor="savings-date"
                className="
                  mb-2
                  block
                  text-xs
                  font-medium
                  text-white/55
                "
              >
                Transaction Date
              </label>

              <input
                id="savings-date"
                type="datetime-local"
                value={
                  transactionAt
                }
                onChange={(
                  event
                ) =>
                  setTransactionAt(
                    event.target.value
                  )
                }
                disabled={
                  submitting
                }
                className="
                  h-11
                  w-full
                  rounded-xl
                  border
                  border-white/[0.08]
                  bg-black
                  px-3
                  text-sm
                  text-white
                  outline-none
                  focus:border-yellow-500/40
                  disabled:cursor-not-allowed
                  disabled:opacity-50
                "
              />
            </div>

            {/* =============================================
                ERROR
            ============================================= */}

            {error && (
              <div
                role="alert"
                className="
                  rounded-xl
                  border
                  border-red-500/15
                  bg-red-500/[0.06]
                  px-3
                  py-3
                  text-xs
                  leading-5
                  text-red-400
                "
              >
                {error}
              </div>
            )}
          </div>

          {/* =================================================
              FOOTER
          ================================================= */}

          <div
            className="
              sticky
              bottom-0
              flex
              shrink-0
              gap-3
              border-t
              border-white/[0.06]
              bg-[#0b0b0b]
              p-4
            "
          >
            <button
              type="button"
              onClick={
                handleClose
              }
              disabled={
                submitting
              }
              className="
                h-11
                flex-1
                rounded-xl
                border
                border-white/[0.08]
                text-sm
                font-medium
                text-white/50
                transition
                hover:bg-white/[0.04]
                hover:text-white
                disabled:cursor-not-allowed
                disabled:opacity-40
              "
            >
              Cancel
            </button>

            <button
              type="submit"
              disabled={
                submitting ||
                !member ||
                !savingsAccount ||
                !savingsAccount.isActive ||
                loadingAccount
              }
              className="
                inline-flex
                h-11
                flex-1
                items-center
                justify-center
                gap-2
                rounded-xl
                bg-yellow-500
                text-sm
                font-semibold
                text-black
                transition
                hover:bg-yellow-400
                active:scale-[0.98]
                disabled:cursor-not-allowed
                disabled:opacity-50
              "
            >
              {submitting ? (
                <>
                  <Loader2
                    size={16}
                    className="animate-spin"
                  />

                  <span>
                    Saving...
                  </span>
                </>
              ) : (
                <>
                  <Plus
                    size={16}
                    strokeWidth={2}
                  />

                  <span>
                    Record Savings
                  </span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
