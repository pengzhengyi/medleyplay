import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { downloadUnderWayOf, trackOf } from "../testing/server";
import { useLanguageChoice } from "../locale";
import { Cover } from "./Cover";
import { KindMark } from "./KindMark";
import { LyricsAvailabilityProvider } from "./LyricsAvailabilityProvider";
import { Downloading } from "./Downloading";
import { SongLyricsButton } from "./AlbumLyricsMatch";
import { LyricsBadge } from "./LyricsBadge";

describe("lyrics availability marks", () => {
  it("uses the same quotation for saved song lyrics and opens it from the keyboard", async () => {
    const onOpen = vi.fn();
    const { container } = render(
      <>
        <LyricsBadge label="Lyrics available" />
        <SongLyricsButton
          song="First light"
          saved
          match={{ state: "saved", note: "Saved lyrics." }}
          onOpen={onOpen}
        />
      </>,
    );
    const button = screen.getByRole("button", { name: "Lyrics for First light" });
    const quotation = container.querySelector(".lyrics-badge svg");

    expect(quotation).not.toBeNull();
    expect(button.querySelector("svg")?.innerHTML).toBe(quotation?.innerHTML);
    expect(button).toHaveAccessibleDescription("Saved lyrics.");
    expect(button).toHaveAttribute("title", "Edit lyrics for First light — Saved lyrics.");
    await userEvent.tab();
    expect(button).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    expect(onOpen).toHaveBeenCalledExactlyOnceWith(button);
  });

  it("announces availability once on the kind indicator, not again on its quotation", () => {
    const song = trackOf(1, "First light", { kind_reason: "named", has_lyrics: true });
    const { container } = render(<KindMark kind="song" reason="named" lyrics={song} />);

    expect(screen.getAllByRole("img")).toHaveLength(1);
    expect(screen.getByRole("img", { name: "Song, Lyrics available" })).toHaveAttribute(
      "title",
      "Song, Lyrics available",
    );
    expect(container.querySelector(".lyrics-badge")).toHaveAttribute("aria-hidden", "true");
  });
  it("marks the downloading song next to its title, not on its artwork or progress", () => {
    const track = trackOf(1, "First light", { has_lyrics: true });
    const { container } = render(
      <Downloading
        tracks={[track]}
        downloads={[downloadUnderWayOf(track.id)]}
        admin={false}
        accountId={1}
        cancelDownload={() => Promise.resolve()}
      />,
    );

    expect(container.querySelector(".downloading-title .kind-mark .lyrics-badge")).not.toBeNull();
    expect(container.querySelector(".cover .lyrics-badge")).toBeNull();
    expect(screen.getByRole("progressbar", { name: track.title })).toBeInTheDocument();
  });
  it("names lyrics availability in Simplified Chinese", () => {
    const { result } = renderHook(() => useLanguageChoice());
    const original = result.current[0];
    act(() => {
      result.current[1]("zh-Hans");
    });
    try {
      render(
        <KindMark
          kind="song"
          reason="named"
          lyrics={trackOf(1, "First light", { has_lyrics: true })}
        />,
      );

      expect(screen.queryByRole("img", { name: "有歌词" })).not.toBeInTheDocument();
      expect(screen.getByRole("img", { name: "歌曲，有歌词" })).toHaveAttribute(
        "title",
        "歌曲，有歌词",
      );
    } finally {
      act(() => {
        result.current[1](original);
      });
    }
  });

  it.each([null, "saved-cover"])(
    "marks the song note beside cover %s without taking its click or focus",
    (cover) => {
      const onPlay = vi.fn();
      const track = trackOf(1, "First light", { has_lyrics: true });
      const { container, rerender } = render(
        <button onClick={onPlay}>
          <Cover cover={cover} size="small" />
          <KindMark kind={track.kind} reason={track.kind_reason} lyrics={track} />
        </button>,
      );

      expect(screen.getByRole("img", { name: /Lyrics available/ })).toHaveAttribute(
        "title",
        "Song, guessed from its length, Lyrics available",
      );
      fireEvent.click(screen.getByRole("img", { name: /Lyrics available/ }));
      expect(onPlay).toHaveBeenCalledOnce();
      expect(container.querySelector("[tabindex]")).toBeNull();
      expect(container.querySelector(".cover")).toHaveAttribute("aria-hidden", "true");
      expect(container.querySelector(".cover .lyrics-badge")).toBeNull();
      expect(container.querySelector(".kind-mark .lyrics-badge")).not.toBeNull();

      rerender(
        <KindMark
          kind={track.kind}
          reason={track.kind_reason}
          lyrics={{ ...track, has_lyrics: false }}
        />,
      );

      expect(screen.queryByRole("img", { name: /Lyrics available/ })).not.toBeInTheDocument();
    },
  );

  it("checks the full album, not the single song shown after filtering", () => {
    const first = trackOf(1, "First light", { has_lyrics: true });
    const last = trackOf(2, "Last train");
    const album = { artist: first.artist, album: first.album };
    const shown = <KindMark kind="album" reason="named" lyrics={album} />;
    const { rerender } = render(
      <LyricsAvailabilityProvider tracks={[first, last]}>{shown}</LyricsAvailabilityProvider>,
    );

    expect(screen.queryByRole("img", { name: /All songs have lyrics/ })).not.toBeInTheDocument();

    rerender(
      <LyricsAvailabilityProvider tracks={[first, { ...last, has_lyrics: true }]}>
        {shown}
      </LyricsAvailabilityProvider>,
    );

    expect(screen.getByRole("img", { name: "Album, All songs have lyrics" })).toBeInTheDocument();
  });

  it("does not count a split file twice or infer children from its cover or lyrics", () => {
    const file = trackOf(1, "Blue", { kind: "album", split: true, has_lyrics: true });
    const first = trackOf(2, "First light", { segment_of: 1, has_lyrics: true });
    const last = trackOf(3, "Last train", { segment_of: 1 });
    const shown = (
      <KindMark kind="album" reason="named" lyrics={{ artist: "The Band", album: "Blue" }} />
    );
    const { rerender } = render(
      <LyricsAvailabilityProvider tracks={[file, first, last]}>{shown}</LyricsAvailabilityProvider>,
    );

    expect(screen.queryByRole("img", { name: /All songs have lyrics/ })).not.toBeInTheDocument();

    rerender(
      <LyricsAvailabilityProvider
        tracks={[{ ...file, has_lyrics: false }, first, { ...last, has_lyrics: true }]}
      >
        {shown}
      </LyricsAvailabilityProvider>,
    );

    expect(screen.getByRole("img", { name: "Album, All songs have lyrics" })).toBeInTheDocument();

    rerender(<LyricsAvailabilityProvider tracks={[]}>{shown}</LyricsAvailabilityProvider>);

    expect(screen.queryByRole("img", { name: /All songs have lyrics/ })).not.toBeInTheDocument();
  });

  it("refreshes a retained song representation from the current catalog", () => {
    const old = trackOf(1, "First light");
    render(
      <LyricsAvailabilityProvider tracks={[{ ...old, has_lyrics: true }]}>
        <KindMark kind={old.kind} reason={old.kind_reason} lyrics={old} />
      </LyricsAvailabilityProvider>,
    );

    expect(screen.getByRole("img", { name: /Lyrics available/ })).toBeInTheDocument();
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

  it.each([
    ["song", "length"],
    ["song", "named"],
    ["album", "default"],
    ["album", "split"],
  ] as const)("keeps the %s glyph for reason %s when lyrics become available", (kind, reason) => {
    const track = trackOf(1, "First light", { kind, kind_reason: reason });
    const { container, rerender } = render(<KindMark kind={kind} reason={reason} lyrics={track} />);
    const glyph = container.querySelector(".kind-mark > svg")?.outerHTML;
    expect(glyph).toBeDefined();

    rerender(<KindMark kind={kind} reason={reason} lyrics={{ ...track, has_lyrics: true }} />);

    expect(container.querySelector(".kind-mark > svg")?.outerHTML).toBe(glyph);
    expect(container.querySelector(".kind-mark .lyrics-badge")).not.toBeNull();
  });
});
