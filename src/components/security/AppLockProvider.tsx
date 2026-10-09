"use client";

import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { App } from "@capacitor/app";
import { Preferences } from "@capacitor/preferences";
import { registerPlugin } from "@capacitor/core";

/* ============================================================
   NATIVE DEVICE SECURITY
============================================================ */

type DeviceSecurityResult = {
  success: boolean;
  code?: string;
  message?: string;
};

interface DeviceSecurityPlugin {
  authenticate(): Promise<DeviceSecurityResult>;
  isAvailable?(): Promise<{
    available: boolean;
    code?: string;
    message?: string;
  }>;
}

const DeviceSecurity =
  registerPlugin<DeviceSecurityPlugin>("DeviceSecurity");

/* ============================================================
   APP LOCK CONFIGURATION
============================================================ */

/*
 * Foreground:
 * Lock after 2 minutes of inactivity by default.
 *
 * This remains configurable through Settings.
 */
const DEFAULT_FOREGROUND_TIMEOUT_MINUTES = 2;

const MIN_FOREGROUND_TIMEOUT_MINUTES = 1;
const MAX_FOREGROUND_TIMEOUT_MINUTES = 60;

/*
 * Background:
 *
 * Hard limit of 1 minute.
 *
 * This is intentionally NOT configurable because the requirement
 * is that once the app goes into the background it should lock
 * within 1 minute at most.
 */
const BACKGROUND_TIMEOUT_MS = 60 * 1000;

const DEFAULT_FOREGROUND_TIMEOUT_MS =
  DEFAULT_FOREGROUND_TIMEOUT_MINUTES * 60 * 1000;

/* ============================================================
   STORAGE KEYS
============================================================ */

const PREF_KEYS = {
  foregroundTimeoutMs: "danijace.app_lock_timeout_ms",
  lastActivity: "danijace.app_lock_last_activity",
  backgroundedAt: "danijace.app_lock_backgrounded_at",
};

/* ============================================================
   CONTEXT
============================================================ */

interface AppLockContextValue {
  locked: boolean;
  ready: boolean;

  timeoutMs: number;
  timeoutMinutes: number;

  lock: () => void;
  setTimeoutMinutes: (minutes: number) => Promise<void>;
  recordActivity: () => void;
}

const AppLockContext =
  createContext<AppLockContextValue | null>(null);

/* ============================================================
   HELPERS
============================================================ */

function clampTimeoutMinutes(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_FOREGROUND_TIMEOUT_MINUTES;
  }

  return Math.min(
    MAX_FOREGROUND_TIMEOUT_MINUTES,
    Math.max(MIN_FOREGROUND_TIMEOUT_MINUTES, value),
  );
}

function isNativeDeviceSecurityUnavailable(
  result: DeviceSecurityResult,
): boolean {
  const code = String(result.code ?? "").toUpperCase();

  /*
   * These mean Android cannot provide a usable native
   * authentication mechanism.
   *
   * Only in these cases do we expose the DANIJACE PROMOTIONS PIN.
   */
  return [
    "NO_HARDWARE",
    "NONE_ENROLLED",
    "NO_DEVICE_CREDENTIAL",
    "UNSUPPORTED",
    "SECURITY_UPDATE_REQUIRED",
    "UNAVAILABLE",
    "NATIVE_ERROR",
  ].includes(code);
}

/* ============================================================
   NATIVE AUTHENTICATION
============================================================ */

async function authenticateWithNativeSecurity(): Promise<DeviceSecurityResult> {
  /*
   * On web/desktop the custom native plugin does not exist.
   *
   * The exception is deliberately converted into an unavailable
   * result so that the normal DANIJACE PROMOTIONS PIN fallback is used.
   */
  try {
    const result = await DeviceSecurity.authenticate();

    return {
      success: Boolean(result?.success),
      code: result?.code,
      message: result?.message,
    };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Native device security is unavailable.";

    return {
      success: false,
      code: "NATIVE_ERROR",
      message,
    };
  }
}

/* ============================================================
   APP LOCK PROVIDER
============================================================ */

