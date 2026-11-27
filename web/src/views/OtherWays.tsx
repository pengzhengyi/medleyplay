/**
 * @file The other ways to get a part's file: a command for each, with a copy button.
 *
 * The household runs them on their own computer; medleyplay never does.
 */

import { CheckIcon, CopyIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";

import { copyText } from "../clipboard";
import { otherWays } from "../library/otherWays";
import { useWords } from "../locale";

/** How long a copy button says it copied. */
const COPIED_MS = 2000;

/**
 * Other ways to get the file of the part at `link` on a site of `kind`, folded unless
 * `open`; nothing when there is no way known for the site.
 */
export function OtherWays({
  kind,
  link,
  open = false,
}: {
  readonly kind: string;
  readonly link: string;
  readonly open?: boolean;
}) {
  const t = useWords();
  const ways = otherWays(kind, link);
  const attempt = useRef(0);
  const [result, setResult] = useState<{ readonly command: string; readonly copied: boolean }>();
  useEffect(
    () => () => {
      attempt.current += 1;
    },
    [],
  );
  if (ways.length === 0) {
    return null;
  }
  const copy = (command: string) => {
    const current = ++attempt.current;
    setResult(undefined);
    void copyText(command).then((worked) => {
      if (attempt.current !== current) return;
      setResult({ command, copied: worked });
      if (worked) {
        setTimeout(() => {
          if (attempt.current === current) setResult(undefined);
        }, COPIED_MS);
      }
    });
  };
  return (
    <details className="other-ways" open={open}>
      <summary className="other-ways-summary">{t("Other ways to get the file")}</summary>
      <p className="other-ways-note">
        {t(
          "Run one on your own computer, then add the file it saves. medleyplay doesn’t run them.",
        )}
      </p>
      <ol>
        {ways.map((way) => {
          const outcome = result?.command === way.command ? result : undefined;
          return (
            <li key={way.name} className="way">
              <p className="way-name">{t(way.name)}</p>
              <p className="way-when">{t(way.when)}</p>
              <div className="way-command">
                <code>{way.command}</code>
                <button
                  type="button"
                  className="icon"
                  aria-label={t("Copy the {{name}} command", { name: t(way.name) })}
                  title={t(outcome?.copied === true ? "Copied" : "Copy")}
                  onClick={() => {
                    copy(way.command);
                  }}
                >
                  {outcome?.copied === true ? (
                    <CheckIcon weight="bold" aria-hidden />
                  ) : (
                    <CopyIcon weight="regular" aria-hidden />
                  )}
                </button>
              </div>
              <p
                className={outcome?.copied === false ? "hint" : "visually-hidden"}
                aria-live="polite"
                role={outcome === undefined ? undefined : "status"}
              >
                {outcome === undefined
                  ? ""
                  : t(
                      outcome.copied
                        ? "Command copied."
                        : "Could not copy the command. Select and copy it manually.",
                    )}
              </p>
            </li>
          );
        })}
      </ol>
    </details>
  );
}
