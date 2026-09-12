// ============================================================
// FILE: src/lib/security/appLock.ts
// ============================================================

/**
 * GEO-SHUA APP LOCK
 *
 * This module controls the client-side app-lock policy.
 *
 * IMPORTANT:
 * - This does NOT authenticate the user.
 * - This does NOT store the PIN.
 * - This does NOT replace the server security session.
 * - The existing PIN/device verification remains the
 *   authoritative second-layer authentication mechanism.
 *
 * The app lock simply decides when that verification must
 * be requested again.
 */

/* ============================================================
   STORAGE
============================================================ */

export const APP_LOCK_STORAGE_KEY =
  "geoshua_app_lock";

/* ============================================================
   DEFAULTS
============================================================ */

/**
 * App lock is enabled by default.
 */
export const DEFAULT_APP_LOCK_ENABLED =
  true;

/**
 * Default timeout:
 *
 * 5 minutes.
 */
export const DEFAULT_APP_LOCK_TIMEOUT_MS =
  5 * 60 * 1000;

/**
 * Available timeout choices exposed to the UI.
 *
 * Keep these simple and user-friendly.
 */
export const APP_LOCK_TIMEOUT_OPTIONS = [
  {
    label: "1 minute",
    value: 1 * 60 * 1000,
  },
  {
    label: "5 minutes",
    value: 5 * 60 * 1000,
  },
  {
    label: "10 minutes",
    value: 10 * 60 * 1000,
  },
  {
    label: "15 minutes",
    value: 15 * 60 * 1000,
  },
  {
    label: "30 minutes",
    value: 30 * 60 * 1000,
  },
  {
    label: "Never",
    value: 0,
  },
] as const;

/* ============================================================
   TYPES
============================================================ */

export type AppLockSettings = {
  enabled: boolean;

  /**
   * Timeout in milliseconds.
   *
   * 0 means disabled/no automatic timeout.
   */
  timeoutMs: number;

  /**
   * Last time the user was considered active.
   *
   * Stored as a Unix timestamp in milliseconds.
   */
  lastActivityAt: number | null;

  /**
   * Time when the app was moved into the background.
   *
   * Stored as a Unix timestamp in milliseconds.
   */
  backgroundedAt: number | null;
};

/* ============================================================
   DEFAULT SETTINGS
============================================================ */

export function getDefaultAppLockSettings(): AppLockSettings {
  return {
    enabled: DEFAULT_APP_LOCK_ENABLED,
    timeoutMs: DEFAULT_APP_LOCK_TIMEOUT_MS,
    lastActivityAt: null,
    backgroundedAt: null,
  };
}

/* ============================================================
   TIMEOUT VALIDATION
============================================================ */

export function isValidAppLockTimeout(
  timeoutMs: number,
): boolean {
  return APP_LOCK_TIMEOUT_OPTIONS.some(
    (option) => option.value === timeoutMs,
  );
}

/* ============================================================
   LOCK DECISION
============================================================ */

/**
 * Determines whether the app should be locked based on
 * elapsed time.
 *
 * timeoutMs === 0 means automatic locking is disabled.
 */
export function shouldLockApp(
  lastActivityAt: number | null,
  timeoutMs: number,
  now: number = Date.now(),
): boolean {
  if (timeoutMs <= 0) {
    return false;
  }

  if (
    !lastActivityAt ||
    !Number.isFinite(lastActivityAt)
  ) {
    return false;
  }

  return (
    now - lastActivityAt >= timeoutMs
  );
}

/**
 * Determines whether the app should be locked after
 * returning from the Android background / Recent Apps.
 *
 * We intentionally use the same configured timeout.
 */
export function shouldLockAfterBackground(
  backgroundedAt: number | null,
  timeoutMs: number,
  now: number = Date.now(),
): boolean {
  if (timeoutMs <= 0) {
    return false;
  }

  if (
    !backgroundedAt ||
    !Number.isFinite(backgroundedAt)
  ) {
    return false;
  }

  return (
    now - backgroundedAt >= timeoutMs
  );
}

/* ============================================================
   STORAGE SERIALIZATION
============================================================ */

/**
 * Safely parse persisted app-lock settings.
 *
 * This function is deliberately defensive because local
 * browser storage can contain stale or malformed data.
 */
export function parseAppLockSettings(
  value: string | null,
): AppLockSettings {
  const defaults =
    getDefaultAppLockSettings();

  if (!value) {
    return defaults;
  }

  try {
    const parsed =
      JSON.parse(value) as Partial<AppLockSettings>;

    const enabled =
      typeof parsed.enabled === "boolean"
        ? parsed.enabled
        : defaults.enabled;

    const timeoutMs =
      typeof parsed.timeoutMs === "number" &&
      isValidAppLockTimeout(
        parsed.timeoutMs,
      )
        ? parsed.timeoutMs
        : defaults.timeoutMs;

    const lastActivityAt =
      typeof parsed.lastActivityAt ===
        "number" &&
      Number.isFinite(
        parsed.lastActivityAt,
      )
        ? parsed.lastActivityAt
        : null;

    const backgroundedAt =
      typeof parsed.backgroundedAt ===
        "number" &&
      Number.isFinite(
        parsed.backgroundedAt,
      )
        ? parsed.backgroundedAt
        : null;

    return {
      enabled,
      timeoutMs,
      lastActivityAt,
      backgroundedAt,
    };
  } catch {
    return defaults;
  }
}

/* ============================================================
   STORAGE HELPERS
============================================================ */

/**
 * Read app-lock settings from browser storage.
 *
 * This function is safe to call from SSR because it checks
 * for window/localStorage before accessing it.
 */
export function loadAppLockSettings(): AppLockSettings {
  if (
    typeof window === "undefined" ||
    !window.localStorage
  ) {
    return getDefaultAppLockSettings();
  }

  return parseAppLockSettings(
    window.localStorage.getItem(
      APP_LOCK_STORAGE_KEY,
    ),
  );
}

/**
 * Persist app-lock settings.
 *
 * Nothing secret is stored here.
 */
export function saveAppLockSettings(
  settings: AppLockSettings,
): void {
  if (
    typeof window === "undefined" ||
    !window.localStorage
  ) {
    return;
  }

  window.localStorage.setItem(
    APP_LOCK_STORAGE_KEY,
    JSON.stringify(settings),
  );
}

/**
 * Remove persisted app-lock state.
 *
 * Useful when the user explicitly signs out.
 */
export function clearAppLockSettings(): void {
  if (
    typeof window === "undefined" ||
    !window.localStorage
  ) {
    return;
  }

  window.localStorage.removeItem(
    APP_LOCK_STORAGE_KEY,
  );
}