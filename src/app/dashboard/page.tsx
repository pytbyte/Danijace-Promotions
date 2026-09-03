"use client";

import {
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from "react";

import {
  ArrowRight,
  Bell,
  Eye,
  EyeOff,
  FileText,
  Fingerprint,
  HandCoins,
  LayoutDashboard,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Users,
  Wallet,
} from "lucide-react";

import { useRouter } from "next/navigation";

import SmsInboxMonitor from "@/components/sms/SmsInboxMonitor";
import TopBar from "@/components/dashboard/TopBar";

/* =========================================================
   TYPES
========================================================= */

type DashboardStats = {
  members: number;
  activeMembers: number;

  savings: number;
  deposits: number;
  withdrawals: number;
  reversals: number;

  loans: number;
  outstandingLoans: number;
  defaulters: number;

  notifications: number;
};

type DashboardActivity = {
  id: string;
  title: string;
  description: string;
  time: string;
  type:
    | "member"
    | "saving"
    | "loan"
    | "notification";
};

type SavingsSummary = {
  totalBalance?: unknown;
  totalDeposits?: unknown;

  /*
   * Backend/domain name remains "totalAdjustments".
   * UI presents this as "Withdrawals".
   */
  totalAdjustments?: unknown;

  totalReversals?: unknown;
  memberCount?: unknown;
};

type ApiResponse<T = unknown> = {
  success?: boolean;
  data?: T;
  error?: string;
};

type MemberRecord = {
  id?: string;
  _id?: string;

  firstName?: string;
  middleName?: string;
  lastName?: string;

  name?: string;
  fullName?: string;

  status?: string;
  isActive?: boolean;

  createdAt?: string;
  updatedAt?: string;
};

type LoanRecord = {
  id?: string;
  _id?: string;

  status?: string;
  loanStatus?: string;

  outstandingBalance?: unknown;
  balance?: unknown;
  remainingBalance?: unknown;

  createdAt?: string;
  updatedAt?: string;

  memberName?: string;
  memberId?: string;

  loanNumber?: string;
};

type NotificationRecord = {
  id?: string;
  _id?: string;

  title?: string;
  message?: string;
  description?: string;

  createdAt?: string;
  updatedAt?: string;

  read?: boolean;
  status?: string;
};

type SecurityMethod = "pin" | "device";

type SecurityStatusResponse = {
  success?: boolean;
  authenticated?: boolean;
  configured?: boolean;
  verified?: boolean;
  error?: string;
};

type SecuritySetupResponse = {
  success?: boolean;
  error?: string;
};

type SecurityVerifyResponse = {
  success?: boolean;
  verified?: boolean;
  error?: string;
  retryAfterSeconds?: number;
};

type WebAuthnOptionsResponse = {
  success?: boolean;
  error?: string;
  publicKey?: PublicKeyCredentialRequestOptionsJSON;
};

type PublicKeyCredentialRequestOptionsJSON = {
  challenge: string;
  timeout?: number;
  rpId?: string;
  allowCredentials?: Array<{
    id: string;
    type: PublicKeyCredentialType;
    transports?: AuthenticatorTransport[];
  }>;
  userVerification?: UserVerificationRequirement;
};

/* =========================================================
   DEFAULTS
========================================================= */

const DEFAULT_STATS: DashboardStats = {
  members: 0,
  activeMembers: 0,

  savings: 0,
  deposits: 0,
  withdrawals: 0,
  reversals: 0,

  loans: 0,
  outstandingLoans: 0,
  defaulters: 0,

  notifications: 0,
};

/* =========================================================
   SAFE HELPERS
========================================================= */

function safeNumber(value: unknown): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === "string") {
    const parsed = Number(value);

    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function getId(
  item: {
    id?: string;
    _id?: string;
  },
  fallback: string,
): string {
  return item.id || item._id || fallback;
}

function getDate(
  item: {
    createdAt?: string;
    updatedAt?: string;
  },
): string {
  return item.createdAt || item.updatedAt || "";
}

function formatRelativeTime(value: string): string {
  if (!value) {
    return "";
  }

  const timestamp = new Date(value).getTime();

  if (!Number.isFinite(timestamp)) {
    return "";
  }

  const difference = Math.max(
    0,
    Date.now() - timestamp,
  );

  const seconds = Math.floor(
    difference / 1000,
  );

  if (seconds < 60) {
    return "Just now";
  }

  const minutes = Math.floor(
    seconds / 60,
  );

  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours = Math.floor(
    minutes / 60,
  );

  if (hours < 24) {
    return `${hours}h ago`;
  }

  const days = Math.floor(
    hours / 24,
  );

  if (days < 7) {
    return `${days}d ago`;
  }

  return new Date(timestamp).toLocaleDateString(
    "en-KE",
    {
      day: "numeric",
      month: "short",
      year: "numeric",
    },
  );
}

function formatCurrency(value: number): string {
  return `KES ${safeNumber(value).toLocaleString(
    "en-KE",
    {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    },
  )}`;
}

function extractRecords<T>(
  result: ApiResponse,
): T[] {
  const data = result.data;

  if (Array.isArray(data)) {
    return data as T[];
  }

  if (
    data &&
    typeof data === "object"
  ) {
    const recordData =
      data as Record<string, unknown>;

    const candidates = [
      recordData.members,
      recordData.loans,
      recordData.notifications,
      recordData.transactions,
      recordData.items,
      recordData.results,
      recordData.data,
    ];

    for (const candidate of candidates) {
      if (Array.isArray(candidate)) {
        return candidate as T[];
      }
    }
  }

  return [];
}

/* =========================================================
   BASE64URL HELPERS
========================================================= */

function base64UrlToUint8Array(
  value: string,
): Uint8Array {
  const normalized = value
    .replace(/-/g, "+")
    .replace(/_/g, "/");

  const padded =
    normalized +
    "=".repeat(
      (4 - (normalized.length % 4)) % 4,
    );

  const binary = window.atob(padded);
  const bytes = new Uint8Array(
    binary.length,
  );

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function toArrayBuffer(
  value: Uint8Array,
): ArrayBuffer {
  const buffer = new ArrayBuffer(
    value.byteLength,
  );

  new Uint8Array(buffer).set(value);

  return buffer;
}

function uint8ArrayToNumberArray(
  value: ArrayBuffer | Uint8Array,
): number[] {
  return Array.from(
    value instanceof Uint8Array
      ? value
      : new Uint8Array(value),
  );
}

/* =========================================================
   SECURITY LOADING
========================================================= */

function SecurityLoading() {
  return (
    <main className="flex min-h-[100dvh] w-full items-center justify-center bg-[#050505] px-5 text-white">
      <div className="w-full max-w-sm text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.03]">
          <div className="text-xl font-bold tracking-tight text-yellow-400">
            GS
          </div>
        </div>

        <p className="mt-5 text-sm font-medium text-white/70">
          GEO-SHUA
        </p>

        <p className="mt-1 text-xs text-white/25">
          Preparing your secure workspace
        </p>

        <div className="mx-auto mt-5 h-1 w-32 overflow-hidden rounded-full bg-white/[0.06]">
          <div className="h-full w-1/2 animate-pulse rounded-full bg-yellow-500" />
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
}) {
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] =
    useState("");

  const [showPin, setShowPin] =
    useState(false);

  const [showConfirmPin, setShowConfirmPin] =
    useState(false);

  const [checking, setChecking] =
    useState(false);

  const [error, setError] =
    useState("");

  const submit = async () => {
    setError("");

    if (!/^\d{4,6}$/.test(pin)) {
      setError(
        "Your PIN must contain 4 to 6 digits.",
      );
      return;
    }

    if (pin !== confirmPin) {
      setError(
        "The PINs do not match.",
      );
      return;
    }

    setChecking(true);

    try {
      const response = await fetch(
        "/api/auth/security/setup",
        {
          method: "POST",
          credentials: "same-origin",
          cache: "no-store",
          headers: {
            "Content-Type":
              "application/json",
            Accept:
              "application/json",
          },
          body: JSON.stringify({
            pin,
            confirmPin,
          }),
        },
      );

      const json =
        (await response.json()) as SecuritySetupResponse;

      if (
        !response.ok ||
        json.success !== true
      ) {
        throw new Error(
          json.error ||
            "Unable to create your security PIN.",
        );
      }

      setPin("");
      setConfirmPin("");

      onSuccess();
    } catch (setupError) {
      setError(
        setupError instanceof Error
          ? setupError.message
          : "Unable to create your security PIN.",
      );
    } finally {
      setChecking(false);
    }
  };

  const handlePinChange = (
    value: string,
    setter: (value: string) => void,
  ) => {
    setter(
      value
        .replace(/\D/g, "")
        .slice(0, 6),
    );
  };

  return (
    <main className="flex min-h-[100dvh] w-full items-center justify-center overflow-x-hidden bg-[#050505] px-4 py-6 text-white">
      <div className="w-full max-w-md">
        <div className="rounded-3xl border border-white/[0.08] bg-white/[0.025] p-5 shadow-2xl sm:p-7">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-yellow-500/10 text-yellow-400">
              <ShieldCheck
                size={21}
                strokeWidth={1.8}
              />
            </div>

            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-yellow-500/60">
                Identity
              </p>

              <h1 className="mt-1 text-lg font-semibold text-white">
                Create security PIN
              </h1>
            </div>
          </div>

          <div className="mt-6 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-[#1683ff]" />

              <p className="text-xs font-medium text-white/65">
                Google identity verified
              </p>
            </div>

            <p className="mt-2 text-[11px] leading-5 text-white/30">
              Create your GEO-SHUA security
              PIN. It will be securely hashed
              on the server and will never be
              stored as plain text.
            </p>
          </div>

          {/* PIN */}

          <div className="mt-5">
            <label
              htmlFor="security-pin"
              className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/35"
            >
              Security PIN
            </label>

            <div className="relative mt-2">
              <input
                id="security-pin"
                type={
                  showPin
                    ? "text"
                    : "password"
                }
                inputMode="numeric"
                autoComplete="new-password"
                maxLength={6}
                value={pin}
                onChange={(event) =>
                  handlePinChange(
                    event.target.value,
                    setPin,
                  )
                }
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter"
                  ) {
                    void submit();
                  }
                }}
                placeholder="4–6 digits"
                className="h-14 w-full rounded-2xl border border-white/[0.08] bg-black/30 px-4 pr-12 text-center text-xl tracking-[0.5em] text-white outline-none transition placeholder:text-sm placeholder:tracking-normal placeholder:text-white/15 focus:border-yellow-500/40"
              />

              <button
                type="button"
                onClick={() =>
                  setShowPin(
                    (current) =>
                      !current,
                  )
                }
                aria-label={
                  showPin
                    ? "Hide PIN"
                    : "Show PIN"
                }
                className="absolute right-3 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-white/30 transition hover:bg-white/[0.05] hover:text-white/60"
              >
                {showPin ? (
                  <EyeOff size={17} />
                ) : (
                  <Eye size={17} />
                )}
              </button>
            </div>
          </div>

          {/* CONFIRM PIN */}

          <div className="mt-4">
            <label
              htmlFor="confirm-security-pin"
              className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/35"
            >
              Confirm PIN
            </label>

            <div className="relative mt-2">
              <input
                id="confirm-security-pin"
                type={
                  showConfirmPin
                    ? "text"
                    : "password"
                }
                inputMode="numeric"
                autoComplete="new-password"
                maxLength={6}
                value={confirmPin}
                onChange={(event) =>
                  handlePinChange(
                    event.target.value,
                    setConfirmPin,
                  )
                }
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter"
                  ) {
                    void submit();
                  }
                }}
                placeholder="Repeat your PIN"
                className="h-14 w-full rounded-2xl border border-white/[0.08] bg-black/30 px-4 pr-12 text-center text-xl tracking-[0.5em] text-white outline-none transition placeholder:text-sm placeholder:tracking-normal placeholder:text-white/15 focus:border-yellow-500/40"
              />

              <button
                type="button"
                onClick={() =>
                  setShowConfirmPin(
                    (current) =>
                      !current,
                  )
                }
                aria-label={
                  showConfirmPin
                    ? "Hide confirmation PIN"
                    : "Show confirmation PIN"
                }
                className="absolute right-3 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-white/30 transition hover:bg-white/[0.05] hover:text-white/60"
              >
                {showConfirmPin ? (
                  <EyeOff size={17} />
                ) : (
                  <Eye size={17} />
                )}
              </button>
            </div>
          </div>

          {error && (
            <div className="mt-4 rounded-xl border border-red-400/10 bg-red-400/[0.05] px-3 py-2.5 text-xs leading-5 text-red-300/80">
              {error}
            </div>
          )}

          <button
            type="button"
            onClick={() => void submit()}
            disabled={checking}
            className="mt-5 flex h-13 w-full items-center justify-center gap-2 rounded-2xl bg-yellow-500 px-4 text-sm font-semibold text-black transition hover:bg-yellow-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {checking ? (
              <>
                <RefreshCw
                  size={16}
                  className="animate-spin"
                />

                Creating PIN...
              </>
            ) : (
              <>
                Create security PIN

                <ArrowRight size={16} />
              </>
            )}
          </button>

          <p className="mt-4 text-center text-[10px] leading-5 text-white/20">
            Your PIN is verified by the
            GEO-SHUA security service.
          </p>
        </div>
      </div>
    </main>
  );
}

