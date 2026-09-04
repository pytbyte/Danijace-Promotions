"use client";

import {
  ArrowRight,
  Bell,
  CheckCircle2,
  Eye,
  EyeOff,
  Fingerprint,
  HandCoins,
  LayoutDashboard,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  Users,
  Wallet,
} from "lucide-react";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
  type ReactNode,
} from "react";

import { useRouter } from "next/navigation";

/* =========================================================
   TYPES
========================================================= */

interface DashboardStats {
  members: number;
  activeMembers: number;
  loans: number;
  outstandingLoans: number;
  defaulters: number;
  unreadNotifications: number;
  savingsBalance: number;
  totalDeposits: number;
  totalWithdrawals: number;
  totalReversals: number;
}

interface DashboardActivity {
  id: string;
  title: string;
  description: string;
  amount?: number;
  date?: string;
  type:
    | "member"
    | "savings"
    | "loan"
    | "notification";
}

interface SavingsSummary {
  balance?: number;
  totalBalance?: number;
  totalDeposits?: number;
  totalWithdrawals?: number;
  totalReversals?: number;
}

interface ApiResponse<T> {
  success?: boolean;
  data?: T;
  items?: T;
  results?: T;
  message?: string;
  error?: string;
}

interface MemberRecord {
  _id?: string;
  id?: string;
  memberId?: string;
  membershipNumber?: string;
  firstName?: string;
  lastName?: string;
  name?: string;
  status?: string;
  createdAt?: string;
}

interface LoanRecord {
  _id?: string;
  id?: string;
  loanId?: string;
  memberId?: string;
  status?: string;
  amount?: number;
  principal?: number;
  outstandingBalance?: number;
  balance?: number;
  createdAt?: string;
}

interface NotificationRecord {
  _id?: string;
  id?: string;
  title?: string;
  message?: string;
  read?: boolean;
  isRead?: boolean;
  createdAt?: string;
}

type SecurityMethod = "pin" | "device";

interface SecurityVerifyResponse {
  success?: boolean;
  verified?: boolean;
  error?: string;
  message?: string;
  code?: string;
  retryAfterSeconds?: number;
}

interface SecurityStatusResponse {
  authenticated?: boolean;
  configured?: boolean;
  verified?: boolean;
  locked?: boolean;
  retryAfterSeconds?: number;
  error?: string;
  message?: string;
}

interface SecuritySetupResponse {
  success?: boolean;
  configured?: boolean;
  error?: string;
  message?: string;
}

/* =========================================================
   HELPERS
========================================================= */

function unwrapArray<T>(
  response:
    | ApiResponse<T[]>
    | T[]
    | null
    | undefined,
): T[] {
  if (Array.isArray(response)) {
    return response;
  }

  if (!response) {
    return [];
  }

  if (Array.isArray(response.data)) {
    return response.data;
  }

  if (Array.isArray(response.items)) {
    return response.items;
  }

  if (Array.isArray(response.results)) {
    return response.results;
  }

  return [];
}

function formatKES(value: number): string {
  return new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    maximumFractionDigits: 0,
  }).format(Number.isFinite(value) ? value : 0);
}

