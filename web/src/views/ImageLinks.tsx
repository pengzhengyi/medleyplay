/**
 * @file Pictures an AI model suggests for an album's cover or an artist's photo, to approve one.
 *
 * Asked, a model names a few links to pictures; each shows here from its own site, as
 * any web page would show it, and one that can't be shown says so. Nothing is
 * downloaded until a picture is approved: then medleyplay downloads it and uses it,
 * as choosing a cover does. While a model is asked or a picture downloaded, it reads
 * again every few seconds. It shows once the links are read, so a server that can't
 * suggest any shows nothing.
 */

import { CircleNotchIcon, SparkleIcon } from "@phosphor-icons/react";
import { useEffect, useEffectEvent, useState } from "react";

import { type PictureLinks, type Pictured, type SuggestedLink, api, coverUrl } from "../api";
import { useAiSetUp } from "./aiSetUp";

const READ_EVERY_MS = 2000;

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

/** What the picture is of, in the words of the notes: *album* or *artist*. */
function subjectOf(pictured: Pictured): string {
  return pictured.kind === "album" ? "album" : "artist";
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
  const noAi = useAiSetUp();
  const [state, setState] = useState<PictureLinks>();
  // Counts the reads asked for, so each asks the server again.
  const [reads, setReads] = useState(0);
  const [error, setError] = useState("");
  // The links approved here and not yet used, and those whose picture won't show.
  const [approved, setApproved] = useState<ReadonlySet<string>>(new Set());
  const [broken, setBroken] = useState<ReadonlySet<string>>(new Set());
  const key = JSON.stringify(pictured);
  const readAgain = () => {
    setReads((count) => count + 1);
  };
  const forget = (url: string) => {
    setApproved((was) => new Set([...was].filter((each) => each !== url)));
  };

  const onRead = useEffectEvent((known: PictureLinks) => {
    setState(known);
    for (const link of known.links) {
      if (!approved.has(link.url)) {
        continue;
      }
      if (link.cover !== null) {
        forget(link.url);
        onUse(link.cover);
      } else if (!link.fetching && (link.unavailable !== "" || link.failure !== null)) {
        forget(link.url);
      }
    }
  });
  useEffect(() => {
    let current = true;
    api.imageLinks(JSON.parse(key) as Pictured).then(
      (known) => {
        if (current) {
          onRead(known);
        }
      },
      () => {
        // Unread, the section stays hidden; asking again reads it again.
      },
    );
    return () => {
      current = false;
    };
  }, [key, reads]);
  useEffect(() => {
    if (state?.asking !== true && !(state?.links.some((link) => link.fetching) ?? false)) {
      return;
    }
    const timer = setTimeout(readAgain, READ_EVERY_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [state]);

  const ask = () => {
    setError("");
    setBroken(new Set());
    setState((was) => (was === undefined ? was : { ...was, asking: true, failure: null }));
    api.suggestImageLinks(pictured).then(readAgain, (failure: unknown) => {
      setError(messageOf(failure));
      readAgain();
    });
  };
  const approve = (link: SuggestedLink) => {
    setError("");
    setApproved((was) => new Set([...was, link.url]));
    api.approveImageLink(pictured, link.url).then(
      ({ cover }) => {
        if (cover === null) {
          readAgain();
        } else {
          forget(link.url);
          onUse(cover);
        }
      },
      (failure: unknown) => {
        forget(link.url);
        setError(messageOf(failure));
      },
    );
  };

  if (state === undefined) {
    return null;
  }
  const links = state.links;
  const asking = state.asking;
  const failure = error || state.failure;
  const subject = subjectOf(pictured);
  return (
    <section className="cover-finder image-links" aria-label="Pictures the AI suggests">
      <div className="cover-finder-head">
        <h4>Suggested by AI</h4>
        {!asking && (
          <button
            type="button"
            className="link-button"
            aria-disabled={noAi.missing}
            title={noAi.missing ? noAi.why : "Ask the AI for pictures; nothing is downloaded yet"}
            onClick={() => {
              noAi.whenSetUp(ask);
            }}
          >
            {state.asked_at === null ? "Ask AI" : "Ask again"}
          </button>
        )}
      </div>
      {asking && (
        <p className="cover-finder-note" role="status">
          <CircleNotchIcon weight="bold" className="spin" aria-hidden />
          {state.waiting ? "Waiting for Online to ask the AI…" : "Asking the AI for pictures…"}
        </p>
      )}
      {failure && (
        <p className="cover-finder-note error" role="alert">
          {failure}
        </p>
      )}
      {!asking && !failure && state.asked_at !== null && links.length === 0 && (
        <p className="cover-finder-note">The AI knows no picture of this {subject}.</p>
      )}
      {links.length > 0 && (
        <ul className="cover-finder-grid">
          {links.map((link) => {
            const site = siteOf(link.url);
            const downloading = link.fetching || approved.has(link.url);
            // A picture that won't show can't be judged; one the server found none at may be asked again.
            const notShown = broken.has(link.url) ? "It can't be shown." : "";
            const why = link.unavailable || notShown;
            const said = `${state.model || "The AI"} suggested this${link.why ? `: ${link.why}` : ""}`;
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
                        <span className="image-link-missing">Unavailable</span>
                      )
                    ) : (
                      <img src={coverUrl(link.cover)} alt="" loading="lazy" decoding="async" />
                    )}
                    {downloading && (
                      <span className="cover-saving" role="status" aria-label="Downloading…">
                        <CircleNotchIcon weight="bold" className="spin" aria-hidden />
                      </span>
                    )}
                  </span>
                  <span className="cover-choice-about image-link-site" title={site}>
                    <SparkleIcon weight="fill" aria-hidden />
                    {link.page === null ? (
                      <span className="image-link-host">{site}</span>
                    ) : (
                      <a
                        className="image-link-host image-link-page"
                        href={link.page}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {site}
                      </a>
                    )}
                  </span>
                  {link.failure !== null && <span className="error">{link.failure}</span>}
                  <button
                    type="button"
                    className="secondary outline image-link-use"
                    aria-pressed={link.cover !== null && link.cover === shown}
                    aria-disabled={notShown !== ""}
                    aria-label={
                      link.cover === null
                        ? `Download and use the picture from ${site}`
                        : `Use the picture from ${site}`
                    }
                    title={notShown || (link.cover === null ? "Download it and use it" : "Use it")}
                    disabled={busy || downloading}
                    onClick={() => {
                      if (notShown !== "") {
                        return;
                      }
                      if (link.cover === null) {
                        approve(link);
                      } else {
                        onUse(link.cover);
                      }
                    }}
                  >
                    {link.cover !== null
                      ? "Use"
                      : link.unavailable === ""
                        ? "Approve"
                        : "Try again"}
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
