/**
 * @file The other ways to get a part's file: a command for each, with a copy button.
 *
 * The household runs them on their own computer; medleyplay never does.
 */

import { CheckIcon, CopyIcon } from "@phosphor-icons/react";
import { useState } from "react";

import { copyText } from "../clipboard";
import { otherWays } from "../library/otherWays";

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
  const ways = otherWays(kind, link);
  const [copied, setCopied] = useState<string | undefined>(undefined);
  if (ways.length === 0) {
    return null;
  }
  const copy = (command: string) => {
    void copyText(command).then((worked) => {
      if (worked) {
        setCopied(command);
        setTimeout(() => {
          setCopied((now) => (now === command ? undefined : now));
        }, COPIED_MS);
      }
    });
  };
  return (
    <details className="other-ways" open={open}>
      <summary className="other-ways-summary">Other ways to get the file</summary>
      <p className="other-ways-note">
        Run one on your own computer, then add the file it saves. medleyplay doesn’t run them.
      </p>
      <ol>
        {ways.map((way) => (
          <li key={way.name} className="way">
            <p className="way-name">{way.name}</p>
            <p className="way-when">{way.when}</p>
            <div className="way-command">
              <code>{way.command}</code>
              <button
                type="button"
                className="icon"
                aria-label={`Copy the ${way.name} command`}
                title={copied === way.command ? "Copied" : "Copy"}
                onClick={() => {
                  copy(way.command);
                }}
              >
                {copied === way.command ? (
                  <CheckIcon weight="bold" aria-hidden />
                ) : (
                  <CopyIcon weight="regular" aria-hidden />
                )}
              </button>
            </div>
          </li>
        ))}
      </ol>
    </details>
  );
}
