/**
 * @file The *Keep downloaded* switch of a Playlist: on, the server downloads every song it
 * holds and never removes them to make room.
 */

import { useState } from "react";

import type { Playlist } from "../api";

/** The switch for `playlist`, saved through `onChange`; why the server refused shows beside it. */
export function KeepDownloaded({
  playlist,
  onChange,
}: {
  readonly playlist: Playlist;
  readonly onChange: (playlist: Playlist, keep: boolean) => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  return (
    <div className="keep-downloaded">
      <label
        className="lyrics-sites-switch"
        title="Download every song here, and never remove them to make room"
      >
        <input
          type="checkbox"
          role="switch"
          checked={playlist.keep_downloaded}
          disabled={saving}
          aria-busy={saving}
          onChange={(event) => {
            const keep = event.target.checked;
            setSaving(true);
            setError("");
            onChange(playlist, keep).then(
              () => {
                setSaving(false);
              },
              (failure: unknown) => {
                setSaving(false);
                setError(failure instanceof Error ? failure.message : String(failure));
              },
            );
          }}
        />
        Keep downloaded
      </label>
      {error !== "" && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
