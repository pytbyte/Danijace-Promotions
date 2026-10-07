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
import { Capacitor } from "@capacitor/core";

import {
  authenticateWithAndroidDeviceSecurity,
  authenticateAndSignAndroidWithDeviceCredential,
  createAndroidRecoveryKey,
  getAndroidRecoveryPublicKey,
  hasAndroidRecoveryKey,
  isAndroidDeviceSecurityAvailable,
} from "@/lib/auth/androidDeviceSecurity";
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
   DEVICE RECOVERY TYPES
========================================================= */

interface DeviceRecoveryOptionsResponse {
  success?: boolean;
  registered?: boolean;
  platform?: string;
  algorithm?: string;
  error?: string;
  message?: string;
}

interface DeviceRecoveryChallengeResponse {
  success?: boolean;
  challenge?: string;
  challengeId?: string;
  expiresAt?: string;
  expiresInSeconds?: number;
  error?: string;
  message?: string;
}

interface DeviceRecoveryVerifyResponse {
  success?: boolean;
  verified?: boolean;
  authorizationToken?: string;
  authorizationExpiresAt?: string;
  expiresInSeconds?: number;
  method?: string;
  platform?: string;
  algorithm?: string;
  error?: string;
  message?: string;
}

interface DeviceRecoveryResetResponse {
  success?: boolean;
  reset?: boolean;
  requiresVerification?: boolean;
  method?: string;
  platform?: string;
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
  }).format(
    Number.isFinite(value) ? value : 0,
  );
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
      .trim() || "DANIJACE PROMOTIONS Member"
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
            DANIJACE PROMOTIONS
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
            Accept: "application/json",
          },
          credentials: "include",
          cache: "no-store",
          body: JSON.stringify({
            pin,
            confirmPin,
          }),
        },
      );

      let result: SecuritySetupResponse =
        {};

      try {
        result =
          (await response.json()) as SecuritySetupResponse;
      } catch {
        throw new Error(
          "The security server returned an invalid response.",
        );
      }

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
    } catch (error) {
      console.error(
        "PIN SETUP ERROR:",
        error,
      );

      setError(
        error instanceof Error
          ? error.message
          : "Unable to configure your security PIN. Please try again.",
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
              DANIJACE PROMOTIONS
            </p>

            <h1 className="mt-1.5 text-xl font-semibold">
              Create security PIN
            </h1>

            <p className="mt-1 text-[11px] text-white/35">
              Protect your DANIJACE PROMOTIONS workspace
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
            DANIJACE PROMOTIONS
          </div>
        </section>
      </div>
    </main>
  );
}

/* =========================================================
   DEVICE RECOVERY PIN RESET
========================================================= */

