import { EditorView } from "@codemirror/view";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { ListCheck } from "../api";
import ListEditor from "./ListEditor";

/** A server that reads each line `0:00 Title` as a song, and any other as no song. */
function check(text: string): Promise<ListCheck> {
  const lines = text.split("\n");
  const songs = lines.flatMap((line) => {
    const read = /^(\d+):(\d\d) (.+)$/u.exec(line);
    return read === null
      ? []
      : [
          {
            start_ms: (Number(read[1]) * 60 + Number(read[2])) * 1000,
            title: read[3] ?? "",
            artist: "",
          },
        ];
  });
  const problems = lines.flatMap((line, index) =>
    /^\d+:\d\d .+$/u.test(line) ? [] : [{ line: index + 1, message: "This line has no time." }],
  );
  return Promise.resolve({ songs, problems });
}

/** The editor's view, as CodeMirror finds it in the page. */
function editorView(): EditorView {
  const content = screen.getByRole("textbox", { name: "Song list" });
  const view = EditorView.findFromDOM(content);
  if (view === null) {
    throw new Error("The song list has no editor.");
  }
  return view;
}

describe("typing a song list", () => {
  it("lists each line the server says is no song, and uses none until it checks clean", async () => {
    const onUse = vi.fn();
    render(
      <ListEditor
        initial={"0:00 Intro\nNight Drive"}
        check={check}
        artists={[]}
        onUse={onUse}
        onCancel={vi.fn()}
      />,
    );

    expect(
      await screen.findByRole("button", { name: "Line 2: This line has no time." }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Use these songs" })).toBeDisabled();
    act(() => {
      const view = editorView();
      view.dispatch({ changes: { from: view.state.doc.line(2).from, insert: "3:12 " } });
    });
    await userEvent.click(await screen.findByRole("button", { name: "Use these 2 songs" }));

    expect(onUse).toHaveBeenCalledWith([
      { start_ms: 0, title: "Intro", artist: "" },
      { start_ms: 192_000, title: "Night Drive", artist: "" },
    ]);
  });

  it("moves to a problem's line when it is chosen", async () => {
    render(
      <ListEditor
        initial={"0:00 Intro\n3:12 Night Drive\nEncore"}
        check={check}
        artists={[]}
        onUse={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    await userEvent.click(
      await screen.findByRole("button", { name: "Line 3: This line has no time." }),
    );

    const view = editorView();
    expect(view.state.doc.lineAt(view.state.selection.main.head).number).toBe(3);
  });
});
