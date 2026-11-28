/**
 * @file The songs downloading, shown above those downloaded: each one's cover, title,
 * artist, and how far its Download has got.
 */

import { useId, useMemo, useState } from "react";

import type { DownloadUnderWay, Track } from "../api";
import { downloadDetailOf, downloadStateOf } from "../library/downloading";
import { useFormattingLocale, useWords } from "../locale";
import { Cover } from "./Cover";
import { DownloadDetails, type DownloadDetailsTarget } from "./DownloadDetails";
import { KindMark } from "./KindMark";
import { DownloadMenu } from "./TrackMenu";

/** List the songs of `tracks` that `downloads` get, or nothing while none is under way. */
export function Downloading({
  downloads,
  tracks,
  admin,
  accountId,
  cancelDownload,
}: {
  readonly downloads: readonly DownloadUnderWay[];
  readonly tracks: readonly Track[];
  readonly admin: boolean;
  readonly accountId: number;
  readonly cancelDownload: (jobId: number) => Promise<void>;
}) {
  const t = useWords();
  const locale = useFormattingLocale();
  const heading = useId();
  const [details, setDetails] = useState<DownloadDetailsTarget>();
  const byId = useMemo(() => new Map(tracks.map((track) => [track.id, track])), [tracks]);
  const shown = downloads.flatMap((download) => {
    const track = byId.get(download.track_id);
    return track === undefined ? [] : [{ download, track }];
  });
  const section =
    shown.length === 0 ? null : (
      <section className="downloading" aria-labelledby={heading}>
        <h3 id={heading} className="found">
          {t("Downloading")}
        </h3>
        <ul>
          {shown.map(({ download, track }) => {
            // A waiting Download's bar stays still and empty; a running one moves until the
            // Job says how far it has got.
            const fraction =
              download.job.state === "running" ? (download.job.progress?.fraction ?? null) : 0;
            const status = downloadStateOf(download, t);
            const detail = downloadDetailOf(download, status, { locale, t });
            return (
              <li key={download.job.id} className="downloading-row">
                <Cover size="small" cover={track.cover} className="downloading-cover" />
                <span className="downloading-names">
                  <span className="downloading-title">
                    <KindMark
                      kind={track.kind}
                      reason={track.kind_reason}
                      lyrics={track}
                      besideTitle
                    />
                    {track.title}
                  </span>
                  <span className="downloading-artist">{track.artist}</span>
                </span>
                <span className="downloading-state" title={detail}>
                  {status}
                </span>
                <DownloadMenu
                  track={track}
                  openDetails={() => {
                    setDetails({ job: download.job.id });
                  }}
                  cancel={
                    admin || download.job.requested_by === accountId
                      ? () => cancelDownload(download.job.id)
                      : undefined
                  }
                />
                <progress
                  aria-label={track.title}
                  aria-valuetext={detail}
                  max={1}
                  {...(fraction === null ? {} : { value: fraction })}
                />
              </li>
            );
          })}
        </ul>
      </section>
    );
  return (
    <>
      {section}
      {details !== undefined && (
        <DownloadDetails
          target={details}
          close={() => {
            setDetails(undefined);
          }}
        />
      )}
    </>
  );
}