function formatDate(value?: string): string {
  if (!value) {
    return "Recently";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Recently";
  }

  return new Intl.DateTimeFormat("en-KE", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

function getMemberName(
  member: MemberRecord,
): string {
  if (member.name) {
    return member.name;
  }

  return (
    [
      member.firstName,
      member.lastName,
    ]
      .filter(Boolean)
      .join(" ")
      .trim() || "GEO-SHUA Member"
  );
}

/* =========================================================
   LOADING
========================================================= */

function DashboardLoading(): ReactNode {
  return (
    <main className="flex h-[100dvh] min-h-[100dvh] items-center justify-center overflow-hidden bg-black text-white">
      <div className="flex flex-col items-center gap-4">
        <div className="relative flex h-16 w-16 items-center justify-center">
          <div className="absolute inset-0 animate-ping rounded-full border border-sky-400/20" />

          <div className="absolute inset-2 rounded-2xl border border-sky-400/20" />

          <div className="relative flex h-12 w-12 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04]">
            <span className="text-sm font-black tracking-[0.2em] text-sky-300">
              GS
            </span>
          </div>
        </div>

        <div className="text-center">
          <p className="text-[10px] font-bold uppercase tracking-[0.35em] text-sky-300">
            GEO-SHUA
          </p>

          <p className="mt-1 text-xs text-white/35">
            Preparing your workspace
          </p>
        </div>
      </div>
    </main>
  );
}

/* =========================================================
   PIN SETUP
========================================================= */

function PinSetupScreen({
  onSuccess,
}: {
  onSuccess: () => void;
}): ReactNode {
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] =
    useState("");

  const [showPin, setShowPin] =
    useState(false);

  const [showConfirmPin, setShowConfirmPin] =
    useState(false);

  const [checking, setChecking] =
    useState(false);

  const [error, setError] = useState("");

  const handlePinChange = (
    event: ChangeEvent<HTMLInputElement>,
  ) => {
    const value = event.target.value
      .replace(/\D/g, "")
      .slice(0, 6);

    setPin(value);
    setError("");
  };

  const handleConfirmPinChange = (
    event: ChangeEvent<HTMLInputElement>,
  ) => {
    const value = event.target.value
      .replace(/\D/g, "")
      .slice(0, 6);

    setConfirmPin(value);
    setError("");
  };

  const setupPin = async () => {
    if (pin.length < 4 || pin.length > 6) {
      setError(
        "Your PIN must contain 4 to 6 digits.",
      );
      return;
    }

    if (confirmPin.length < 4) {
      setError("Confirm your PIN.");
      return;
    }

    if (pin !== confirmPin) {
      setError("PINs do not match.");
      return;
    }

    setChecking(true);
    setError("");

    try {
      const response = await fetch(
        "/api/auth/security/setup",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          credentials: "include",
          cache: "no-store",
          body: JSON.stringify({
            pin,
            confirmPin,
          }),
        },
      );

      const result =
        (await response.json()) as SecuritySetupResponse;

      if (
        !response.ok ||
        result.success !== true
      ) {
        setError(
          result.error ||
            result.message ||
            "Unable to configure your security PIN.",
        );

        return;
      }

      setPin("");
      setConfirmPin("");

      onSuccess();
    } catch {
      setError(
        "Unable to configure your security PIN. Please try again.",
      );
    } finally {
      setChecking(false);
    }
  };

  return (
    <main className="relative h-[100dvh] min-h-[100dvh] overflow-hidden bg-black text-white">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 top-1/2 h-[420px] w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-sky-500/[0.055] blur-3xl" />

        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_25%,rgba(0,0,0,0.8)_100%)]" />
      </div>

      <div className="relative flex h-full items-center justify-center px-4 py-4">
        <section className="w-full max-w-sm rounded-[1.75rem] border border-white/[0.08] bg-white/[0.035] p-5 shadow-2xl shadow-black/60 backdrop-blur-2xl sm:p-6">

          <div className="text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-[1.25rem] border border-sky-400/20 bg-sky-400/[0.06]">
              <span className="text-lg font-black tracking-[0.18em] text-sky-300">
                GS
              </span>
            </div>

            <p className="mt-3 text-[9px] font-bold uppercase tracking-[0.45em] text-sky-300/80">
              GEO-SHUA
            </p>

            <h1 className="mt-1.5 text-xl font-semibold">
              Create security PIN
            </h1>

            <p className="mt-1 text-[11px] text-white/35">
              Protect your GEO-SHUA workspace
            </p>
          </div>

          <div className="mt-4 flex items-center gap-3 rounded-xl border border-white/[0.06] bg-black/25 p-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/[0.06]">
              <CheckCircle2 className="h-4 w-4 text-sky-300" />
            </div>

            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-white">
                Google identity verified
              </p>

              <p className="mt-0.5 truncate text-[10px] text-white/30">
                Create a second security layer
              </p>
            </div>

            <ShieldCheck className="h-4 w-4 shrink-0 text-sky-300/60" />
          </div>

          <div className="mt-5">
            <p className="text-[11px] text-white/40">
              Create your 4–6 digit PIN
            </p>

            <div className="relative mt-2.5">
              <input
                autoFocus
                value={pin}
                onChange={handlePinChange}
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="new-password"
                type={
                  showPin ? "text" : "password"
                }
                maxLength={6}
                placeholder="Enter PIN"
                className="h-12 w-full rounded-xl border border-white/[0.08] bg-black/40 px-4 pr-12 text-center text-lg font-bold tracking-[0.45em] text-white outline-none transition placeholder:text-xs placeholder:font-normal placeholder:tracking-normal placeholder:text-white/20 focus:border-sky-400/40"
              />

              <button
                type="button"
                onClick={() =>
                  setShowPin(
                    (value) => !value,
                  )
                }
                className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-2 text-white/30 hover:text-white"
              >
                {showPin ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>

            <div className="mt-2 flex justify-center gap-2">
              {Array.from({ length: 6 }).map(
                (_, index) => (
                  <span
                    key={index}
                    className={`h-1.5 w-5 rounded-full ${
                      index < pin.length
                        ? "bg-sky-300"
                        : "bg-white/10"
                    }`}
                  />
                ),
              )}
            </div>
          </div>

          <div className="mt-4">
            <p className="text-[11px] text-white/40">
              Confirm your PIN
            </p>

            <div className="relative mt-2.5">
              <input
                value={confirmPin}
                onChange={
                  handleConfirmPinChange
                }
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="new-password"
                type={
                  showConfirmPin
                    ? "text"
                    : "password"
                }
                maxLength={6}
                placeholder="Confirm PIN"
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter" &&
                    pin.length >= 4 &&
                    confirmPin.length >= 4 &&
                    !checking
                  ) {
                    void setupPin();
                  }
                }}
                className="h-12 w-full rounded-xl border border-white/[0.08] bg-black/40 px-4 pr-12 text-center text-lg font-bold tracking-[0.45em] text-white outline-none transition placeholder:text-xs placeholder:font-normal placeholder:tracking-normal placeholder:text-white/20 focus:border-sky-400/40"
              />

              <button
                type="button"
                onClick={() =>
                  setShowConfirmPin(
                    (value) => !value,
                  )
                }
                className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-2 text-white/30 hover:text-white"
              >
                {showConfirmPin ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>

          {error ? (
            <p className="mt-3 text-center text-[10px] font-medium text-red-300">
              {error}
            </p>
          ) : (
            <p className="mt-3 text-center text-[9px] text-white/20">
              Your PIN is securely hashed on the server.
            </p>
          )}

          <button
            type="button"
            onClick={() => void setupPin()}
            disabled={
              pin.length < 4 ||
              confirmPin.length < 4 ||
              checking
            }
            className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-sky-400 text-xs font-bold text-black shadow-lg shadow-sky-500/15 transition hover:bg-sky-300 disabled:cursor-not-allowed disabled:opacity-30"
          >
            {checking ? (
              <>
                <RefreshCw className="h-4 w-4 animate-spin" />
                Creating PIN
              </>
            ) : (
              <>
                Create security PIN
                <ArrowRight className="h-4 w-4" />
              </>
            )}
          </button>

          <div className="mt-4 flex items-center justify-center gap-1.5 text-[8px] font-semibold uppercase tracking-[0.25em] text-white/15">
            <ShieldCheck className="h-3 w-3" />
            GEO-SHUA
          </div>
        </section>
      </div>
    </main>
  );
}

