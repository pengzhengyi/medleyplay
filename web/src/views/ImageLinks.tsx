/**
 * @file Pictures an AI model suggests for an album's cover or an artist's photo, to approve one.
 *
 * Asked, a model names a few links to pictures; each shows here from its own site, as
 * any web page would show it, and one that can't be shown says so. Nothing is
 * downloaded until a picture is approved: then medleyplay downloads it and uses it,
 * as choosing a cover does. While a model is asked or a picture downloaded, it reads
 * again every few seconds. It shows once the links are read, so a server that can't
 * suggest any shows nothing.
 *
 * Shown for a picture never asked about, it asks the AI at once; *Ask again* opens a
 * note to tell the AI what picture is wanted.
 */

import { CircleNotchIcon, SparkleIcon } from "@phosphor-icons/react";
import { useEffect, useEffectEvent, useId, useLayoutEffect, useRef, useState } from "react";

import { type PictureLinks, type Pictured, type SuggestedLink, api, coverUrl } from "../api";
import { useWords } from "../locale";
import { composing } from "../ime";
import { AiSetUpHint } from "./AiSetUpHint";
import { useAiSetUp } from "./aiSetUp";

const READ_EVERY_MS = 2000;
interface Approval {
  readonly url: string;
  following: boolean;
}

/** Say why a request failed, in the server's words when it gave some. */
function messageOf(failure: unknown): string {
  return failure instanceof Error ? failure.message : String(failure);
}

/** The site a link is on, such as *upload.wikimedia.org*. */
function siteOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/** An example of a note to the AI, for the picture wanted. */
function noteExample(pictured: Pictured): string {
  return pictured.kind === "album"
    ? "Which cover you mean, such as “the 1997 first pressing”"
    : "Which photo you want, such as “live on stage, not a poster”";
}

/**
 * The pictures an AI model suggests of `pictured`; `shown` is the cover or photo shown now,
 * and `onUse` sets the one approved, once downloaded.
 */
