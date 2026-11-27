/**
 * @file A song list typed as text, one song a line, checked by the server as it is typed.
 *
 * CodeMirror numbers the lines, colors each time and artist, offers the Library's
 * artists after a dash, and marks each line the server says is no song; the
 * problems are listed under it too, each moving to its line. The server reads the
 * list as a paste is read, so what checks clean here is what it takes; the editor
 * holding it saves the list once it checks clean.
 */

import { autocompletion, completionKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { HighlightStyle, StreamLanguage, syntaxHighlighting } from "@codemirror/language";
import { type Diagnostic, lintGutter, setDiagnostics } from "@codemirror/lint";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView, drawSelection, keymap, lineNumbers, placeholder } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { useEffect, useEffectEvent, useRef, useState } from "react";

import type { ListCheck, Song } from "../api";
import { type Words, useWords } from "../locale";

/** How long typing pauses before the list is checked. */
const CHECK_AFTER_MS = 350;
/** What an empty list shows, a line each, to say how a list is written. */
const EXAMPLE = ["0:00 Intro", "3:12 Night Drive - Blue Room"];
const PROBLEMS = new Set([
  "This line is too long for a song.",
  "This line has no time, such as 3:12.",
  "This line has no title.",
  "This starts before the song above.",
  "This starts less than a second after the song above.",
]);
const EDITOR_PHRASES = [
  "Completions",
  "Diagnostics",
  "No diagnostics",
  "Control character",
  "Selection deleted",
  "close",
  "to",
];

function problemOf(message: string, t: Words): string {
  if (PROBLEMS.has(message)) return t(message);
  const end = /^This starts after the file ends, at ([\d:]+)\.$/u.exec(message)?.[1];
  if (end !== undefined) return t("This starts after the file ends, at {{end}}.", { end });
  const min = /^A song list has at least (\d+) songs\.$/u.exec(message)?.[1];
  if (min !== undefined) return t("A song list has at least {{min}} songs.", { min });
  const max = /^A song list has at most (\d+) songs\.$/u.exec(message)?.[1];
  return max === undefined ? message : t("A song list has at most {{max}} songs.", { max });
}

function editorWords(t: Words) {
  return [
    placeholder(EXAMPLE.map((line) => t(line)).join("\n")),
    EditorView.contentAttributes.of({ "aria-label": t("Song list") }),
    EditorState.phrases.of(
      Object.fromEntries(
        EDITOR_PHRASES.map((phrase) => [
          phrase,
          t(`CodeMirror: ${phrase}`, { defaultValue: phrase }),
        ]),
      ),
    ),
  ];
}

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
  onListed,
}: {
  /** The list to start from, such as the rows the editor holds. */
  readonly initial: string;
  readonly check: (text: string) => Promise<ListCheck>;
  /** The artists to offer after a dash. */
  readonly artists: readonly string[];
  /** Told the songs each time the list checks clean, and `undefined` while it doesn't. */
  readonly onListed: (songs: readonly Song[] | undefined) => void;
}) {
  const t = useWords();
  const parent = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const [language] = useState(() => new Compartment());
  const [checked, setChecked] = useState<ListCheck | undefined>(undefined);
  const [failure, setFailure] = useState("");
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
    let version = 0;
    const ask = (editor: EditorView) => {
      const text = editor.state.doc.toString();
      const sent = version;
      const current = () => view.current === editor && sent === version;
      checkLatest.current(text).then(
        (answer) => {
          if (!current()) return;
          setFailure("");
          setChecked(answer);
        },
        (error: unknown) => {
          if (current()) {
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
          language.of(editorWords(t)),
          EditorView.lineWrapping,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              version += 1;
              setChecked(undefined);
              setFailure("");
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

  useEffect(() => {
    view.current?.dispatch({ effects: language.reconfigure(editorWords(t)) });
  }, [language, t]);
  useEffect(() => {
    const editor = view.current;
    if (editor !== null)
      editor.dispatch(
        setDiagnostics(
          editor.state,
          checked === undefined ? [] : diagnosticsOf(editor.state, checked, t),
        ),
      );
  }, [checked, t]);

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
  const listed = useEffectEvent(onListed);
  useEffect(() => {
    listed(usable);
  }, [usable]);
  return (
    <div className="list-editor">
      <p className="hint">
        {t(
          "Write one song per line: start time, then title. To include the artist, use Title - Artist with a space on both sides of the hyphen. For example: 3:12 Night Drive - Blue Room.",
        )}
      </p>
      <div ref={parent} className="list-editor-text" />
      <div className="list-editor-status" role="status">
        {checked === undefined && failure === "" && <span className="muted">{t("Checking…")}</span>}
        {failure !== "" && (
          <span className="error">
            {t("Could not check the song list: {{detail}}", { detail: failure })}
          </span>
        )}
        {usable !== undefined && <span>{t("song_count", { count: usable.length })}</span>}
      </div>
      {checked !== undefined && checked.problems.length > 0 && (
        <ul className="list-problems" aria-label={t("Problems")}>
          {checked.problems.map((problem, index) => (
            <li key={index} className="list-problem">
              {problem.line === null ? (
                problemOf(problem.message, t)
              ) : (
                <button
                  type="button"
                  className="link-button"
                  onClick={() => {
                    toLine(problem.line ?? 1);
                  }}
                >
                  {t("Line {{number}}: {{problem}}", {
                    number: problem.line,
                    problem: problemOf(problem.message, t),
                  })}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The marks the editor shows for `answer`'s problems, each across its line. */
function diagnosticsOf(state: EditorState, answer: ListCheck, t: Words): Diagnostic[] {
  return answer.problems.flatMap((problem) => {
    if (problem.line === null || problem.line > state.doc.lines) {
      return [];
    }
    const line = state.doc.line(problem.line);
    return [
      { from: line.from, to: line.to, severity: "error", message: problemOf(problem.message, t) },
    ];
  });
}