/* =========================================================
   IDENTITY SCREEN
========================================================= */

function IdentityScreen({
  onSuccess,
}: {
  onSuccess: () => void;
}) {
  const [method, setMethod] =
    useState<SecurityMethod>("pin");

  const [pin, setPin] = useState("");

  const [showPin, setShowPin] =
    useState(false);

  const [checking, setChecking] =
    useState(false);

  const [deviceAvailable, setDeviceAvailable] =
    useState(false);

  const [error, setError] =
    useState("");

  const [attempts, setAttempts] =
    useState(0);

  const MAX_CLIENT_ATTEMPTS = 5;

  useEffect(() => {
    let active = true;

    const checkDevice = async () => {
      try {
        if (
          typeof window ===
            "undefined" ||
          !("PublicKeyCredential" in
            window)
        ) {
          if (active) {
            setDeviceAvailable(false);
          }

          return;
        }

        const credential =
          window.PublicKeyCredential;

        if (
          typeof credential
            .isUserVerifyingPlatformAuthenticatorAvailable !==
          "function"
        ) {
          if (active) {
            setDeviceAvailable(false);
          }

          return;
        }

        const available =
          await credential.isUserVerifyingPlatformAuthenticatorAvailable();

        if (active) {
          setDeviceAvailable(
            available,
          );
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

  const verifyPin = async () => {
    setError("");

    if (
      !/^\d{4,6}$/.test(pin)
    ) {
      setError(
        "Enter a valid 4 to 6 digit PIN.",
      );
      return;
    }

    if (
      attempts >=
      MAX_CLIENT_ATTEMPTS
    ) {
      setError(
        "Too many unsuccessful attempts. Please wait and try again.",
      );
      return;
    }

    setChecking(true);

    try {
      const response = await fetch(
        "/api/auth/security/verify",
        {
          method: "POST",
          credentials: "same-origin",
          cache: "no-store",
          headers: {
            "Content-Type":
              "application/json",
            Accept:
              "application/json",
          },
          body: JSON.stringify({
            method: "pin",
            pin,
          }),
        },
      );

      const json =
        (await response.json()) as SecurityVerifyResponse;

      if (
        response.ok &&
        json.success === true &&
        json.verified === true
      ) {
        setPin("");
        setAttempts(0);

        onSuccess();

        return;
      }

      setAttempts(
        (current) => current + 1,
      );

      if (
        json.retryAfterSeconds &&
        json.retryAfterSeconds > 0
      ) {
        setError(
          `Too many attempts. Try again in ${json.retryAfterSeconds} seconds.`,
        );
      } else {
        setError(
          json.error ||
            "Incorrect security PIN.",
        );
      }

      setPin("");
    } catch {
      setError(
        "Unable to verify your PIN. Please try again.",
      );
    } finally {
      setChecking(false);
    }
  };

  const verifyDevice = async () => {
    setError("");
    setChecking(true);

    try {
      const optionsResponse =
        await fetch(
          "/api/auth/security/webauthn/options",
          {
            method: "POST",
            credentials: "same-origin",
            cache: "no-store",
            headers: {
              Accept:
                "application/json",
              "Content-Type":
                "application/json",
            },
            body: JSON.stringify({}),
          },
        );

      const optionsJson =
        (await optionsResponse.json()) as WebAuthnOptionsResponse;

      if (
        !optionsResponse.ok ||
        optionsJson.success !== true ||
        !optionsJson.publicKey
      ) {
        throw new Error(
          optionsJson.error ||
            "Unable to start device verification.",
        );
      }

      if (
        typeof navigator ===
          "undefined" ||
        !navigator.credentials
      ) {
        throw new Error(
          "Device security is not available on this device.",
        );
      }

      const publicKey =
        optionsJson.publicKey;

      const credential =
        (await navigator.credentials.get(
          {
            publicKey: {
             challenge: toArrayBuffer(
  base64UrlToUint8Array(
    publicKey.challenge,
  ),
),

timeout:
  publicKey.timeout,

rpId:
  publicKey.rpId,

userVerification:
  publicKey.userVerification ||
  "required",

allowCredentials:
  publicKey.allowCredentials?.map(
    (item) => ({
      id: toArrayBuffer(
        base64UrlToUint8Array(
          item.id,
        ),
      ),
      type: item.type,
      transports:
        item.transports,
    }),
  ),
            },
          },
        )) as PublicKeyCredential | null;

      if (!credential) {
        throw new Error(
          "Device verification was cancelled.",
        );
      }

      const response =
        credential.response as AuthenticatorAssertionResponse;

      const verifyResponse =
        await fetch(
          "/api/auth/security/webauthn/verify",
          {
            method: "POST",
            credentials: "same-origin",
            cache: "no-store",
            headers: {
              "Content-Type":
                "application/json",
              Accept:
                "application/json",
            },
            body: JSON.stringify({
              id: credential.id,
              rawId:
                uint8ArrayToNumberArray(
                  credential.rawId,
                ),
              type: credential.type,
              response: {
                authenticatorData:
                  uint8ArrayToNumberArray(
                    response.authenticatorData,
                  ),
                clientDataJSON:
                  uint8ArrayToNumberArray(
                    response.clientDataJSON,
                  ),
                signature:
                  uint8ArrayToNumberArray(
                    response.signature,
                  ),
                userHandle:
                  response.userHandle
                    ? uint8ArrayToNumberArray(
                        response.userHandle,
                      )
                    : null,
              },
            }),
          },
        );

      const verifyJson =
        (await verifyResponse.json()) as SecurityVerifyResponse;

      if (
        !verifyResponse.ok ||
        verifyJson.success !== true ||
        verifyJson.verified !== true
      ) {
        throw new Error(
          verifyJson.error ||
            "Device verification failed.",
        );
      }

      onSuccess();
    } catch (deviceError) {
      if (
        deviceError instanceof
          DOMException &&
        deviceError.name ===
          "NotAllowedError"
      ) {
        setError(
          "Device verification was cancelled or timed out.",
        );
      } else {
        setError(
          deviceError instanceof Error
            ? deviceError.message
            : "Device verification failed.",
        );
      }
    } finally {
      setChecking(false);
    }
  };

  return (
    <main className="flex min-h-[100dvh] w-full items-center justify-center overflow-x-hidden bg-[#050505] px-4 py-5 text-white">
      <div className="w-full max-w-md">
        <div className="rounded-3xl border border-white/[0.08] bg-white/[0.025] p-5 shadow-2xl sm:p-7">
          {/* HEADER */}

          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-yellow-500/10 text-yellow-400">
              <ShieldCheck
                size={21}
                strokeWidth={1.8}
              />
            </div>

            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-yellow-500/60">
                Identity
              </p>

              <h1 className="mt-1 text-lg font-semibold text-white">
                Verify your identity
              </h1>
            </div>
          </div>

          {/* GOOGLE STATUS */}

          <div className="mt-5 flex items-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-3">
            <span className="h-2 w-2 rounded-full bg-[#1683ff]" />

            <span className="text-xs text-white/55">
              Google identity verified
            </span>
          </div>

          {/* METHOD SELECTOR */}

          <div className="mt-5 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() =>
                setMethod("pin")
              }
              className={`rounded-2xl border p-3 text-left transition ${
                method === "pin"
                  ? "border-yellow-500/30 bg-yellow-500/[0.07]"
                  : "border-white/[0.07] bg-white/[0.02] hover:bg-white/[0.04]"
              }`}
            >
              <div className="flex items-center gap-2">
                <ShieldCheck
                  size={17}
                  className={
                    method === "pin"
                      ? "text-yellow-400"
                      : "text-white/35"
                  }
                />

                <span
                  className={`text-xs font-medium ${
                    method === "pin"
                      ? "text-white"
                      : "text-white/45"
                  }`}
                >
                  PIN
                </span>
              </div>

              <p className="mt-1 text-[9px] text-white/20">
                Use your security PIN
              </p>
            </button>

            <button
              type="button"
              disabled={
                !deviceAvailable
              }
              onClick={() =>
                setMethod("device")
              }
              className={`rounded-2xl border p-3 text-left transition ${
                method === "device"
                  ? "border-yellow-500/30 bg-yellow-500/[0.07]"
                  : "border-white/[0.07] bg-white/[0.02]"
              } ${
                !deviceAvailable
                  ? "cursor-not-allowed opacity-40"
                  : "hover:bg-white/[0.04]"
              }`}
            >
              <div className="flex items-center gap-2">
                <Fingerprint
                  size={17}
                  className={
                    method === "device"
                      ? "text-yellow-400"
                      : "text-white/35"
                  }
                />

                <span
                  className={`text-xs font-medium ${
                    method === "device"
                      ? "text-white"
                      : "text-white/45"
                  }`}
                >
                  Device
                </span>
              </div>

              <p className="mt-1 text-[9px] text-white/20">
                Fingerprint or device security
              </p>
            </button>
          </div>

          {/* PIN */}

          {method === "pin" && (
            <div className="mt-5">
              <label
                htmlFor="identity-pin"
                className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/35"
              >
                Security PIN
              </label>

              <div className="relative mt-2">
                <input
                  id="identity-pin"
                  type={
                    showPin
                      ? "text"
                      : "password"
                  }
                  inputMode="numeric"
                  autoComplete="current-password"
                  maxLength={6}
                  value={pin}
                  onChange={(event) =>
                    setPin(
                      event.target.value
                        .replace(
                          /\D/g,
                          "",
                        )
                        .slice(0, 6),
                    )
                  }
                  onKeyDown={(event) => {
                    if (
                      event.key ===
                      "Enter"
                    ) {
                      void verifyPin();
                    }
                  }}
                  placeholder="Enter 4–6 digit PIN"
                  className="h-14 w-full rounded-2xl border border-white/[0.08] bg-black/30 px-4 pr-12 text-center text-xl tracking-[0.5em] text-white outline-none transition placeholder:text-sm placeholder:tracking-normal placeholder:text-white/15 focus:border-yellow-500/40"
                />

                <button
                  type="button"
                  onClick={() =>
                    setShowPin(
                      (current) =>
                        !current,
                    )
                  }
                  aria-label={
                    showPin
                      ? "Hide PIN"
                      : "Show PIN"
                  }
                  className="absolute right-3 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-white/30 hover:bg-white/[0.05]"
                >
                  {showPin ? (
                    <EyeOff size={17} />
                  ) : (
                    <Eye size={17} />
                  )}
                </button>
              </div>

              {error && (
                <div className="mt-3 rounded-xl border border-red-400/10 bg-red-400/[0.05] px-3 py-2.5 text-xs text-red-300/80">
                  {error}
                </div>
              )}

              <button
                type="button"
                onClick={() =>
                  void verifyPin()
                }
                disabled={checking}
                className="mt-4 flex h-13 w-full items-center justify-center gap-2 rounded-2xl bg-yellow-500 px-4 text-sm font-semibold text-black transition hover:bg-yellow-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {checking ? (
                  <>
                    <RefreshCw
                      size={16}
                      className="animate-spin"
                    />

                    Verifying...
                  </>
                ) : (
                  <>
                    Continue

                    <ArrowRight size={16} />
                  </>
                )}
              </button>
            </div>
          )}

          {/* DEVICE */}

          {method === "device" && (
            <div className="mt-5">
              <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-5 text-center">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-yellow-500/10 text-yellow-400">
                  <Fingerprint
                    size={27}
                    strokeWidth={1.6}
                  />
                </div>

                <p className="mt-4 text-sm font-medium text-white/70">
                  Device security
                </p>

                <p className="mx-auto mt-2 max-w-xs text-[11px] leading-5 text-white/25">
                  Use your device fingerprint,
                  face recognition, screen lock,
                  or other supported biometric
                  security.
                </p>
              </div>

              {error && (
                <div className="mt-3 rounded-xl border border-red-400/10 bg-red-400/[0.05] px-3 py-2.5 text-xs text-red-300/80">
                  {error}
                </div>
              )}

              <button
                type="button"
                onClick={() =>
                  void verifyDevice()
                }
                disabled={checking}
                className="mt-4 flex h-13 w-full items-center justify-center gap-2 rounded-2xl bg-yellow-500 px-4 text-sm font-semibold text-black transition hover:bg-yellow-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {checking ? (
                  <>
                    <RefreshCw
                      size={16}
                      className="animate-spin"
                    />

                    Verifying...
                  </>
                ) : (
                  <>
                    <Fingerprint
                      size={17}
                    />

                    Verify device
                  </>
                )}
              </button>
            </div>
          )}

          <p className="mt-4 text-center text-[9px] leading-5 text-white/15">
            Identity verification protects
            access to the GEO-SHUA workspace.
          </p>
        </div>
      </div>
    </main>
  );
}

