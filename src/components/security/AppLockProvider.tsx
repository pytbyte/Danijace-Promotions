// ============================================================
// FILE: src/components/security/AppLockProvider.tsx
// ============================================================

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

// ============================================================
// CONFIGURATION
// ============================================================

const DEFAULT_TIMEOUT_MINUTES = 3;

const MIN_TIMEOUT_MINUTES = 1;
const MAX_TIMEOUT_MINUTES = 60;

const DEFAULT_TIMEOUT_MS =
  DEFAULT_TIMEOUT_MINUTES * 60 * 1000;

const PREF_KEYS = {
  timeoutMs: "geoshua.app_lock_timeout_ms",
  lastActivity: "geoshua.app_lock_last_activity",
  backgroundedAt: "geoshua.app_lock_backgrounded_at",
};

// ============================================================
// TYPES
// ============================================================

interface AppLockContextValue {
  locked: boolean;
  ready: boolean;

  timeoutMs: number;
  timeoutMinutes: number;

  lock: () => Promise<void>;

  setTimeoutMinutes: (
    minutes: number,
  ) => Promise<void>;

  recordActivity: () => void;
}

interface AppLockProviderProps {
  children: ReactNode;
}

// ============================================================
// CONTEXT
// ============================================================

const AppLockContext =
  createContext<AppLockContextValue | null>(null);

// ============================================================
// HELPERS
// ============================================================

function clampTimeoutMinutes(
  minutes: number,
): number {
  if (!Number.isFinite(minutes)) {
    return DEFAULT_TIMEOUT_MINUTES;
  }

  return Math.min(
    MAX_TIMEOUT_MINUTES,
    Math.max(
      MIN_TIMEOUT_MINUTES,
      Math.round(minutes),
    ),
  );
}

function minutesToMilliseconds(
  minutes: number,
): number {
  return (
    clampTimeoutMinutes(minutes) *
    60 *
    1000
  );
}

async function getStoredNumber(
  key: string,
): Promise<number | null> {
  try {
    const result = await Preferences.get({
      key,
    });

    if (
      result.value === null ||
      result.value === undefined ||
      result.value === ""
    ) {
      return null;
    }

    const value = Number(result.value);

    return Number.isFinite(value)
      ? value
      : null;
  } catch {
    return null;
  }
}

async function setStoredNumber(
  key: string,
  value: number,
): Promise<void> {
  try {
    await Preferences.set({
      key,
      value: String(value),
    });
  } catch {
    /*
     * Do not allow storage failures to crash
     * the dashboard.
     */
  }
}

async function removeStoredValue(
  key: string,
): Promise<void> {
  try {
    await Preferences.remove({
      key,
    });
  } catch {
    /*
     * Non-fatal.
     */
  }
}

// ============================================================
// PROVIDER
// ============================================================

