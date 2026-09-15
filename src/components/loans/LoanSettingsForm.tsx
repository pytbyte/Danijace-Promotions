"use client";

import {
  FormEvent,
  useEffect,
  useState,
} from "react";

import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  Save,
  Settings2,
  X,
} from "lucide-react";

import type { LoanSettings } from "@/lib/loans/types";

/* =========================================================
   PROPS
========================================================= */

interface LoanSettingsFormProps {
  open: boolean;
  onClose: () => void;
}

/* =========================================================
   FORM TYPE
========================================================= */

type LoanSettingsFormState = {
  /*
   * Interest rates and fine rate are stored by the API
   * as decimal fractions:
   *
   * 30% = 0.30
   * 10% = 0.10
   *
   * The administrator enters normal percentages:
   *
   * 30
   * 10
   */

  regularInterestRate: string;
  emergencyInterestRate: string;

  regularMinimumSavings: string;
  regularSavingsMultiplier: string;

  repaymentGraceDays: string;
  repaymentCycleDays: string;
  fineRate: string;

  emergencyLoansEnabled: boolean;
  regularLoansEnabled: boolean;
};

/* =========================================================
   DEFAULT FORM
========================================================= */

const DEFAULT_FORM: LoanSettingsFormState = {
  regularInterestRate: "",
  emergencyInterestRate: "",

  regularMinimumSavings: "",
  regularSavingsMultiplier: "",

  repaymentGraceDays: "",
  repaymentCycleDays: "",
  fineRate: "",

  emergencyLoansEnabled: false,
  regularLoansEnabled: false,
};

/* =========================================================
   HELPERS
========================================================= */

/**
 * Convert database settings into values suitable for the
 * administrator-facing form.
 *
 * Database:
 *
 *   0.30
 *
 * Form:
 *
 *   30
 */
function settingsToForm(
  settings: LoanSettings,
): LoanSettingsFormState {
  return {
    regularInterestRate:
      Number.isFinite(
        settings.regularInterestRate,
      )
        ? String(
            settings.regularInterestRate * 100,
          )
        : "",

    emergencyInterestRate:
      Number.isFinite(
        settings.emergencyInterestRate,
      )
        ? String(
            settings.emergencyInterestRate * 100,
          )
        : "",

    regularMinimumSavings:
      Number.isFinite(
        settings.regularMinimumSavings,
      )
        ? String(
            settings.regularMinimumSavings,
          )
        : "",

    regularSavingsMultiplier:
      Number.isFinite(
        settings.regularSavingsMultiplier,
      )
        ? String(
            settings.regularSavingsMultiplier,
          )
        : "",

    repaymentGraceDays:
      Number.isFinite(
        settings.repaymentGraceDays,
      )
        ? String(
            settings.repaymentGraceDays,
          )
        : "",

    repaymentCycleDays:
      Number.isFinite(
        settings.repaymentCycleDays,
      )
        ? String(
            settings.repaymentCycleDays,
          )
        : "",

    fineRate:
      Number.isFinite(
        settings.fineRate,
      )
        ? String(
            settings.fineRate * 100,
          )
        : "",

    emergencyLoansEnabled:
      Boolean(
        settings.emergencyLoansEnabled,
      ),

    regularLoansEnabled:
      Boolean(
        settings.regularLoansEnabled,
      ),
  };
}

/**
 * Convert administrator-facing form values into the
 * database/API representation.
 *
 * Admin:
 *
 *   30%
 *
 * API:
 *
 *   0.30
 */
function formToPayload(
  form: LoanSettingsFormState,
) {
  return {
    regularInterestRate:
      Number(form.regularInterestRate) / 100,

    emergencyInterestRate:
      Number(form.emergencyInterestRate) / 100,

    regularMinimumSavings:
      Number(form.regularMinimumSavings),

    regularSavingsMultiplier:
      Number(form.regularSavingsMultiplier),

    repaymentGraceDays:
      Number(form.repaymentGraceDays),

    repaymentCycleDays:
      Number(form.repaymentCycleDays),

    fineRate:
      Number(form.fineRate) / 100,

    emergencyLoansEnabled:
      form.emergencyLoansEnabled,

    regularLoansEnabled:
      form.regularLoansEnabled,
  };
}