/* =========================================================
   IDENTITY
========================================================= */

function IdentityScreen({
  onSuccess,
}: {
  onSuccess: () => void;
}): ReactNode {
  const [method, setMethod] =
    useState<SecurityMethod>("pin");

  const [pin, setPin] = useState("");
  const [showPin, setShowPin] =
    useState(false);

  const [checking, setChecking] =
    useState(false);

  const [error, setError] = useState("");

  const [deviceAvailable, setDeviceAvailable] =
    useState(false);

  const [attempts, setAttempts] = useState(0);

  /* -------------------------------------------------------
     DEVICE AVAILABILITY
  ------------------------------------------------------- */

  useEffect(() => {
    let active = true;

    const checkDevice = async () => {
      try {
        if (
          typeof window === "undefined" ||
          !window.PublicKeyCredential
        ) {
          if (active) {
            setDeviceAvailable(false);
          }

          return;
        }

        const available =
          await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();

        if (active) {
          setDeviceAvailable(available);
        }
      } catch {
        if (active) {
          setDeviceAvailable(false);
        }
      }
    };

    void checkDevice();

    return () => {
      active = false;
    };
  }, []);

  /* -------------------------------------------------------
     PIN
  ------------------------------------------------------- */

  const handlePinChange = (
    event: ChangeEvent<HTMLInputElement>,
  ) => {
    const value = event.target.value
      .replace(/\D/g, "")
      .slice(0, 6);

    setPin(value);
    setError("");
  };

  /* -------------------------------------------------------
     VERIFY PIN
  ------------------------------------------------------- */

  const verifyPin = async () => {
    if (pin.length < 4) {
      setError("Enter at least 4 digits.");
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
            "Content-Type": "application/json",
          },
          credentials: "include",
          cache: "no-store",
          body: JSON.stringify({
            method: "pin",
            pin,
          }),
        },
      );

      const result =
        (await response.json()) as SecurityVerifyResponse;

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
          const minutes = Math.ceil(
            result.retryAfterSeconds / 60,
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

        return;
      }

      setPin("");
      setAttempts(0);

      onSuccess();
    } catch {
      setError(
        "Unable to verify your identity. Please try again.",
      );
    } finally {
      setChecking(false);
    }
  };

  /* -------------------------------------------------------
     VERIFY DEVICE
  ------------------------------------------------------- */

  const verifyDevice = async () => {
    setChecking(true);
    setError("");

    try {
      const optionsResponse =
        await fetch(
          "/api/auth/security/webauthn/options",
          {
            method: "POST",
            headers: {
              "Content-Type":
                "application/json",
            },
            credentials: "include",
            cache: "no-store",
          },
        );

      if (!optionsResponse.ok) {
        throw new Error(
          "Device security is not available right now.",
        );
      }

      const optionsResult =
        (await optionsResponse.json()) as {
          publicKey?: PublicKeyCredentialRequestOptions;
        };

      if (!optionsResult.publicKey) {
        throw new Error(
          "Device security configuration is unavailable.",
        );
      }

      const credential =
        await navigator.credentials.get({
          publicKey:
            optionsResult.publicKey,
        });

      if (!credential) {
        throw new Error(
          "No device credential was returned.",
        );
      }

      const assertion =
        credential as PublicKeyCredential;

      const assertionResponse =
        assertion.response as AuthenticatorAssertionResponse;

      const response = await fetch(
        "/api/auth/security/webauthn/verify",
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json",
          },
          credentials: "include",
          cache: "no-store",
          body: JSON.stringify({
            id: assertion.id,
            rawId: Array.from(
              new Uint8Array(
                assertion.rawId,
              ),
            ),
            type: assertion.type,
            response: {
              authenticatorData:
                Array.from(
                  new Uint8Array(
                    assertionResponse.authenticatorData,
                  ),
                ),

              clientDataJSON:
                Array.from(
                  new Uint8Array(
                    assertionResponse.clientDataJSON,
                  ),
                ),

              signature: Array.from(
                new Uint8Array(
                  assertionResponse.signature,
                ),
              ),

              userHandle:
                assertionResponse.userHandle
                  ? Array.from(
                      new Uint8Array(
                        assertionResponse.userHandle,
                      ),
                    )
                  : null,
            },
          }),
        },
      );

      const result =
        (await response.json()) as SecurityVerifyResponse;

      if (
        !response.ok ||
        result.verified !== true
      ) {
        throw new Error(
          result.error ||
            result.message ||
            "Device verification failed.",
        );
      }

      onSuccess();
    } catch (err) {
      if (
        err instanceof DOMException &&
        err.name === "NotAllowedError"
      ) {
        setError(
          "Device verification was cancelled.",
        );
      } else {
        setError(
          err instanceof Error
            ? err.message
            : "Device verification failed.",
        );
      }
    } finally {
      setChecking(false);
    }
  };

  return (
    <main className="relative h-[100dvh] min-h-[100dvh] overflow-hidden bg-black text-white">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 top-1/2 h-[420px] w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-sky-500/[0.055] blur-3xl" />

        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_25%,rgba(0,0,0,0.8)_100%)]" />
      </div>

      <div className="relative flex h-full items-center justify-center px-4 py-4">
        <section className="w-full max-w-sm rounded-[1.75rem] border border-white/[0.08] bg-white/[0.035] p-5 shadow-2xl shadow-black/60 backdrop-blur-2xl sm:p-6">

          <div className="text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-[1.25rem] border border-sky-400/20 bg-sky-400/[0.06]">
              <span className="text-lg font-black tracking-[0.18em] text-sky-300">
                GS
              </span>
            </div>

            <p className="mt-3 text-[9px] font-bold uppercase tracking-[0.45em] text-sky-300/80">
              GEO-SHUA
            </p>

            <h1 className="mt-1.5 text-xl font-semibold">
              Identity
            </h1>

            <p className="mt-1 text-[11px] text-white/35">
              Confirm your identity to continue
            </p>
          </div>

          <div className="mt-4 flex items-center gap-3 rounded-xl border border-white/[0.06] bg-black/25 p-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/[0.06]">
              <CheckCircle2 className="h-4 w-4 text-sky-300" />
            </div>

            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-white">
                Google identity verified
              </p>

              <p className="mt-0.5 truncate text-[10px] text-white/30">
                GEO-SHUA account authenticated
              </p>
            </div>

            <ShieldCheck className="h-4 w-4 shrink-0 text-sky-300/60" />
          </div>

          <div className="mt-3 grid grid-cols-2 gap-1.5 rounded-xl border border-white/[0.06] bg-black/25 p-1">
            <button
              type="button"
              onClick={() => {
                setMethod("pin");
                setError("");
              }}
              className={`flex h-9 items-center justify-center gap-2 rounded-lg text-[11px] font-semibold ${
                method === "pin"
                  ? "bg-white/[0.09] text-white"
                  : "text-white/35"
              }`}
            >
              <LockKeyhole className="h-3.5 w-3.5" />
              PIN
            </button>

            <button
              type="button"
              disabled={!deviceAvailable}
              onClick={() => {
                setMethod("device");
                setError("");
              }}
              className={`flex h-9 items-center justify-center gap-2 rounded-lg text-[11px] font-semibold ${
                method === "device"
                  ? "bg-white/[0.09] text-white"
                  : "text-white/35"
              } ${
                !deviceAvailable
                  ? "cursor-not-allowed opacity-25"
                  : ""
              }`}
            >
              <Fingerprint className="h-3.5 w-3.5" />
              Device
            </button>
          </div>

          {method === "pin" ? (
            <div className="mt-4">
              <p className="text-center text-[11px] text-white/40">
                Enter your security PIN
              </p>

              <div className="relative mt-2.5">
                <input
                  autoFocus
                  value={pin}
                  onChange={handlePinChange}
                  inputMode="numeric"
                  pattern="[0-9]*"
                  autoComplete="off"
                  type={
                    showPin
                      ? "text"
                      : "password"
                  }
                  maxLength={6}
                  placeholder="Enter PIN"
                  onKeyDown={(event) => {
                    if (
                      event.key === "Enter" &&
                      pin.length >= 4 &&
                      !checking
                    ) {
                      void verifyPin();
                    }
                  }}
                  className="h-12 w-full rounded-xl border border-white/[0.08] bg-black/40 px-4 pr-12 text-center text-lg font-bold tracking-[0.45em] text-white outline-none placeholder:text-xs placeholder:font-normal placeholder:tracking-normal placeholder:text-white/20 focus:border-sky-400/40"
                />

                <button
                  type="button"
                  onClick={() =>
                    setShowPin(
                      (value) => !value,
                    )
                  }
                  className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-2 text-white/30 hover:text-white"
                >
                  {showPin ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>

              <div className="mt-2.5 flex justify-center gap-2">
                {Array.from({
                  length: 6,
                }).map((_, index) => (
                  <span
                    key={index}
                    className={`h-1.5 w-5 rounded-full ${
                      index < pin.length
                        ? "bg-sky-300"
                        : "bg-white/10"
                    }`}
                  />
                ))}
              </div>

              {error ? (
                <p className="mt-2 text-center text-[10px] text-red-300">
                  {error}
                </p>
              ) : (
                <p className="mt-2 text-center text-[9px] text-white/20">
                  4–6 digit PIN
                </p>
              )}

              <button
                type="button"
                onClick={() =>
                  void verifyPin()
                }
                disabled={
                  pin.length < 4 ||
                  checking
                }
                className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-sky-400 text-xs font-bold text-black shadow-lg shadow-sky-500/15 hover:bg-sky-300 disabled:cursor-not-allowed disabled:opacity-30"
              >
                {checking ? (
                  <>
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    Verifying
                  </>
                ) : (
                  <>
                    Continue
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </button>
            </div>
          ) : (
            <div className="mt-5 text-center">
              <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-[1.5rem] border border-sky-400/15 bg-sky-400/[0.05]">
                <Fingerprint className="h-10 w-10 text-sky-300" />
              </div>

              <h2 className="mt-4 text-base font-semibold">
                Device security
              </h2>

              <p className="mx-auto mt-1.5 max-w-[260px] text-[10px] leading-4 text-white/35">
                Use the security method configured on this device.
              </p>

              {error ? (
                <p className="mt-2 text-[10px] text-red-300">
                  {error}
                </p>
              ) : null}

              <button
                type="button"
                onClick={() =>
                  void verifyDevice()
                }
                disabled={
                  checking ||
                  !deviceAvailable
                }
                className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-sky-400 text-xs font-bold text-black shadow-lg shadow-sky-500/15 hover:bg-sky-300 disabled:cursor-not-allowed disabled:opacity-30"
              >
                {checking ? (
                  <>
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    Verifying
                  </>
                ) : (
                  <>
                    Verify identity
                    <Fingerprint className="h-4 w-4" />
                  </>
                )}
              </button>
            </div>
          )}

          <div className="mt-4 flex items-center justify-center gap-1.5 text-[8px] font-semibold uppercase tracking-[0.25em] text-white/15">
            <ShieldCheck className="h-3 w-3" />
            GEO-SHUA
          </div>
        </section>
      </div>
    </main>
  );
}


/* =========================================================
   GEO-SHUA NAVIGATOR
========================================================= */

function GeoShuaNavigator(): ReactNode {
  const router = useRouter();

  const navigation = [
    {
      title: "Dashboard",
      description: "SACCO overview & activity",
      icon: LayoutDashboard,
      path: "/dashboard/summery",
    },
    {
      title: "Members",
      description: "Manage membership",
      icon: Users,
      path: "/dashboard/members",
    },
    {
      title: "Savings",
      description: "Savings & transactions",
      icon: Wallet,
      path: "/dashboard/savings",
    },
    {
      title: "Loans",
      description: "Loans & repayments",
      icon: HandCoins,
      path: "/dashboard/loans",
    },
  ];

  return (
    <main className="relative min-h-[100dvh] overflow-hidden bg-black text-white">
      {/* BACKGROUND */}

      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 top-1/2 h-[380px] w-[380px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-sky-500/[0.04] blur-3xl" />

        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_25%,rgba(0,0,0,0.88)_100%)]" />
      </div>

      {/* CONTENT */}

      <div className="relative flex min-h-[100dvh] items-center justify-center px-4 py-6 sm:px-6">
        <section className="w-full max-w-md">

          {/* =================================================
             BRAND
          ================================================= */}

          <div className="text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl border border-sky-400/15 bg-white/[0.035] shadow-lg shadow-sky-500/[0.04]">
              <span className="text-sm font-black tracking-[0.16em] text-sky-300">
                GS
              </span>
            </div>

            <p className="mt-3 text-[8px] font-bold uppercase tracking-[0.42em] text-sky-300/70">
              GEO-SHUA
            </p>

            <h1 className="mt-1 text-xl font-semibold tracking-tight text-white sm:text-2xl">
              Workspace
            </h1>

            <p className="mt-1 text-[10px] text-white/30 sm:text-[11px]">
              Select a section to continue
            </p>
          </div>

          {/* =================================================
             NAVIGATION
          ================================================= */}

          <div className="mt-6 grid grid-cols-2 gap-2.5 sm:gap-3">
            {navigation.map((item) => {
              const Icon = item.icon;

              return (
                <button
                  key={item.title}
                  type="button"
                  onClick={() =>
                    router.push(item.path)
                  }
                  className="group rounded-xl border border-white/[0.07] bg-white/[0.035] p-3.5 text-left backdrop-blur-xl transition duration-200 hover:border-sky-400/20 hover:bg-white/[0.055] active:scale-[0.98] sm:p-4"
                >
                  {/* TOP ROW */}

                  <div className="flex items-center justify-between">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-sky-400/[0.055]">
                      <Icon className="h-4.5 w-4.5 text-sky-300" />
                    </div>

                    <ArrowRight className="h-4 w-4 text-white/15 transition duration-200 group-hover:translate-x-0.5 group-hover:text-sky-300/70" />
                  </div>

                  {/* TEXT */}

                  <h2 className="mt-3 text-sm font-semibold text-white">
                    {item.title}
                  </h2>

                  <p className="mt-1 text-[10px] leading-4 text-white/30">
                    {item.description}
                  </p>
                </button>
              );
            })}
          </div>

          {/* =================================================
             FOOTER
          ================================================= */}

          <div className="mt-5 flex items-center justify-center gap-1.5 text-[8px] font-medium uppercase tracking-[0.28em] text-white/15">
            <ShieldCheck className="h-3 w-3" />
            GEO-SHUA workspace
          </div>
        </section>
      </div>
    </main>
  );
}