export function AppLockProvider({
  children,
}: {
  children: ReactNode;
}) {
  /* ----------------------------------------------------------
     STATE
  ---------------------------------------------------------- */

  const [ready, setReady] = useState(false);

  const [locked, setLocked] = useState(false);

  const [timeoutMs, setTimeoutMsState] = useState(
    DEFAULT_FOREGROUND_TIMEOUT_MS,
  );

  /*
   * Whether the native authentication mechanism is unavailable
   * and therefore the DANIJACE PROMOTIONS PIN should be shown.
   */
  const [showPinFallback, setShowPinFallback] =
    useState(false);

  const [authMessage, setAuthMessage] = useState("");

  const [pin, setPin] = useState("");

  const [pinLoading, setPinLoading] = useState(false);

  const [pinError, setPinError] = useState("");

  /* ----------------------------------------------------------
     REFS
  ---------------------------------------------------------- */

  const timeoutRef = useRef(
    DEFAULT_FOREGROUND_TIMEOUT_MS,
  );

  const lastActivityRef = useRef<number>(Date.now());

  const backgroundedAtRef = useRef<number | null>(null);

  const foregroundTimerRef =
    useRef<ReturnType<typeof setTimeout> | null>(null);

  const nativeAuthRunningRef = useRef(false);

  const nativeAuthAttemptedRef = useRef(false);

  const mountedRef = useRef(true);

  /* ==========================================================
     CLEAR FOREGROUND TIMER
  ========================================================== */

  const clearForegroundTimer = useCallback(() => {
    if (foregroundTimerRef.current !== null) {
      clearTimeout(foregroundTimerRef.current);
      foregroundTimerRef.current = null;
    }
  }, []);

  /* ==========================================================
     SAVE LAST ACTIVITY
  ========================================================== */

  const persistLastActivity = useCallback(
    async (timestamp: number) => {
      try {
        await Preferences.set({
          key: PREF_KEYS.lastActivity,
          value: String(timestamp),
        });
      } catch {
        /*
         * Local persistence failure should not break the lock
         * mechanism. The in-memory timestamp still works.
         */
      }
    },
    [],
  );

  /* ==========================================================
     COMPLETE UNLOCK
  ========================================================== */

  const completeUnlock = useCallback(async () => {
    if (!mountedRef.current) {
      return;
    }

    const now = Date.now();

    lastActivityRef.current = now;

    backgroundedAtRef.current = null;

    nativeAuthRunningRef.current = false;

    nativeAuthAttemptedRef.current = false;

    setLocked(false);

    setShowPinFallback(false);

    setAuthMessage("");

    setPin("");

    setPinError("");

    clearForegroundTimer();

    try {
      await Preferences.set({
        key: PREF_KEYS.lastActivity,
        value: String(now),
      });

      await Preferences.remove({
        key: PREF_KEYS.backgroundedAt,
      });
    } catch {
      /*
       * Unlock must still succeed if Preferences happens to fail.
       */
    }
  }, [clearForegroundTimer]);

  /* ==========================================================
     NATIVE AUTHENTICATION
  ========================================================== */

  const runNativeAuthentication = useCallback(async () => {
    if (!mountedRef.current) {
      return;
    }

    if (!locked) {
      return;
    }

    /*
     * Prevent multiple native prompts from being opened at
     * the same time.
     */
    if (nativeAuthRunningRef.current) {
      return;
    }

    nativeAuthRunningRef.current = true;

    setAuthMessage("Verifying your device…");
    setShowPinFallback(false);
    setPinError("");

    const result =
      await authenticateWithNativeSecurity();

    if (!mountedRef.current) {
      nativeAuthRunningRef.current = false;
      return;
    }

    nativeAuthRunningRef.current = false;

    if (result.success) {
      await completeUnlock();
      return;
    }

    /*
     * IMPORTANT:
     *
     * A cancelled biometric prompt, failed fingerprint,
     * failed face verification, timeout, or lockout does NOT
     * mean native security is unavailable.
     *
     * Therefore we do NOT fall back to the weaker DANIJACE PROMOTIONS PIN
     * in those cases.
     */
    if (!isNativeDeviceSecurityUnavailable(result)) {
      setAuthMessage(
        result.message ||
          "Use your Android device security to continue.",
      );

      /*
       * Do not automatically loop native prompts forever.
       *
       * Android's native prompt has already appeared and the
       * user can interact with it normally.
       */
      return;
    }

    /*
     * No usable native device security exists.
     *
     * Only now is the DANIJACE PROMOTIONS PIN allowed.
     */
    setShowPinFallback(true);

    setAuthMessage(
      "Android device security is unavailable. Use your DANIJACE PROMOTIONS PIN.",
    );
  }, [completeUnlock, locked]);

  /* ==========================================================
     LOCK
  ========================================================== */

  const lock = useCallback(() => {
    if (!mountedRef.current) {
      return;
    }

    clearForegroundTimer();

    nativeAuthAttemptedRef.current = false;

    nativeAuthRunningRef.current = false;

    setPin("");

    setPinError("");

    setAuthMessage("");

    setShowPinFallback(false);

    setLocked(true);
  }, [clearForegroundTimer]);

  /* ==========================================================
     SCHEDULE FOREGROUND LOCK
  ========================================================== */

  const scheduleForegroundLock = useCallback(() => {
    clearForegroundTimer();

    const now = Date.now();

    const elapsed =
      now - lastActivityRef.current;

    const remaining =
      timeoutRef.current - elapsed;

    if (remaining <= 0) {
      lock();
      return;
    }

    foregroundTimerRef.current =
      setTimeout(() => {
        const currentNow = Date.now();

        const currentElapsed =
          currentNow - lastActivityRef.current;

        if (
          currentElapsed >=
          timeoutRef.current
        ) {
          lock();
          return;
        }

        scheduleForegroundLock();
      }, Math.max(1000, remaining));
  }, [clearForegroundTimer, lock]);

  /* ==========================================================
     RECORD ACTIVITY
  ========================================================== */

  const recordActivity = useCallback(() => {
    /*
     * Never reset activity while the app is locked.
     */
    if (locked) {
      return;
    }

    /*
     * Never reset foreground activity while the native app is
     * in the background.
     */
    if (backgroundedAtRef.current !== null) {
      return;
    }

    const now = Date.now();

    lastActivityRef.current = now;

    void persistLastActivity(now);

    scheduleForegroundLock();
  }, [
    locked,
    persistLastActivity,
    scheduleForegroundLock,
  ]);

  /* ==========================================================
     SET FOREGROUND TIMEOUT
  ========================================================== */

  const setTimeoutMinutes = useCallback(
    async (minutes: number) => {
      const safeMinutes =
        clampTimeoutMinutes(minutes);

      const nextTimeoutMs =
        safeMinutes * 60 * 1000;

      timeoutRef.current = nextTimeoutMs;

      setTimeoutMsState(nextTimeoutMs);

      try {
        await Preferences.set({
          key: PREF_KEYS.foregroundTimeoutMs,
          value: String(nextTimeoutMs),
        });
      } catch {
        /*
         * Keep the in-memory setting even if persistence fails.
         */
      }

      if (!locked) {
        lastActivityRef.current = Date.now();

        await persistLastActivity(
          lastActivityRef.current,
        );

        scheduleForegroundLock();
      }
    },
    [
      locked,
      persistLastActivity,
      scheduleForegroundLock,
    ],
  );

  /* ==========================================================
     INITIALISE
  ========================================================== */

  useEffect(() => {
    mountedRef.current = true;

    let cancelled = false;

    const initialise = async () => {
      let storedTimeoutMs =
        DEFAULT_FOREGROUND_TIMEOUT_MS;

      let storedLastActivity = Date.now();

      let storedBackgroundedAt: number | null =
        null;

      try {
        const timeoutPreference =
          await Preferences.get({
            key: PREF_KEYS.foregroundTimeoutMs,
          });

        if (timeoutPreference.value) {
          const parsed =
            Number(timeoutPreference.value);

          if (
            Number.isFinite(parsed) &&
            parsed > 0
          ) {
            storedTimeoutMs =
              clampTimeoutMinutes(
                parsed / 60_000,
              ) * 60_000;
          }
        }

        const activityPreference =
          await Preferences.get({
            key: PREF_KEYS.lastActivity,
          });

        if (activityPreference.value) {
          const parsed =
            Number(activityPreference.value);

          if (
            Number.isFinite(parsed) &&
            parsed > 0
          ) {
            storedLastActivity = parsed;
          }
        }

        const backgroundPreference =
          await Preferences.get({
            key: PREF_KEYS.backgroundedAt,
          });

        if (backgroundPreference.value) {
          const parsed =
            Number(backgroundPreference.value);

          if (
            Number.isFinite(parsed) &&
            parsed > 0
          ) {
            storedBackgroundedAt = parsed;
          }
        }
      } catch {
        /*
         * Defaults remain valid.
         */
      }

      if (cancelled || !mountedRef.current) {
        return;
      }

      const now = Date.now();

      timeoutRef.current = storedTimeoutMs;

      lastActivityRef.current =
        storedLastActivity;

      backgroundedAtRef.current =
        storedBackgroundedAt;

      setTimeoutMsState(storedTimeoutMs);

      /*
       * If the app was previously backgrounded, enforce the
       * hard 1-minute background timeout.
       */
      if (
        storedBackgroundedAt !== null &&
        now - storedBackgroundedAt >=
          BACKGROUND_TIMEOUT_MS
      ) {
        setLocked(true);

        backgroundedAtRef.current =
          storedBackgroundedAt;

        setReady(true);

        return;
      }

      /*
       * If foreground inactivity already exceeded the configured
       * timeout, lock immediately.
       */
      if (
        now - storedLastActivity >=
        storedTimeoutMs
      ) {
        setLocked(true);

        setReady(true);

        return;
      }

      /*
       * Otherwise the app can continue normally.
       */
      setReady(true);

      scheduleForegroundLock();
    };

    void initialise();

    return () => {
      cancelled = true;

      mountedRef.current = false;

      clearForegroundTimer();
    };
  }, [
    clearForegroundTimer,
    scheduleForegroundLock,
  ]);

  /* ==========================================================
     AUTOMATIC NATIVE AUTH WHEN LOCKED
  ========================================================== */

  useEffect(() => {
    if (!ready || !locked) {
      return;
    }

    /*
     * The authentication flow is automatic.
     *
     * There is deliberately no "Unlock" button.
     */
    if (nativeAuthAttemptedRef.current) {
      return;
    }

    nativeAuthAttemptedRef.current = true;

    /*
     * Give React one tick to render the lock screen before
     * opening the native Android authentication prompt.
     */
    const timer = setTimeout(() => {
      void runNativeAuthentication();
    }, 150);

    return () => {
      clearTimeout(timer);
    };
  }, [
    ready,
    locked,
    runNativeAuthentication,
  ]);

  /* ==========================================================
     APP STATE
  ========================================================== */

  useEffect(() => {
    if (!ready) {
      return;
    }

    let mounted = true;

    const listenerPromise =
      App.addListener(
        "appStateChange",
        ({ isActive }) => {
          if (!mounted || !mountedRef.current) {
            return;
          }

          const now = Date.now();

          /*
           * ----------------------------------------------------
           * APP GOES TO BACKGROUND
           * ----------------------------------------------------
           */

          if (!isActive) {
            backgroundedAtRef.current = now;

            void Preferences.set({
              key: PREF_KEYS.backgroundedAt,
              value: String(now),
            });

            clearForegroundTimer();

            return;
          }

          /*
           * ----------------------------------------------------
           * APP RETURNS TO FOREGROUND
           * ----------------------------------------------------
           */

          const backgroundedAt =
            backgroundedAtRef.current;

          /*
           * The background timestamp is deliberately checked
           * before anything else.
           */
          if (
            backgroundedAt !== null &&
            now - backgroundedAt >=
              BACKGROUND_TIMEOUT_MS
          ) {
            clearForegroundTimer();

            setLocked(true);

            nativeAuthAttemptedRef.current =
              false;

            return;
          }

          /*
           * App returned before the 1-minute background limit.
           *
           * Treat the return as fresh foreground activity.
           */
          backgroundedAtRef.current = null;

          void Preferences.remove({
            key: PREF_KEYS.backgroundedAt,
          });

          if (!locked) {
            lastActivityRef.current = now;

            void persistLastActivity(now);

            scheduleForegroundLock();
          }
        },
      );

    return () => {
      mounted = false;

      void listenerPromise.then((listener) => {
        listener.remove();
      });

      clearForegroundTimer();
    };
  }, [
    ready,
    locked,
    clearForegroundTimer,
    persistLastActivity,
    scheduleForegroundLock,
  ]);

  /* ==========================================================
     WEB ACTIVITY LISTENERS
  ========================================================== */

  useEffect(() => {
    if (!ready || locked) {
      return;
    }

    const events = [
      "pointerdown",
      "keydown",
      "touchstart",
      "scroll",
    ] as const;

    let activityScheduled = false;

    const handleActivity = () => {
      if (activityScheduled) {
        return;
      }

      activityScheduled = true;

      /*
       * Avoid writing Preferences on every touch/scroll event.
       */
      window.setTimeout(() => {
        activityScheduled = false;

        if (!mountedRef.current || locked) {
          return;
        }

        recordActivity();
      }, 250);
    };

    for (const event of events) {
      window.addEventListener(
        event,
        handleActivity,
        {
          passive: true,
        },
      );
    }

    return () => {
      for (const event of events) {
        window.removeEventListener(
          event,
          handleActivity,
        );
      }
    };
  }, [
    ready,
    locked,
    recordActivity,
  ]);

  /* ==========================================================
     DANIJACE PROMOTIONS PIN FALLBACK
  ========================================================== */

  const verifyPin = useCallback(
    async (event?: React.FormEvent) => {
      event?.preventDefault();

      if (pinLoading) {
        return;
      }

      const cleanPin = pin.trim();

      if (!/^\d{4,6}$/.test(cleanPin)) {
        setPinError(
          "Enter your 4–6 digit DANIJACE PROMOTIONS PIN.",
        );

        return;
      }

      setPinLoading(true);

      setPinError("");

      try {
        const response = await fetch(
          "/api/auth/security/verify",
          {
            method: "POST",
            headers: {
              "Content-Type":
                "application/json",
            },
            credentials: "include",
            body: JSON.stringify({
              method: "pin",
              pin: cleanPin,
            }),
          },
        );

        const data = await response
          .json()
          .catch(() => null);

        if (!response.ok || !data?.success) {
          throw new Error(
            data?.message ||
              "Incorrect DANIJACE PROMOTIONS PIN.",
          );
        }

        await completeUnlock();
      } catch (error) {
        if (!mountedRef.current) {
          return;
        }

        setPinError(
          error instanceof Error
            ? error.message
            : "Unable to verify your PIN.",
        );

        setPin("");
      } finally {
        if (mountedRef.current) {
          setPinLoading(false);
        }
      }
    },
    [
      pin,
      pinLoading,
      completeUnlock,
    ],
  );

  /* ==========================================================
     CONTEXT VALUE
  ========================================================== */

  const contextValue = useMemo<AppLockContextValue>(
    () => ({
      locked,
      ready,

      timeoutMs,

      timeoutMinutes: Math.round(
        timeoutMs / 60_000,
      ),

      lock,

      setTimeoutMinutes,

      recordActivity,
    }),
    [
      locked,
      ready,
      timeoutMs,
      lock,
      setTimeoutMinutes,
      recordActivity,
    ],
  );

  /* ==========================================================
     INITIAL LOADING
  ========================================================== */

  if (!ready) {
    return (
      <div className="min-h-screen bg-white text-black flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="h-9 w-9 rounded-full border-2 border-slate-200 border-t-[#1683ff] animate-spin" />

          <p className="text-sm text-slate-500">
            Securing DANIJACE PROMOTIONS…
          </p>
        </div>
      </div>
    );
  }

  /* ==========================================================
     LOCK SCREEN
  ========================================================== */

  return (
    <AppLockContext.Provider value={contextValue}>
      <div
        className={
          locked
            ? "min-h-screen bg-white text-black"
            : undefined
        }
      >
        <div
          style={
            locked
              ? {
                  visibility: "hidden",
                  pointerEvents: "none",
                  position: "fixed",
                  inset: 0,
                  overflow: "hidden",
                }
              : undefined
          }
          aria-hidden={locked}
        >
          {children}
        </div>

        {locked && (
          <div className="fixed inset-0 z-[99999] bg-white text-black flex items-center justify-center px-6">
            <div className="w-full max-w-sm">
              {/* ------------------------------------------------
                 BRAND
              ------------------------------------------------ */}

              <div className="flex flex-col items-center text-center">
                <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-[#1683ff] text-white shadow-sm">
                  <span className="text-xl font-black tracking-tight">
                    DP
                  </span>
                </div>

                <h1 className="text-2xl font-bold tracking-tight">
                  DANIJACE PROMOTIONS Locked
                </h1>

                <p className="mt-2 max-w-xs text-sm leading-6 text-slate-500">
                  Verify your identity to continue.
                </p>
              </div>

              {/* ------------------------------------------------
                 NATIVE AUTH STATE
              ------------------------------------------------ */}

              {!showPinFallback && (
                <div className="mt-10 rounded-2xl border border-slate-200 bg-slate-50 px-5 py-6 text-center">
                  <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-white shadow-sm">
                    <div className="h-6 w-6 rounded-full border-2 border-[#1683ff] border-t-transparent animate-spin" />
                  </div>

                  <p className="text-sm font-medium text-slate-900">
                    {authMessage ||
                      "Waiting for device security…"}
                  </p>

                  <p className="mt-2 text-xs leading-5 text-slate-500">
                    Use your fingerprint, face, or
                    Android device PIN, pattern, or
                    password.
                  </p>
                </div>
              )}

              {/* ------------------------------------------------
                 DANIJACE PROMOTIONS PIN FALLBACK
              ------------------------------------------------ */}

              {showPinFallback && (
                <form
                  onSubmit={verifyPin}
                  className="mt-10"
                >
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                    <p className="text-sm font-medium text-slate-900">
                      Device security unavailable
                    </p>

                    <p className="mt-1 text-xs leading-5 text-slate-500">
                      Use your DANIJACE PROMOTIONS security PIN
                      to continue.
                    </p>

                    <input
                      type="password"
                      inputMode="numeric"
                      autoComplete="current-password"
                      maxLength={6}
                      value={pin}
                      onChange={(event) => {
                        const value =
                          event.target.value.replace(
                            /\D/g,
                            "",
                          );

                        setPin(value);
                        setPinError("");
                      }}
                      autoFocus
                      placeholder="Enter PIN"
                      className="mt-5 h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-center text-lg tracking-[0.35em] text-black outline-none transition focus:border-[#1683ff] focus:ring-2 focus:ring-[#1683ff]/20"
                      disabled={pinLoading}
                    />

                    {pinError && (
                      <p className="mt-3 text-center text-xs font-medium text-red-600">
                        {pinError}
                      </p>
                    )}

                    <button
                      type="submit"
                      disabled={
                        pinLoading ||
                        pin.length < 4
                      }
                      className="mt-4 h-12 w-full rounded-xl bg-[#1683ff] px-4 text-sm font-semibold text-white transition hover:bg-[#0f75e8] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {pinLoading
                        ? "Verifying…"
                        : "Unlock DANIJACE PROMOTIONS"}
                    </button>
                  </div>
                </form>
              )}

              {/* ------------------------------------------------
                 SESSION NOTE
              ------------------------------------------------ */}

              <p className="mt-6 text-center text-xs text-slate-400">
                Your Google session remains active.
              </p>
            </div>
          </div>
        )}
      </div>
    </AppLockContext.Provider>
  );
}

/* ============================================================
   HOOK
============================================================ */

export function useAppLock(): AppLockContextValue {
  const context = useContext(AppLockContext);

  if (!context) {
    throw new Error(
      "useAppLock must be used inside AppLockProvider.",
    );
  }

  return context;
}
