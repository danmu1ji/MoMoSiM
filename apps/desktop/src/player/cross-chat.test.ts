import { beforeEach, describe, expect, it } from 'vitest';
import { clearCrossChatConversation, crossChatConsentGeneration, hasFollowUpJob, loadFollowUpJobs, loadSharedContext, scheduleFollowUps, setCrossChatEnabled, takeDueFollowUpJobs } from './cross-chat';

function installLocalStorage() {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  } });
}

const context = { world: 'world-id', worldName: 'World Name', updatedAt: new Date().toISOString(), currentConversationId: 'ba-a', timeSlice: 'slice-id', timeSliceLabel: 'Chapter 1', location: 'School', activity: 'Talking', recentText: 'Recent text' };

describe('cross-chat scheduling', () => {
  beforeEach(() => installLocalStorage());

  it('bounds the plan count and enforces a 60-second minimum after timer start', () => {
    setCrossChatEnabled(true);
    scheduleFollowUps({ world: context.world, sourceConversationId: 'ba-a', context, plans: Array.from({ length: 4 }, (_, index) => ({ characterId: `c${index}`, characterName: `C${index}`, startAfterMinutes: 0, waitMinutes: 0, intent: 'check in' })) });
    const jobs = loadFollowUpJobs();
    expect(jobs).toHaveLength(3);
    expect(jobs.every(job => job.world === 'world-id' && job.waitMinutes === 1 && job.dueAt - job.timerStartsAt === 60_000)).toBe(true);
    expect(takeDueFollowUpJobs(Date.now() + 60_000, 'world-id')).toHaveLength(3);
  });

  it('does not claim due jobs for another world', () => {
    setCrossChatEnabled(true);
    scheduleFollowUps({ world: context.world, sourceConversationId: 'ba-a', context, plans: [{ characterId: 'c1', characterName: 'C1', startAfterMinutes: 0, waitMinutes: 1, intent: 'check in' }] });
    expect(takeDueFollowUpJobs(Date.now() + 60_000, 'other-world')).toEqual([]);
    expect(hasFollowUpJob(loadFollowUpJobs()[0].id)).toBe(true);
  });

  it('clears a reset chat only from its own world', () => {
    setCrossChatEnabled(true);
    scheduleFollowUps({ world: 'world-one', sourceConversationId: 'ba-a', context: { ...context, world: 'world-one' }, plans: [{ characterId: 'c1', characterName: 'C1', startAfterMinutes: 0, waitMinutes: 1, intent: 'world one' }] });
    scheduleFollowUps({ world: 'world-two', sourceConversationId: 'ba-a', context: { ...context, world: 'world-two' }, plans: [{ characterId: 'c1', characterName: 'C1', startAfterMinutes: 0, waitMinutes: 1, intent: 'world two' }] });
    clearCrossChatConversation('ba-a', 'world-one');
    expect(loadFollowUpJobs().map(job => job.world)).toEqual(['world-two']);
  });

  it('clears target jobs for every participant in a reset group chat', () => {
    setCrossChatEnabled(true);
    scheduleFollowUps({ world: 'world-one', sourceConversationId: 'ba-x', context: { ...context, world: 'world-one' }, plans: [{ characterId: 'c1', characterName: 'C1', startAfterMinutes: 0, waitMinutes: 1, intent: 'one' }] });
    scheduleFollowUps({ world: 'world-two', sourceConversationId: 'ba-y', context: { ...context, world: 'world-two' }, plans: [{ characterId: 'c2', characterName: 'C2', startAfterMinutes: 0, waitMinutes: 1, intent: 'two' }] });
    clearCrossChatConversation('ba-c1+c2', 'world-one');
    expect(loadFollowUpJobs().map(job => job.world)).toEqual(['world-two']);
  });

  it('clears context and queued jobs on opt-out and invalidates in-flight consent', () => {
    setCrossChatEnabled(true);
    const generation = crossChatConsentGeneration();
    scheduleFollowUps({ world: context.world, sourceConversationId: 'ba-a', context, plans: [{ characterId: 'c1', characterName: 'C1', startAfterMinutes: 0, waitMinutes: 1, intent: 'check in' }] });
    setCrossChatEnabled(false);
    setCrossChatEnabled(true);
    expect(crossChatConsentGeneration()).toBeGreaterThan(generation);
    expect(loadFollowUpJobs()).toEqual([]);
    expect(loadSharedContext()).toBeUndefined();
  });

  it('expires stale shared context', () => {
    localStorage.setItem('world-player.cross-chat.context.v1', JSON.stringify({ ...context, updatedAt: '2000-01-01T00:00:00.000Z' }));
    expect(loadSharedContext()).toBeUndefined();
  });
});
