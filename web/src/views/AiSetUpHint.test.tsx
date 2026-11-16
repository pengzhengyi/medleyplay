import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AiSetUpHint } from "./AiSetUpHint";
import { type AiSetUp, AiSetUpContext } from "./aiSetUp";

function hintFor(setUp: AiSetUp, newTab = false) {
  return render(
    <AiSetUpContext value={setUp}>
      <AiSetUpHint newTab={newTab} />
    </AiSetUpContext>,
  );
}

describe("the hint to set up AI", () => {
  it("links an admin to Settings' AI section", () => {
    hintFor({ missing: true, admin: true });

    const link = screen.getByRole("link", { name: "Set up AI" });

    expect(link).toHaveAttribute("href", "#/settings?section=ai");
    expect(link).toHaveAccessibleDescription("No AI provider is set up; set one up in Settings");
  });

  it("opens Settings in a new tab from a dialog, keeping what is typed there", () => {
    hintFor({ missing: true, admin: true }, true);

    expect(screen.getByRole("link", { name: "Set up AI" })).toHaveAttribute("target", "_blank");
  });

  it("tells a member to ask an admin, with no link", () => {
    hintFor({ missing: true, admin: false });

    expect(screen.getByText("Ask an admin to set up AI")).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("says nothing while a provider is set up, or the server hasn't said", () => {
    const { container } = hintFor({ missing: false, admin: true });

    expect(container).toBeEmptyDOMElement();
  });
});