/* =========================================================
   MONEY FORMAT
========================================================= */

function formatKES(
  value: number,
): string {
  if (!Number.isFinite(value)) {
    return "KES 0.00";
  }

  return `KES ${value.toLocaleString(
    "en-KE",
    {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    },
  )}`;
}

/* =========================================================
   API ERROR HELPER
========================================================= */

function getApiError(
  result: unknown,
  fallback: string,
): string {
  if (
    typeof result === "object" &&
    result !== null &&
    "error" in result
  ) {
    const error = (
      result as {
        error?: unknown;
      }
    ).error;

    if (typeof error === "string") {
      return error;
    }
  }

  return fallback;
}

/* =========================================================
   NUMBER FIELD
========================================================= */

interface NumberFieldProps {
  label: string;
  description?: string;

  value: string;

  onChange: (
    value: string,
  ) => void;

  step?: string;
  min?: string;
  max?: string;

  suffix?: string;
  prefix?: string;

  placeholder?: string;

  disabled?: boolean;
}

function NumberField({
  label,
  description,
  value,
  onChange,
  step = "0.01",
  min = "0",
  max,
  suffix,
  prefix,
  placeholder,
  disabled = false,
}: NumberFieldProps) {
  return (
    <div className="min-w-0">
      <label className="block text-sm font-medium text-white">
        {label}
      </label>

      {description && (
        <p className="mt-1 text-xs leading-5 text-white/35">
          {description}
        </p>
      )}

      <div className="relative mt-2">
        {prefix && (
          <span
            className="
              pointer-events-none
              absolute
              left-3
              top-1/2
              -translate-y-1/2
              text-sm
              text-white/35
            "
          >
            {prefix}
          </span>
        )}

        <input
          type="number"
          inputMode="decimal"
          min={min}
          max={max}
          step={step}
          value={value}
          placeholder={placeholder}
          disabled={disabled}
          onChange={(event) =>
            onChange(
              event.target.value,
            )
          }
          className={`
            h-11
            w-full
            rounded-xl
            border
            border-white/[0.08]
            bg-black/30
            px-3
            text-sm
            text-white
            outline-none
            transition
            placeholder:text-white/20
            focus:border-yellow-500/40
            focus:bg-black/40
            disabled:cursor-not-allowed
            disabled:opacity-50
            ${prefix ? "pl-10" : ""}
            ${suffix ? "pr-12" : ""}
          `}
        />

        {suffix && (
          <span
            className="
              pointer-events-none
              absolute
              right-3
              top-1/2
              -translate-y-1/2
              text-xs
              font-medium
              text-white/35
            "
          >
            {suffix}
          </span>
        )}
      </div>
    </div>
  );
}

/* =========================================================
   TOGGLE
========================================================= */

interface ToggleProps {
  label: string;
  description: string;
  checked: boolean;
  onChange: (
    value: boolean,
  ) => void;
  disabled?: boolean;
}

function Toggle({
  label,
  description,
  checked,
  onChange,
  disabled = false,
}: ToggleProps) {
  return (
    <div
      className="
        flex
        min-w-0
        items-center
        justify-between
        gap-4
        rounded-xl
        border
        border-white/[0.08]
        bg-black/20
        p-4
      "
    >
      <div className="min-w-0">
        <p className="text-sm font-medium text-white">
          {label}
        </p>

        <p className="mt-1 text-xs leading-5 text-white/35">
          {description}
        </p>
      </div>

      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() =>
          onChange(!checked)
        }
        className={`
          relative
          h-6
          w-11
          shrink-0
          rounded-full
          transition
          disabled:cursor-not-allowed
          disabled:opacity-40
          ${
            checked
              ? "bg-yellow-500"
              : "bg-white/15"
          }
        `}
      >
        <span
          className={`
            absolute
            top-1
            h-4
            w-4
            rounded-full
            bg-white
            shadow-sm
            transition
            ${
              checked
                ? "left-6"
                : "left-1"
            }
          `}
        />
      </button>
    </div>
  );
}