/* =========================================================
   GEO-SHUA LAUNCHER
========================================================= */

function GeoShuaLauncher({
  onDashboard,
}: {
  onDashboard: () => void;
}) {
  const router = useRouter();

  const open = (
    href: string,
  ) => {
    router.push(href);
  };

  return (
    <main className="min-h-[100dvh] w-full overflow-x-hidden bg-[#050505] px-4 py-6 text-white sm:px-6 sm:py-10">
      <div className="mx-auto flex min-h-[calc(100dvh-3rem)] w-full max-w-3xl flex-col justify-center">
        <div className="text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl border border-yellow-500/20 bg-yellow-500/[0.07] text-xl font-bold tracking-tight text-yellow-400 shadow-[0_0_45px_rgba(234,179,8,0.08)]">
            GS
          </div>

          <div className="mt-5 flex items-center justify-center gap-2">
            <Sparkles
              size={14}
              className="text-yellow-400"
            />

            <span className="text-[10px] font-semibold uppercase tracking-[0.25em] text-yellow-500/60">
              GEO-SHUA
            </span>
          </div>

          <h1 className="mt-3 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            Your workspace
          </h1>

          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-white/30">
            Choose where you want to go.
          </p>
        </div>

        <div className="mt-8 grid gap-3 sm:grid-cols-2">
          <LauncherCard
            title="Dashboard"
            description="SACCO overview and live activity"
            icon={
              <LayoutDashboard
                size={20}
                strokeWidth={1.8}
              />
            }
            onClick={onDashboard}
          />

          <LauncherCard
            title="Members"
            description="Manage GEO-SHUA membership"
            icon={
              <Users
                size={20}
                strokeWidth={1.8}
              />
            }
            onClick={() =>
              open("/dashboard/members")
            }
          />

          <LauncherCard
            title="Savings"
            description="View savings and ledger records"
            icon={
              <Wallet
                size={20}
                strokeWidth={1.8}
              />
            }
            onClick={() =>
              open("/dashboard/savings")
            }
          />

          <LauncherCard
            title="Loans"
            description="Manage lending and repayments"
            icon={
              <HandCoins
                size={20}
                strokeWidth={1.8}
              />
            }
            onClick={() =>
              open("/dashboard/loans")
            }
          />
        </div>

        <p className="mt-8 text-center text-[9px] text-white/15">
          GEO-SHUA SACCO Management
        </p>
      </div>
    </main>
  );
}

