import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { AskAiAgain } from "./AskAiAgain";
import { LanguageSelect } from "./LanguageSelect";

describe("asking the AI again", () => {
  it("describes the paid request in Chinese before asking and keeps the track name", async () => {
    const onAsk = vi.fn();
    const user = userEvent.setup();
    const language = render(<LanguageSelect />).getByRole("combobox", { name: "Language" });

    try {
      await user.selectOptions(language, "zh-Hans");
      render(<AskAiAgain title="Night Drive" onAsk={onAsk} onClose={vi.fn()} />);

      const dialog = screen.getByRole("dialog", { name: "再次询问 AI？" });
      expect(dialog).toHaveAccessibleDescription(/「Night Drive」.*可能产生费用/u);
      expect(onAsk).not.toHaveBeenCalled();
    } finally {
      await user.selectOptions(language, "auto");
    }
  });

  it("says what asking again costs before anything is asked", () => {
    const onAsk = vi.fn();

    render(<AskAiAgain title="Night Drive" onAsk={onAsk} onClose={vi.fn()} />);

    const dialog = screen.getByRole("dialog", { name: "Ask the AI again?" });
    expect(dialog).toHaveAccessibleDescription(
      "The AI was asked about “Night Drive” in the last 24 hours. Asking again sends your AI provider another request, which may cost money, and it will likely answer the same.",
    );
    expect(onAsk).not.toHaveBeenCalled();
  });

  it("asks once someone agrees, and closes", async () => {
    const onAsk = vi.fn();
    const onClose = vi.fn();
    render(<AskAiAgain title="Night Drive" onAsk={onAsk} onClose={onClose} />);

    await userEvent.click(screen.getByRole("button", { name: "Ask again" }));

    expect(onAsk).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("asks nothing when cancelled", async () => {
    const onAsk = vi.fn();
    const onClose = vi.fn();
    render(<AskAiAgain title="Night Drive" onAsk={onAsk} onClose={onClose} />);

    await userEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(onAsk).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledOnce();
  });
});