/* =========================================================
   MAIN
========================================================= */

export default function LoanSettingsForm({
  open,
  onClose,
}: LoanSettingsFormProps) {
  const [form, setForm] =
    useState<LoanSettingsFormState>(
      DEFAULT_FORM,
    );

  const [loading, setLoading] =
    useState(false);

  const [saving, setSaving] =
    useState(false);

  const [error, setError] =
    useState("");

  const [success, setSuccess] =
    useState("");

  /* =======================================================
     LOAD SETTINGS
  ======================================================= */

  useEffect(() => {
    if (!open) {
      return;
    }

    let cancelled = false;

    async function loadSettings() {
      try {
        setLoading(true);
        setError("");
        setSuccess("");

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

        let result: unknown = null;

        try {
          result =
            await response.json();
        } catch {
          throw new Error(
            "The server returned an invalid response.",
          );
        }

        if (cancelled) {
          return;
        }

        if (response.status === 404) {
          setForm(
            DEFAULT_FORM,
          );

          setError("");

          return;
        }

        if (!response.ok) {
          throw new Error(
            getApiError(
              result,
              "Failed to load loan settings.",
            ),
          );
        }

        if (
          typeof result !==
            "object" ||
          result === null ||
          !("data" in result)
        ) {
          throw new Error(
            "Invalid loan settings response.",
          );
        }

        const settings =
          (
            result as {
              data?: LoanSettings;
            }
          ).data;

        if (!settings) {
          setForm(
            DEFAULT_FORM,
          );

          return;
        }

        setForm(
          settingsToForm(
            settings,
          ),
        );
      } catch (err) {
        if (!cancelled) {
          console.error(
            "Failed to load loan settings:",
            err,
          );

          setError(
            err instanceof Error
              ? err.message
              : "Failed to load loan settings.",
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadSettings();

    return () => {
      cancelled = true;
    };
  }, [open]);

  /* =======================================================
     ESCAPE KEY
  ======================================================= */

  useEffect(() => {
    if (!open) {
      return;
    }

    function handleKeyDown(
      event: KeyboardEvent,
    ) {
      if (
        event.key === "Escape" &&
        !saving
      ) {
        onClose();
      }
    }

    window.addEventListener(
      "keydown",
      handleKeyDown,
    );

    return () => {
      window.removeEventListener(
        "keydown",
        handleKeyDown,
      );
    };
  }, [
    open,
    saving,
    onClose,
  ]);

  /* =======================================================
     UPDATE FIELD
  ======================================================= */

  function updateField(
    field: keyof LoanSettingsFormState,
    value: string | boolean,
  ) {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));

    setError("");
    setSuccess("");
  }

  /* =======================================================
     VALIDATE
  ======================================================= */

  function validateForm(
    payload: ReturnType<
      typeof formToPayload
    >,
  ) {
    const numericFields = [
      [
        "Regular interest rate",
        payload.regularInterestRate,
      ],
      [
        "Emergency interest rate",
        payload.emergencyInterestRate,
      ],
      [
        "Regular minimum savings",
        payload.regularMinimumSavings,
      ],
      [
        "Regular savings multiplier",
        payload.regularSavingsMultiplier,
      ],
      [
        "Repayment grace days",
        payload.repaymentGraceDays,
      ],
      [
        "Repayment cycle days",
        payload.repaymentCycleDays,
      ],
      [
        "Fine rate",
        payload.fineRate,
      ],
    ] as const;

    for (
      const [label, value] of numericFields
    ) {
      if (
        !Number.isFinite(value)
      ) {
        throw new Error(
          `${label} must be a valid number.`,
        );
      }
    }

    /* =====================================================
       INTEREST
    ===================================================== */

    if (
      payload.regularInterestRate < 0 ||
      payload.regularInterestRate > 1
    ) {
      throw new Error(
        "Regular interest rate must be between 0% and 100%.",
      );
    }

    if (
      payload.emergencyInterestRate < 0 ||
      payload.emergencyInterestRate > 1
    ) {
      throw new Error(
        "Emergency interest rate must be between 0% and 100%.",
      );
    }

    /* =====================================================
       MINIMUM SAVINGS
    ===================================================== */

    if (
      payload.regularMinimumSavings <= 0
    ) {
      throw new Error(
        "Regular minimum savings must be greater than zero.",
      );
    }

    /* =====================================================
       SAVINGS MULTIPLIER
    ===================================================== */

    if (
      payload.regularSavingsMultiplier <= 0
    ) {
      throw new Error(
        "Regular savings multiplier must be greater than zero.",
      );
    }

    /* =====================================================
       GRACE DAYS
    ===================================================== */

    if (
      !Number.isInteger(
        payload.repaymentGraceDays,
      ) ||
      payload.repaymentGraceDays < 0
    ) {
      throw new Error(
        "Repayment grace days must be a whole number of zero or greater.",
      );
    }

    /* =====================================================
       REPAYMENT CYCLE
    ===================================================== */

    if (
      !Number.isInteger(
        payload.repaymentCycleDays,
      ) ||
      payload.repaymentCycleDays < 1 ||
      payload.repaymentCycleDays > 3650
    ) {
      throw new Error(
        "Repayment cycle must be a whole number between 1 and 3650 days.",
      );
    }

    /* =====================================================
       FINE RATE
    ===================================================== */

    if (
      payload.fineRate < 0 ||
      payload.fineRate > 1
    ) {
      throw new Error(
        "Fine rate must be between 0% and 100%.",
      );
    }
  }

  /* =======================================================
     SAVE
  ======================================================= */

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    if (saving) {
      return;
    }

    setSaving(true);
    setError("");
    setSuccess("");

    try {
      const payload =
        formToPayload(form);

      validateForm(payload);

      const response =
        await fetch(
          "/api/loans/settings",
          {
            method: "PATCH",
            headers: {
              "Content-Type":
                "application/json",
              Accept:
                "application/json",
            },
            body: JSON.stringify(
              payload,
            ),
          },
        );

      let result: unknown = null;

      try {
        result =
          await response.json();
      } catch {
        throw new Error(
          "The server returned an invalid response.",
        );
      }

      if (!response.ok) {
        throw new Error(
          getApiError(
            result,
            "Failed to save loan settings.",
          ),
        );
      }

      if (
        typeof result !==
          "object" ||
        result === null ||
        !("data" in result)
      ) {
        throw new Error(
          "Invalid response after saving loan settings.",
        );
      }

      const updated =
        (
          result as {
            data?: LoanSettings;
          }
        ).data;

      if (!updated) {
        throw new Error(
          "The server did not return the updated loan settings.",
        );
      }

      /*
       * The database/API response is authoritative.
       *
       * Convert decimal rates back into administrator-
       * facing percentages.
       */
      setForm(
        settingsToForm(
          updated,
        ),
      );

      setSuccess(
        "Loan settings saved successfully.",
      );
    } catch (err) {
      console.error(
        "Failed to save loan settings:",
        err,
      );

      setError(
        err instanceof Error
          ? err.message
          : "Failed to save loan settings.",
      );
    } finally {
      setSaving(false);
    }
  }

  /* =======================================================
     CLOSED
  ======================================================= */

  if (!open) {
    return null;
  }

  /* =======================================================
     MODAL
  ======================================================= */

  return (
    <div
      className="
        fixed
        inset-0
        z-[100]
        flex
        items-end
        justify-center
        bg-black/75
        p-0
        backdrop-blur-sm
        sm:items-center
        sm:p-4
      "
      onMouseDown={(event) => {
        if (
          event.target ===
            event.currentTarget &&
          !saving
        ) {
          onClose();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="loan-settings-title"
        className="
          flex
          max-h-[94dvh]
          w-full
          min-w-0
          flex-col
          overflow-hidden
          rounded-t-3xl
          border
          border-white/[0.09]
          bg-[#0a0a0a]
          shadow-2xl
          sm:max-w-3xl
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
            gap-4
            border-b
            border-white/[0.07]
            px-4
            py-4
            sm:px-6
          "
        >
          <div className="flex min-w-0 items-center gap-3">
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
              <Settings2
                size={19}
                strokeWidth={1.8}
              />
            </div>

            <div className="min-w-0">
              <h2
                id="loan-settings-title"
                className="truncate text-base font-semibold text-white"
              >
                Loan Settings
              </h2>

              <p className="mt-0.5 truncate text-xs text-white/30">
                Configure loan rules, eligibility,
                repayment and availability
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="
              flex
              h-9
              w-9
              shrink-0
              items-center
              justify-center
              rounded-xl
              border
              border-white/[0.07]
              bg-white/[0.03]
              text-white/40
              transition
              hover:bg-white/[0.07]
              hover:text-white
              disabled:cursor-not-allowed
              disabled:opacity-40
            "
            aria-label="Close loan settings"
          >
            <X size={18} />
          </button>
        </div>

        {/* =================================================
            CONTENT
        ================================================= */}

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <div className="p-4 sm:p-6">
            {loading ? (
              <div className="flex min-h-[420px] items-center justify-center">
                <div className="text-center">
                  <Loader2
                    size={28}
                    className="mx-auto animate-spin text-yellow-400"
                  />

                  <p className="mt-3 text-sm text-white/40">
                    Loading loan settings...
                  </p>
                </div>
              </div>
            ) : (
              <form
                id="loan-settings-form"
                onSubmit={handleSubmit}
                className="space-y-4"
              >
                {/* =================================================
                    ERROR
                ================================================= */}

                {error && (
                  <div
                    role="alert"
                    className="
                      flex
                      items-start
                      gap-3
                      rounded-xl
                      border
                      border-red-500/15
                      bg-red-500/[0.06]
                      p-3
                    "
                  >
                    <AlertCircle
                      size={18}
                      className="mt-0.5 shrink-0 text-red-400"
                    />

                    <p className="text-xs leading-5 text-red-300">
                      {error}
                    </p>
                  </div>
                )}

                {/* =================================================
                    SUCCESS
                ================================================= */}

                {success && (
                  <div
                    role="status"
                    className="
                      flex
                      items-start
                      gap-3
                      rounded-xl
                      border
                      border-emerald-500/15
                      bg-emerald-500/[0.06]
                      p-3
                    "
                  >
                    <CheckCircle2
                      size={18}
                      className="mt-0.5 shrink-0 text-emerald-400"
                    />

                    <p className="text-xs leading-5 text-emerald-300">
                      {success}
                    </p>
                  </div>
                )}

                {/* =================================================
                    INTEREST RATES
                ================================================= */}

                <section
                  className="
                    rounded-2xl
                    border
                    border-white/[0.07]
                    bg-white/[0.02]
                    p-4
                    sm:p-5
                  "
                >
                  <div>
                    <h3 className="text-sm font-semibold text-white">
                      Interest Rates
                    </h3>

                    <p className="mt-1 text-xs leading-5 text-white/30">
                      Enter the actual percentage charged
                      on the loan. For example,
                      <span className="font-medium text-yellow-400/70">
                        {" "}
                        30%
                      </span>{" "}
                      should be entered as
                      <span className="font-medium text-yellow-400/70">
                        {" "}
                        30
                      </span>
                      .
                    </p>
                  </div>

                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <NumberField
                      label="Regular Interest Rate"
                      description="Interest charged on regular loans."
                      value={
                        form.regularInterestRate
                      }
                      onChange={(value) =>
                        updateField(
                          "regularInterestRate",
                          value,
                        )
                      }
                      min="0"
                      max="100"
                      step="0.01"
                      suffix="%"
                      placeholder="30"
                      disabled={saving}
                    />

                    <NumberField
                      label="Emergency Interest Rate"
                      description="Interest charged on emergency loans."
                      value={
                        form.emergencyInterestRate
                      }
                      onChange={(value) =>
                        updateField(
                          "emergencyInterestRate",
                          value,
                        )
                      }
                      min="0"
                      max="100"
                      step="0.01"
                      suffix="%"
                      placeholder="40"
                      disabled={saving}
                    />
                  </div>

                  <div
                    className="
                      mt-4
                      rounded-xl
                      border
                      border-yellow-500/10
                      bg-yellow-500/[0.035]
                      px-3
                      py-2.5
                    "
                  >
                    <p className="text-[11px] leading-5 text-white/35">
                      Example: entering{" "}
                      <span className="font-semibold text-yellow-400">
                        30
                      </span>{" "}
                      means{" "}
                      <span className="font-semibold text-yellow-400">
                        30%
                      </span>
                      . The system stores this safely as{" "}
                      <span className="font-mono text-yellow-400">
                        0.30
                      </span>
                      .
                    </p>
                  </div>
                </section>

                {/* =================================================
                    REGULAR LOAN ELIGIBILITY
                ================================================= */}

                <section
                  className="
                    rounded-2xl
                    border
                    border-white/[0.07]
                    bg-white/[0.02]
                    p-4
                    sm:p-5
                  "
                >
                  <div>
                    <h3 className="text-sm font-semibold text-white">
                      Regular Loan Eligibility
                    </h3>

                    <p className="mt-1 text-xs leading-5 text-white/30">
                      These rules determine whether a member
                      qualifies and the maximum amount they
                      can borrow against their savings.
                    </p>
                  </div>

                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <NumberField
                      label="Minimum Savings"
                      description="Minimum savings a member must have before qualifying."
                      value={
                        form.regularMinimumSavings
                      }
                      onChange={(value) =>
                        updateField(
                          "regularMinimumSavings",
                          value,
                        )
                      }
                      min="0"
                      step="0.01"
                      prefix="KES"
                      placeholder="10000"
                      disabled={saving}
                    />

                    <NumberField
                      label="Savings Multiplier"
                      description="Maximum regular loan as a multiple of savings."
                      value={
                        form.regularSavingsMultiplier
                      }
                      onChange={(value) =>
                        updateField(
                          "regularSavingsMultiplier",
                          value,
                        )
                      }
                      min="0"
                      step="0.1"
                      suffix="×"
                      placeholder="2"
                      disabled={saving}
                    />
                  </div>

                  <div
                    className="
                      mt-4
                      rounded-xl
                      border
                      border-white/[0.07]
                      bg-black/20
                      p-3
                    "
                  >
                    <p className="text-[11px] leading-5 text-white/35">
                      Example: if savings are{" "}
                      <span className="text-white/60">
                        KES 10,000
                      </span>{" "}
                      and the multiplier is{" "}
                      <span className="text-yellow-400">
                        2×
                      </span>
                      , the maximum regular loan is{" "}
                      <span className="font-semibold text-yellow-400">
                        KES 20,000
                      </span>
                      .
                    </p>
                  </div>
                </section>

                {/* =================================================
                    REPAYMENT & FINES
                ================================================= */}

                <section
                  className="
                    rounded-2xl
                    border
                    border-white/[0.07]
                    bg-white/[0.02]
                    p-4
                    sm:p-5
                  "
                >
                  <div>
                    <h3 className="text-sm font-semibold text-white">
                      Repayment & Fines
                    </h3>

                    <p className="mt-1 text-xs leading-5 text-white/30">
                      Configure the repayment cycle, grace
                      period and percentage fine applied to
                      an unpaid installment shortfall.
                    </p>
                  </div>

                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <NumberField
                      label="Repayment Cycle"
                      description="Number of days in one repayment cycle."
                      value={
                        form.repaymentCycleDays
                      }
                      onChange={(value) =>
                        updateField(
                          "repaymentCycleDays",
                          value,
                        )
                      }
                      min="1"
                      max="3650"
                      step="1"
                      suffix="days"
                      placeholder="7"
                      disabled={saving}
                    />

                    <NumberField
                      label="Repayment Grace Days"
                      description="Additional days allowed before repayment becomes overdue."
                      value={
                        form.repaymentGraceDays
                      }
                      onChange={(value) =>
                        updateField(
                          "repaymentGraceDays",
                          value,
                        )
                      }
                      min="0"
                      step="1"
                      suffix="days"
                      placeholder="7"
                      disabled={saving}
                    />

                    <NumberField
                      label="Fine Rate"
                      description="Percentage charged on the unpaid portion of the expected installment."
                      value={
                        form.fineRate
                      }
                      onChange={(value) =>
                        updateField(
                          "fineRate",
                          value,
                        )
                      }
                      min="0"
                      max="100"
                      step="0.01"
                      suffix="%"
                      placeholder="10"
                      disabled={saving}
                    />
                  </div>

                  <div
                    className="
                      mt-4
                      rounded-xl
                      border
                      border-yellow-500/10
                      bg-yellow-500/[0.035]
                      px-3
                      py-2.5
                    "
                  >
                    <p className="text-[11px] leading-5 text-white/35">
                      Example: with a{" "}
                      <span className="text-yellow-400">
                        KES 5,000
                      </span>{" "}
                      weekly installment and{" "}
                      <span className="text-yellow-400">
                        10%
                      </span>{" "}
                      fine rate, paying only KES 3,000 leaves
                      a KES 2,000 shortfall, producing a{" "}
                      <span className="font-semibold text-yellow-400">
                        KES 200
                      </span>{" "}
                      fine.
                    </p>
                  </div>
                </section>

                {/* =================================================
                    AVAILABILITY
                ================================================= */}

                <section
                  className="
                    rounded-2xl
                    border
                    border-white/[0.07]
                    bg-white/[0.02]
                    p-4
                    sm:p-5
                  "
                >
                  <div>
                    <h3 className="text-sm font-semibold text-white">
                      Loan Availability
                    </h3>

                    <p className="mt-1 text-xs leading-5 text-white/30">
                      Disable a loan type to prevent new
                      loans of that type from being created.
                      Existing loans are not affected.
                    </p>
                  </div>

                  <div className="mt-4 space-y-3">
                    <Toggle
                      label="Regular Loans"
                      description="Allow eligible members to receive regular loans."
                      checked={
                        form.regularLoansEnabled
                      }
                      onChange={(value) =>
                        updateField(
                          "regularLoansEnabled",
                          value,
                        )
                      }
                      disabled={saving}
                    />

                    <Toggle
                      label="Emergency Loans"
                      description="Allow eligible members to receive emergency loans."
                      checked={
                        form.emergencyLoansEnabled
                      }
                      onChange={(value) =>
                        updateField(
                          "emergencyLoansEnabled",
                          value,
                        )
                      }
                      disabled={saving}
                    />
                  </div>
                </section>

                {/* =================================================
                    CURRENT CONFIGURATION SUMMARY
                ================================================= */}

                <section
                  className="
                    rounded-2xl
                    border
                    border-white/[0.07]
                    bg-black/20
                    p-4
                    sm:p-5
                  "
                >
                  <h3 className="text-sm font-semibold text-white">
                    Configuration Summary
                  </h3>

                  <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
                    <SummaryItem
                      label="Regular Rate"
                      value={
                        form.regularInterestRate
                          ? `${form.regularInterestRate}%`
                          : "—"
                      }
                    />

                    <SummaryItem
                      label="Emergency Rate"
                      value={
                        form.emergencyInterestRate
                          ? `${form.emergencyInterestRate}%`
                          : "—"
                      }
                    />

                    <SummaryItem
                      label="Multiplier"
                      value={
                        form.regularSavingsMultiplier
                          ? `${form.regularSavingsMultiplier}×`
                          : "—"
                      }
                    />

                    <SummaryItem
                      label="Minimum Savings"
                      value={
                        form.regularMinimumSavings
                          ? formatKES(
                              Number(
                                form.regularMinimumSavings,
                              ),
                            )
                          : "—"
                      }
                    />

                    <SummaryItem
                      label="Repayment Cycle"
                      value={
                        form.repaymentCycleDays
                          ? `${form.repaymentCycleDays} days`
                          : "—"
                      }
                    />

                    <SummaryItem
                      label="Grace Period"
                      value={
                        form.repaymentGraceDays
                          ? `${form.repaymentGraceDays} days`
                          : "—"
                      }
                    />

                    <SummaryItem
                      label="Fine Rate"
                      value={
                        form.fineRate
                          ? `${form.fineRate}%`
                          : "—"
                      }
                    />
                  </div>

                  <div className="mt-4 border-t border-white/[0.06] pt-4">
                    <div className="flex flex-wrap gap-2">
                      <StatusBadge
                        label="Regular Loans"
                        enabled={
                          form.regularLoansEnabled
                        }
                      />

                      <StatusBadge
                        label="Emergency Loans"
                        enabled={
                          form.emergencyLoansEnabled
                        }
                      />
                    </div>
                  </div>
                </section>
              </form>
            )}
          </div>
        </div>

        {/* =================================================
            FOOTER
        ================================================= */}

        {!loading && (
          <div
            className="
              flex
              shrink-0
              flex-col-reverse
              gap-2
              border-t
              border-white/[0.07]
              bg-[#0a0a0a]
              p-4
              sm:flex-row
              sm:items-center
              sm:justify-end
              sm:px-6
            "
          >
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="
                h-11
                w-full
                rounded-xl
                border
                border-white/[0.08]
                bg-white/[0.025]
                px-5
                text-sm
                font-medium
                text-white/60
                transition
                hover:bg-white/[0.05]
                hover:text-white
                disabled:cursor-not-allowed
                disabled:opacity-40
                sm:w-auto
              "
            >
              Cancel
            </button>

            <button
              type="submit"
              form="loan-settings-form"
              disabled={saving}
              className="
                inline-flex
                h-11
                w-full
                items-center
                justify-center
                gap-2
                rounded-xl
                bg-yellow-500
                px-5
                text-sm
                font-semibold
                text-black
                transition
                hover:bg-yellow-400
                active:scale-[0.98]
                disabled:cursor-not-allowed
                disabled:opacity-50
                sm:w-auto
              "
            >
              {saving ? (
                <>
                  <Loader2
                    size={16}
                    className="animate-spin"
                  />

                  Saving...
                </>
              ) : (
                <>
                  <Save size={16} />

                  Save Changes
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* =========================================================
   SUMMARY ITEM
========================================================= */

function SummaryItem({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div
      className="
        rounded-xl
        border
        border-white/[0.06]
        bg-white/[0.02]
        px-3
        py-3
      "
    >
      <p className="text-[9px] font-medium uppercase tracking-wider text-white/25">
        {label}
      </p>

      <p className="mt-1 text-sm font-semibold text-white/70">
        {value}
      </p>
    </div>
  );
}

/* =========================================================
   STATUS BADGE
========================================================= */

function StatusBadge({
  label,
  enabled,
}: {
  label: string;
  enabled: boolean;
}) {
  return (
    <span
      className={`
        inline-flex
        items-center
        gap-1.5
        rounded-full
        border
        px-2.5
        py-1
        text-[10px]
        font-medium
        ${
          enabled
            ? "border-emerald-500/15 bg-emerald-500/10 text-emerald-300"
            : "border-white/[0.07] bg-white/[0.03] text-white/30"
        }
      `}
    >
      <span
        className={`
          h-1.5
          w-1.5
          rounded-full
          ${
            enabled
              ? "bg-emerald-400"
              : "bg-white/20"
          }
        `}
      />

      {label}:{" "}
      {enabled
        ? "Enabled"
        : "Disabled"}
    </span>
  );
}