export function ImageLinks({
  pictured,
  shown,
  busy = false,
  onUse,
}: {
  readonly pictured: Pictured;
  readonly shown: string | null | undefined;
  readonly busy?: boolean;
  readonly onUse: (cover: string) => void;
}) {
  const t = useWords();
  const noAi = useAiSetUp();
  const [state, setState] = useState<PictureLinks>();
  // Counts the reads asked for, so each asks the server again.
  const [reads, setReads] = useState(0);
  const [error, setError] = useState("");
  const [readFailure, setReadFailure] = useState("");
  const [approvalFailure, setApprovalFailure] = useState<{ readonly detail?: string }>();
  const [approved, setApproved] = useState<string>();
  const approval = useRef<Approval | undefined>(undefined);
  const [broken, setBroken] = useState<ReadonlySet<string>>(new Set());
  // The note to the AI while it is being written, kept to write on when asking again.
  const [noting, setNoting] = useState(false);
  const [note, setNote] = useState("");
  // Whether the AI was asked on opening, so it is asked once.
  const askedOnOpening = useRef(false);
  const noteId = useId();
  const key = JSON.stringify(pictured);
  useLayoutEffect(() => {
    return () => {
      approval.current = undefined;
    };
  }, [key]);
  const readAgain = () => {
    setReads((count) => count + 1);
  };
  const finishApproval = () => {
    approval.current = undefined;
    setApproved(undefined);
  };

  const onRead = useEffectEvent((known: PictureLinks, following: Approval | undefined) => {
    setState(known);
    if (
      !askedOnOpening.current &&
      known.asked_at === null &&
      !known.asking &&
      known.may_suggest &&
      !noAi.missing
    ) {
      askedOnOpening.current = true;
      ask("");
    }
    if (following === undefined || following !== approval.current) return;
    const link = known.links.find((candidate) => following.url === candidate.url);
    if (link?.cover != null) {
      finishApproval();
      onUse(link.cover);
    } else if (link?.fetching !== true) {
      finishApproval();
      if (link === undefined || (link.unavailable === "" && link.failure === null))
        setApprovalFailure({});
    }
  });
  useEffect(() => {
    let current = true;
    const following = approval.current?.following === true ? approval.current : undefined;
    api.imageLinks(JSON.parse(key) as Pictured).then(
      (known) => {
        if (current) {
          setReadFailure("");
          onRead(known, following);
        }
      },
      (failure: unknown) => {
        if (current) setReadFailure(messageOf(failure));
      },
    );
    return () => {
      current = false;
    };
  }, [key, reads]);
  useEffect(() => {
    if (
      readFailure !== "" ||
      (state?.asking !== true &&
        approved === undefined &&
        !state?.links.some((link) => link.fetching))
    ) {
      return;
    }
    const timer = setTimeout(readAgain, READ_EVERY_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [approved, readFailure, state]);

  function ask(hint: string) {
    setError("");
    setBroken(new Set());
    setNoting(false);
    setState((was) => (was === undefined ? was : { ...was, asking: true, failure: null }));
    api.suggestImageLinks(pictured, hint).then(readAgain, (failure: unknown) => {
      setError(messageOf(failure));
      readAgain();
    });
  }
  const approve = (link: SuggestedLink) => {
    if (approval.current !== undefined) return;
    setApprovalFailure(undefined);
    const request: Approval = { url: link.url, following: false };
    approval.current = request;
    setApproved(link.url);
    api.approveImageLink(pictured, link.url).then(
      ({ cover }) => {
        if (approval.current !== request) return;
        if (cover === null) {
          request.following = true;
          readAgain();
        } else {
          finishApproval();
          onUse(cover);
        }
      },
      (failure: unknown) => {
        if (approval.current !== request) return;
        finishApproval();
        setApprovalFailure({ detail: messageOf(failure) });
      },
    );
  };

  if (state === undefined) {
    return readFailure === "" ? (
      <p role="status" aria-busy="true">
        {t("Reading picture suggestions…")}
      </p>
    ) : (
      <>
        <p role="alert">
          {t("Could not read picture suggestions: {{detail}}", { detail: readFailure })}
        </p>
        <button
          type="button"
          className="link-button"
          onClick={() => {
            setReadFailure("");
            readAgain();
          }}
        >
          {t("Retry reading results")}
        </button>
      </>
    );
  }
  const links = state.links;
  const asking = state.asking;
  const failure = error || state.failure;
  const canAsk = !busy && approved === undefined && state.may_suggest && !noAi.missing;
  const retryRead = readFailure !== "" && (
    <>
      <p role="alert">
        {t("Could not read picture suggestions: {{detail}}", { detail: readFailure })}
      </p>
      <button
        type="button"
        className="link-button"
        onClick={() => {
          setReadFailure("");
          readAgain();
        }}
      >
        {t("Retry reading results")}
      </button>
    </>
  );
  return (
    <section className="cover-finder image-links" aria-label={t("Pictures the AI suggests")}>
      {retryRead}
      <p className="hint">
        {t(
          "AI suggests links, not verified pictures. The browser may load previews from image hosts. Review the source and usage rights before downloading a picture to the server and using it.",
        )}
      </p>
      {!asking && (
        <div className="cover-finder-head">
          {state.asked_at === null ? (
            <button
              type="button"
              className="link-button"
              title={noAi.missing ? noAi.why : t("Ask the AI to suggest picture links")}
              disabled={!canAsk}
              onClick={() => {
                noAi.whenSetUp(() => {
                  ask("");
                });
              }}
            >
              {t("Ask AI")}
            </button>
          ) : (
            <button
              type="button"
              className="link-button"
              aria-expanded={noting && canAsk}
              aria-controls={noteId}
              title={noAi.missing ? noAi.why : t("Ask the AI again, saying what picture you want")}
              disabled={!canAsk}
              onClick={() => {
                setNoting((was) => !was);
              }}
            >
              {t("Ask again")}
            </button>
          )}
        </div>
      )}
      {noting && !asking && canAsk && (
        <form
          id={noteId}
          className="picture-note"
          onSubmit={(event) => {
            event.preventDefault();
            if (approval.current !== undefined) return;
            noAi.whenSetUp(() => {
              ask(note);
            });
          }}
        >
          <label className="visually-hidden" htmlFor={`${noteId}-text`}>
            {t("Anything the AI should know?")}
          </label>
          <input
            id={`${noteId}-text`}
            className="picture-note-text"
            type="text"
            value={note}
            maxLength={500}
            placeholder={t(noteExample(pictured))}
            disabled={busy}
            // The field opens on pressing Ask again, to type the note at once.
            autoFocus
            onChange={(event) => {
              setNote(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                // Escape puts the note away, not the dialog it is in.
                event.stopPropagation();
                if (composing(event.nativeEvent)) return;
                event.preventDefault();
                setNoting(false);
              }
            }}
          />
          <button type="submit" className="dialog-button" disabled={busy}>
            {t("Ask")}
          </button>
        </form>
      )}
      {noAi.missing && (
        <div className="cover-finder-note">
          <p>
            {noAi.why} {noAi.admin && <AiSetUpHint newTab />}
          </p>
          {noAi.recheck !== undefined && (
            <button
              type="button"
              className="link-button"
              disabled={busy}
              onClick={() => {
                askedOnOpening.current = true;
                noAi.whenSetUp(readAgain);
              }}
            >
              {t("Check again")}
            </button>
          )}
        </div>
      )}
      {!noAi.missing && !state.may_suggest && (
        <p className="cover-finder-note">{t("AI picture suggestions are unavailable.")}</p>
      )}
      {asking && (
        <p className="cover-finder-note" role="status">
          <CircleNotchIcon weight="bold" className="spin" aria-hidden />
          {t(state.waiting ? "Waiting for Online to ask the AI…" : "Asking the AI for pictures…")}
        </p>
      )}
      {failure && (
        <p className="cover-finder-note error" role="alert">
          {t("Could not get picture suggestions: {{detail}}", { detail: failure })}
        </p>
      )}
      {approvalFailure !== undefined && (
        <p className="cover-finder-note error" role="alert">
          {approvalFailure.detail === undefined
            ? t("The download did not finish. Try again.")
            : t("Could not download the picture: {{detail}}", { detail: approvalFailure.detail })}
        </p>
      )}
      {!asking && !failure && state.asked_at !== null && links.length === 0 && (
        <p className="cover-finder-note">
          {t(
            pictured.kind === "album"
              ? "The AI knows no picture of this album."
              : "The AI knows no picture of this artist.",
          )}
        </p>
      )}
      {links.length > 0 && (
        <ul className="cover-finder-grid">
          {links.map((link) => {
            const site = siteOf(link.url);
            const downloading = link.fetching || approved === link.url;
            // A picture that won't show can't be judged; one the server found none at may be asked again.
            const notShown = broken.has(link.url) ? t("It can't be shown.") : "";
            const why = link.unavailable || notShown;
            const said = t(
              link.why ? "{{model}} suggested this: {{reason}}" : "{{model}} suggested this",
              { model: state.model || t("The AI"), reason: link.why },
            );
            return (
              <li key={link.url}>
                <div className="cover-choice image-link" title={why || said}>
                  <span className="image-link-picture">
                    {link.cover === null ? (
                      why === "" ? (
                        <img
                          src={link.url}
                          alt=""
                          loading="lazy"
                          decoding="async"
                          referrerPolicy="no-referrer"
                          onError={() => {
                            setBroken((was) => new Set([...was, link.url]));
                          }}
                        />
                      ) : (
                        <span className="image-link-missing">{t("Unavailable")}</span>
                      )
                    ) : (
                      <img
                        src={coverUrl(link.cover, "medium")}
                        alt=""
                        loading="lazy"
                        decoding="async"
                      />
                    )}
                    {downloading && (
                      <span className="cover-saving" role="status" aria-label={t("Downloading…")}>
                        <CircleNotchIcon weight="bold" className="spin" aria-hidden />
                      </span>
                    )}
                  </span>
                  <span className="cover-choice-about image-link-site" title={site}>
                    <SparkleIcon weight="fill" aria-hidden />
                    <span className="image-link-host">{site}</span>
                    {link.page === null ? (
                      <span>{t("No source page provided.")}</span>
                    ) : (
                      <a
                        className="image-link-host image-link-page"
                        href={link.page}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {t("Source page: {{site}}", { site: siteOf(link.page) })}
                      </a>
                    )}
                  </span>
                  {link.failure !== null && <span className="error">{link.failure}</span>}
                  <button
                    type="button"
                    className="secondary outline image-link-use"
                    aria-pressed={link.cover !== null && link.cover === shown}
                    aria-disabled={notShown !== ""}
                    aria-label={t(
                      link.cover === null
                        ? "Download and use the picture from {{site}}"
                        : "Use the picture from {{site}}",
                      { site },
                    )}
                    title={notShown || t(link.cover === null ? "Download it and use it" : "Use it")}
                    disabled={busy || downloading || approved !== undefined}
                    onClick={() => {
                      if (notShown !== "" || approval.current !== undefined) {
                        return;
                      }
                      if (link.cover === null) {
                        approve(link);
                      } else {
                        onUse(link.cover);
                      }
                    }}
                  >
                    {t(
                      link.cover !== null
                        ? "Use"
                        : link.unavailable === ""
                          ? "Approve"
                          : "Try again",
                    )}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
