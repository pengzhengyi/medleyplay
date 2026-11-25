/**
 * @file The songs downloading, shown above those downloaded: each one's cover, title,
 * artist, and how far its Download has got.
 */

import { useId, useMemo } from "react";

import type { DownloadUnderWay, Track } from "../api";
import { downloadDetailOf, downloadStateOf } from "../library/downloading";
import { Cover } from "./Cover";

/** List the songs of `tracks` that `downloads` get, or nothing while none is under way. */
export function Downloading({
  downloads,
  tracks,
}: {
  readonly downloads: readonly DownloadUnderWay[];
  readonly tracks: readonly Track[];
}) {
  const heading = useId();
  const byId = useMemo(() => new Map(tracks.map((track) => [track.id, track])), [tracks]);
  const shown = downloads.flatMap((download) => {
    const track = byId.get(download.track_id);
    return track === undefined ? [] : [{ download, track }];
  });
  if (shown.length === 0) {
    return null;
  }
  return (
    <section className="downloading" aria-labelledby={heading}>
      <h3 id={heading} className="found">
        Downloading
      </h3>
      <ul>
        {shown.map(({ download, track }) => {
          // A waiting Download's bar stays still and empty; a running one moves until the
          // Job says how far it has got.
          const fraction =
            download.job.state === "running" ? (download.job.progress?.fraction ?? null) : 0;
          const status = downloadStateOf(download);
          return (
            <li key={download.job.id} className="downloading-row">
              <Cover size="small" cover={track.cover} className="downloading-cover" />
              <span className="downloading-names">
                <span className="downloading-title">{track.title}</span>
                <span className="downloading-artist">{track.artist}</span>
              </span>
              <span className="downloading-state" title={downloadDetailOf(download, status)}>
                {status}
              </span>
              <progress
                aria-label={track.title}
                aria-valuetext={status}
                max={1}
                {...(fraction === null ? {} : { value: fraction })}
              />
            </li>
          );
        })}
      </ul>
    </section>
  );
}
