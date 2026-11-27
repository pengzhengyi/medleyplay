import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { openWithShortcuts } from "../testing/server";
import { type ShortcutHandlers, Shortcuts } from "./Shortcuts";

/** A handler for every command, each one a spy. */
function spies() {
  return {
    toggle: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    previous: vi.fn(),
    next: vi.fn(),
    previousAlbum: vi.fn(),
    nextAlbum: vi.fn(),
    volumeDown: vi.fn(),
    volumeUp: vi.fn(),
    mute: vi.fn(),
    shuffle: vi.fn(),
    repeat: vi.fn(),
    favorite: vi.fn(),
    search: vi.fn(),
    queue: vi.fn(),
    nowPlaying: vi.fn(),
    help: vi.fn(),
  } satisfies ShortcutHandlers;
}

/** The shortcuts listening on a page holding `page`. */
function listening(page?: ReactNode) {
  const on = spies();
  render(
    <>
      <Shortcuts on={on} />
      {page}
    </>,
  );
  return on;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the keyboard shortcuts", () => {
  it("play or pause with K", async () => {
    const on = listening();

    await userEvent.keyboard("k");

    expect(on.toggle).toHaveBeenCalledOnce();
  });

  it("leave browser scrolling and Quick Find keys alone by default", () => {
    const on = listening();

    const scrolled = fireEvent.keyDown(document.body, { code: "Space", key: " " });
    const found = fireEvent.keyDown(document.body, { code: "Slash", key: "/" });

    expect(scrolled).toBe(true);
    expect(found).toBe(true);
    expect(on.toggle).not.toHaveBeenCalled();
    expect(on.search).not.toHaveBeenCalled();
  });

  it("tell a key from the same key with Shift", async () => {
    const on = listening();

    await userEvent.keyboard("{Shift>}{ArrowRight}{/Shift}");

    expect(on.next).toHaveBeenCalledOnce();
    expect(on.forward).not.toHaveBeenCalled();
  });

  it("leave a key held with Ctrl or ⌘ to the browser", async () => {
    const on = listening();

    await userEvent.keyboard("{Meta>}l{/Meta}{Control>}s{/Control}l");

    expect(on.favorite).toHaveBeenCalledOnce();
    expect(on.shuffle).not.toHaveBeenCalled();
  });

  it("play or pause once while K is held", () => {
    const on = listening();

    fireEvent.keyDown(document.body, { code: "KeyK", key: "k" });
    fireEvent.keyDown(document.body, { code: "KeyK", key: "k", repeat: true });

    expect(on.toggle).toHaveBeenCalledOnce();
  });

  it("go on seeking while an arrow is held", () => {
    const on = listening();

    fireEvent.keyDown(document.body, { code: "ArrowRight", key: "ArrowRight" });
    fireEvent.keyDown(document.body, { code: "ArrowRight", key: "ArrowRight", repeat: true });

    expect(on.forward).toHaveBeenCalledTimes(2);
  });

  it("leave Space to a focused button, which it presses", async () => {
    await openWithShortcuts({ toggle: ["space"] });
    const pressed = vi.fn();
    const on = listening(
      <button type="button" onClick={pressed}>
        Next
      </button>,
    );
    screen.getByRole("button", { name: "Next" }).focus();

    await userEvent.keyboard(" ");

    expect(pressed).toHaveBeenCalledOnce();
    expect(on.toggle).not.toHaveBeenCalled();
  });

  it("play or pause with Space after a button is clicked, rather than click it again", async () => {
    await openWithShortcuts({ toggle: ["space"] });
    const pressed = vi.fn();
    const on = listening(
      <button type="button" onClick={pressed}>
        Alpha
      </button>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Alpha" }));

    await userEvent.keyboard(" ");

    expect(on.toggle).toHaveBeenCalledOnce();
    expect(pressed).toHaveBeenCalledOnce();
  });

  it("leave the arrows to a focused slider, but still play or pause with K", async () => {
    const on = listening(<input type="range" aria-label="Volume" />);
    screen.getByRole("slider", { name: "Volume" }).focus();

    await userEvent.keyboard("{ArrowRight}k");

    expect(on.forward).not.toHaveBeenCalled();
    expect(on.toggle).toHaveBeenCalledOnce();
  });

  it("reserves arrows for the sortable handle independently of its spoken language", async () => {
    const pressed = vi.fn();
    const on = listening(
      <button
        type="button"
        data-sortable-handle=""
        aria-roledescription="可调整顺序"
        onKeyDown={pressed}
      >
        调整顺序
      </button>,
    );
    screen.getByRole("button", { name: "调整顺序" }).focus();

    await userEvent.keyboard("{ArrowLeft}{ArrowRight}");

    expect(pressed).toHaveBeenCalledTimes(2);
    expect(on.back).not.toHaveBeenCalled();
    expect(on.forward).not.toHaveBeenCalled();
  });

  it("go to the next song with Shift + → even while a slider is focused, whose arrows have no Shift", async () => {
    const on = listening(<input type="range" aria-label="Position" />);
    screen.getByRole("slider", { name: "Position" }).focus();

    await userEvent.keyboard("{Shift>}{ArrowRight}{/Shift}");

    expect(on.next).toHaveBeenCalledOnce();
    expect(on.forward).not.toHaveBeenCalled();
  });

  it("go to the next album with ], not to the next song", async () => {
    const on = listening();

    await userEvent.keyboard("[BracketRight]");

    expect(on.nextAlbum).toHaveBeenCalledOnce();
    expect(on.next).not.toHaveBeenCalled();
  });

  it("go to the previous album with [", async () => {
    const on = listening();

    await userEvent.keyboard("[BracketLeft]");

    expect(on.previousAlbum).toHaveBeenCalledOnce();
    expect(on.previous).not.toHaveBeenCalled();
  });

  it("leave browser tab switching alone even when it was saved as a shortcut", async () => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
    await openWithShortcuts({ nextAlbum: ["alt+meta+right"] });
    const on = listening();

    const switched = fireEvent.keyDown(document.body, {
      code: "ArrowRight",
      key: "ArrowRight",
      altKey: true,
      metaKey: true,
    });

    expect(switched).toBe(true);
    expect(on.nextAlbum).not.toHaveBeenCalled();
  });

  it("leave Firefox Quick Find alone when another physical key types slash", () => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 Firefox/144.0");
    const on = listening();

    const found = fireEvent.keyDown(document.body, { code: "BracketLeft", key: "/" });
    fireEvent.keyDown(document.body, { code: "Slash", key: "?", shiftKey: true });

    expect(found).toBe(true);
    expect(on.previousAlbum).not.toHaveBeenCalled();
    expect(on.help).toHaveBeenCalledOnce();
  });

  it("keeps a saved physical Slash key when it types a different character in Firefox", async () => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 Firefox/144.0");
    await openWithShortcuts({ search: ["slash"] });
    const on = listening();

    fireEvent.keyDown(document.body, { code: "Slash", key: "z" });

    expect(on.search).toHaveBeenCalledOnce();
  });

  it("leave typing to a text box", async () => {
    const on = listening(<input type="search" aria-label="Search" />);

    const search = screen.getByRole("searchbox", { name: "Search" });
    await userEvent.type(search, "s kg[BracketLeft][BracketRight]");

    expect(search).toHaveValue("s kg[]");
    expect(on.shuffle).not.toHaveBeenCalled();
    expect(on.toggle).not.toHaveBeenCalled();
    expect(on.search).not.toHaveBeenCalled();
    expect(on.previousAlbum).not.toHaveBeenCalled();
    expect(on.nextAlbum).not.toHaveBeenCalled();
  });

  it("leave every key to an open dialog", async () => {
    const on = listening(<dialog open>Add to playlists</dialog>);

    await userEvent.keyboard("ks");

    expect(on.toggle).not.toHaveBeenCalled();
    expect(on.shuffle).not.toHaveBeenCalled();
  });

  it("keep working over a full-screen view that lets them through", async () => {
    const on = listening(
      <dialog open data-shortcuts>
        Now Playing
      </dialog>,
    );

    await userEvent.keyboard("ks");

    expect(on.toggle).toHaveBeenCalledOnce();
    expect(on.shuffle).toHaveBeenCalledOnce();
  });

  it("leave every key to a dialog open over a full-screen view", async () => {
    const on = listening(
      <>
        <dialog open data-shortcuts>
          Now Playing
        </dialog>
        <dialog open>Add to playlists</dialog>
      </>,
    );

    await userEvent.keyboard("ks");

    expect(on.toggle).not.toHaveBeenCalled();
    expect(on.shuffle).not.toHaveBeenCalled();
  });

  it("open Now Playing with F", async () => {
    const on = listening();

    await userEvent.keyboard("f");

    expect(on.nowPlaying).toHaveBeenCalledOnce();
  });

  it("leave every key to an open menu", async () => {
    const on = listening(
      <div role="menu">
        <div role="menuitem" tabIndex={-1}>
          Go to artist
        </div>
      </div>,
    );
    screen.getByRole("menuitem", { name: "Go to artist" }).focus();

    await userEvent.keyboard("s");

    expect(on.shuffle).not.toHaveBeenCalled();
  });

  it("play or pause with either of its keys", async () => {
    await openWithShortcuts({ toggle: ["space", "k"] });
    const on = listening();

    await userEvent.keyboard(" k");

    expect(on.toggle).toHaveBeenCalledTimes(2);
  });

  it("follow a command moved to other keys", async () => {
    const on = listening();

    await openWithShortcuts({ toggle: ["j"] });
    await userEvent.keyboard("j k ");

    expect(on.toggle).toHaveBeenCalledOnce();
  });

  it("listen for nothing for a command with no keys", async () => {
    const on = listening();

    await openWithShortcuts({ mute: [] });
    await userEvent.keyboard("m");

    expect(on.mute).not.toHaveBeenCalled();
  });
});
