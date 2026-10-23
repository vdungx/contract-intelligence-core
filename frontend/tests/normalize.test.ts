import { describe, expect, it } from 'vitest'
import {
  asNullableString,
  asNumber,
  asRecord,
  asString,
} from '../src/api/normalize'

describe('normalize decoders', () => {
  it('keeps strings untouched and falls back for non-strings', () => {
    expect(asString('  x  ')).toBe('  x  ')
    expect(asString(undefined)).toBe('')
    expect(asString(42, 'fallback')).toBe('fallback')
    expect(asNullableString('')).toBe('')
    expect(asNullableString(null)).toBeNull()
    expect(asNullableString(0)).toBeNull()
  })

  it('keeps finite numbers and falls back otherwise', () => {
    expect(asNumber(0)).toBe(0)
    expect(asNumber(1.5)).toBe(1.5)
    expect(asNumber(Number.NaN, 7)).toBe(7)
    expect(asNumber(Infinity)).toBe(0)
    expect(asNumber('3')).toBe(0)
  })

  it('only accepts plain objects as records', () => {
    expect(asRecord({ a: 1 })).toEqual({ a: 1 })
    expect(asRecord([])).toBeNull()
    expect(asRecord(null)).toBeNull()
    expect(asRecord('x')).toBeNull()
  })
})
