import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ArtistNames, NameToTidy } from "../api";
import { artistNameOf } from "../testing/server";
import { toDoOf } from "../library/cleanUp";
import { CleanUpView } from "./CleanUpView";

/** 周杰伦's first album, written into the artist of one song. */
const JAY: NameToTidy = {
  kind: "artist",
  written: "周杰伦2000年发行首张个人",
  name: "周杰伦",
  year: 2000,
  fields: ["artist"],
  track_ids: [11],
  years_differ: 0,
};

const namesOf = (...names: ArtistNames["names"]): ArtistNames => ({ names, artists: [] });

describe("cleaning up names", () => {
  it("counts the names to tidy and those that may be linked and are not", () => {
    const names = namesOf(artistNameOf("Blue Room"), artistNameOf("Beatles", "b10bbbfc"), {
      ...artistNameOf("群星"),
      look_up: "never",
    });

    expect(toDoOf([JAY], names)).toBe(2);
    expect(toDoOf([], undefined)).toBe(0);
  });

  it("shows a section for each kind of change waiting, with how many wait in all", () => {
    render(
      <CleanUpView
        tidy={{ names: [JAY], reload: vi.fn() }}
        artistNames={{ names: namesOf(artistNameOf("Blue Room")), reload: vi.fn() }}
      />,
    );

    expect(screen.getByRole("heading", { name: "Clean up" })).toBeInTheDocument();
    expect(screen.getByText("1 name to tidy, 1 to link")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: /Tidy names/ })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: /Link artist names/ })).toBeInTheDocument();
  });

  it("says there is nothing to clean up, and what would show here", () => {
    render(<CleanUpView tidy={{ names: [], reload: vi.fn() }} artistNames={undefined} />);

    expect(screen.getByText(/^Nothing to clean up\./)).toBeInTheDocument();
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
  });
});
