import { EditorView } from "@codemirror/view";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ListCheck } from "../api";
import { LanguageSelect } from "./LanguageSelect";
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
  beforeEach(() => {
    Object.defineProperties(Range.prototype, {
      getClientRects: { configurable: true, value: () => [] },
      getBoundingClientRect: { configurable: true, value: () => new DOMRect() },
    });
  });

  afterEach(() => {
    Reflect.deleteProperty(Range.prototype, "getClientRects");
    Reflect.deleteProperty(Range.prototype, "getBoundingClientRect");
  });

  it("translates help and diagnostics without restarting CodeMirror or rechecking a draft", async () => {
    const initial = "0:00 Intro\nEncore";
    const verify = vi.fn(() =>
      Promise.resolve({
        songs: [],
        problems: [{ line: 2, message: "This line has no time, such as 3:12." }],
      }),
    );
    render(<ListEditor initial={initial} check={verify} artists={[]} onListed={vi.fn()} />);
    const language = render(<LanguageSelect />).getByRole("combobox", { name: "Language" });
    const user = userEvent.setup();
    await screen.findByRole("button", { name: /^Line 2:/u });
    const original = editorView();

    try {
      await user.selectOptions(language, "zh-Hans");

      const field = screen.getByRole("textbox", { name: "歌曲列表" });
      expect(EditorView.findFromDOM(field)).toBe(original);
      expect(original.state.doc.toString()).toBe(initial);
      expect(
        screen.getByRole("button", { name: "第 2 行：此行缺少起始时间，例如 3:12。" }),
      ).toBeVisible();
      expect(screen.getByText(/例如：3:12 夜行 - 蓝房间/u)).toBeVisible();
      expect(verify).toHaveBeenCalledExactlyOnceWith(initial);
    } finally {
      await user.selectOptions(language, "auto");
    }
  });

  it("ignores a successful check for text edited before the next debounce", async () => {
    const onListed = vi.fn();
    let finish: (answer: ListCheck) => void = () => undefined;
    const response = new Promise<ListCheck>((resolve) => {
      finish = resolve;
    });
    render(
      <ListEditor initial="0:00 Intro" check={() => response} artists={[]} onListed={onListed} />,
    );
    act(() => {
      const editor = editorView();
      editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: "Encore" } });
    });

    await act(async () => {
      finish({ songs: [{ start_ms: 0, title: "Intro", artist: "" }], problems: [] });
      await response;
    });

    expect(onListed).toHaveBeenLastCalledWith(undefined);
    expect(screen.getByText("Checking…")).toBeVisible();
  });

  it("lists each line the server says is no song, and offers no songs until it checks clean", async () => {
    const onListed = vi.fn();
    render(
      <ListEditor
        initial={"0:00 Intro\nNight Drive"}
        check={check}
        artists={[]}
        onListed={onListed}
      />,
    );

    expect(
      await screen.findByRole("button", { name: "Line 2: This line has no time." }),
    ).toBeInTheDocument();
    expect(onListed).toHaveBeenLastCalledWith(undefined);
    act(() => {
      const view = editorView();
      view.dispatch({ changes: { from: view.state.doc.line(2).from, insert: "3:12 " } });
    });
    await screen.findByText("2 songs");

    // The editor tells its parent after it shows the count, so the call may come a moment later.
    await waitFor(() => {
      expect(onListed).toHaveBeenLastCalledWith([
        { start_ms: 0, title: "Intro", artist: "" },
        { start_ms: 192_000, title: "Night Drive", artist: "" },
      ]);
    });
  });

  it("moves to a problem's line when it is chosen", async () => {
    render(
      <ListEditor
        initial={"0:00 Intro\n3:12 Night Drive\nEncore"}
        check={check}
        artists={[]}
        onListed={vi.fn()}
      />,
    );

    await userEvent.click(
      await screen.findByRole("button", { name: "Line 3: This line has no time." }),
    );

    const view = editorView();
    expect(view.state.doc.lineAt(view.state.selection.main.head).number).toBe(3);
  });

  it("numbers each line of the example an empty list shows, and only real lines once typed", () => {
    const { container } = render(
      <ListEditor initial="" check={check} artists={[]} onListed={vi.fn()} />,
    );
    // The gutter's numbers, but for the hidden one CodeMirror sizes the gutter by.
    const numbers = () =>
      [...container.querySelectorAll<HTMLElement>(".cm-lineNumbers .cm-gutterElement")]
        .filter((element) => element.style.visibility !== "hidden")
        .map((element) => element.textContent);
    const empty = numbers();

    act(() => {
      editorView().dispatch({ changes: { from: 0, insert: "0:00 Intro" } });
    });

    expect([empty, numbers()]).toEqual([["1\n2"], ["1"]]);
  });
});
