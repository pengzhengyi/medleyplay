import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { trackOf } from "../testing/server";
import { useLanguageChoice } from "../locale";
import { Cover } from "./Cover";
import { KindMark } from "./KindMark";
import { LyricsAvailabilityProvider } from "./LyricsAvailabilityProvider";

describe("lyrics availability marks", () => {
  it("names lyrics availability in Simplified Chinese", () => {
    const { result } = renderHook(() => useLanguageChoice());
    const original = result.current[0];
    act(() => {
      result.current[1]("zh-Hans");
    });
    try {
      render(
        <Cover
          cover={null}
          size="small"
          lyrics={trackOf(1, "First light", { has_lyrics: true })}
        />,
      );

      expect(screen.getByRole("img", { name: "有歌词" })).toHaveAttribute("title", "有歌词");
    } finally {
      act(() => {
        result.current[1](original);
      });
    }
  });

  it.each([null, "saved-cover"])(
    "marks a song's cover %s without taking its click or focus",
    (cover) => {
      const onPlay = vi.fn();
      const track = trackOf(1, "First light", { has_lyrics: true });
      const { container, rerender } = render(
        <button onClick={onPlay}>
          <Cover cover={cover} size="small" lyrics={track} />
        </button>,
      );

      expect(screen.getByRole("img", { name: "Lyrics available" })).toHaveAttribute(
        "title",
        "Lyrics available",
      );
      fireEvent.click(screen.getByRole("img", { name: "Lyrics available" }));
      expect(onPlay).toHaveBeenCalledOnce();
      expect(container.querySelector("[tabindex]")).toBeNull();

      rerender(<Cover cover={cover} size="small" lyrics={{ ...track, has_lyrics: false }} />);

      expect(screen.queryByRole("img", { name: "Lyrics available" })).not.toBeInTheDocument();
    },
  );

  it("checks the full album, not the single song shown after filtering", () => {
    const first = trackOf(1, "First light", { has_lyrics: true });
    const last = trackOf(2, "Last train");
    const album = { artist: first.artist, album: first.album };
    const shown = <Cover cover={null} size="medium" lyrics={album} />;
    const { rerender } = render(
      <LyricsAvailabilityProvider tracks={[first, last]}>{shown}</LyricsAvailabilityProvider>,
    );

    expect(screen.queryByRole("img", { name: "All songs have lyrics" })).not.toBeInTheDocument();

    rerender(
      <LyricsAvailabilityProvider tracks={[first, { ...last, has_lyrics: true }]}>
        {shown}
      </LyricsAvailabilityProvider>,
    );

    expect(screen.getByRole("img", { name: "All songs have lyrics" })).toBeInTheDocument();
  });

  it("does not count a split file twice or infer children from its cover or lyrics", () => {
    const file = trackOf(1, "Blue", { kind: "album", split: true, has_lyrics: true });
    const first = trackOf(2, "First light", { segment_of: 1, has_lyrics: true });
    const last = trackOf(3, "Last train", { segment_of: 1 });
    const shown = (
      <Cover cover={null} size="medium" lyrics={{ artist: "The Band", album: "Blue" }} />
    );
    const { rerender } = render(
      <LyricsAvailabilityProvider tracks={[file, first, last]}>{shown}</LyricsAvailabilityProvider>,
    );

    expect(screen.queryByRole("img", { name: "All songs have lyrics" })).not.toBeInTheDocument();

    rerender(
      <LyricsAvailabilityProvider
        tracks={[{ ...file, has_lyrics: false }, first, { ...last, has_lyrics: true }]}
      >
        {shown}
      </LyricsAvailabilityProvider>,
    );

    expect(screen.getByRole("img", { name: "All songs have lyrics" })).toBeInTheDocument();

    rerender(<LyricsAvailabilityProvider tracks={[]}>{shown}</LyricsAvailabilityProvider>);

    expect(screen.queryByRole("img", { name: "All songs have lyrics" })).not.toBeInTheDocument();
  });

  it("refreshes a retained song representation from the current catalog", () => {
    const old = trackOf(1, "First light");
    render(
      <LyricsAvailabilityProvider tracks={[{ ...old, has_lyrics: true }]}>
        <Cover cover={null} size="small" lyrics={old} />
      </LyricsAvailabilityProvider>,
    );

    expect(screen.getByRole("img", { name: "Lyrics available" })).toBeInTheDocument();
  });

  it("preserves a guessed song mark and names its available lyrics", () => {
    const song = trackOf(1, "First light", { has_lyrics: true });
    const { container } = render(<KindMark kind="song" reason="length" lyrics={song} />);

    expect(
      screen.getByRole("img", { name: /Song, guessed from its length.*Lyrics available/ }),
    ).toBeInTheDocument();
    expect(container.querySelector(".kind-mark")).toHaveClass("guessed");
    expect(container.querySelectorAll(".lyrics-badge")).toHaveLength(1);
  });
});
