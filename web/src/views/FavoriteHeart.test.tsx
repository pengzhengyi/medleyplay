import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FavoriteHeart } from "./FavoriteHeart";

/** The heart of an artist with 3 loved songs, never suggested in this browser before. */
function suggested() {
  render(
    <FavoriteHeart
      kind="artist"
      name="ryo"
      favorite={false}
      onChange={vi.fn()}
      loved={3}
      suggestionKey="1:artist:ryo"
    />,
  );
  return screen.getByRole("button", { name: "Favorite artist ryo" });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
});

describe("suggesting a favorite", () => {
  it("beats the heart and says why, then lets the note go after a few seconds", () => {
    const heart = suggested();

    const beating = heart.classList.contains("beat");
    const note = screen.getByText("3 songs you love");
    act(() => {
      vi.advanceTimersByTime(6000);
    });

    expect(beating).toBe(true);
    expect(note).toBeEmptyDOMElement();
  });

  it("keeps the note while the heart is pointed at or focused", () => {
    const heart = suggested();

    fireEvent.pointerEnter(heart);
    act(() => {
      vi.advanceTimersByTime(20_000);
    });
    const kept = screen.queryByText("3 songs you love");
    fireEvent.pointerLeave(heart);
    act(() => {
      vi.advanceTimersByTime(6000);
    });

    expect(kept).toBeInTheDocument();
    expect(screen.queryByText("3 songs you love")).not.toBeInTheDocument();
  });

  it("says nothing for a group already a favorite", () => {
    render(
      <FavoriteHeart
        kind="artist"
        name="ryo"
        favorite
        onChange={vi.fn()}
        loved={3}
        suggestionKey="1:artist:ryo"
      />,
    );

    expect(screen.getByRole("button", { name: "Favorite artist ryo" })).not.toHaveClass("beat");
    expect(screen.queryByText("3 songs you love")).not.toBeInTheDocument();
  });
});
