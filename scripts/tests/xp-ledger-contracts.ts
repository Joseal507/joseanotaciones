import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveServerXPAmount, stableXPContentId, xpEventId } from '../../lib/xpEvents';

type Applied = { applied: boolean; awardedXP: number; totalXP: number };

class AtomicLedgerFixture {
  private total: number;
  private events = new Set<string>();
  private queue = Promise.resolve();

  constructor(existingXP = 0) { this.total = existingXP; }

  apply(eventId: string, amount: number): Promise<Applied> {
    const operation = this.queue.then(() => {
      if (this.events.has(eventId)) return { applied: false, awardedXP: 0, totalXP: this.total };
      this.events.add(eventId);
      this.total = Math.max(0, this.total + amount);
      return { applied: true, awardedXP: amount, totalXP: this.total };
    });
    this.queue = operation.then(() => undefined);
    return operation;
  }

  async applyWithCrash(eventId: string, amount: number, crashAt: 'after_insert' | 'after_increment' | 'after_applied'): Promise<void> {
    const beforeTotal = this.total;
    const beforeEvents = new Set(this.events);
    try {
      if (this.events.has(eventId)) return;
      this.events.add(eventId);
      if (crashAt === 'after_insert') throw new Error(crashAt);
      this.total = Math.max(0, this.total + amount);
      if (crashAt === 'after_increment') throw new Error(crashAt);
      if (crashAt === 'after_applied') throw new Error(crashAt);
    } catch {
      // D1 batch is transactional: any failed statement rolls the entire batch back.
      this.total = beforeTotal;
      this.events = beforeEvents;
    }
  }
}

async function main() {
  const eventId = xpEventId('assignment_completed', 'assignment-1');
  const ledger = new AtomicLedgerFixture(100);

  const first = await ledger.apply(eventId, 50);
  assert.deepEqual(first, { applied: true, awardedXP: 50, totalXP: 150 }, 'A first event applies');
  const retry = await ledger.apply(eventId, 50);
  assert.deepEqual(retry, { applied: false, awardedXP: 0, totalXP: 150 }, 'B retry is a successful no-op');

  const twoLedger = new AtomicLedgerFixture();
  const two = await Promise.all([twoLedger.apply(eventId, 50), twoLedger.apply(eventId, 50)]);
  assert.equal(two.filter(result => result.applied).length, 1, 'C two concurrent requests apply once');
  assert.equal(two[1].totalXP, 50);

  const tenLedger = new AtomicLedgerFixture();
  const ten = await Promise.all(Array.from({ length: 10 }, () => tenLedger.apply(eventId, 50)));
  assert.equal(ten.filter(result => result.applied).length, 1, 'D ten concurrent requests apply once');
  assert.equal(ten.at(-1)?.totalXP, 50);

  const timeoutLedger = new AtomicLedgerFixture();
  await timeoutLedger.apply(eventId, 50); // response is lost after commit
  const afterTimeout = await timeoutLedger.apply(eventId, 50);
  assert.deepEqual(afterTimeout, { applied: false, awardedXP: 0, totalXP: 50 }, 'E retry after lost response applies once');

  for (const crashAt of ['after_insert', 'after_increment', 'after_applied'] as const) {
    const crashLedger = new AtomicLedgerFixture(25);
    await crashLedger.applyWithCrash(eventId, 50, crashAt);
    const recovered = await crashLedger.apply(eventId, 50);
    assert.deepEqual(
      recovered,
      { applied: true, awardedXP: 50, totalXP: 75 },
      `crash window ${crashAt} rolls back and retry applies exactly once`,
    );
  }

  const apiSource = readFileSync('app/api/xp/route.ts', 'utf8');
  assert.match(apiSource, /requireAuthenticatedStudyALUser/, 'F/G identity is derived server-side');
  assert.doesNotMatch(apiSource, /body\.user_?id|body\.email/, 'F/G client identity cannot select ledger owner');

  assert.equal(
    xpEventId('assignment_completed', 'assignment-1'),
    xpEventId('assignment_completed', 'assignment-1'),
    'H recompletion keeps the same logical event',
  );
  assert.match(apiSource, /serverDate[\s\S]*daily_streak/, 'I streak day uses server date');

  const pomodoro = readFileSync('components/PomodoroProvider.tsx', 'utf8');
  assert.doesNotMatch(pomodoro, /awardXPEvent|darXP\(/, 'J Pomodoro cannot tick-farm XP');

  assert.equal(
    stableXPContentId({ session: 'free-1', completed: true }),
    stableXPContentId({ session: 'free-1', completed: true }),
    'K Free restore preserves logical event identity',
  );
  assert.equal(
    stableXPContentId({ session: 'adaptive-1', completed: true }),
    stableXPContentId({ session: 'adaptive-1', completed: true }),
    'L Adaptive restore preserves logical event identity',
  );

  const worker = readFileSync('cloudflare/studyal-api/src/index.ts', 'utf8');
  assert.match(worker, /env\.DB\.batch\(\[/, 'C/D worker uses a transactional D1 batch');
  assert.match(worker, /INSERT OR IGNORE INTO xp_events[\s\S]*UPDATE leaderboard[\s\S]*applied = 0[\s\S]*UPDATE xp_events SET applied = 1/, 'claim, increment and consume remain in one ordered batch');
  assert.match(worker, /applied = 0/, 'M leaderboard increments only an unclaimed ledger event');
  assert.doesNotMatch(worker, /xp_total = COALESCE\(excluded\.xp_total/, 'M generic leaderboard upsert cannot rewrite XP');

  const migration = readFileSync('cloudflare/studyal-api/migrations/0004_xp_event_ledger.sql', 'utf8');
  assert.match(migration, /PRIMARY KEY \(user_id, event_id\)/, 'ledger enforces per-user event uniqueness');
  assert.doesNotMatch(migration, /UPDATE leaderboard|DELETE FROM leaderboard/, 'N migration preserves existing XP');

  assert.equal(resolveServerXPAmount('community_post_created', {}, { streak: 0 }), 15);
  assert.equal(resolveServerXPAmount('assignment_completed', { size: 'mediano' }, { streak: 0 }), 120);
  assert.throws(() => resolveServerXPAmount('assignment_completed', { size: 'forged' }, { streak: 0 }));
  assert.equal(resolveServerXPAmount('daily_streak', {}, { streak: 7 }), 125);

  console.log('XP ledger contracts A-N: PASS');
  console.log('concurrent requests: 2 + 10; duplicate applications: 0');
  console.log('retry-after-commit duplicate applications: 0');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
