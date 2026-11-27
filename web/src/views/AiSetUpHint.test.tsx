import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { AiSetUpHint } from "./AiSetUpHint";
import { LanguageSelect } from "./LanguageSelect";
import { type AiSetUp, AiSetUpContext } from "./aiSetUp";

function hintFor(setUp: AiSetUp, newTab = false) {
  return render(
    <AiSetUpContext value={setUp}>
      <AiSetUpHint newTab={newTab} />
    </AiSetUpContext>,
  );
}

describe("the hint to set up AI", () => {
  it("translates the accessible explanation when a provider may be disabled", async () => {
    hintFor({ missing: true, admin: true });
    render(<LanguageSelect />);
    const user = userEvent.setup();
    const language = screen.getByRole("combobox", { name: "Language" });

    try {
      await user.selectOptions(language, "zh-Hans");

      expect(screen.getByRole("link", { name: "设置 AI" })).toHaveAccessibleDescription(
        "没有已启用的 AI 服务。请在设置中添加或启用一个服务。",
      );
    } finally {
      await user.selectOptions(language, "auto");
    }
  });

  it("links an admin to Settings' AI section", () => {
    hintFor({ missing: true, admin: true });

    const link = screen.getByRole("link", { name: "Set up AI" });

    expect(link).toHaveAttribute("href", "#/settings?section=ai");
    expect(link).toHaveAccessibleDescription(
      "No AI provider is enabled. Add or enable one in Settings.",
    );
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
