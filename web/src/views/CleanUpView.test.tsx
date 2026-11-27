import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ArtistNames, NameToTidy } from "../api";
import { artistNameOf } from "../testing/server";
import { toDoOf } from "../library/cleanUp";
import { CleanUpView } from "./CleanUpView";
import { LanguageSelect } from "./LanguageSelect";

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

afterEach(() => {
  vi.restoreAllMocks();
});

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

  it("explains the Chinese cleanup totals and preserves the suggested name", async () => {
    render(
      <CleanUpView
        tidy={{ names: [JAY], reload: vi.fn() }}
        artistNames={{ names: namesOf(artistNameOf("Blue Room")), reload: vi.fn() }}
      />,
    );
    const language = render(<LanguageSelect />).getByRole("combobox", { name: "Language" });
    const user = userEvent.setup();

    try {
      await user.selectOptions(language, "zh-Hans");

      expect(screen.getByRole("heading", { name: "整理" })).toBeVisible();
      expect(screen.getByText("1 个名称待整理，1 个名称待关联")).toBeVisible();
      const sections = within(screen.getByRole("navigation", { name: "整理分类" }));
      expect(sections.getByRole("button", { name: "前往「整理名称」，1 项待处理" })).toBeVisible();
      const tidy = within(screen.getByRole("list", { name: "待整理的名称" }));
      expect(
        tidy.getByRole("button", { name: "将「周杰伦2000年发行首张个人」整理为「周杰伦」" }),
      ).toBeVisible();
      expect(screen.getByText(/缺少年份的歌曲/u)).toBeVisible();
    } finally {
      await user.selectOptions(language, "auto");
    }
  });

  it("goes to each section from a bar, saying how many names each has waiting", async () => {
    render(
      <CleanUpView
        tidy={{ names: [JAY], reload: vi.fn() }}
        artistNames={{ names: namesOf(artistNameOf("Beatles", "b10bbbfc")), reload: vi.fn() }}
      />,
    );
    const bar = screen.getByRole("navigation", { name: "Clean up sections" });
    const scrolled = vi.spyOn(Element.prototype, "scrollIntoView");

    const user = userEvent.setup();
    within(bar).getByRole("button", { name: "Go to Link artist names, done" }).focus();
    await user.keyboard("{Enter}");

    expect(
      within(bar)
        .getAllByRole("button")
        .map((button) => button.getAttribute("aria-label")),
    ).toEqual(["Go to Tidy names, 1 waiting", "Go to Link artist names, done"]);
    expect(scrolled.mock.contexts).toEqual([document.getElementById("clean-up-link")]);
    expect(document.getElementById("clean-up-link")).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "Unlink Beatles" })).toHaveFocus();
  });

  it("does not mark missing album artwork done when there is no suggestion to review", () => {
    render(
      <CleanUpView
        tidy={{ names: [], reload: vi.fn() }}
        artistNames={undefined}
        missingCovers={{
          albums: [
            {
              album: "Night Drive",
              artist: "Trio",
              songs: 1,
              suggested: null,
              picked: false,
              found: true,
              finding: false,
            },
          ],
          reload: vi.fn(),
          answered: 1,
        }}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Go to Find album covers, no suggestions to review" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Go to Find album covers, done" }),
    ).not.toBeInTheDocument();
  });

  it("says there is nothing to clean up, and what would show here", () => {
    render(<CleanUpView tidy={{ names: [], reload: vi.fn() }} artistNames={undefined} />);

    expect(screen.getByText(/^Nothing to clean up\./)).toBeInTheDocument();
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
  });
});
