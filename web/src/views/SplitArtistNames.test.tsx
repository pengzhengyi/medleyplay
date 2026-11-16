import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ArtistSplitOffer, ArtistSplits } from "../api";
import { toDoOf } from "../library/cleanUp";
import { serve } from "../testing/server";
import { CleanUpView } from "./CleanUpView";

/** *GUMI/MAYU*, which two songs show: GUMI and MAYU. */
const DUET: ArtistSplitOffer = {
  written: "GUMI/MAYU",
  artists: [
    { written: "GUMI", role: "main" },
    { written: "MAYU", role: "main" },
  ],
  songs: 2,
  linked: false,
};

/** *スズム feat. GUMI*, which one song shows: スズム, featuring GUMI. */
const FEATURING: ArtistSplitOffer = {
  written: "スズム feat. GUMI",
  artists: [
    { written: "スズム", role: "main" },
    { written: "GUMI", role: "featured" },
  ],
  songs: 1,
  linked: false,
};

/** *初音ミク/米津玄師*, linked to one MusicBrainz artist, so maybe one artist after all. */
const LINKED: ArtistSplitOffer = {
  written: "初音ミク/米津玄師",
  artists: [
    { written: "初音ミク", role: "main" },
    { written: "米津玄師", role: "main" },
  ],
  songs: 1,
  linked: true,
};

function cleanUp(splits: ArtistSplits) {
  const reload = vi.fn();
  render(
    <CleanUpView
      tidy={{ names: [], reload: vi.fn() }}
      artistNames={undefined}
      artistSplits={{ names: splits, reload }}
    />,
  );
  return { reload };
}

const section = () => within(screen.getByRole("region", { name: /^Split artist names/u }));

/** Record each body posted to `path`, answering with nothing. */
function recording(path: string): unknown[] {
  const sent: unknown[] = [];
  serve({
    [`POST ${path}`]: (body) => {
      sent.push(body);
      return { body: null };
    },
  });
  return sent;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("splitting artist names in Clean up", () => {
  it("counts each name offered", () => {
    expect(toDoOf([], undefined, undefined, { offers: [DUET, FEATURING], decided: [] })).toBe(2);
  });

  it("offers each name with its songs and the artists it lists, featured ones marked", () => {
    cleanUp({ offers: [DUET, FEATURING], decided: [] });

    const rows = section().getAllByRole("listitem");
    const capsules = rows.map((row) =>
      [...row.querySelectorAll(".split-name-artist")].map((each) => each.textContent),
    );
    expect(capsules).toEqual([
      ["GUMI", "MAYU"],
      ["スズム", "feat.GUMI"],
    ]);
    expect(within(rows[0] ?? document.body).getByText("2 songs")).toBeVisible();
  });

  it("splits a name into its artists", async () => {
    const sent = recording("/api/artist-splits/split");
    const { reload } = cleanUp({ offers: [DUET], decided: [] });

    await userEvent.click(
      section().getByRole("button", { name: "Split GUMI/MAYU into GUMI and MAYU" }),
    );

    expect(sent).toEqual([{ names: ["GUMI/MAYU"] }]);
    expect(reload).toHaveBeenCalled();
  });

  it("keeps a name as written", async () => {
    const sent = recording("/api/artist-splits/keep");
    cleanUp({ offers: [DUET], decided: [] });

    await userEvent.click(section().getByRole("button", { name: "Keep GUMI/MAYU as written" }));

    expect(sent).toEqual([{ names: ["GUMI/MAYU"] }]);
  });

  it("splits every name not linked to one artist at once, and says a linked one may be one", async () => {
    const sent = recording("/api/artist-splits/split");
    cleanUp({ offers: [DUET, LINKED, FEATURING], decided: [] });

    await userEvent.click(section().getByRole("button", { name: "Split all" }));

    expect(sent).toEqual([{ names: ["GUMI/MAYU", "スズム feat. GUMI"] }]);
    expect(section().getByText(/Linked to one artist/u)).toBeVisible();
  });

  it("lists the names decided, and undoes one so it is offered again", async () => {
    const sent = recording("/api/artist-splits/forget");
    cleanUp({ offers: [], decided: [{ written: "GUMI/MAYU", split: true }] });

    await userEvent.click(section().getByText("1 name decided"));
    await userEvent.click(section().getByRole("button", { name: "Undo splitting GUMI/MAYU" }));

    expect(sent).toEqual([{ names: ["GUMI/MAYU"] }]);
  });
});