export function AppLockProvider({
  children,
}: AppLockProviderProps) {
  const [ready, setReady] =
    useState(false);

  const [locked, setLocked] =
    useState(false);

  const [timeoutMs, setTimeoutMs] =
    useState(DEFAULT_TIMEOUT_MS);

  const timeoutRef =
    useRef(DEFAULT_TIMEOUT_MS);

  const lastActivityRef =
    useRef<number>(Date.now());

  const backgroundedAtRef =
    useRef<number | null>(null);

  const lockedRef =
    useRef(false);

  const activityWriteTimerRef =
    useRef<ReturnType<typeof setTimeout> | null>(
      null,
    );

  const lockTimerRef =
    useRef<ReturnType<typeof setTimeout> | null>(
      null,
    );

  // ==========================================================
  // LOCK
  // ==========================================================

  const lock = useCallback(
    async () => {
      if (lockedRef.current) {
        return;
      }

      lockedRef.current = true;

      setLocked(true);

      /*
       * Keep the original lastActivity timestamp.
       *
       * This is intentional. If Android destroys the
       * WebView while the app is locked, reopening it
       * should still require verification.
       */
      if (
        activityWriteTimerRef.current
      ) {
        clearTimeout(
          activityWriteTimerRef.current,
        );

        activityWriteTimerRef.current = null;
      }

      if (lockTimerRef.current) {
        clearTimeout(
          lockTimerRef.current,
        );

        lockTimerRef.current = null;
      }
    },
    [],
  );

  // ==========================================================
  // SCHEDULE IDLE LOCK
  // ==========================================================

  const scheduleLock = useCallback(
    (
      activityTimestamp: number,
    ) => {
      if (lockTimerRef.current) {
        clearTimeout(
          lockTimerRef.current,
        );
      }

      const elapsed =
        Date.now() -
        activityTimestamp;

      const remaining =
        timeoutRef.current -
        elapsed;

      if (remaining <= 0) {
        void lock();
        return;
      }

      lockTimerRef.current =
        setTimeout(() => {
          const currentElapsed =
            Date.now() -
            lastActivityRef.current;

          if (
            currentElapsed >=
            timeoutRef.current
          ) {
            void lock();
          } else {
            scheduleLock(
              lastActivityRef.current,
            );
          }
        }, remaining + 250);
    },
    [lock],
  );

  // ==========================================================
  // RECORD ACTIVITY
  // ==========================================================

  const recordActivity =
    useCallback(() => {
      if (
        !ready ||
        lockedRef.current
      ) {
        return;
      }

      const now = Date.now();

      lastActivityRef.current =
        now;

      /*
       * We intentionally debounce writes.
       *
       * Activity remains accurate in memory,
       * while native storage is not written on
       * every mouse movement/touch event.
       */
      if (
        !activityWriteTimerRef.current
      ) {
        activityWriteTimerRef.current =
          setTimeout(async () => {
            activityWriteTimerRef.current =
              null;

            if (
              lockedRef.current
            ) {
              return;
            }

            await setStoredNumber(
              PREF_KEYS.lastActivity,
              lastActivityRef.current,
            );
          }, 10_000);
      }

      scheduleLock(now);
    }, [
      ready,
      scheduleLock,
    ]);

  // ==========================================================
  // COMPLETE UNLOCK
  // ==========================================================

  const completeUnlock =
    useCallback(async () => {
      const now = Date.now();

      lockedRef.current =
        false;

      setLocked(false);

      lastActivityRef.current =
        now;

      backgroundedAtRef.current =
        null;

      await setStoredNumber(
        PREF_KEYS.lastActivity,
        now,
      );

      await removeStoredValue(
        PREF_KEYS.backgroundedAt,
      );

      scheduleLock(now);
    }, [scheduleLock]);

  // ==========================================================
  // INITIALISE
  // ==========================================================

  useEffect(() => {
    let cancelled = false;

    async function initialise() {
      const storedTimeout =
        await getStoredNumber(
          PREF_KEYS.timeoutMs,
        );

      let resolvedTimeout =
        DEFAULT_TIMEOUT_MS;

      if (
        storedTimeout !== null &&
        Number.isFinite(storedTimeout)
      ) {
        const minutes =
          clampTimeoutMinutes(
            storedTimeout / 60 / 1000,
          );

        resolvedTimeout =
          minutesToMilliseconds(
            minutes,
          );
      }

      if (cancelled) {
        return;
      }

      timeoutRef.current =
        resolvedTimeout;

      setTimeoutMs(
        resolvedTimeout,
      );

      const storedActivity =
        await getStoredNumber(
          PREF_KEYS.lastActivity,
        );

      const storedBackground =
        await getStoredNumber(
          PREF_KEYS.backgroundedAt,
        );

      if (cancelled) {
        return;
      }

      const now = Date.now();

      /*
       * First installation / first run.
       *
       * Do not immediately lock an existing user
       * just because the app-lock feature was added.
       */
      if (storedActivity === null) {
        lastActivityRef.current =
          now;

        await setStoredNumber(
          PREF_KEYS.lastActivity,
          now,
        );

        await removeStoredValue(
          PREF_KEYS.backgroundedAt,
        );

        if (!cancelled) {
          setReady(true);
          scheduleLock(now);
        }

        return;
      }

      lastActivityRef.current =
        storedActivity;

      if (storedBackground !== null) {
        backgroundedAtRef.current =
          storedBackground;
      }

      const idleElapsed =
        now -
        storedActivity;

      const backgroundElapsed =
        storedBackground !== null
          ? now - storedBackground
          : 0;

      const shouldLock =
        idleElapsed >=
          resolvedTimeout ||
        backgroundElapsed >=
          resolvedTimeout;

      if (shouldLock) {
        lockedRef.current =
          true;

        if (!cancelled) {
          setLocked(true);
          setReady(true);
        }

        return;
      }

      /*
       * The app was away from the foreground,
       * but not long enough to require a lock.
       */
      await setStoredNumber(
        PREF_KEYS.lastActivity,
        now,
      );

      await removeStoredValue(
        PREF_KEYS.backgroundedAt,
      );

      lastActivityRef.current =
        now;

      if (!cancelled) {
        setReady(true);
        scheduleLock(now);
      }
    }

    void initialise();

    return () => {
      cancelled = true;

      if (
        activityWriteTimerRef.current
      ) {
        clearTimeout(
          activityWriteTimerRef.current,
        );
      }

      if (lockTimerRef.current) {
        clearTimeout(
          lockTimerRef.current,
        );
      }
    };
  }, [scheduleLock]);

  // ==========================================================
  // APP FOREGROUND / BACKGROUND
  // ==========================================================

  useEffect(() => {
    if (!ready) {
      return;
    }

    let listener:
      | {
          remove: () => Promise<void>;
        }
      | null = null;

    async function handleAppState(
      isActive: boolean,
    ) {
      const now = Date.now();

      if (!isActive) {
        /*
         * App entered Android Recent Apps/background.
         */
        backgroundedAtRef.current =
          now;

        await setStoredNumber(
          PREF_KEYS.backgroundedAt,
          now,
        );

        /*
         * Also persist current activity before
         * Android potentially suspends/kills WebView.
         */
        await setStoredNumber(
          PREF_KEYS.lastActivity,
          lastActivityRef.current,
        );

        return;
      }

      /*
       * App returned to foreground.
       */
      const backgroundedAt =
        backgroundedAtRef.current ??
        (await getStoredNumber(
          PREF_KEYS.backgroundedAt,
        ));

      const storedActivity =
        await getStoredNumber(
          PREF_KEYS.lastActivity,
        );

      const effectiveActivity =
        storedActivity ??
        lastActivityRef.current;

      const idleElapsed =
        now -
        effectiveActivity;

      const backgroundElapsed =
        backgroundedAt !== null
          ? now - backgroundedAt
          : 0;

      if (
        lockedRef.current ||
        idleElapsed >=
          timeoutRef.current ||
        backgroundElapsed >=
          timeoutRef.current
      ) {
        await lock();
        return;
      }

      /*
       * User came back before the timeout.
       */
      lastActivityRef.current =
        now;

      backgroundedAtRef.current =
        null;

      await setStoredNumber(
        PREF_KEYS.lastActivity,
        now,
      );

      await removeStoredValue(
        PREF_KEYS.backgroundedAt,
      );

      scheduleLock(now);
    }

    async function setupListener() {
      listener =
        await App.addListener(
          "appStateChange",
          ({ isActive }) => {
            void handleAppState(
              isActive,
            );
          },
        );
    }

    void setupListener();

    return () => {
      if (listener) {
        void listener.remove();
      }
    };
  }, [
    ready,
    lock,
    scheduleLock,
  ]);

  // ==========================================================
  // USER ACTIVITY EVENTS
  // ==========================================================

  useEffect(() => {
    if (!ready || locked) {
      return;
    }

    const events: Array<
      keyof WindowEventMap
    > = [
      "pointerdown",
      "keydown",
      "touchstart",
      "scroll",
    ];

    const handleActivity = () => {
      recordActivity();
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

  // ==========================================================
  // TIMEOUT UPDATE
  // ==========================================================

  const setTimeoutMinutes =
    useCallback(
      async (minutes: number) => {
        const safeMinutes =
          clampTimeoutMinutes(
            minutes,
          );

        const newTimeoutMs =
          minutesToMilliseconds(
            safeMinutes,
          );

        timeoutRef.current =
          newTimeoutMs;

        setTimeoutMs(
          newTimeoutMs,
        );

        await setStoredNumber(
          PREF_KEYS.timeoutMs,
          newTimeoutMs,
        );

        if (lockedRef.current) {
          return;
        }

        const elapsed =
          Date.now() -
          lastActivityRef.current;

        if (
          elapsed >=
          newTimeoutMs
        ) {
          await lock();
          return;
        }

        scheduleLock(
          lastActivityRef.current,
        );
      },
      [lock, scheduleLock],
    );

  // ==========================================================
  // CONTEXT VALUE
  // ==========================================================

  const contextValue =
    useMemo<AppLockContextValue>(
      () => ({
        locked,
        ready,
        timeoutMs,
        timeoutMinutes:
          Math.round(
            timeoutMs /
              60 /
              1000,
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

  // ==========================================================
  // INITIAL LOADING
  // ==========================================================

  if (!ready) {
    return (
      <div className="min-h-screen bg-slate-950" />
    );
  }

  // ==========================================================
  // RENDER
  // ==========================================================

  return (
    <AppLockContext.Provider
      value={contextValue}
    >
      <div
        className={
          locked
            ? "invisible h-full"
            : "h-full"
        }
        aria-hidden={locked}
      >
        {children}
      </div>

      {locked && (
        <AppLockScreen
          timeoutMinutes={
            Math.round(
              timeoutMs /
                60 /
                1000,
            )
          }
          onUnlocked={
            completeUnlock
          }
        />
      )}
    </AppLockContext.Provider>
  );
}

// ============================================================
// LOCK SCREEN
// ============================================================

interface AppLockScreenProps {
  timeoutMinutes: number;
  onUnlocked: () => Promise<void>;
}

function AppLockScreen({
  timeoutMinutes,
  onUnlocked,
}: AppLockScreenProps) {
  const [pin, setPin] =
    useState("");

  const [error, setError] =
    useState("");

  const [loading, setLoading] =
    useState(false);

  const [retryAfter, setRetryAfter] =
    useState(0);

  const inputRef =
    useRef<HTMLInputElement | null>(
      null,
    );

  // ==========================================================
  // AUTO FOCUS
  // ==========================================================

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // ==========================================================
  // RETRY COUNTDOWN
  // ==========================================================

  useEffect(() => {
    if (retryAfter <= 0) {
      return;
    }

    const timer =
      setInterval(() => {
        setRetryAfter(
          (current) =>
            Math.max(
              0,
              current - 1,
            ),
        );
      }, 1000);

    return () => {
      clearInterval(timer);
    };
  }, [retryAfter]);

  // ==========================================================
  // VERIFY PIN
  // ==========================================================

  async function verifyPin() {
    const cleanPin =
      pin.replace(/\D/g, "");

    if (
      cleanPin.length < 4 ||
      cleanPin.length > 6
    ) {
      setError(
        "Enter your 4–6 digit PIN.",
      );

      return;
    }

    if (retryAfter > 0) {
      return;
    }

    setLoading(true);
    setError("");

    try {
      const response =
        await fetch(
          "/api/auth/security/verify",
          {
            method: "POST",
            headers: {
              "Content-Type":
                "application/json",
            },
            body: JSON.stringify({
              method: "pin",
              pin: cleanPin,
            }),
          },
        );

      const data =
        await response
          .json()
          .catch(() => null);

      if (!response.ok) {
        const retry =
          Number(
            data?.retryAfterSeconds ??
              data?.retryAfter ??
              0,
          );

        if (
          Number.isFinite(retry) &&
          retry > 0
        ) {
          setRetryAfter(
            Math.ceil(retry),
          );
        }

        setError(
          data?.error ||
            "Incorrect PIN.",
        );

        setPin("");

        inputRef.current?.focus();

        return;
      }

      await onUnlocked();

      setPin("");
      setError("");
    } catch {
      setError(
        "Unable to verify your PIN. Check your connection and try again.",
      );
    } finally {
      setLoading(false);
    }
  }

  // ==========================================================
  // KEYBOARD SUBMIT
  // ==========================================================

  function handleKeyDown(
    event: React.KeyboardEvent<HTMLInputElement>,
  ) {
    if (
      event.key === "Enter"
    ) {
      event.preventDefault();

      void verifyPin();
    }
  }

  // ==========================================================
  // RENDER
  // ==========================================================

  return (
    <div className="fixed inset-0 z-[99999] flex min-h-screen items-center justify-center bg-slate-950 px-5 text-white">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-sky-500/10 ring-1 ring-sky-400/20">
            <div className="text-xl font-black tracking-tight text-sky-400">
              GS
            </div>
          </div>

          <h1 className="text-2xl font-bold tracking-tight">
            GEO-SHUA Locked
          </h1>

          <p className="mt-2 text-sm leading-6 text-slate-400">
            For your security, GEO-SHUA
            locked after{" "}
            {timeoutMinutes}{" "}
            {timeoutMinutes === 1
              ? "minute"
              : "minutes"}{" "}
            of inactivity.
          </p>
        </div>

        <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-5 shadow-2xl backdrop-blur-xl">
          <label
            htmlFor="geoshua-app-lock-pin"
            className="mb-2 block text-sm font-medium text-slate-300"
          >
            Enter your PIN
          </label>

          <input
            ref={inputRef}
            id="geoshua-app-lock-pin"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            maxLength={6}
            value={pin}
            disabled={
              loading ||
              retryAfter > 0
            }
            onChange={(event) => {
              const value =
                event.target.value
                  .replace(/\D/g, "")
                  .slice(0, 6);

              setPin(value);
              setError("");
            }}
            onKeyDown={
              handleKeyDown
            }
            className="h-14 w-full rounded-2xl border border-white/10 bg-black/20 px-4 text-center text-2xl tracking-[0.45em] text-white outline-none transition focus:border-sky-400/60 focus:ring-2 focus:ring-sky-400/10 disabled:opacity-50"
            placeholder="••••"
            aria-label="GEO-SHUA PIN"
          />

          {error && (
            <p className="mt-3 text-center text-sm text-red-400">
              {error}
            </p>
          )}

          {retryAfter > 0 && (
            <p className="mt-3 text-center text-xs text-slate-500">
              Try again in{" "}
              {retryAfter}s.
            </p>
          )}

          <button
            type="button"
            disabled={
              loading ||
              retryAfter > 0 ||
              pin.length < 4
            }
            onClick={() =>
              void verifyPin()
            }
            className="mt-5 h-12 w-full rounded-2xl bg-sky-500 font-semibold text-white transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {loading
              ? "Verifying…"
              : "Unlock GEO-SHUA"}
          </button>
        </div>

        <p className="mt-5 text-center text-xs text-slate-600">
          Your Google session remains active.
        </p>
      </div>
    </div>
  );
}

// ============================================================
// HOOK
// ============================================================

export function useAppLock(): AppLockContextValue {
  const context =
    useContext(
      AppLockContext,
    );

  if (!context) {
    throw new Error(
      "useAppLock must be used inside AppLockProvider.",
    );
  }

  return context;
}