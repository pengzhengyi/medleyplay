import { afterEach, describe, expect, it, vi } from "vitest";

import type { Settings } from "../api";
import { serve, settingsOf } from "../testing/server";
import { saveChange } from "./householdSettings";

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The settings as first read: no limit, no lyrics sites turned on, at revision 2. */
const HELD: Settings = settingsOf({ revision: 2 });

describe("saving one setting over another's save", () => {
  it("saves a list over a save that changed another field, the list read again unchanged", async () => {
    const sent: unknown[] = [];
    serve({
      "PUT /api/settings": (body) => {
        sent.push(body);
        return sent.length === 1
          ? { status: 409, body: { detail: "Saved since revision 2." } }
          : { body: { ...HELD, storage_limit: 5, lyrics_sites: ["netease"], revision: 4 } };
      },
      "GET /api/settings": { body: { ...HELD, storage_limit: 5, lyrics_sites: [], revision: 3 } },
    });

    const saved = await saveChange(HELD, { lyrics_sites: ["netease"] });

    expect(saved.outcome).toBe("saved");
    expect(sent.at(-1)).toEqual({
      ...HELD,
      storage_limit: 5,
      lyrics_sites: ["netease"],
      revision: 3,
    });
  });

  it("gives way when the other save changed the same list", async () => {
    serve({
      "PUT /api/settings": { status: 409, body: { detail: "Saved since revision 2." } },
      "GET /api/settings": { body: { ...HELD, lyrics_sites: ["netease"], revision: 3 } },
    });

    const saved = await saveChange(HELD, { lyrics_sites: [] as const });

    expect(saved.outcome).toBe("conflict");
  });
});
