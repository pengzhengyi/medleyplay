import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type Routes, serve } from "../testing/server";
import { recordPlay, sendPlays, updatePlay } from "./plays";
import type { Play } from "./storage";

/** The outbox, as IndexedDB would keep it, by play id. */
const outbox = new Map<string, Play>();

vi.mock("./storage", () => ({
  keepPlay: (play: Play) => {
    outbox.set(play.id, play);
    return Promise.resolve();
  },
  keptPlays: () => Promise.resolve([...outbox.values()]),
  forgetPlay: (id: string) => {
    outbox.delete(id);
    return Promise.resolve();
  },
  keepPlayTime: (id: string, listenedMs: number) => {
    const kept = outbox.get(id);
    if (kept !== undefined) {
      outbox.set(id, { ...kept, listenedMs: Math.max(kept.listenedMs ?? 0, listenedMs) });
    }
    return Promise.resolve(outbox.get(id));
  },
  settlePlay: (sent: Play) => {
    const kept = outbox.get(sent.id);
    if (kept !== undefined && (kept.listenedMs ?? 0) <= (sent.listenedMs ?? 0)) {
      outbox.delete(sent.id);
    } else if (kept !== undefined) {
      outbox.set(sent.id, { ...kept, recorded: true });
    }
    return Promise.resolve();
  },
}));

const PLAY: Play = {
  id: "00000000-0000-4000-8000-000000000001",
  trackId: 7,
  playedAt: "2026-11-09T12:00:00Z",
  listenedMs: 90_000,
};

/** Serve every play request with `answer`, and return the bodies sent, by route. */
function servingPlays(answer: { status?: number } = {}) {
  const sent: [string, unknown][] = [];
  const noting = (route: string) => (body: unknown) => {
    sent.push([route, body]);
    return answer.status === undefined ? { status: 204 } : answer;
  };
  const routes: Routes = {
    [`PUT /api/plays/${PLAY.id}`]: (body) => {
      sent.push(["record", body]);
      return answer.status === undefined ? { body: {} } : answer;
    },
    [`PUT /api/plays/${PLAY.id}/listened`]: noting("listened"),
  };
  serve(routes);
  return sent;
}

beforeEach(() => {
  outbox.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("sending plays", () => {
  it("records a play with the time it was listened to, then forgets it", async () => {
    const sent = servingPlays();

    await recordPlay(PLAY);

    expect(sent).toEqual([
      ["record", { track_id: 7, played_at: PLAY.playedAt, listened_ms: 90_000 }],
    ]);
    expect(outbox.size).toBe(0);
  });

  it("sends a recorded play's later time on its own, never recording it again", async () => {
    const sent = servingPlays();
    await recordPlay(PLAY);

    await updatePlay(PLAY, 150_000);

    expect(sent.at(-1)).toEqual(["listened", { listened_ms: 150_000 }]);
    expect(outbox.size).toBe(0);
  });

  it("keeps a play the server couldn't take, and records it later with its latest time", async () => {
    servingPlays({ status: 503 });
    await recordPlay(PLAY);
    await updatePlay(PLAY, 150_000);
    const sent = servingPlays();

    await sendPlays();

    expect(sent).toEqual([
      ["record", { track_id: 7, played_at: PLAY.playedAt, listened_ms: 150_000 }],
    ]);
    expect(outbox.size).toBe(0);
  });

  it("forgets a time for a play the server no longer has", async () => {
    const sent = servingPlays({ status: 404 });

    await updatePlay(PLAY, 150_000);

    expect(sent).toEqual([["listened", { listened_ms: 150_000 }]]);
    expect(outbox.size).toBe(0);
  });
});
