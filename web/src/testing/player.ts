/**
 * @file Stand-ins for the player and the sleep timer, recording what is asked of them.
 */

import { vi } from "vitest";

import { EMPTY, type Queue } from "../player/queue";
import type { Player } from "../player/usePlayer";
import type { SleepTimer } from "../player/useSleepTimer";

/**
 * A player playing the first of two entries, `a` and `b`, of Tracks 1 and 2, 12.5 s
 * in, unless `change` says otherwise; each action is a spy.
 */
export function playerOf(change: Partial<Player> = {}): Player {
  const queue: Queue = {
    ...EMPTY,
    entries: [
      { key: "a", trackId: 1 },
      { key: "b", trackId: 2 },
    ],
  };
  return {
    queue,
    status: { kind: "playing" },
    shuffled: false,
    repeat: "off",
    position: 12.5,
    duration: 200,
    volume: 0.8,
    muted: false,
    playList: vi.fn(),
    playAll: vi.fn(),
    playNext: vi.fn(),
    add: vi.fn(),
    toggle: vi.fn(),
    pause: vi.fn(),
    next: vi.fn(),
    previous: vi.fn(),
    seek: vi.fn(),
    move: vi.fn(),
    remove: vi.fn(),
    clear: vi.fn(),
    shuffle: vi.fn(),
    setRepeat: vi.fn(),
    setVolume: vi.fn(),
    setMuted: vi.fn(),
    handoff: vi.fn(),
    take: vi.fn(),
    ...change,
  };
}

/** A sleep timer that is off, unless `change` says otherwise; starting and stopping are spies. */
export function sleepTimerOf(change: Partial<SleepTimer> = {}): SleepTimer {
  return { endsAt: null, setAt: null, start: vi.fn(), stop: vi.fn(), ...change };
}
