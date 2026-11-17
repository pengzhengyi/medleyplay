import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { LibrarySkeleton } from "./LibrarySkeleton";

describe("the Library while its songs are read", () => {
  it("says so to a screen reader, and hides the rows that stand in for songs", () => {
    render(<LibrarySkeleton />);

    expect(screen.getByRole("status")).toHaveTextContent("Loading your music…");
    expect(screen.queryByRole("list")).toBeNull();
  });
});