function DeviceRecoveryResetScreen({
  authorizationToken,
  onSuccess,
  onCancel,
}: {
  authorizationToken: string;
  onSuccess: () => void;
  onCancel: () => void;
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

  const resetPin = async () => {
    if (pin.length < 4 || pin.length > 6) {
      setError(
        "Your PIN must contain 4 to 6 digits.",
      );
      return;
    }

    if (confirmPin.length < 4) {
      setError("Confirm your new PIN.");
      return;
    }

    if (pin !== confirmPin) {
      setError("PINs do not match.");
      return;
    }

    if (!authorizationToken) {
      setError(
        "Recovery authorization has expired. Please start again.",
      );
      return;
    }

    setChecking(true);
    setError("");

    try {
      const response = await fetch(
        "/api/auth/security/device-recovery/reset-pin",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          credentials: "include",
          cache: "no-store",
          body: JSON.stringify({
            authorizationToken,
            pin,
            confirmPin,
          }),
        },
      );

      let result: DeviceRecoveryResetResponse =
        {};

      try {
        result =
          (await response.json()) as DeviceRecoveryResetResponse;
      } catch {
        throw new Error(
          "The recovery server returned an invalid response.",
        );
      }

      if (
        !response.ok ||
        result.success !== true ||
        result.reset !== true
      ) {
        throw new Error(
          result.error ||
            result.message ||
            "Unable to reset your security PIN.",
        );
      }

      setPin("");
      setConfirmPin("");

      onSuccess();
    } catch (error) {
      console.error(
        "DEVICE RECOVERY PIN RESET ERROR:",
        error,
      );

      setError(
        error instanceof Error
          ? error.message
          : "Unable to reset your security PIN. Please try again.",
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
              DANIJACE PROMOTIONS
            </p>

            <h1 className="mt-1.5 text-xl font-semibold">
              Reset security PIN
            </h1>

            <p className="mx-auto mt-1 max-w-[270px] text-[11px] leading-4 text-white/35">
              Your Android device has authorized this PIN
              reset. Create a new 4–6 digit PIN.
            </p>
          </div>

          <div className="mt-4 flex items-center gap-3 rounded-xl border border-sky-400/10 bg-sky-400/[0.035] p-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sky-400/[0.06]">
              <Fingerprint className="h-4 w-4 text-sky-300" />
            </div>

            <div className="min-w-0">
              <p className="text-xs font-semibold text-white">
                Android recovery verified
              </p>

              <p className="mt-0.5 text-[10px] text-white/30">
                Your previous security sessions will be
                invalidated.
              </p>
            </div>
          </div>

          <div className="mt-5">
            <p className="text-[11px] text-white/40">
              New security PIN
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
                placeholder="Enter new PIN"
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
              Confirm new PIN
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
                placeholder="Confirm new PIN"
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter" &&
                    pin.length >= 4 &&
                    confirmPin.length >= 4 &&
                    !checking
                  ) {
                    void resetPin();
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
              Your new PIN is securely hashed on the server.
            </p>
          )}

          <button
            type="button"
            onClick={() => void resetPin()}
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
                Resetting PIN
              </>
            ) : (
              <>
                Set new PIN
                <ArrowRight className="h-4 w-4" />
              </>
            )}
          </button>

          <button
            type="button"
            onClick={onCancel}
            disabled={checking}
            className="mt-2 h-10 w-full rounded-xl text-[10px] font-semibold text-white/30 transition hover:bg-white/[0.03] hover:text-white/60 disabled:opacity-30"
          >
            Cancel recovery
          </button>

          <div className="mt-4 flex items-center justify-center gap-1.5 text-[8px] font-semibold uppercase tracking-[0.25em] text-white/15">
            <ShieldCheck className="h-3 w-3" />
            DANIJACE PROMOTIONS
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

  const [isAndroid, setIsAndroid] =
    useState(false);

  const [attempts, setAttempts] =
    useState(0);

  const [recoveryMode, setRecoveryMode] =
    useState(false);

  const [recoveryToken, setRecoveryToken] =
    useState("");

  /* =======================================================
     PLATFORM
  ======================================================= */

  useEffect(() => {
    const nativeAndroid =
      Capacitor.isNativePlatform() &&
      Capacitor.getPlatform() === "android";

    setIsAndroid(nativeAndroid);
  }, []);

  /* =======================================================
     DEVICE AVAILABILITY
  ======================================================= */

  useEffect(() => {
    let active = true;

    const checkDevice = async () => {
      if (!isAndroid) {
        if (active) {
          setDeviceAvailable(false);
        }

        return;
      }

      try {
        const result =
          await isAndroidDeviceSecurityAvailable();

        if (active) {
          setDeviceAvailable(
            result === true,
          );
        }
      } catch (error) {
        console.error(
          "ANDROID DEVICE SECURITY AVAILABILITY ERROR:",
          error,
        );

        if (active) {
          setDeviceAvailable(false);
        }
      }
    };

    void checkDevice();

    return () => {
      active = false;
    };
  }, [isAndroid]);

  /* =======================================================
     PIN INPUT
  ======================================================= */

  const handlePinChange = (
    event: ChangeEvent<HTMLInputElement>,
  ) => {
    const value = event.target.value
      .replace(/\D/g, "")
      .slice(0, 6);

    setPin(value);
    setError("");
  };

  /* =======================================================
     VERIFY PIN
  ======================================================= */

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
            Accept: "application/json",
          },
          credentials: "include",
          cache: "no-store",
          body: JSON.stringify({
            method: "pin",
            pin,
          }),
        },
      );

      let result: SecurityVerifyResponse =
        {};

      try {
        result =
          (await response.json()) as SecurityVerifyResponse;
      } catch {
        throw new Error(
          "The security server returned an invalid response.",
        );
      }

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

        setPin("");
        return;
      }

      setPin("");
      setAttempts(0);

      onSuccess();
    } catch (error) {
      console.error(
        "PIN VERIFICATION ERROR:",
        error,
      );

      setError(
        error instanceof Error
          ? error.message
          : "Unable to verify your identity. Please try again.",
      );
    } finally {
      setChecking(false);
    }
  };

  /* =======================================================
     VERIFY DEVICE
  ======================================================= */

  const verifyDevice = async () => {
    if (!isAndroid) {
      setError(
        "Android device security is available in the DANIJACE PROMOTIONS Android app.",
      );
      return;
    }

    if (!deviceAvailable) {
      setError(
        "No supported Android device security method is available.",
      );
      return;
    }

    setChecking(true);
    setError("");

    try {
      const result =
        await authenticateWithAndroidDeviceSecurity();

      if (!result.success) {
        throw new Error(
          result.message ||
            "Android device verification failed.",
        );
      }

      setError("");
      onSuccess();
    } catch (error) {
      console.error(
        "ANDROID DEVICE VERIFICATION ERROR:",
        error,
      );

      setError(
        error instanceof Error
          ? error.message
          : "Android device verification failed.",
      );
    } finally {
      setChecking(false);
    }
  };

  /* =======================================================
     START ANDROID FORGOT PIN RECOVERY
     
     Recovery authorization:
     
       Google session
            ↓
       Android recovery key
            ↓
       Public key registration
            ↓
       Server challenge
            ↓
       Android device authentication
            ↓
       Signature
            ↓
       Server verification
            ↓
       Short-lived authorization token
            ↓
       New PIN
     
     IMPORTANT:
     
     The native recovery authentication method accepts
     the Android device's configured security:
     
       • fingerprint
       • face
       • device PIN
       • device pattern
       • device password
  ======================================================= */

  const startAndroidRecovery =
    async () => {
      if (!isAndroid) {
        setError(
          "PIN recovery with device security is available in the DANIJACE PROMOTIONS Android app.",
        );
        return;
      }

      if (!deviceAvailable) {
        setError(
          "No supported Android device security method is available.",
        );
        return;
      }

      if (checking) {
        return;
      }

      setChecking(true);
      setError("");

      try {
        /* -------------------------------------------------
           STEP 1
           Check recovery key.
        ------------------------------------------------- */

        const keyStatus =
          await hasAndroidRecoveryKey();

        if (!keyStatus.success) {
          throw new Error(
            keyStatus.error ||
              keyStatus.message ||
              "Unable to check Android recovery security.",
          );
        }

        /* -------------------------------------------------
           STEP 2
           Create recovery key if necessary.
        ------------------------------------------------- */

        if (!keyStatus.exists) {
          const created =
            await createAndroidRecoveryKey();

          if (!created.success) {
            throw new Error(
              created.error ||
                created.message ||
                "Unable to create the Android recovery key.",
            );
          }
        }

        /* -------------------------------------------------
           STEP 3
           Read public key.
           
           The private key remains inside Android Keystore.
        ------------------------------------------------- */

        const publicKeyResult =
          await getAndroidRecoveryPublicKey();

        if (
          !publicKeyResult.success ||
          typeof publicKeyResult.publicKey !==
            "string" ||
          !publicKeyResult.publicKey.trim()
        ) {
          throw new Error(
            publicKeyResult.error ||
              publicKeyResult.message ||
              "Unable to access the Android recovery public key.",
          );
        }

        const publicKey =
          publicKeyResult.publicKey.trim();

        /* -------------------------------------------------
           STEP 4
           Register public key.
        ------------------------------------------------- */

        const optionsResponse =
          await fetch(
            "/api/auth/security/device-recovery/options",
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
                publicKey,
              }),
            },
          );

        let optionsResult:
          DeviceRecoveryOptionsResponse =
          {};

        try {
          optionsResult =
            (await optionsResponse.json()) as DeviceRecoveryOptionsResponse;
        } catch {
          throw new Error(
            "The recovery registration server returned an invalid response.",
          );
        }

        if (
          !optionsResponse.ok ||
          optionsResult.success !== true
        ) {
          throw new Error(
            optionsResult.error ||
              optionsResult.message ||
              "Android recovery could not be registered.",
          );
        }

        /* -------------------------------------------------
           STEP 5
           Request cryptographic challenge.
        ------------------------------------------------- */

        const challengeResponse =
          await fetch(
            "/api/auth/security/device-recovery/challenge",
            {
              method: "POST",
              headers: {
                Accept:
                  "application/json",
              },
              credentials: "include",
              cache: "no-store",
            },
          );

        let challengeResult:
          DeviceRecoveryChallengeResponse =
          {};

        try {
          challengeResult =
            (await challengeResponse.json()) as DeviceRecoveryChallengeResponse;
        } catch {
          throw new Error(
            "The recovery challenge server returned an invalid response.",
          );
        }

        /* -------------------------------------------------
           STEP 6
           STRICT CHALLENGE VALIDATION.
           
           NEVER call Android with an empty challenge.
        ------------------------------------------------- */

        if (!challengeResponse.ok) {
          throw new Error(
            challengeResult.error ||
              challengeResult.message ||
              "Unable to create the Android recovery challenge.",
          );
        }

        if (
          challengeResult.success !== true
        ) {
          throw new Error(
            challengeResult.error ||
              challengeResult.message ||
              "The Android recovery challenge was rejected.",
          );
        }

        if (
          typeof challengeResult.challengeId !==
            "string" ||
          !challengeResult.challengeId.trim()
        ) {
          throw new Error(
            "The recovery server did not return a valid challenge ID.",
          );
        }

        if (
          typeof challengeResult.challenge !==
            "string" ||
          !challengeResult.challenge.trim()
        ) {
          throw new Error(
            "The recovery server did not return a valid recovery challenge.",
          );
        }

        const challenge =
          challengeResult.challenge.trim();

        const challengeId =
          challengeResult.challengeId.trim();

        /* -------------------------------------------------
           STEP 7
           ANDROID DEVICE AUTHENTICATION + SIGNING
           
           This native method deliberately uses the Android
           device credential-capable authentication path.
           
           It supports:
           
             • fingerprint
             • face
             • device PIN
             • pattern
             • password
        ------------------------------------------------- */

        const signedResult =
        await authenticateAndSignAndroidWithDeviceCredential(
          challenge,
        );

        if (
          !signedResult.success
        ) {
          throw new Error(
            signedResult.error ||
              signedResult.message ||
              "Android device security did not authorize PIN recovery.",
          );
        }

        if (
          typeof signedResult.signature !==
            "string" ||
          !signedResult.signature.trim()
        ) {
          throw new Error(
            "Android device security completed, but no recovery signature was returned.",
          );
        }

        const signature =
          signedResult.signature.trim();

        /* -------------------------------------------------
           STEP 8
           Verify signature with server.
        ------------------------------------------------- */

        const verifyResponse =
          await fetch(
            "/api/auth/security/device-recovery/verify",
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
                challengeId,
                challenge,
                signature,
              }),
            },
          );

        let verifyResult:
          DeviceRecoveryVerifyResponse =
          {};

        try {
          verifyResult =
            (await verifyResponse.json()) as DeviceRecoveryVerifyResponse;
        } catch {
          throw new Error(
            "The recovery verification server returned an invalid response.",
          );
        }

        /* -------------------------------------------------
           STEP 9
           Validate authorization.
        ------------------------------------------------- */

        if (!verifyResponse.ok) {
          throw new Error(
            verifyResult.error ||
              verifyResult.message ||
              "Android recovery verification failed.",
          );
        }

        if (
          verifyResult.success !== true ||
          verifyResult.verified !== true
        ) {
          throw new Error(
            verifyResult.error ||
              verifyResult.message ||
              "Android recovery authorization failed.",
          );
        }

        if (
          typeof verifyResult.authorizationToken !==
            "string" ||
          !verifyResult.authorizationToken.trim()
        ) {
          throw new Error(
            "The recovery server did not issue a valid authorization token.",
          );
        }

        /* -------------------------------------------------
           STEP 10
           Keep token ONLY in React memory.
        ------------------------------------------------- */

        setRecoveryToken(
          verifyResult.authorizationToken.trim(),
        );

        setRecoveryMode(true);

        setPin("");
        setAttempts(0);
        setError("");
      } catch (error) {
        console.error(
          "ANDROID PIN RECOVERY ERROR:",
          error,
        );

        setError(
          error instanceof Error
            ? error.message
            : "Android PIN recovery failed. Please try again.",
        );
      } finally {
        setChecking(false);
      }
    };

  /* =======================================================
     EXIT RECOVERY
  ======================================================= */

  const cancelRecovery = () => {
    setRecoveryMode(false);
    setRecoveryToken("");
    setPin("");
    setError("");
    setAttempts(0);
    setChecking(false);
    setMethod("pin");
  };

  /* =======================================================
     RECOVERY RESET SCREEN
  ======================================================= */

  if (
    recoveryMode &&
    recoveryToken
  ) {
    return (
      <DeviceRecoveryResetScreen
        authorizationToken={
          recoveryToken
        }
        onSuccess={() => {
          setRecoveryMode(false);
          setRecoveryToken("");
          setPin("");
          setError("");
          setAttempts(0);
          setMethod("pin");
        }}
        onCancel={cancelRecovery}
      />
    );
  }

  /* =======================================================
     IDENTITY SCREEN
  ======================================================= */

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
              DANIJACE PROMOTIONS
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
                DANIJACE PROMOTIONS account authenticated
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

              {/* =================================================
                 FORGOT PIN
              ================================================= */}

              {isAndroid ? (
                <button
                  type="button"
                  onClick={() =>
                    void startAndroidRecovery()
                  }
                  disabled={
                    checking ||
                    !deviceAvailable
                  }
                  className="mx-auto mt-3 flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-[10px] font-semibold text-sky-300/75 transition hover:bg-sky-400/[0.05] hover:text-sky-200 disabled:cursor-not-allowed disabled:opacity-30"
                >
                  {checking ? (
                    <RefreshCw className="h-3 w-3 animate-spin" />
                  ) : (
                    <Fingerprint className="h-3 w-3" />
                  )}

                  Forgot PIN?
                </button>
              ) : null}
            </div>
          ) : (
            <div className="mt-5 text-center">
              <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-[1.5rem] border border-sky-400/15 bg-sky-400/[0.05]">
                <Fingerprint className="h-10 w-10 text-sky-300" />
              </div>

              <h2 className="mt-4 text-base font-semibold">
                Device security
              </h2>

              <p className="mx-auto mt-1.5 max-w-[270px] text-[10px] leading-4 text-white/35">
                Use your fingerprint, face unlock,
                device PIN, pattern, or password.
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
            DANIJACE PROMOTIONS
          </div>
        </section>
      </div>
    </main>
  );
}

