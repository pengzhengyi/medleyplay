import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { KnownArtist, SharedName } from "../api";
import { toDoOf } from "../library/cleanUp";
import { serve } from "../testing/server";
import { CleanUpView } from "./CleanUpView";

/** The Library's one artist called *Jay*, not linked to MusicBrainz. */
const JAY = "a".repeat(32);
/** Another of the Library's artists called *Jay*. */
const OTHER_JAY = "b".repeat(32);

function knownArtist(id: string, name: string, disambiguation: string, country: string) {
  return {
    id,
    name,
    sort_name: name,
    disambiguation,
    country,
    aliases: [],
    page: null,
    photo: null,
    photo_page: null,
    shown_as: null,
    about: null,
    own_photo: false,
  } satisfies KnownArtist;
}

const CHOU = knownArtist("c40e", "周杰伦", "", "TW");
const RAPPER = knownArtist("a7a9e", "Jay", "UK rapper", "GB");

/**
 * *Jay*, which MusicBrainz knows two artists by: two songs of *范特西* and one of
 * *Rap Tape*, all by the Library's one Jay.
 */
const AMBIGUOUS: SharedName = {
  name: "Jay",
  artists: [{ artist_id: JAY, musicbrainz_id: null, songs: 3 }],
  known: [CHOU.id, RAPPER.id],
  kept: false,
  waiting: true,
  albums: [
    { album: "范特西", track_ids: [1, 2], artist_id: JAY, confirmed: false },
    { album: "Rap Tape", track_ids: [3], artist_id: JAY, confirmed: false },
  ],
};

/** *Jay*, naming two of the Library's artists: *Rap Tape* chosen for the other, *范特西* not. */
const SEVERAL: SharedName = {
  name: "Jay",
  artists: [
    { artist_id: JAY, musicbrainz_id: CHOU.id, songs: 2 },
    { artist_id: OTHER_JAY, musicbrainz_id: null, songs: 1 },
  ],
  known: [],
  kept: false,
  waiting: true,
  albums: [
    { album: "范特西", track_ids: [1, 2], artist_id: JAY, confirmed: false },
    { album: "Rap Tape", track_ids: [3], artist_id: OTHER_JAY, confirmed: true },
  ],
};

function cleanUp(names: readonly SharedName[]) {
  const reload = vi.fn();
  const view = (current: readonly SharedName[]) => (
    <CleanUpView
      tidy={{ names: [], reload: vi.fn() }}
      artistNames={{ names: { names: [], artists: [CHOU, RAPPER] }, reload: vi.fn() }}
      sharedNames={{ names: current, reload }}
    />
  );
  const { rerender } = render(view(names));
  return {
    reload,
    show: (current: readonly SharedName[]) => {
      rerender(view(current));
    },
  };
}

const section = () => within(screen.getByRole("region", { name: /^Artists sharing a name/u }));

/** Record each body sent to `route`, as `PUT /path`, answering with nothing. */
function recording(route: string): unknown[] {
  const sent: unknown[] = [];
  serve({
    [route]: (body) => {
      sent.push(body);
      return { body: null };
    },
  });
  return sent;
}

