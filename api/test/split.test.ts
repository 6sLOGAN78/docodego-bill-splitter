import { describe, expect, it } from 'vitest'
import { splitCents } from '../src/split'

describe('splitCents', () => {
  it.each([
    [1000, 3, [334, 333, 333]],
    [3000, 3, [1000, 1000, 1000]],
    [1, 3, [1, 0, 0]],
    [2, 3, [1, 1, 0]],
    [4999, 1, [4999]],
  ])('splits %i between %i members as %j', (total, count, expected) => {
    expect(splitCents(total, count)).toEqual(expected)
  })

  it('always adds up to the total', () => {
    for (let total = 1; total <= 500; total++) {
      for (let count = 1; count <= 12; count++) {
        const parts = splitCents(total, count)
        expect(parts.reduce((sum, part) => sum + part, 0)).toBe(total)
        expect(Math.max(...parts) - Math.min(...parts)).toBeLessThanOrEqual(1)
      }
    }
  })

  it.each([0, -1, 1.5, Number.NaN])('refuses the total %d', (total) => {
    expect(() => splitCents(total, 2)).toThrow(RangeError)
  })

  it('refuses zero members', () => {
    expect(() => splitCents(100, 0)).toThrow(RangeError)
  })
})
