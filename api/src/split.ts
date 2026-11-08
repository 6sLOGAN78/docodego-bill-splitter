/**
 * Splits a total between members, in the order they were added.
 *
 * Everyone gets the same base amount. The cents that are left over go one by one
 * to the first members. Example: 1000 between 3 gives [334, 333, 333].
 * The result always adds up to `totalCents`.
 */
export function splitCents(totalCents: number, memberCount: number): number[] {
  if (!Number.isSafeInteger(totalCents) || totalCents <= 0) {
    throw new RangeError('totalCents must be a positive whole number')
  }
  if (!Number.isSafeInteger(memberCount) || memberCount <= 0) {
    throw new RangeError('memberCount must be a positive whole number')
  }

  const base = Math.floor(totalCents / memberCount)
  const remainder = totalCents % memberCount

  return Array.from({ length: memberCount }, (_, index) => base + (index < remainder ? 1 : 0))
}
