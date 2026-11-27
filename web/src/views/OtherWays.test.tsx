import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OtherWays } from "./OtherWays";

const LINK = "https://www.bilibili.com/video/BV1Xx41117Tz?p=1";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the other ways to get a file", () => {
  it("is folded until opened, and says medleyplay doesn't run the commands", async () => {
    render(<OtherWays kind="bilibili" link={LINK} />);
    const ways = screen.getByRole("group");

    expect(ways).not.toHaveAttribute("open");
    await userEvent.click(screen.getByText("Other ways to get the file"));

    expect(ways).toHaveAttribute("open");
    expect(within(ways).getByText(/medleyplay doesn’t run them/)).toBeVisible();
  });

  it("shows each way's command with the part's link filled in", () => {
    render(<OtherWays kind="bilibili" link={LINK} open />);

    const commands = screen.getAllByRole("listitem").map((way) => within(way).getByText(/ "https/));

    expect(commands).toHaveLength(6);
    for (const command of commands) {
      expect(command).toHaveTextContent(LINK);
    }
  });

  it("copies a way's command and says it copied", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    render(<OtherWays kind="bilibili" link={LINK} open />);

    const copy = screen.getByRole("button", { name: "Copy the BBDown command" });
    await userEvent.click(copy);

    expect(writeText).toHaveBeenCalledExactlyOnceWith(`BBDown --audio-only "${LINK}"`);
    expect(await screen.findByTitle("Copied")).toBe(copy);
  });

  it("explains how to copy a command when clipboard access fails", async () => {
    vi.stubGlobal("navigator", {
      clipboard: { writeText: () => Promise.reject(new Error("Denied.")) },
    });
    render(<OtherWays kind="bilibili" link={LINK} open />);

    await userEvent.click(screen.getByRole("button", { name: "Copy the BBDown command" }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Could not copy the command. Select and copy it manually.",
    );
  });

  it("replaces the last clipboard success with the current failure", async () => {
    const writeText = vi
      .fn<() => Promise<void>>()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("Denied."));
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    render(<OtherWays kind="bilibili" link={LINK} open />);
    const copy = screen.getByRole("button", { name: "Copy the BBDown command" });

    await userEvent.click(copy);
    expect(await screen.findByRole("status")).toHaveTextContent("Command copied.");
    await userEvent.click(copy);

    expect(await screen.findByRole("status")).toHaveTextContent("Could not copy the command.");
    expect(screen.queryByTitle("Copied")).not.toBeInTheDocument();
  });

  it("shows nothing for a site it knows no way for", () => {
    const { container } = render(<OtherWays kind="example" link="https://example.com/1" />);

    expect(container).toBeEmptyDOMElement();
  });
});
