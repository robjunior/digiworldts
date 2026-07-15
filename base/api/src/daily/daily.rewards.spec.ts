import { describe, expect, it } from 'vitest';
import {
  DAILY_CYCLE_LENGTH,
  DAILY_REWARDS,
  advanceStreak,
  claimedOnSameDay,
  utcDayKey,
} from './daily.rewards';

/**
 * Pure daily-reward rules (TASK-235, R-40) — plain Vitest, NO DB/HTTP. Proves the
 * framework-free core the service wires to the datastore: the 7-day table is all
 * bankable, the streak advance wraps, and the once-per-UTC-calendar-day gate is correct
 * across a day boundary.
 */
describe('daily.rewards (pure rules)', () => {
  describe('DAILY_REWARDS table', () => {
    it('has exactly 7 entries', () => {
      expect(DAILY_REWARDS).toHaveLength(7);
      expect(DAILY_CYCLE_LENGTH).toBe(7);
    });

    it('every day grants a currently-bankable resource with a positive amount (A-217)', () => {
      // Only Meat / DigiCredits have a spendable ResourceBalance home this slice; every
      // day must credit real spendable value (no not-yet-modeled item grants here).
      const bankable = new Set(['Meat', 'DigiCredits']);
      for (const reward of DAILY_REWARDS) {
        expect(bankable.has(reward.resource)).toBe(true);
        expect(reward.amount).toBeGreaterThan(0);
        expect(Number.isInteger(reward.amount)).toBe(true);
      }
    });
  });

  describe('advanceStreak', () => {
    it('starts a never-claimed player (0) at day 1', () => {
      expect(advanceStreak(0)).toBe(1);
    });

    it('advances 1..6 by one', () => {
      expect(advanceStreak(1)).toBe(2);
      expect(advanceStreak(2)).toBe(3);
      expect(advanceStreak(6)).toBe(7);
    });

    it('wraps day 7 back to day 1', () => {
      expect(advanceStreak(7)).toBe(1);
    });

    it('is total over 0..7 and yields a valid in-range day (never throws)', () => {
      for (let day = 0; day <= 7; day += 1) {
        const next = advanceStreak(day);
        expect(next).toBeGreaterThanOrEqual(1);
        expect(next).toBeLessThanOrEqual(7);
      }
    });

    it('is defensive against out-of-range/corrupt stored values (never throws)', () => {
      // A corrupt persisted streak (negative, huge) can never crash a claim.
      expect(() => advanceStreak(-3)).not.toThrow();
      expect(advanceStreak(-3)).toBeGreaterThanOrEqual(1);
      expect(advanceStreak(-3)).toBeLessThanOrEqual(7);
      expect(advanceStreak(1000)).toBeGreaterThanOrEqual(1);
      expect(advanceStreak(1000)).toBeLessThanOrEqual(7);
    });
  });

  describe('utcDayKey / claimedOnSameDay', () => {
    it('keys an instant by its UTC calendar day (YYYY-MM-DD)', () => {
      expect(utcDayKey(new Date('2026-07-13T23:59:59.999Z'))).toBe('2026-07-13');
      expect(utcDayKey(new Date('2026-07-14T00:00:00.000Z'))).toBe('2026-07-14');
    });

    it('never claimed (null/undefined) is NOT same-day', () => {
      expect(claimedOnSameDay(null, new Date('2026-07-13T10:00:00Z'))).toBe(false);
      expect(claimedOnSameDay(undefined, new Date('2026-07-13T10:00:00Z'))).toBe(false);
    });

    it('two instants on the SAME UTC day are same-day (refuse a second claim)', () => {
      const earlier = new Date('2026-07-13T00:00:01Z');
      const later = new Date('2026-07-13T23:59:59Z');
      expect(claimedOnSameDay(earlier, later)).toBe(true);
    });

    it('across a UTC day boundary is NOT same-day (allow a new claim)', () => {
      const yesterday = new Date('2026-07-13T23:59:59Z');
      const today = new Date('2026-07-14T00:00:00Z');
      expect(claimedOnSameDay(yesterday, today)).toBe(false);
    });
  });
});
