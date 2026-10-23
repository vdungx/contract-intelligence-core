/** Narrow an unknown JSON value to a plain object. */
export function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

/** Coerce a JSON string, or return `fallback` for any other value. */
export function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

/** Coerce a finite JSON number, or return `fallback`. */
export function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/** Coerce a JSON string, or null for any other value. */
export function asNullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}
