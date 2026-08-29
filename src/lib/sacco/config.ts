/**
 * Current application SACCO configuration.
 *
 * GEO-SHUA is currently the only SACCO supported
 * by the application.
 *
 * The ID should remain stable because it is used
 * to identify financial records.
 */

export const CURRENT_SACCO = {
  id: "geoshua",
  name: "GEO-SHUA",
} as const;

export type CurrentSacco = typeof CURRENT_SACCO;

/**
 * Check that submitted SACCO information matches
 * the currently configured SACCO.
 *
 * Client-submitted values are never treated as
 * authoritative. The application configuration
 * remains the source of truth.
 */
export function validateCurrentSacco(
  saccoId: unknown,
  saccoName: unknown
): boolean {
  return (
    saccoId === CURRENT_SACCO.id &&
    saccoName === CURRENT_SACCO.name
  );
}