/* =========================================================
   DANIJACE PROMOTIONS NAVIGATOR
========================================================= */

function DanijaceNavigator(): ReactNode {
  const router = useRouter();

  const navigation = [
    {
      title: "Summary",
      description: "Overview & activity",
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
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 top-1/2 h-[380px] w-[380px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-sky-500/[0.04] blur-3xl" />

        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_25%,rgba(0,0,0,0.88)_100%)]" />
      </div>

      <div className="relative flex min-h-[100dvh] items-center justify-center px-4 py-6 sm:px-6">
        <section className="w-full max-w-md">
          <div className="text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl border border-sky-400/15 bg-white/[0.035] shadow-lg shadow-sky-500/[0.04]">
              <span className="text-sm font-black tracking-[0.16em] text-sky-300">
                GS
              </span>
            </div>

            <p className="mt-3 text-[8px] font-bold uppercase tracking-[0.42em] text-sky-300/70">
              DANIJACE PROMOTIONS
            </p>

            <h1 className="mt-1 text-xl font-semibold tracking-tight text-white sm:text-2xl">
              Workspace
            </h1>

            <p className="mt-1 text-[10px] text-white/30 sm:text-[11px]">
              Select a section to continue
            </p>
          </div>

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
                  <div className="flex items-center justify-between">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-sky-400/[0.055]">
                      <Icon className="h-4.5 w-4.5 text-sky-300" />
                    </div>

                    <ArrowRight className="h-4 w-4 text-white/15 transition duration-200 group-hover:translate-x-0.5 group-hover:text-sky-300/70" />
                  </div>

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

          <div className="mt-5 flex items-center justify-center gap-1.5 text-[8px] font-medium uppercase tracking-[0.28em] text-white/15">
            <ShieldCheck className="h-3 w-3" />
            DANIJACE PROMOTIONS workspace
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

        let result: SecurityStatusResponse =
          {};

        try {
          result =
            (await response.json()) as SecurityStatusResponse;
        } catch {
          throw new Error(
            "The security status server returned an invalid response.",
          );
        }

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

        setPinConfigured(
          result.configured === true,
        );

        setIdentityVerified(
          result.verified === true,
        );
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

          let loans: LoanRecord[] =
            [];

          let notifications: NotificationRecord[] =
            [];

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

          const activeMembers =
            members.filter(
              (member) =>
                member.status?.toLowerCase() ===
                "active",
            ).length;

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

          const unreadNotifications =
            notifications.filter(
              (notification) =>
                notification.read !== true &&
                notification.isRead !== true,
            ).length;

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
                    "DANIJACE PROMOTIONS notification",

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
  void activities;
  void loading;
  void refreshing;
  void loadDashboard;

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
     AFTER SECURITY → NAVIGATOR
  ======================================================= */

  return <DanijaceNavigator />;
}