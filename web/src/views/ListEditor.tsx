/**
 * @file A song list typed as text, one song a line, checked by the server as it is typed.
 *
 * CodeMirror numbers the lines, colors each time and artist, offers the Library's
 * artists after a dash, and marks each line the server says is no song; the
 * problems are listed under it too, each moving to its line. The server reads the
 * list as a paste is read, so what checks clean here is what it takes.
 */

import { autocompletion, completionKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { HighlightStyle, StreamLanguage, syntaxHighlighting } from "@codemirror/language";
import { type Diagnostic, lintGutter, setDiagnostics } from "@codemirror/lint";
import { EditorState } from "@codemirror/state";
import { EditorView, drawSelection, keymap, lineNumbers, placeholder } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { useEffect, useRef, useState } from "react";

import type { ListCheck, Song } from "../api";

/** How long typing pauses before the list is checked. */
const CHECK_AFTER_MS = 350;
/** What an empty list shows, a line each, to say how a list is written. */
const EXAMPLE = ["0:00 Intro", "3:12 Night Drive - Blue Room"];

const TIME = /^(?:\d{1,2}:)?\d{1,3}:\d{2}(?![\d:])/u;
const DASH = /^\s+[-–—]\s+|^\s*－\s*/u;

/** A song line's parts: its time, its title, and after a dash, its artist. */
const songLines = StreamLanguage.define<{ artist: boolean }>({
  startState: () => ({ artist: false }),
  token(stream, state) {
    if (stream.sol()) {
      state.artist = false;
    }
    if (stream.match(TIME)) {
      return "number";
    }
    if (!state.artist && stream.match(DASH)) {
      state.artist = true;
      return "punctuation";
    }
    stream.next();
    return state.artist ? "name" : "string";
  },
});

const colors = HighlightStyle.define([
  { tag: tags.number, class: "list-time" },
  { tag: tags.punctuation, class: "list-dash" },
  { tag: tags.name, class: "list-artist" },
]);

export default function ListEditor({
  initial,
  check,
  artists,
  onUse,
  onCancel,
}: {
  /** The list to start from, such as the rows the editor holds. */
  readonly initial: string;
  readonly check: (text: string) => Promise<ListCheck>;
  /** The artists to offer after a dash. */
  readonly artists: readonly string[];
  readonly onUse: (songs: readonly Song[]) => void;
  readonly onCancel: () => void;
}) {
  const parent = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const [checked, setChecked] = useState<ListCheck | undefined>(undefined);
  const [failure, setFailure] = useState("");
  // The latest text sent, so an older answer can't land after it.
  const sent = useRef("");
  const checkLatest = useRef(check);
  useEffect(() => {
    checkLatest.current = check;
  });

  useEffect(() => {
    const element = parent.current;
    if (element === null) {
      return undefined;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ask = (editor: EditorView) => {
      const text = editor.state.doc.toString();
      sent.current = text;
      checkLatest.current(text).then(
        (answer) => {
          if (sent.current !== text || view.current !== editor) {
            return;
          }
          setFailure("");
          setChecked(answer);
          editor.dispatch(setDiagnostics(editor.state, diagnosticsOf(editor.state, answer)));
        },
        (error: unknown) => {
          if (sent.current === text) {
            setFailure(error instanceof Error ? error.message : String(error));
          }
        },
      );
    };
    const editor = new EditorView({
      parent: element,
      state: EditorState.create({
        doc: initial,
        extensions: [
          // An empty list's example is numbered line by line, so it reads as the lines it shows.
          lineNumbers({
            formatNumber: (line, state) =>
              state.doc.length === 0
                ? EXAMPLE.map((_, index) => String(index + 1)).join("\n")
                : String(line),
          }),
          history(),
          // CodeMirror draws the caret, so beside the two-line example it stays one line tall.
          drawSelection(),
          keymap.of([...defaultKeymap, ...historyKeymap, ...completionKeymap]),
          songLines,
          syntaxHighlighting(colors),
          lintGutter(),
          autocompletion({
            override: [
              (context) => {
                const typed = context.matchBefore(/\s[-–—]\s[^\n]*/u);
                if (typed === null) {
                  return null;
                }
                return {
                  from: typed.from + 3,
                  options: artists.map((artist) => ({ label: artist, type: "text" })),
                };
              },
            ],
          }),
          placeholder(EXAMPLE.join("\n")),
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({ "aria-label": "Song list" }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              setChecked(undefined);
              clearTimeout(timer);
              timer = setTimeout(() => {
                ask(update.view);
              }, CHECK_AFTER_MS);
            }
          }),
        ],
      }),
    });
    view.current = editor;
    ask(editor);
    editor.focus();
    return () => {
      clearTimeout(timer);
      view.current = null;
      editor.destroy();
    };
    // The editor is made once; what it starts from is read only then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toLine = (line: number) => {
    const editor = view.current;
    if (editor !== null && line <= editor.state.doc.lines) {
      const { from } = editor.state.doc.line(line);
      editor.dispatch({ selection: { anchor: from }, scrollIntoView: true });
      editor.focus();
    }
  };
  // The songs to use once the list checks clean.
  const usable = checked?.problems.length === 0 ? checked.songs : undefined;
  return (
    <div className="list-editor">
      <div ref={parent} className="list-editor-text" />
      <div className="list-editor-status" role="status">
        {checked === undefined && failure === "" && <span className="muted">Checking…</span>}
        {failure !== "" && <span className="error">{failure}</span>}
        {usable !== undefined && <span>{`${String(usable.length)} songs`}</span>}
      </div>
      {checked !== undefined && checked.problems.length > 0 && (
        <ul className="list-problems" aria-label="Problems">
          {checked.problems.map((problem, index) => (
            <li key={index} className="list-problem">
              {problem.line === null ? (
                problem.message
              ) : (
                <button
                  type="button"
                  className="link-button"
                  onClick={() => {
                    toLine(problem.line ?? 1);
                  }}
                >
                  {`Line ${String(problem.line)}: ${problem.message}`}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="list-editor-buttons">
        <button type="button" className="secondary outline list-editor-button" onClick={onCancel}>
          Back to the songs
        </button>
        <button
          type="button"
          className="list-editor-button"
          disabled={usable === undefined}
          onClick={() => {
            if (usable !== undefined) {
              onUse(usable);
            }
          }}
        >
          {usable === undefined ? "Use these songs" : `Use these ${String(usable.length)} songs`}
        </button>
      </div>
    </div>
  );
}

/** The marks the editor shows for `answer`'s problems, each across its line. */
function diagnosticsOf(state: EditorState, answer: ListCheck): Diagnostic[] {
  return answer.problems.flatMap((problem) => {
    if (problem.line === null || problem.line > state.doc.lines) {
      return [];
    }
    const line = state.doc.line(problem.line);
    return [{ from: line.from, to: line.to, severity: "error", message: problem.message }];
  });
}
