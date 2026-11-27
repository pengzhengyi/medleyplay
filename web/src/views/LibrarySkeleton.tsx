/**
 * @file What the Library shows while its songs are read: rows shaped like songs, which
 * the songs then take the place of, so the page doesn't jump when they come.
 */

import { useWords } from "../locale";

/** How wide each placeholder row's title and artist are, as a song list's vary. */
const ROWS: readonly (readonly [number, number])[] = [
  [46, 28],
  [62, 22],
  [38, 30],
  [54, 18],
  [70, 26],
  [42, 34],
  [58, 20],
  [34, 24],
  [66, 30],
  [50, 16],
  [44, 28],
  [60, 22],
];

/** Rows shaped like songs, while the Library's are read; says so to a screen reader. */
export function LibrarySkeleton() {
  const t = useWords();
  return (
    <div className="library-skeleton" aria-busy="true">
      <p className="visually-hidden" role="status">
        {t("Loading your music…")}
      </p>
      <ul className="library-skeleton-rows" aria-hidden="true">
        {ROWS.map(([title, artist], place) => (
          <li key={place} className="library-skeleton-row">
            <span className="library-skeleton-cover" />
            <span className="library-skeleton-words">
              <span className="library-skeleton-bar" style={{ width: `${String(title)}%` }} />
              <span
                className="library-skeleton-bar faint"
                style={{ width: `${String(artist)}%` }}
              />
            </span>
            <span className="library-skeleton-bar length" />
          </li>
        ))}
      </ul>
    </div>
  );
}