/* =========================================================
   LAUNCHER CARD
========================================================= */

function LauncherCard({
  title,
  description,
  icon,
  onClick,
}: {
  title: string;
  description: string;
  icon: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex min-w-0 items-center gap-4 rounded-2xl border border-white/[0.08] bg-white/[0.025] p-4 text-left transition hover:border-yellow-500/20 hover:bg-white/[0.045] active:scale-[0.99]"
    >
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/[0.04] text-white/45 transition group-hover:bg-yellow-500/10 group-hover:text-yellow-400">
        {icon}
      </div>

      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-white/75 group-hover:text-white">
          {title}
        </p>

        <p className="mt-1 text-[10px] text-white/25">
          {description}
        </p>
      </div>

      <ArrowRight
        size={16}
        className="shrink-0 text-white/15 transition group-hover:translate-x-0.5 group-hover:text-yellow-400"
      />
    </button>
  );
}

/* =========================================================
   DASHBOARD PAGE
========================================================= */

export default function DashboardPage() {
  const [mounted, setMounted] =
    useState(false);

  const [securityChecked, setSecurityChecked] =
    useState(false);

  const [pinConfigured, setPinConfigured] =
    useState(false);

  const [identityVerified, setIdentityVerified] =
    useState(false);

  const [showDashboard, setShowDashboard] =
    useState(false);

  const [stats, setStats] =
    useState<DashboardStats>(
      DEFAULT_STATS,
    );

  const [activities, setActivities] =
    useState<DashboardActivity[]>([]);

  const [loading, setLoading] =
    useState(true);

  const [refreshing, setRefreshing] =
    useState(false);

  /* =======================================================
     SECURITY STATUS
  ======================================================= */

  const checkSecurityStatus =
    useCallback(async () => {
      try {
        const response =
          await fetch(
            "/api/auth/security/status",
            {
              method: "GET",
              credentials: "same-origin",
              cache: "no-store",
              headers: {
                Accept:
                  "application/json",
              },
            },
          );

        if (
          response.status === 401
        ) {
          setPinConfigured(false);
          setIdentityVerified(false);
          setShowDashboard(false);

          return;
        }

        const json =
          (await response.json()) as SecurityStatusResponse;

        if (
          json.authenticated ===
          false
        ) {
          setPinConfigured(false);
          setIdentityVerified(false);
          setShowDashboard(false);

          return;
        }

        const configured =
          json.configured === true;

        const verified =
          json.verified === true;

        setPinConfigured(
          configured,
        );

        setIdentityVerified(
          verified,
        );

        if (verified) {
          setShowDashboard(true);
        } else {
          setShowDashboard(false);
        }
      } catch (error) {
        console.error(
          "Failed to check security status:",
          error,
        );

        /*
         * Fail closed.
         *
         * If the security service cannot be
         * reached, do not expose the dashboard.
         */
        setPinConfigured(false);
        setIdentityVerified(false);
        setShowDashboard(false);
      } finally {
        setSecurityChecked(true);
      }
    }, []);

  /* =======================================================
     MOUNT
  ======================================================= */

  useEffect(() => {
    setMounted(true);
  }, []);

  /* =======================================================
     SECURITY STATUS LOAD
  ======================================================= */

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
     PIN SETUP SUCCESS
  ======================================================= */

  const handlePinSetupSuccess =
    useCallback(() => {
      setPinConfigured(true);
      setIdentityVerified(false);
      setShowDashboard(false);
    }, []);

  /* =======================================================
     IDENTITY SUCCESS
  ======================================================= */

  const handleIdentitySuccess =
    useCallback(() => {
      setIdentityVerified(true);
      setShowDashboard(false);
    }, []);

  /* =======================================================
     LOAD DASHBOARD
  ======================================================= */

  const loadDashboard =
    useCallback(
      async (isRefresh = false) => {
        if (!identityVerified) {
          return;
        }

        if (!showDashboard) {
          return;
        }

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
                  method: "GET",
                  cache: "no-store",
                  credentials:
                    "same-origin",
                  headers: {
                    Accept:
                      "application/json",
                  },
                },
              ),

              fetch(
                "/api/members",
                {
                  method: "GET",
                  cache: "no-store",
                  credentials:
                    "same-origin",
                  headers: {
                    Accept:
                      "application/json",
                  },
                },
              ),

              fetch(
                "/api/loans",
                {
                  method: "GET",
                  cache: "no-store",
                  credentials:
                    "same-origin",
                  headers: {
                    Accept:
                      "application/json",
                  },
                },
              ),

              fetch(
                "/api/notifications",
                {
                  method: "GET",
                  cache: "no-store",
                  credentials:
                    "same-origin",
                  headers: {
                    Accept:
                      "application/json",
                  },
                },
              ),
            ]);

          /* =================================================
             SAVINGS
          ================================================= */

          let savings: SavingsSummary =
            {};

          if (
            savingsResponse.status ===
            "fulfilled"
          ) {
            try {
              const response =
                savingsResponse.value;

              const json =
                (await response.json()) as ApiResponse<SavingsSummary>;

              if (
                response.ok &&
                json.success !== false
              ) {
                savings =
                  json.data || {};
              }
            } catch {
              savings = {};
            }
          }

          /* =================================================
             MEMBERS
          ================================================= */

          let members: MemberRecord[] =
            [];

          if (
            membersResponse.status ===
            "fulfilled"
          ) {
            try {
              const response =
                membersResponse.value;

              const json =
                (await response.json()) as ApiResponse;

              if (
                response.ok &&
                json.success !== false
              ) {
                members =
                  extractRecords<MemberRecord>(
                    json,
                  );
              }
            } catch {
              members = [];
            }
          }

          /* =================================================
             LOANS
          ================================================= */

          let loans: LoanRecord[] =
            [];

          if (
            loansResponse.status ===
            "fulfilled"
          ) {
            try {
              const response =
                loansResponse.value;

              const json =
                (await response.json()) as ApiResponse;

              if (
                response.ok &&
                json.success !== false
              ) {
                loans =
                  extractRecords<LoanRecord>(
                    json,
                  );
              }
            } catch {
              loans = [];
            }
          }

          /* =================================================
             NOTIFICATIONS
          ================================================= */

          let notifications:
            NotificationRecord[] = [];

          if (
            notificationsResponse.status ===
            "fulfilled"
          ) {
            try {
              const response =
                notificationsResponse.value;

              const json =
                (await response.json()) as ApiResponse;

              if (
                response.ok &&
                json.success !== false
              ) {
                notifications =
                  extractRecords<NotificationRecord>(
                    json,
                  );
              }
            } catch {
              notifications = [];
            }
          }

          /* =================================================
             MEMBER STATS
          ================================================= */

          const memberCountFromSavings =
            safeNumber(
              savings.memberCount,
            );

          const totalMembers =
            members.length > 0
              ? members.length
              : memberCountFromSavings;

          const activeMembers =
            members.length > 0
              ? members.filter(
                  (member) => {
                    if (
                      member.isActive ===
                      true
                    ) {
                      return true;
                    }

                    return (
                      typeof member.status ===
                        "string" &&
                      member.status
                        .trim()
                        .toLowerCase() ===
                        "active"
                    );
                  },
                ).length
              : memberCountFromSavings;

          /* =================================================
             LOAN STATS
          ================================================= */

          const loanCount =
            loans.length;

          let outstandingLoans = 0;
          let defaulters = 0;

          for (const loan of loans) {
            const outstanding =
              safeNumber(
                loan.outstandingBalance ??
                  loan.remainingBalance ??
                  loan.balance,
              );

            outstandingLoans +=
              Math.max(
                0,
                outstanding,
              );

            const status = (
              loan.status ||
              loan.loanStatus ||
              ""
            )
              .trim()
              .toLowerCase();

            if (
              [
                "default",
                "defaulted",
                "overdue",
                "defaulter",
              ].includes(status)
            ) {
              defaulters += 1;
            }
          }

          /* =================================================
             NOTIFICATIONS
          ================================================= */

          const notificationCount =
            notifications.filter(
              (notification) => {
                if (
                  notification.read ===
                  true
                ) {
                  return false;
                }

                return (
                  notification.status
                    ?.trim()
                    .toLowerCase() !==
                  "read"
                );
              },
            ).length;

          /* =================================================
             SAVINGS VALUES
          ================================================= */

          const savingsBalance =
            safeNumber(
              savings.totalBalance,
            );

          const savingsDeposits =
            safeNumber(
              savings.totalDeposits,
            );

          const savingsWithdrawals =
            Math.abs(
              safeNumber(
                savings.totalAdjustments,
              ),
            );

          const savingsReversals =
            Math.abs(
              safeNumber(
                savings.totalReversals,
              ),
            );

          /* =================================================
             STATS
          ================================================= */

          setStats({
            members:
              totalMembers,

            activeMembers:
              activeMembers,

            savings:
              savingsBalance,

            deposits:
              savingsDeposits,

            withdrawals:
              savingsWithdrawals,

            reversals:
              savingsReversals,

            loans:
              loanCount,

            outstandingLoans:
              outstandingLoans,

            defaulters:
              defaulters,

            notifications:
              notificationCount,
          });

          /* =================================================
             RECENT ACTIVITY
          ================================================= */

          const nextActivities: Array<
            DashboardActivity & {
              sortTimestamp: number;
            }
          > = [];

          members
            .slice()
            .sort(
              (a, b) =>
                new Date(
                  getDate(b),
                ).getTime() -
                new Date(
                  getDate(a),
                ).getTime(),
            )
            .slice(0, 5)
            .forEach(
              (member, index) => {
                const name =
                  member.name ||
                  member.fullName ||
                  [
                    member.firstName,
                    member.middleName,
                    member.lastName,
                  ]
                    .filter(Boolean)
                    .join(" ") ||
                  "Member";

                const date =
                  getDate(member);

                nextActivities.push({
                  id: `member-${getId(
                    member,
                    String(index),
                  )}`,

                  title:
                    "Member activity",

                  description:
                    `${name} was recently recorded.`,

                  time:
                    formatRelativeTime(
                      date,
                    ),

                  type:
                    "member",

                  sortTimestamp:
                    new Date(
                      date,
                    ).getTime() || 0,
                });
              },
            );

          loans
            .slice()
            .sort(
              (a, b) =>
                new Date(
                  getDate(b),
                ).getTime() -
                new Date(
                  getDate(a),
                ).getTime(),
            )
            .slice(0, 5)
            .forEach(
              (loan, index) => {
                const date =
                  getDate(loan);

                nextActivities.push({
                  id: `loan-${getId(
                    loan,
                    String(index),
                  )}`,

                  title:
                    "Loan activity",

                  description:
                    loan.memberName
                      ? `${loan.memberName} has loan activity.`
                      : "A loan record was recently updated.",

                  time:
                    formatRelativeTime(
                      date,
                    ),

                  type:
                    "loan",

                  sortTimestamp:
                    new Date(
                      date,
                    ).getTime() || 0,
                });
              },
            );

          notifications
            .slice()
            .sort(
              (a, b) =>
                new Date(
                  getDate(b),
                ).getTime() -
                new Date(
                  getDate(a),
                ).getTime(),
            )
            .slice(0, 5)
            .forEach(
              (
                notification,
                index,
              ) => {
                const date =
                  getDate(
                    notification,
                  );

                nextActivities.push({
                  id: `notification-${getId(
                    notification,
                    String(index),
                  )}`,

                  title:
                    notification.title ||
                    "Notification",

                  description:
                    notification.message ||
                    notification.description ||
                    "New notification.",

                  time:
                    formatRelativeTime(
                      date,
                    ),

                  type:
                    "notification",

                  sortTimestamp:
                    new Date(
                      date,
                    ).getTime() || 0,
                });
              },
            );

          setActivities(
            nextActivities
              .sort(
                (a, b) =>
                  b.sortTimestamp -
                  a.sortTimestamp,
              )
              .slice(0, 12)
              .map(
                ({
                  sortTimestamp:
                    _sortTimestamp,
                  ...activity
                }) => activity,
              ),
          );
        } catch (error) {
          console.error(
            "Failed to load dashboard:",
            error,
          );
        } finally {
          setLoading(false);
          setRefreshing(false);
        }
      },
      [
        identityVerified,
        showDashboard,
      ],
    );

  /* =======================================================
     DASHBOARD LOAD
  ======================================================= */

  useEffect(() => {
    if (
      !mounted ||
      !securityChecked ||
      !identityVerified ||
      !showDashboard
    ) {
      return;
    }

    void loadDashboard();
  }, [
    mounted,
    securityChecked,
    identityVerified,
    showDashboard,
    loadDashboard,
  ]);

  /* =======================================================
     REFRESH
  ======================================================= */

  const handleRefresh =
    useCallback(() => {
      if (
        loading === true ||
        refreshing === true
      ) {
        return;
      }

      void loadDashboard(true);
    }, [
      loadDashboard,
      loading,
      refreshing,
    ]);

  /* =======================================================
     HYDRATION / SECURITY LOADING
  ======================================================= */

  if (
    mounted === false ||
    securityChecked === false
  ) {
    return <SecurityLoading />;
  }

  /* =======================================================
     PIN SETUP
  ======================================================= */

  if (
    pinConfigured === false
  ) {
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

  if (
    identityVerified === false
  ) {
    return (
      <IdentityScreen
        onSuccess={
          handleIdentitySuccess
        }
      />
    );
  }

  /* =======================================================
     LAUNCHER
  ======================================================= */

  if (
    showDashboard === false
  ) {
    return (
      <GeoShuaLauncher
        onDashboard={() =>
          setShowDashboard(true)
        }
      />
    );
  }

  /* =======================================================
     MAIN DASHBOARD
  ======================================================= */

  return (
    <main className="min-h-[100dvh] w-full max-w-full overflow-x-clip bg-[#050505] text-white">
      <TopBar />

      <div className="w-full pt-16">
        <div className="mx-auto w-full max-w-[1800px] px-4 py-5 sm:px-6 sm:py-8 lg:px-8 lg:py-10 xl:px-10 2xl:px-12">
          {/* =================================================
              MOBILE DASHBOARD
          ================================================= */}

          <div className="lg:hidden">
            {loading === true ? (
              <MobileDashboardLoading />
            ) : (
              <MobileDashboard
                stats={stats}
                activities={
                  activities
                }
                onRefresh={
                  handleRefresh
                }
                refreshing={
                  refreshing === true
                }
              />
            )}
          </div>

          {/* =================================================
              DESKTOP DASHBOARD
          ================================================= */}

          <div className="hidden lg:block">
            <section className="mb-6">
              <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-yellow-500/10 text-yellow-400">
                      <FileText
                        size={17}
                        strokeWidth={1.8}
                      />
                    </div>

                    <span className="text-xs font-medium uppercase tracking-[0.22em] text-yellow-500/60">
                      Overview
                    </span>
                  </div>

                  <h1 className="mt-3 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
                    Dashboard
                  </h1>

                  <p className="mt-2 max-w-2xl text-sm leading-6 text-white/35">
                    A clean view of
                    GEO-SHUA members,
                    savings, loans and
                    account activity.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={
                    handleRefresh
                  }
                  disabled={
                    loading === true ||
                    refreshing === true
                  }
                  className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.025] px-4 text-sm font-medium text-white/55 transition hover:border-white/[0.14] hover:bg-white/[0.05] hover:text-white disabled:cursor-not-allowed disabled:opacity-40 lg:w-auto"
                >
                  <RefreshCw
                    size={16}
                    strokeWidth={1.8}
                    className={
                      refreshing
                        ? "animate-spin"
                        : ""
                    }
                  />

                  Refresh
                </button>
              </div>
            </section>

            {loading === true ? (
              <DashboardLoading />
            ) : (
              <>
                {/* STATS */}

                <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
                  <StatCard
                    title="Members"
                    value={
                      stats.members
                    }
                    subtitle={`${stats.activeMembers.toLocaleString()} active`}
                    icon={
                      <Users
                        size={19}
                        strokeWidth={1.8}
                      />
                    }
                    href="/dashboard/members"
                  />

                  <StatCard
                    title="Savings"
                    value={formatCurrency(
                      stats.savings,
                    )}
                    subtitle="Current ledger balance"
                    icon={
                      <Wallet
                        size={19}
                        strokeWidth={1.8}
                      />
                    }
                    href="/dashboard/savings"
                  />

                  <StatCard
                    title="Loans"
                    value={
                      stats.loans
                    }
                    subtitle={formatCurrency(
                      stats.outstandingLoans,
                    )}
                    icon={
                      <HandCoins
                        size={19}
                        strokeWidth={1.8}
                      />
                    }
                    href="/dashboard/loans"
                  />

                  <StatCard
                    title="Defaulters"
                    value={
                      stats.defaulters
                    }
                    subtitle="Members requiring attention"
                    icon={
                      <Bell
                        size={19}
                        strokeWidth={1.8}
                      />
                    }
                    href="/dashboard/loans"
                  />
                </section>

                {/* FINANCIAL BREAKDOWN */}

                <section className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <MetricCard
                    label="Deposits"
                    value={formatCurrency(
                      stats.deposits,
                    )}
                  />

                  <MetricCard
                    label="Withdrawals"
                    value={formatCurrency(
                      stats.withdrawals,
                    )}
                  />

                  <MetricCard
                    label="Reversals"
                    value={formatCurrency(
                      stats.reversals,
                    )}
                  />

                  <MetricCard
                    label="Net Savings"
                    value={formatCurrency(
                      stats.savings,
                    )}
                  />
                </section>

                {/* MAIN GRID */}

                <section className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1.45fr)_minmax(280px,0.75fr)]">
                  {/* RECENT ACTIVITY */}

                  <div className="min-w-0 overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.025]">
                    <div className="flex items-center justify-between border-b border-white/[0.07] px-4 py-4 sm:px-5">
                      <div>
                        <h2 className="text-sm font-semibold text-white">
                          Recent Activity
                        </h2>

                        <p className="mt-1 text-xs text-white/30">
                          Latest recorded
                          activity
                        </p>
                      </div>

                      <span className="rounded-lg bg-white/[0.04] px-2.5 py-1 text-[10px] text-white/25">
                        Live data
                      </span>
                    </div>

                    {activities.length ===
                    0 ? (
                      <div className="flex min-h-[180px] items-center justify-center p-6">
                        <div className="text-center">
                          <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.03] text-white/25">
                            <Bell
                              size={19}
                              strokeWidth={1.5}
                            />
                          </div>

                          <p className="mt-4 text-sm font-medium text-white/45">
                            No recent
                            activity
                          </p>

                          <p className="mt-2 text-xs text-white/25">
                            New records
                            will appear
                            here
                            automatically.
                          </p>
                        </div>
                      </div>
                    ) : (
                      <div className="max-h-[300px] overflow-y-auto overscroll-contain scrollbar-thin scrollbar-track-transparent scrollbar-thumb-white/10 hover:scrollbar-thumb-white/20">
                        <div className="divide-y divide-white/[0.05]">
                          {activities.map(
                            (
                              activity,
                            ) => (
                              <ActivityRow
                                key={
                                  activity.id
                                }
                                activity={
                                  activity
                                }
                              />
                            ),
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* QUICK ACCESS */}

                  <div className="min-w-0 overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.025]">
                    <div className="border-b border-white/[0.07] px-4 py-4 sm:px-5">
                      <h2 className="text-sm font-semibold text-white">
                        Quick Access
                      </h2>

                      <p className="mt-1 text-xs text-white/30">
                        Core GEO-SHUA
                        modules
                      </p>
                    </div>

                    <div className="grid gap-1 p-3 sm:p-4">
                      <QuickAccess
                        label="Members"
                        description="Manage member records"
                        icon={
                          <Users
                            size={18}
                            strokeWidth={1.8}
                          />
                        }
                        href="/dashboard/members"
                      />

                      <QuickAccess
                        label="Savings"
                        description="View savings records"
                        icon={
                          <Wallet
                            size={18}
                            strokeWidth={1.8}
                          />
                        }
                        href="/dashboard/savings"
                      />

                      <QuickAccess
                        label="Loans"
                        description="Manage loans and repayments"
                        icon={
                          <HandCoins
                            size={18}
                            strokeWidth={1.8}
                          />
                        }
                        href="/dashboard/loans"
                      />

                      <QuickAccess
                        label="Notifications"
                        description={`${stats.notifications.toLocaleString()} unread notifications`}
                        icon={
                          <Bell
                            size={18}
                            strokeWidth={1.8}
                          />
                        }
                        href="/dashboard/notifications"
                      />
                    </div>
                  </div>
                </section>

                {/* MEMBER + SAVINGS */}

                <section className="mt-5 grid gap-5 md:grid-cols-2">
                  <OverviewCard
                    eyebrow="Member Overview"
                    value={stats.members.toLocaleString()}
                    description="Registered members"
                    icon={
                      <Users
                        size={19}
                        strokeWidth={1.8}
                      />
                    }
                    footerLabel="Manage members"
                    footerHref="/dashboard/members"
                    progress={
                      stats.members > 0
                        ? Math.min(
                            100,
                            (stats.activeMembers /
                              stats.members) *
                              100,
                          )
                        : 0
                    }
                    progressLabel="Active members"
                    progressValue={
                      stats.members > 0
                        ? `${Math.round(
                            (stats.activeMembers /
                              stats.members) *
                              100,
                          )}%`
                        : "0%"
                    }
                  />

                  <OverviewCard
                    eyebrow="Savings Overview"
                    value={formatCurrency(
                      stats.savings,
                    )}
                    description="Authoritative ledger balance"
                    icon={
                      <Wallet
                        size={19}
                        strokeWidth={1.8}
                      />
                    }
                    footerLabel="Open savings"
                    footerHref="/dashboard/savings"
                    metrics={[
                      {
                        label:
                          "Deposits",
                        value:
                          formatCurrency(
                            stats.deposits,
                          ),
                      },
                      {
                        label:
                          "Withdrawals",
                        value:
                          formatCurrency(
                            stats.withdrawals,
                          ),
                      },
                      {
                        label:
                          "Reversals",
                        value:
                          formatCurrency(
                            stats.reversals,
                          ),
                      },
                    ]}
                  />
                </section>

                {/* LOANS */}

                <section className="mt-5">
                  <LoanOverviewCard
                    loans={
                      stats.loans
                    }
                    outstanding={
                      stats.outstandingLoans
                    }
                    defaulters={
                      stats.defaulters
                    }
                  />
                </section>

                {/* FOOTER */}

                <div className="mt-5 flex flex-col gap-1 px-1 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-[10px] text-white/20">
                    GEO-SHUA SACCO
                    Management
                  </p>

                  <p className="text-[10px] text-white/20">
                    Financial data
                    sourced from
                    domain APIs
                  </p>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

/* =========================================================
   MOBILE DASHBOARD
========================================================= */

function MobileDashboard({
  stats,
  activities,
  onRefresh,
  refreshing,
}: {
  stats: DashboardStats;
  activities: DashboardActivity[];
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const [amountsHidden, setAmountsHidden] =
    useState(false);

  /*
   * This is a client-side reconciliation
   * indicator only.
   *
   * stats.savings remains the authoritative
   * backend balance.
   */
  const calculatedSavings =
    stats.deposits -
    stats.withdrawals -
    stats.reversals;

  const displayAmount = (
    value: number,
  ): string => {
    if (amountsHidden) {
      return "KES ••••••";
    }

    return formatCurrency(value);
  };

  return (
    <div className="space-y-3">
      {/* HEADER */}

      <section className="flex items-center justify-between px-1 pb-1">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-[#1683ff] shadow-[0_0_10px_rgba(22,131,255,0.8)]" />

            <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#1683ff]">
              GEO-SHUA
            </span>
          </div>

          <h1 className="mt-1 text-lg font-semibold tracking-tight text-white">
            Dashboard
          </h1>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() =>
              setAmountsHidden(
                (current) =>
                  !current,
              )
            }
            aria-label={
              amountsHidden
                ? "Show amounts"
                : "Hide amounts"
            }
            aria-pressed={amountsHidden}
            title={
              amountsHidden
                ? "Show amounts"
                : "Hide amounts"
            }
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.035] text-white/55 transition active:scale-95 hover:bg-white/[0.055] hover:text-white/75"
          >
            {amountsHidden ? (
              <Eye
                size={16}
                strokeWidth={1.8}
              />
            ) : (
              <EyeOff
                size={16}
                strokeWidth={1.8}
              />
            )}
          </button>

          <button
            type="button"
            onClick={onRefresh}
            disabled={
              refreshing === true
            }
            aria-label="Refresh dashboard"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.035] text-white/55 transition active:scale-95 disabled:opacity-40"
          >
            <RefreshCw
              size={16}
              strokeWidth={1.8}
              className={
                refreshing
                  ? "animate-spin"
                  : ""
              }
            />
          </button>
        </div>
      </section>

      {/* MEMBERS */}

      <button
        type="button"
        onClick={() =>
          window.location.assign(
            "/dashboard/members",
          )
        }
        className="group relative w-full overflow-hidden rounded-[22px] border border-[#1683ff]/15 bg-gradient-to-br from-[#0b1c30] via-[#081521] to-[#060b11] p-4 text-left shadow-[0_12px_35px_rgba(0,0,0,0.25)] transition active:scale-[0.99]"
      >
        <div className="absolute -right-10 -top-10 h-28 w-28 rounded-full bg-[#1683ff]/10 blur-2xl" />

        <div className="relative">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#1683ff]/10 text-[#4da3ff]">
                <Users
                  size={17}
                  strokeWidth={1.8}
                />
              </div>

              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/35">
                  Members
                </p>

                <p className="text-[9px] text-white/20">
                  Membership base
                </p>
              </div>
            </div>

            <ArrowRight
              size={15}
              className="text-white/20"
            />
          </div>

          <div className="mt-3 flex items-end justify-between">
            <div>
              <p className="text-[28px] font-semibold leading-none tracking-tight text-white">
                {stats.members.toLocaleString()}
              </p>

              <p className="mt-1 text-[10px] text-white/30">
                registered members
              </p>
            </div>

            <div className="text-right">
              <p className="text-sm font-semibold text-[#4da3ff]">
                {stats.activeMembers.toLocaleString()}
              </p>

              <p className="text-[9px] uppercase tracking-[0.12em] text-white/25">
                active
              </p>
            </div>
          </div>

          <div className="mt-3 h-1 overflow-hidden rounded-full bg-white/[0.06]">
            <div
              className="h-full rounded-full bg-[#1683ff] transition-all"
              style={{
                width: `${
                  stats.members > 0
                    ? Math.min(
                        100,
                        (stats.activeMembers /
                          stats.members) *
                          100,
                      )
                    : 0
                }%`,
              }}
            />
          </div>

          <div className="mt-2 flex items-center justify-between">
            <span className="text-[9px] text-white/25">
              Active membership
            </span>

            <span className="text-[9px] font-medium text-white/40">
              {stats.members > 0
                ? `${Math.round(
                    (stats.activeMembers /
                      stats.members) *
                      100,
                  )}%`
                : "0%"}
            </span>
          </div>
        </div>
      </button>

      {/* SAVINGS */}

      <button
        type="button"
        onClick={() =>
          window.location.assign(
            "/dashboard/savings",
          )
        }
        className="group relative w-full overflow-hidden rounded-[22px] border border-[#1683ff]/15 bg-gradient-to-br from-[#0a1928] via-[#07131e] to-[#060b11] p-4 text-left shadow-[0_12px_35px_rgba(0,0,0,0.25)] transition active:scale-[0.99]"
      >
        <div className="absolute -right-12 -top-12 h-32 w-32 rounded-full bg-[#1683ff]/10 blur-3xl" />

        <div className="relative">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#1683ff]/10 text-[#4da3ff]">
                <Wallet
                  size={17}
                  strokeWidth={1.8}
                />
              </div>

              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/35">
                  Savings
                </p>

                <p className="text-[9px] text-white/20">
                  Authoritative ledger
                </p>
              </div>
            </div>

            <ArrowRight
              size={15}
              className="text-white/20"
            />
          </div>

          <div className="mt-3">
            <p className="truncate text-[25px] font-semibold leading-none tracking-tight text-white">
              {displayAmount(
                stats.savings,
              )}
            </p>

            <p className="mt-1 text-[10px] text-white/30">
              current savings
              balance
            </p>
          </div>

          <div className="mt-4 border-t border-white/[0.06] pt-3">
            <div className="flex items-center justify-between">
              <p className="text-[8px] font-semibold uppercase tracking-[0.12em] text-white/20">
                Balance calculation
              </p>

              <span
                className={
                  Math.abs(
                    calculatedSavings -
                      stats.savings,
                  ) < 0.01
                    ? "text-[8px] font-medium text-[#4da3ff]/70"
                    : "text-[8px] font-medium text-red-400"
                }
              >
                {Math.abs(
                  calculatedSavings -
                    stats.savings,
                ) < 0.01
                  ? "Balanced"
                  : "Check ledger"}
              </span>
            </div>

            <div className="mt-2 space-y-1.5">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[9px] text-white/30">
                  Deposits
                </span>

                <span className="text-[10px] font-medium text-white/55">
                  {displayAmount(
                    stats.deposits,
                  )}
                </span>
              </div>

              <div className="flex items-center justify-between gap-3">
                <span className="text-[9px] text-white/30">
                  − Withdrawals
                </span>

                <span className="text-[10px] font-medium text-white/50">
                  {displayAmount(
                    stats.withdrawals,
                  )}
                </span>
              </div>

              <div className="flex items-center justify-between gap-3">
                <span className="text-[9px] text-white/30">
                  − Reversals
                </span>

                <span className="text-[10px] font-medium text-white/50">
                  {displayAmount(
                    stats.reversals,
                  )}
                </span>
              </div>

              <div className="mt-2 flex items-center justify-between gap-3 border-t border-white/[0.06] pt-2">
                <span className="text-[9px] font-medium text-white/40">
                  Current balance
                </span>

                <span className="text-[10px] font-semibold text-[#4da3ff]">
                  {displayAmount(
                    calculatedSavings,
                  )}
                </span>
              </div>
            </div>
          </div>
        </div>
      </button>

      {/* LOANS */}

      <button
        type="button"
        onClick={() =>
          window.location.assign(
            "/dashboard/loans",
          )
        }
        className="group relative w-full overflow-hidden rounded-[22px] border border-[#1683ff]/15 bg-gradient-to-br from-[#0a1826] via-[#07131e] to-[#060b11] p-4 text-left shadow-[0_12px_35px_rgba(0,0,0,0.25)] transition active:scale-[0.99]"
      >
        <div className="absolute -bottom-12 -right-10 h-32 w-32 rounded-full bg-[#1683ff]/10 blur-3xl" />

        <div className="relative">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#1683ff]/10 text-[#4da3ff]">
                <HandCoins
                  size={17}
                  strokeWidth={1.8}
                />
              </div>

              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/35">
                  Loans
                </p>

                <p className="text-[9px] text-white/20">
                  Lending portfolio
                </p>
              </div>
            </div>

            <ArrowRight
              size={15}
              className="text-white/20"
            />
          </div>

          <div className="mt-3">
            <p className="truncate text-[25px] font-semibold leading-none tracking-tight text-white">
              {displayAmount(
                stats.outstandingLoans,
              )}
            </p>

            <p className="mt-1 text-[10px] text-white/30">
              outstanding
              balance
            </p>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2 border-t border-white/[0.06] pt-3">
            <div>
              <p className="text-sm font-semibold text-white/80">
                {stats.loans.toLocaleString()}
              </p>

              <p className="mt-0.5 text-[9px] uppercase tracking-[0.12em] text-white/25">
                Active loans
              </p>
            </div>

            <div className="text-right">
              <p
                className={`text-sm font-semibold ${
                  stats.defaulters > 0
                    ? "text-red-400"
                    : "text-[#4da3ff]"
                }`}
              >
                {stats.defaulters.toLocaleString()}
              </p>

              <p className="mt-0.5 text-[9px] uppercase tracking-[0.12em] text-white/25">
                Defaulters
              </p>
            </div>
          </div>
        </div>
      </button>

      {/* SMS INGESTION MONITOR */}

      <SmsInboxMonitor />

      {/* RECENT ACTIVITY */}

      <section className="overflow-hidden rounded-[22px] border border-white/[0.07] bg-white/[0.025]">
        <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3.5">
          <div>
            <p className="text-xs font-semibold text-white/75">
              Recent activity
            </p>

            <p className="mt-0.5 text-[9px] text-white/25">
              Latest system
              records
            </p>
          </div>

          <span className="flex items-center gap-1.5 text-[9px] text-[#4da3ff]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#1683ff]" />
            Live
          </span>
        </div>

        {activities.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <Bell
              size={18}
              className="mx-auto text-white/20"
            />

            <p className="mt-2 text-xs text-white/35">
              No recent activity
            </p>
          </div>
        ) : (
          <div className="max-h-[260px] overflow-y-auto overscroll-contain scrollbar-thin scrollbar-track-transparent scrollbar-thumb-white/10">
            {activities
              .slice(0, 6)
              .map(
                (activity) => (
                  <MobileActivityRow
                    key={
                      activity.id
                    }
                    activity={
                      activity
                    }
                  />
                ),
              )}
          </div>
        )}
      </section>

      {/* FOOTER */}

      <div className="px-1 pb-3 pt-1 text-center">
        <p className="text-[9px] text-white/15">
          GEO-SHUA SACCO
          Management
        </p>
      </div>
    </div>
  );
}

/* =========================================================
   MOBILE ACTIVITY
========================================================= */

function MobileActivityRow({
  activity,
}: {
  activity: DashboardActivity;
}) {
  const icons: Record<
    DashboardActivity["type"],
    ReactNode
  > = {
    member: (
      <Users
        size={14}
        strokeWidth={1.8}
      />
    ),

    saving: (
      <Wallet
        size={14}
        strokeWidth={1.8}
      />
    ),

    loan: (
      <HandCoins
        size={14}
        strokeWidth={1.8}
      />
    ),

    notification: (
      <Bell
        size={14}
        strokeWidth={1.8}
      />
    ),
  };

  return (
    <div className="flex min-w-0 items-center gap-3 border-b border-white/[0.045] px-4 py-3 last:border-b-0">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#1683ff]/[0.07] text-[#4da3ff]/70">
        {icons[activity.type]}
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate text-[10px] font-medium text-white/60">
          {activity.title}
        </p>

        <p className="mt-0.5 truncate text-[9px] text-white/20">
          {activity.description}
        </p>
      </div>

      <span className="shrink-0 text-[8px] text-white/20">
        {activity.time}
      </span>
    </div>
  );
}

/* =========================================================
   OVERVIEW CARD
========================================================= */

function OverviewCard({
  eyebrow,
  value,
  description,
  icon,
  footerLabel,
  footerHref,
  progress,
  progressLabel,
  progressValue,
  metrics,
}: {
  eyebrow: string;
  value: string;
  description: string;
  icon: ReactNode;
  footerLabel: string;
  footerHref: string;
  progress?: number;
  progressLabel?: string;
  progressValue?: string;
  metrics?: {
    label: string;
    value: string;
  }[];
}) {
  return (
    <div className="min-w-0 overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.025] p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-[0.18em] text-white/25">
            {eyebrow}
          </p>

          <p className="mt-3 text-3xl font-semibold text-white">
            {value}
          </p>

          <p className="mt-1 text-xs text-white/30">
            {description}
          </p>
        </div>

        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-yellow-500/10 text-yellow-400">
          {icon}
        </div>
      </div>

      {progress !==
        undefined && (
        <div className="mt-5">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[10px] text-white/25">
              {progressLabel}
            </span>

            <span className="text-[10px] text-white/40">
              {progressValue}
            </span>
          </div>

          <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
            <div
              className="h-full rounded-full bg-yellow-500 transition-all"
              style={{
                width: `${Math.max(
                  0,
                  Math.min(
                    100,
                    progress,
                  ),
                )}%`,
              }}
            />
          </div>
        </div>
      )}

      {metrics &&
        metrics.length > 0 && (
          <div className="mt-5 grid grid-cols-3 gap-3">
            {metrics.map(
              (metric) => (
                <MiniMetric
                  key={
                    metric.label
                  }
                  label={
                    metric.label
                  }
                  value={
                    metric.value
                  }
                />
              ),
            )}
          </div>
        )}

      <button
        type="button"
        onClick={() =>
          window.location.assign(
            footerHref,
          )
        }
        className="mt-5 flex items-center gap-2 text-xs font-medium text-yellow-400 transition hover:text-yellow-300"
      >
        <span>
          {footerLabel}
        </span>

        <ArrowRight
          size={14}
          strokeWidth={1.8}
        />
      </button>
    </div>
  );
}

/* =========================================================
   LOAN OVERVIEW
========================================================= */

function LoanOverviewCard({
  loans,
  outstanding,
  defaulters,
}: {
  loans: number;
  outstanding: number;
  defaulters: number;
}) {
  return (
    <div className="min-w-0 overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.025] p-5">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-start gap-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-yellow-500/10 text-yellow-400">
            <HandCoins
              size={20}
              strokeWidth={1.8}
            />
          </div>

          <div className="min-w-0">
            <p className="text-xs uppercase tracking-[0.18em] text-white/25">
              Loan Overview
            </p>

            <p className="mt-2 text-2xl font-semibold text-white">
              {formatCurrency(
                outstanding,
              )}
            </p>

            <p className="mt-1 text-xs text-white/30">
              Outstanding loan
              balance
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <MiniMetric
            label="Loans"
            value={loans.toLocaleString()}
          />

          <MiniMetric
            label="Outstanding"
            value={formatCurrency(
              outstanding,
            )}
          />

          <MiniMetric
            label="Defaulters"
            value={defaulters.toLocaleString()}
          />
        </div>

        <button
          type="button"
          onClick={() =>
            window.location.assign(
              "/dashboard/loans",
            )
          }
          className="flex shrink-0 items-center gap-2 text-xs font-medium text-yellow-400 transition hover:text-yellow-300"
        >
          <span>
            Open loans
          </span>

          <ArrowRight
            size={14}
            strokeWidth={1.8}
          />
        </button>
      </div>
    </div>
  );
}

/* =========================================================
   METRIC CARD
========================================================= */

function MetricCard({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="min-w-0 overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.025] p-4">
      <p className="truncate text-[10px] uppercase tracking-[0.14em] text-white/25">
        {label}
      </p>

      <p className="mt-2 truncate text-sm font-semibold text-white/75">
        {value}
      </p>
    </div>
  );
}

/* =========================================================
   MINI METRIC
========================================================= */

function MiniMetric({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="min-w-0">
      <p className="truncate text-[9px] uppercase tracking-[0.12em] text-white/20">
        {label}
      </p>

      <p className="mt-1 truncate text-xs font-medium text-white/55">
        {value}
      </p>
    </div>
  );
}

/* =========================================================
   QUICK ACCESS
========================================================= */

function QuickAccess({
  label,
  description,
  icon,
  href,
}: {
  label: string;
  description: string;
  icon: ReactNode;
  href: string;
}) {
  return (
    <button
      type="button"
      onClick={() =>
        window.location.assign(
          href,
        )
      }
      className="group flex min-w-0 items-center gap-3 rounded-xl border border-transparent px-3 py-3 text-left transition hover:border-white/[0.06] hover:bg-white/[0.04]"
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/[0.04] text-white/40 transition group-hover:bg-yellow-500/10 group-hover:text-yellow-400">
        {icon}
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-white/65 group-hover:text-white">
          {label}
        </p>

        <p className="mt-0.5 truncate text-[10px] text-white/25">
          {description}
        </p>
      </div>

      <ArrowRight
        size={14}
        strokeWidth={1.8}
        className="shrink-0 text-white/15 transition group-hover:translate-x-0.5 group-hover:text-white/40"
      />
    </button>
  );
}

/* =========================================================
   STAT CARD
========================================================= */

function StatCard({
  title,
  value,
  subtitle,
  icon,
  href,
}: {
  title: string;
  value: string | number;
  subtitle: string;
  icon: ReactNode;
  href: string;
}) {
  return (
    <button
      type="button"
      onClick={() =>
        window.location.assign(
          href,
        )
      }
      className="group min-w-0 overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.025] p-4 text-left transition hover:border-white/[0.12] hover:bg-white/[0.04] sm:p-5"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium text-white/35">
            {title}
          </p>

          <p className="mt-3 truncate text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            {value}
          </p>

          <p className="mt-2 truncate text-[10px] text-white/25">
            {subtitle}
          </p>
        </div>

        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-yellow-500/10 text-yellow-400 transition group-hover:bg-yellow-500/15 sm:h-10 sm:w-10">
          {icon}
        </div>
      </div>
    </button>
  );
}

/* =========================================================
   ACTIVITY ROW
========================================================= */

function ActivityRow({
  activity,
}: {
  activity: DashboardActivity;
}) {
  const icons: Record<
    DashboardActivity["type"],
    ReactNode
  > = {
    member: (
      <Users
        size={15}
        strokeWidth={1.8}
      />
    ),

    saving: (
      <Wallet
        size={15}
        strokeWidth={1.8}
      />
    ),

    loan: (
      <HandCoins
        size={15}
        strokeWidth={1.8}
      />
    ),

    notification: (
      <Bell
        size={15}
        strokeWidth={1.8}
      />
    ),
  };

  return (
    <div className="flex min-w-0 items-center gap-3 px-4 py-3.5 sm:px-5">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/[0.04] text-white/35">
        {icons[activity.type]}
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-white/65">
          {activity.title}
        </p>

        <p className="mt-0.5 truncate text-[10px] text-white/25">
          {activity.description}
        </p>
      </div>

      <span className="shrink-0 text-[10px] text-white/20">
        {activity.time}
      </span>
    </div>
  );
}

/* =========================================================
   DESKTOP LOADING
========================================================= */

function DashboardLoading() {
  return (
    <div className="w-full animate-pulse space-y-5">
      <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {Array.from({
          length: 4,
        }).map(
          (_, index) => (
            <div
              key={index}
              className="h-[125px] rounded-2xl border border-white/[0.06] bg-white/[0.025]"
            />
          ),
        )}
      </section>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({
          length: 4,
        }).map(
          (_, index) => (
            <div
              key={index}
              className="h-[85px] rounded-2xl border border-white/[0.06] bg-white/[0.025]"
            />
          ),
        )}
      </section>

      <section className="grid gap-5 lg:grid-cols-[minmax(0,1.45fr)_minmax(280px,0.75fr)]">
        <div className="min-h-[330px] rounded-2xl border border-white/[0.06] bg-white/[0.025]" />

        <div className="min-h-[330px] rounded-2xl border border-white/[0.06] bg-white/[0.025]" />
      </section>

      <section className="grid gap-5 md:grid-cols-2">
        <div className="h-[220px] rounded-2xl border border-white/[0.06] bg-white/[0.025]" />

        <div className="h-[220px] rounded-2xl border border-white/[0.06] bg-white/[0.025]" />
      </section>

      <section>
        <div className="h-[125px] rounded-2xl border border-white/[0.06] bg-white/[0.025]" />
      </section>
    </div>
  );
}

/* =========================================================
   MOBILE LOADING
========================================================= */

function MobileDashboardLoading() {
  return (
    <div className="animate-pulse space-y-3">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <div className="h-2.5 w-20 rounded bg-white/[0.06]" />

          <div className="mt-2 h-5 w-28 rounded bg-white/[0.06]" />

          <div className="mt-2 h-2.5 w-36 rounded bg-white/[0.04]" />
        </div>

        <div className="h-10 w-10 rounded-xl bg-white/[0.05]" />
      </div>

      {Array.from({
        length: 3,
      }).map(
        (_, index) => (
          <div
            key={index}
            className="h-[137px] rounded-[22px] border border-white/[0.06] bg-white/[0.025]"
          />
        ),
      )}

      <div className="h-[170px] rounded-[22px] border border-white/[0.06] bg-white/[0.025]" />

      <div className="h-[220px] rounded-[22px] border border-white/[0.06] bg-white/[0.025]" />
    </div>
  );
}