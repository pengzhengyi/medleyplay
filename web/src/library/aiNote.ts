/** @file The note sent with a question to the AI. */

/** Return the note to send: the notes `ticked`, then the `details` typed, one to a line. */
export function noteOf(ticked: readonly string[], details: string): string {
  return [...ticked, details.trim()].filter((line) => line !== "").join("\n");
}