/** The artist each album's picker offers, as it reads. */
function offered(album: string): string[] {
  const picker = section().getByRole("combobox", { name: `Who ${album} is by` });
  return within(picker)
    .getAllByRole("option")
    .map((option) => option.textContent);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("telling apart artists who share a name in Clean up", () => {
  it("counts each name waiting", () => {
    expect(
      toDoOf([], undefined, undefined, undefined, [AMBIGUOUS, { ...SEVERAL, waiting: false }]),
    ).toBe(1);
  });

  it("says MusicBrainz knows several artists by a name, and offers them for each album", () => {
    cleanUp([AMBIGUOUS]);

    expect(section().getByText("MusicBrainz knows 2 artists called Jay")).toBeVisible();
    expect(offered("范特西")).toEqual(["Jay, on 范特西", "周杰伦 (TW)", "Jay (UK rapper, GB)"]);
    expect(section().getByRole("combobox", { name: "Who Rap Tape is by" })).toHaveDisplayValue(
      "Jay, on 范特西",
    );
  });

  it("confirms who each album is by, an artist MusicBrainz knows by its id there", async () => {
    const sent = recording("PUT /api/shared-names/albums");
    const { reload } = cleanUp([AMBIGUOUS]);

    await userEvent.selectOptions(
      section().getByRole("combobox", { name: "Who Rap Tape is by" }),
      "Jay (UK rapper, GB)",
    );
    await userEvent.click(
      section().getByRole("button", { name: "Confirm who each album by Jay is by" }),
    );

    expect(sent).toEqual([
      {
        name: "Jay",
        albums: [
          { track_ids: [1, 2], artist_id: JAY },
          { track_ids: [3], musicbrainz_id: RAPPER.id },
        ],
      },
    ]);
    expect(reload).toHaveBeenCalled();
  });

  it("keeps a name naming one artist as one", async () => {
    const sent = recording("POST /api/shared-names/keep");
    cleanUp([AMBIGUOUS]);

    await userEvent.click(section().getByRole("button", { name: "Keep Jay as one artist" }));

    expect(sent).toEqual([{ names: ["Jay"] }]);
  });

  it("keeps an unsaved assignment with its album after the rows reorder", async () => {
    const sent = recording("PUT /api/shared-names/albums");
    const { show } = cleanUp([AMBIGUOUS]);
    await userEvent.selectOptions(
      section().getByRole("combobox", { name: "Who Rap Tape is by" }),
      "Jay (UK rapper, GB)",
    );
    show([{ ...AMBIGUOUS, albums: [...AMBIGUOUS.albums].reverse() }]);

    await userEvent.click(
      section().getByRole("button", { name: "Confirm who each album by Jay is by" }),
    );

    expect(sent).toEqual([
      {
        name: "Jay",
        albums: [
          { track_ids: [3], musicbrainz_id: RAPPER.id },
          { track_ids: [1, 2], artist_id: JAY },
        ],
      },
    ]);
  });

  it("offers a name's own artists by what each is, marking the albums confirmed", () => {
    cleanUp([SEVERAL]);

    expect(section().getByText("Names 2 artists")).toBeVisible();
    expect(offered("Rap Tape")).toEqual(["周杰伦 (TW)", "Jay, on Rap Tape"]);
    const [fantasy, rap] = section().getAllByRole("listitem").slice(1);
    expect(within(fantasy ?? document.body).queryByRole("img", { name: "Confirmed" })).toBeNull();
    expect(within(rap ?? document.body).getByRole("img", { name: "Confirmed" })).toBeVisible();
    expect(section().queryByRole("button", { name: "Keep Jay as one artist" })).toBeNull();
  });

  it("folds a name kept as one away, to undo", async () => {
    const sent = recording("POST /api/shared-names/forget");
    cleanUp([{ ...AMBIGUOUS, kept: true, waiting: false }]);

    await userEvent.click(section().getByText("1 name done"));
    await userEvent.click(
      section().getByRole("button", { name: "Undo keeping Jay as one artist" }),
    );

    expect(sent).toEqual([{ names: ["Jay"] }]);
  });

  it("reports a failed undo and keeps the current decision visible", async () => {
    serve({
      "POST /api/shared-names/forget": { status: 409, body: { detail: "The decision changed." } },
    });
    cleanUp([{ ...AMBIGUOUS, kept: true, waiting: false }]);
    await userEvent.click(section().getByText("1 name done"));

    await userEvent.click(
      section().getByRole("button", { name: "Undo keeping Jay as one artist" }),
    );

    expect(await section().findByRole("alert")).toHaveTextContent(
      "Could not change this name: The decision changed.",
    );
    expect(section().getByText("Kept as one artist")).toBeVisible();
  });

  it("saves a done name only once an album is changed", async () => {
    cleanUp([{ ...SEVERAL, waiting: false }]);
    await userEvent.click(section().getByText("1 name done"));
    const save = section().getByRole("button", { name: "Confirm who each album by Jay is by" });

    const before = save.hasAttribute("disabled");
    await userEvent.selectOptions(
      section().getByRole("combobox", { name: "Who 范特西 is by" }),
      "Jay, on Rap Tape",
    );

    expect([before, save.hasAttribute("disabled")]).toEqual([true, false]);
  });
});
