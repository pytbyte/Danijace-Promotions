// ============================================================
// FILE: src/components/security/AppLockScreen.tsx
// ============================================================

"use client";

import {
  ArrowRight,
  Eye,
  EyeOff,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";

import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from "react";

/* ============================================================
   TYPES
============================================================ */

interface SecurityVerifyResponse {
  success?: boolean;
  verified?: boolean;
  error?: string;
  message?: string;
  code?: string;
  retryAfterSeconds?: number;
}

type AppLockScreenProps = {
  onSuccess: () => void;
};

/* ============================================================
   COMPONENT
============================================================ */

export default function AppLockScreen({
  onSuccess,
}: AppLockScreenProps): ReactNode {
  const [pin, setPin] = useState("");

  const [showPin, setShowPin] =
    useState(false);

  const [checking, setChecking] =
    useState(false);

  const [error, setError] =
    useState("");

  const [attempts, setAttempts] =
    useState(0);

  const inputRef =
    useRef<HTMLInputElement | null>(null);

  /* ==========================================================
     FOCUS
  ========================================================== */

  useEffect(() => {
    /**
     * Give the PIN input focus after the lock screen appears.
     *
     * Small delay allows the overlay to mount cleanly on
     * Android WebView.
     */
    const timer =
      window.setTimeout(() => {
        inputRef.current?.focus();
      }, 100);

    return () => {
      window.clearTimeout(timer);
    };
  }, []);

  /* ==========================================================
     PIN INPUT
  ========================================================== */

  const handlePinChange = (
    event: ChangeEvent<HTMLInputElement>,
  ) => {
    const value =
      event.target.value
        .replace(/\D/g, "")
        .slice(0, 6);

    setPin(value);
    setError("");
  };

  /* ==========================================================
     VERIFY PIN
  ========================================================== */

  const verifyPin = async () => {
    if (checking) {
      return;
    }

    if (pin.length < 4) {
      setError(
        "Enter at least 4 digits.",
      );

      return;
    }

    if (attempts >= 5) {
      setError(
        "Too many unsuccessful attempts. Please wait before trying again.",
      );

      return;
    }

    setChecking(true);
    setError("");

    try {
      const response = await fetch(
        "/api/auth/security/verify",
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json",
            Accept:
              "application/json",
          },
          credentials: "include",
          cache: "no-store",
          body: JSON.stringify({
            method: "pin",
            pin,
          }),
        },
      );

      let result:
        SecurityVerifyResponse = {};

      try {
        result =
          (await response.json()) as SecurityVerifyResponse;
      } catch {
        throw new Error(
          "The security server returned an invalid response.",
        );
      }

      /* ------------------------------------------------------
         SERVER REJECTED
      ------------------------------------------------------ */

      if (
        !response.ok ||
        result.verified !== true
      ) {
        setAttempts(
          (current) => current + 1,
        );

        if (
          result.retryAfterSeconds &&
          result.retryAfterSeconds > 0
        ) {
          const minutes =
            Math.ceil(
              result.retryAfterSeconds /
                60,
            );

          setError(
            result.error ||
              `Security temporarily locked. Try again in ${minutes} minute${
                minutes === 1
                  ? ""
                  : "s"
              }.`,
          );
        } else {
          setError(
            result.error ||
              result.message ||
              "The PIN could not be verified.",
          );
        }

        setPin("");

        return;
      }

      /* ------------------------------------------------------
         SUCCESS
      ------------------------------------------------------ */

      setPin("");
      setAttempts(0);
      setError("");

      /**
       * The existing server-side verification has now created
       * or refreshed the DANIJACE PROMOTIONS security session.
       *
       * AppLockProvider will then clear its client-side lock.
       */
      onSuccess();
    } catch (error) {
      console.error(
        "APP LOCK PIN VERIFICATION ERROR:",
        error,
      );

      setError(
        error instanceof Error
          ? error.message
          : "Unable to verify your PIN. Please try again.",
      );
    } finally {
      setChecking(false);

      /**
       * Return focus to the PIN field after an unsuccessful
       * attempt.
       */
      window.setTimeout(() => {
        inputRef.current?.focus();
      }, 50);
    }
  };

  /* ==========================================================
     RENDER
  ========================================================== */

  return (
    <main
      className="
        fixed
        inset-0
        z-[9999]
        h-[100dvh]
        min-h-[100dvh]
        overflow-hidden
        bg-black
        text-white
      "
      role="dialog"
      aria-modal="true"
      aria-labelledby="danijace-app-lock-title"
    >
      {/* ======================================================
          BACKGROUND
      ====================================================== */}

      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 top-1/2 h-[460px] w-[460px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-sky-500/[0.055] blur-3xl" />

        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_20%,rgba(0,0,0,0.9)_100%)]" />
      </div>

      {/* ======================================================
          CONTENT
      ====================================================== */}

      <div className="relative flex h-full items-center justify-center px-4 py-5">
        <section className="w-full max-w-sm rounded-[1.75rem] border border-white/[0.08] bg-white/[0.035] p-5 shadow-2xl shadow-black/70 backdrop-blur-2xl sm:p-6">
          {/* ==================================================
              BRAND
          ================================================== */}

          <div className="text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-[1.25rem] border border-sky-400/20 bg-sky-400/[0.06] shadow-lg shadow-sky-500/[0.05]">
              <LockKeyhole className="h-7 w-7 text-sky-300" />
            </div>

            <p className="mt-3 text-[9px] font-bold uppercase tracking-[0.45em] text-sky-300/80">
              DANIJACE PROMOTIONS
            </p>

            <h1
              id="danijace-app-lock-title"
              className="mt-1.5 text-xl font-semibold"
            >
              App locked
            </h1>

            <p className="mt-1 text-[11px] text-white/35">
              Enter your security PIN to continue
            </p>
          </div>

          {/* ==================================================
              SECURITY STATUS
          ================================================== */}

          <div className="mt-5 flex items-center gap-3 rounded-xl border border-white/[0.06] bg-black/25 p-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sky-400/[0.06]">
              <ShieldCheck className="h-4 w-4 text-sky-300" />
            </div>

            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-white">
                Security check required
              </p>

              <p className="mt-0.5 text-[10px] leading-4 text-white/30">
                Your Google session is still active.
              </p>
            </div>
          </div>

          {/* ==================================================
              PIN
          ================================================== */}

          <div className="mt-5">
            <p className="text-center text-[11px] text-white/40">
              Security PIN
            </p>

            <div className="relative mt-2.5">
              <input
                ref={inputRef}
                autoFocus
                value={pin}
                onChange={handlePinChange}
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter" &&
                    pin.length >= 4 &&
                    !checking
                  ) {
                    void verifyPin();
                  }
                }}
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="off"
                type={
                  showPin
                    ? "text"
                    : "password"
                }
                maxLength={6}
                disabled={checking}
                placeholder="Enter PIN"
                aria-label="DANIJACE PROMOTIONS security PIN"
                className="
                  h-12
                  w-full
                  rounded-xl
                  border
                  border-white/[0.08]
                  bg-black/40
                  px-4
                  pr-12
                  text-center
                  text-lg
                  font-bold
                  tracking-[0.45em]
                  text-white
                  outline-none
                  transition
                  placeholder:text-xs
                  placeholder:font-normal
                  placeholder:tracking-normal
                  placeholder:text-white/20
                  focus:border-sky-400/40
                  focus:ring-1
                  focus:ring-sky-400/10
                  disabled:cursor-not-allowed
                  disabled:opacity-60
                "
              />

              <button
                type="button"
                onClick={() =>
                  setShowPin(
                    (value) => !value,
                  )
                }
                disabled={checking}
                aria-label={
                  showPin
                    ? "Hide PIN"
                    : "Show PIN"
                }
                className="
                  absolute
                  right-3
                  top-1/2
                  -translate-y-1/2
                  rounded-lg
                  p-2
                  text-white/30
                  transition
                  hover:text-white
                  disabled:cursor-not-allowed
                  disabled:opacity-30
                "
              >
                {showPin ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>

            {/* =================================================
                PIN INDICATORS
            ================================================= */}

            <div className="mt-2.5 flex justify-center gap-2">
              {Array.from({
                length: 6,
              }).map((_, index) => (
                <span
                  key={index}
                  className={`h-1.5 w-5 rounded-full transition-colors ${
                    index < pin.length
                      ? "bg-sky-300"
                      : "bg-white/10"
                  }`}
                />
              ))}
            </div>
          </div>

          {/* ==================================================
              ERROR
          ================================================== */}

          {error ? (
            <div className="mt-3 rounded-xl border border-red-400/10 bg-red-400/[0.04] px-3 py-2.5">
              <p className="text-center text-[10px] font-medium leading-4 text-red-300">
                {error}
              </p>
            </div>
          ) : (
            <p className="mt-3 text-center text-[9px] text-white/20">
              Enter your 4–6 digit DANIJACE PROMOTIONS PIN.
            </p>
          )}

          {/* ==================================================
              VERIFY BUTTON
          ================================================== */}

          <button
            type="button"
            onClick={() =>
              void verifyPin()
            }
            disabled={
              pin.length < 4 ||
              checking
            }
            className="
              mt-3
              flex
              h-11
              w-full
              items-center
              justify-center
              gap-2
              rounded-xl
              bg-sky-400
              text-xs
              font-bold
              text-black
              shadow-lg
              shadow-sky-500/15
              transition
              hover:bg-sky-300
              active:scale-[0.99]
              disabled:cursor-not-allowed
              disabled:opacity-30
            "
          >
            {checking ? (
              <>
                <RefreshCw className="h-4 w-4 animate-spin" />
                Verifying
              </>
            ) : (
              <>
                Unlock DANIJACE PROMOTIONS
                <ArrowRight className="h-4 w-4" />
              </>
            )}
          </button>

          {/* ==================================================
              FOOTER
          ================================================== */}

          <div className="mt-5 flex items-center justify-center gap-1.5 text-[8px] font-semibold uppercase tracking-[0.25em] text-white/15">
            <ShieldCheck className="h-3 w-3" />
            DANIJACE PROMOTIONS protected
          </div>
        </section>
      </div>
    </main>
  );
}