/* =========================================================
   MAIN DASHBOARD PAGE
========================================================= */

export default function DashboardPage(): ReactNode {
  const [mounted, setMounted] =
    useState(false);

  const [securityChecked, setSecurityChecked] =
    useState(false);

  const [pinConfigured, setPinConfigured] =
    useState(false);

  const [identityVerified, setIdentityVerified] =
    useState(false);

  /* =======================================================
     DASHBOARD DATA
  ======================================================= */

  const [loading, setLoading] =
    useState(false);

  const [refreshing, setRefreshing] =
    useState(false);

  const [stats, setStats] =
    useState<DashboardStats>({
      members: 0,
      activeMembers: 0,
      loans: 0,
      outstandingLoans: 0,
      defaulters: 0,
      unreadNotifications: 0,
      savingsBalance: 0,
      totalDeposits: 0,
      totalWithdrawals: 0,
      totalReversals: 0,
    });

  const [activities, setActivities] =
    useState<DashboardActivity[]>([]);

  /* =======================================================
     MOUNT
  ======================================================= */

  useEffect(() => {
    setMounted(true);
  }, []);

  /* =======================================================
     SECURITY STATUS
  ======================================================= */

  const checkSecurityStatus =
    useCallback(async () => {
      try {
        setSecurityChecked(false);

        const response = await fetch(
          "/api/auth/security/status",
          {
            method: "GET",
            credentials: "include",
            cache: "no-store",
          },
        );

        const result =
          (await response.json()) as SecurityStatusResponse;

        if (
          response.status === 401 ||
          result.authenticated === false
        ) {
          setIdentityVerified(false);
          setPinConfigured(false);
          return;
        }

        if (!response.ok) {
          throw new Error(
            result.error ||
              result.message ||
              "Unable to check security status.",
          );
        }

        const configured =
          result.configured === true;

        const verified =
          result.verified === true;

        setPinConfigured(configured);
        setIdentityVerified(verified);
      } catch (error) {
        console.error(
          "SECURITY STATUS ERROR:",
          error,
        );

        setPinConfigured(false);
        setIdentityVerified(false);
      } finally {
        setSecurityChecked(true);
      }
    }, []);

  useEffect(() => {
    if (!mounted) {
      return;
    }

    void checkSecurityStatus();
  }, [
    mounted,
    checkSecurityStatus,
  ]);

  /* =======================================================
     PIN SETUP COMPLETE
  ======================================================= */

  const handlePinSetupSuccess =
    () => {
      setPinConfigured(true);
      setIdentityVerified(false);
    };

  /* =======================================================
     IDENTITY COMPLETE
     
     IMPORTANT:
     After identity verification we stay on
     /dashboard and show the NAVIGATOR.
     
     We do NOT automatically open the summary.
  ======================================================= */

  const handleIdentitySuccess =
    () => {
      setIdentityVerified(true);
    };

  /* =======================================================
     LOAD SUMMARY DATA
======================================================= */

  const loadDashboard =
    useCallback(
      async (isRefresh = false) => {
        if (isRefresh) {
          setRefreshing(true);
        } else {
          setLoading(true);
        }

        try {
          const [
            savingsResponse,
            membersResponse,
            loansResponse,
            notificationsResponse,
          ] =
            await Promise.allSettled([
              fetch(
                "/api/savings/summary",
                {
                  credentials:
                    "include",
                  cache: "no-store",
                },
              ),

              fetch("/api/members", {
                credentials:
                  "include",
                cache: "no-store",
              }),

              fetch("/api/loans", {
                credentials:
                  "include",
                cache: "no-store",
              }),

              fetch(
                "/api/notifications",
                {
                  credentials:
                    "include",
                  cache: "no-store",
                },
              ),
            ]);

          let savings: SavingsSummary =
            {};

          let members: MemberRecord[] =
            [];

          let loans: LoanRecord[] = [];

          let notifications: NotificationRecord[] =
            [];

          /* SAVINGS */

          if (
            savingsResponse.status ===
              "fulfilled" &&
            savingsResponse.value.ok
          ) {
            try {
              savings =
                (await savingsResponse.value.json()) as SavingsSummary;
            } catch {
              savings = {};
            }
          }

          /* MEMBERS */

          if (
            membersResponse.status ===
              "fulfilled" &&
            membersResponse.value.ok
          ) {
            try {
              const result =
                (await membersResponse.value.json()) as
                  | ApiResponse<MemberRecord[]>
                  | MemberRecord[];

              members =
                unwrapArray(result);
            } catch {
              members = [];
            }
          }

          /* LOANS */

          if (
            loansResponse.status ===
              "fulfilled" &&
            loansResponse.value.ok
          ) {
            try {
              const result =
                (await loansResponse.value.json()) as
                  | ApiResponse<LoanRecord[]>
                  | LoanRecord[];

              loans =
                unwrapArray(result);
            } catch {
              loans = [];
            }
          }

          /* NOTIFICATIONS */

          if (
            notificationsResponse.status ===
              "fulfilled" &&
            notificationsResponse.value.ok
          ) {
            try {
              const result =
                (await notificationsResponse.value.json()) as
                  | ApiResponse<NotificationRecord[]>
                  | NotificationRecord[];

              notifications =
                unwrapArray(result);
            } catch {
              notifications = [];
            }
          }

          /* MEMBERS */

          const activeMembers =
            members.filter(
              (member) =>
                member.status?.toLowerCase() ===
                "active",
            ).length;

          /* LOANS */

          const activeLoans =
            loans.filter((loan) => {
              const status =
                loan.status?.toLowerCase();

              return (
                status !== "closed" &&
                status !== "completed" &&
                status !== "repaid"
              );
            });

          const outstandingLoans =
            activeLoans.reduce(
              (total, loan) =>
                total +
                Number(
                  loan.outstandingBalance ??
                    loan.balance ??
                    loan.amount ??
                    loan.principal ??
                    0,
                ),
              0,
            );

          const defaulters =
            loans.filter((loan) => {
              const status =
                loan.status?.toLowerCase();

              return (
                status === "defaulted" ||
                status === "overdue" ||
                status === "defaulter"
              );
            }).length;

          /* NOTIFICATIONS */

          const unreadNotifications =
            notifications.filter(
              (notification) =>
                notification.read !== true &&
                notification.isRead !== true,
            ).length;

          /* SAVINGS */

          const savingsBalance =
            Number(
              savings.balance ??
                savings.totalBalance ??
                0,
            );

          const totalDeposits =
            Number(
              savings.totalDeposits ?? 0,
            );

          const totalWithdrawals =
            Number(
              savings.totalWithdrawals ?? 0,
            );

          const totalReversals =
            Number(
              savings.totalReversals ?? 0,
            );

          setStats({
            members: members.length,
            activeMembers,
            loans: activeLoans.length,
            outstandingLoans,
            defaulters,
            unreadNotifications,
            savingsBalance,
            totalDeposits,
            totalWithdrawals,
            totalReversals,
          });

          /* RECENT MEMBERS */

          const recentMembers =
            [...members]
              .sort(
                (a, b) =>
                  new Date(
                    b.createdAt ?? 0,
                  ).getTime() -
                  new Date(
                    a.createdAt ?? 0,
                  ).getTime(),
              )
              .slice(0, 3)
              .map((member) => ({
                id:
                  member.id ??
                  member._id ??
                  member.memberId ??
                  crypto.randomUUID(),

                title: "New member",

                description:
                  getMemberName(member),

                date: formatDate(
                  member.createdAt,
                ),

                type:
                  "member" as const,
              }));

          /* RECENT LOANS */

          const recentLoans =
            [...loans]
              .sort(
                (a, b) =>
                  new Date(
                    b.createdAt ?? 0,
                  ).getTime() -
                  new Date(
                    a.createdAt ?? 0,
                  ).getTime(),
              )
              .slice(0, 3)
              .map((loan) => ({
                id:
                  loan.id ??
                  loan._id ??
                  loan.loanId ??
                  crypto.randomUUID(),

                title: "Loan activity",

                description:
                  loan.loanId ??
                  loan.memberId ??
                  "Loan record",

                amount: Number(
                  loan.amount ??
                    loan.principal ??
                    0,
                ),

                date: formatDate(
                  loan.createdAt,
                ),

                type:
                  "loan" as const,
              }));

          /* RECENT NOTIFICATIONS */

          const recentNotifications =
            [...notifications]
              .sort(
                (a, b) =>
                  new Date(
                    b.createdAt ?? 0,
                  ).getTime() -
                  new Date(
                    a.createdAt ?? 0,
                  ).getTime(),
              )
              .slice(0, 3)
              .map(
                (
                  notification,
                ) => ({
                  id:
                    notification.id ??
                    notification._id ??
                    crypto.randomUUID(),

                  title:
                    notification.title ??
                    "Notification",

                  description:
                    notification.message ??
                    "GEO-SHUA notification",

                  date: formatDate(
                    notification.createdAt,
                  ),

                  type:
                    "notification" as const,
                }),
              );

          setActivities(
            [
              ...recentMembers,
              ...recentLoans,
              ...recentNotifications,
            ].slice(0, 6),
          );
        } finally {
          setLoading(false);
          setRefreshing(false);
        }
      },
      [],
    );

  /* =======================================================
     DASHBOARD CARDS
     
     Kept here because /dashboard/summery will use them
     through DashboardUI.
  ======================================================= */

  const dashboardCards =
    useMemo(
      () => [
        {
          title: "Members",
          value:
            stats.members.toLocaleString(),
          secondary: `${stats.activeMembers.toLocaleString()} active`,
          icon: Users,
        },

        {
          title: "Savings",
          value: formatKES(
            stats.savingsBalance,
          ),
          secondary: "Current balance",
          icon: Wallet,
        },

        {
          title: "Loans",
          value:
            stats.loans.toLocaleString(),
          secondary: formatKES(
            stats.outstandingLoans,
          ),
          icon: HandCoins,
        },

        {
          title: "Notifications",
          value:
            stats.unreadNotifications.toLocaleString(),
          secondary:
            stats.unreadNotifications ===
            1
              ? "Unread notification"
              : "Unread notifications",
          icon: Bell,
        },
      ],
      [stats],
    );

  void dashboardCards;

  /* =======================================================
     HYDRATION
  ======================================================= */

  if (!mounted) {
    return <DashboardLoading />;
  }

  /* =======================================================
     SECURITY LOADING
  ======================================================= */

  if (!securityChecked) {
    return <DashboardLoading />;
  }

  /* =======================================================
     PIN SETUP
  ======================================================= */

  if (!pinConfigured) {
    return (
      <PinSetupScreen
        onSuccess={
          handlePinSetupSuccess
        }
      />
    );
  }

  /* =======================================================
     IDENTITY
  ======================================================= */

  if (!identityVerified) {
    return (
      <IdentityScreen
        onSuccess={
          handleIdentitySuccess
        }
      />
    );
  }

  /* =======================================================
     AFTER LOGIN → NAVIGATOR
     
     THIS IS NOW ALWAYS THE DEFAULT.
  ======================================================= */

  return <GeoShuaNavigator />;
}