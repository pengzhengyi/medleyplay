import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { detailsOf } from "../testing/server";
import { type Origins, type Shown, changesOf, shownOf } from "./details";

/** The cases the server's own rule is checked against too, in `tests/support`. */
interface Shared {
  readonly cases: readonly { name: string; origins: Origins; shown: Shown }[];
}

const SHARED = JSON.parse(
  readFileSync(join(__dirname, "../../../tests/support/shown_details.json"), "utf8"),
) as Shared;

describe("what a Track shows", () => {
  it.each(SHARED.cases.map((each) => [each.name, each] as const))(
    "%s, as the server shows it",
    (_, { origins, shown }) => {
      expect(shownOf(origins)).toEqual(shown);
    },
  );
});

describe("saving a confirmed single", () => {
  it("keeps only the explicitly confirmed blank album", () => {
    const details = detailsOf(7, {}, { files: { title: "Single" } });
    const own = { album: "", artist: "", genre: "" };

    expect(changesOf(details, own)).toEqual({});
    expect(changesOf(details, own, true)).toEqual({ album: "" });
  });

  it("does not replace a later album edit with the single choice", () => {
    const details = detailsOf(7, {}, { files: { title: "Single" } });

    expect(changesOf(details, { album: "Sessions" }, true)).toEqual({ album: "Sessions" });
  });
});
