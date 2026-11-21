/**
 * @file The mark shown while the page starts: `index.html` shows it before the script
 * runs, and the app until it knows who is signed in, so the page is never blank.
 */

/** The word medleyplay, busy, in the middle of the page. */
export function Starting() {
  return (
    <p className="starting" aria-busy="true">
      medleyplay
    </p>
  );
}
