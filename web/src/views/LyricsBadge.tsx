/** @file A static quotation mark on a song or album whose lyrics can be read. */

import { QuotesIcon } from "@phosphor-icons/react";

export function LyricsBadge({ label }: { readonly label: string | undefined }) {
  return label === undefined ? null : (
    <span className="lyrics-badge" role="img" aria-label={label} title={label}>
      <QuotesIcon weight="fill" aria-hidden />
    </span>
  );
}
