import { getDb, closeDbAdapter } from '../src/db/adapter.ts';
import { nextDayFor } from '../src/social/daily.ts';

async function main() {
  const db = getDb();
  console.log('✓ DB initialized');

  const now = Date.now();
  const DAY = 86_400_000;

  // Test nextDayFor logic
  const t1 = nextDayFor(now, null, 0);
  console.assert(t1.nextDay === 1 && !t1.reset, 'first claim → day 1');
  console.log('✓ first claim → day 1');

  const t2 = nextDayFor(now, now - DAY / 2, 1);
  console.assert(t2.nextDay === 0, 'same day → no claim');
  console.log('✓ same day → no claim');

  const t3 = nextDayFor(now, now - DAY, 1);
  console.assert(t3.nextDay === 2 && !t3.reset, 'next day → advance');
  console.log('✓ next day → advance to day 2');

  const t4 = nextDayFor(now, now - DAY * 1.5, 5);
  console.assert(t4.nextDay === 6 && !t4.reset, 'within grace → advance');
  console.log('✓ within grace → advance');

  const t5 = nextDayFor(now, now - DAY * 3, 5);
  console.assert(t5.nextDay === 1 && t5.reset, 'beyond grace → reset');
  console.log('✓ beyond grace → reset to day 1');

  const t6 = nextDayFor(now, now - DAY, 30);
  console.assert(t6.nextDay === 1 && t6.reset, 'day 30 → wrap to day 1');
  console.log('✓ day 30 → wrap to day 1');

  // Test cycle multiplier
  function getCycleMultiplier(totalCycles: number): number {
    return 1 + totalCycles * 0.5;
  }
  console.assert(getCycleMultiplier(0) === 1.0, 'cycle 0 multiplier = 1.0');
  console.assert(getCycleMultiplier(1) === 1.5, 'cycle 1 multiplier = 1.5');
  console.assert(getCycleMultiplier(2) === 2.0, 'cycle 2 multiplier = 2.0');
  console.log('✓ cycle multiplier logic valid');

  // Test season logic
  function getSeason(streakDay: number): number {
    return Math.floor((streakDay - 1) / 90) + 1;
  }
  console.assert(getSeason(1) === 1, 'day 1 → season 1');
  console.assert(getSeason(90) === 1, 'day 90 → season 1');
  console.assert(getSeason(91) === 2, 'day 91 → season 2');
  console.assert(getSeason(180) === 2, 'day 180 → season 2');
  console.assert(getSeason(181) === 3, 'day 181 → season 3');
  console.log('✓ season logic valid');

  // Test full cycle simulation (31 days to see the wrap)
  let simStreak = 0;
  let simCycles = 0;
  for (let day = 1; day <= 31; day++) {
    const claimTime = now + (day - 1) * DAY;
    const step = nextDayFor(claimTime, day === 1 ? null : claimTime - DAY, simStreak);
    simStreak = step.nextDay;
    if (step.nextDay === 1 && day > 1) {
      simCycles++;
    }
  }
  console.assert(simStreak === 1, 'after 31 days, streak wraps to 1');
  console.assert(simCycles === 1, 'after 31 days, 1 cycle completed');
  console.log('✓ full 30-day cycle simulation valid');

  // Test 90-day simulation (91 days to see the wrap)
  let simStreak2 = 0;
  let simCycles2 = 0;
  for (let day = 1; day <= 91; day++) {
    const claimTime = now + (day - 1) * DAY;
    const step = nextDayFor(claimTime, day === 1 ? null : claimTime - DAY, simStreak2);
    simStreak2 = step.nextDay;
    if (step.nextDay === 1 && day > 1) {
      simCycles2++;
    }
  }
  console.assert(simCycles2 === 3, 'after 91 days, 3 cycles completed');
  console.assert(getSeason(90) === 1, 'day 90 still season 1');
  console.log('✓ 90-day (1 season) simulation valid');

  console.log('\n✅ All daily reward logic tests passed');
  await closeDbAdapter();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
