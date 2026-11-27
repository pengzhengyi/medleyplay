/**
 * @file Which artist going by a song's artist name the song is by, for two artists of one name.
 *
 * The ? in the artist's tag, *Another artist named Jay?*, opens a menu of every artist the
 * song shows. Under
 * each are the artists going by its name: the one the song is by now, checked; each other
 * one, with the albums its songs are on; and *Another artist called Jay*, which adds one.
 * A choice moves this song alone, at once.
 *
 * ```text
 * Another artist named Jay?
 *   Jay
 *   ✓ The one it is by now
 *     On Jay, 范特西 · 3 songs
 *   + Another artist called Jay
 * ```
 */

import * as Menu from "@radix-ui/react-dropdown-menu";
import { CheckIcon, PlusIcon, QuestionIcon } from "@phosphor-icons/react";
import { Fragment } from "react";

import type { Namesake, TrackArtist } from "../api";
import { type Words, useWords } from "../locale";

/** Return what tells another artist of a name apart: who it is, its albums, and its songs. */
function namesakeLabel(namesake: Namesake, t: Words): string {
  const songs = t("song_count", { count: namesake.songs });
  const albums =
    namesake.albums.length === 0
      ? ""
      : t("On {{albums}}", { albums: namesake.albums.join(t(", ")) });
  return [namesake.linked?.name, albums, songs].filter(Boolean).join(" · ");
}

export function WhichArtist({
  artists,
  disabled,
  onChoose,
}: {
  /** The artists the song shows, as saved. */
  readonly artists: readonly TrackArtist[];
  readonly disabled: boolean;
  /** Bind the song's artist `written` to the artist `id`, or to another one for `null`. */
  readonly onChoose: (written: string, id: string | null) => void;
}) {
  const t = useWords();
  const [only] = artists;
  if (only === undefined) {
    return null;
  }
  const one = artists.length === 1;
  const why = t("Choose the artist for this song. Changes apply immediately.");
  return (
    <Menu.Root modal={false}>
      <Menu.Trigger asChild disabled={disabled}>
        <button
          type="button"
          className="icon artist-tag-which"
          title={why}
          aria-label={
            one
              ? t("Another artist named {{name}}?", { name: only.written })
              : t("Another artist of the same name?")
          }
        >
          <QuestionIcon weight="bold" aria-hidden />
        </button>
      </Menu.Trigger>
      <Menu.Content
        className="track-menu which-artist"
        align="end"
        sideOffset={4}
        collisionPadding={8}
      >
        {artists.map((artist, index) => (
          <Fragment key={artist.artist_id}>
            {index > 0 && <Menu.Separator className="track-menu-line" />}
            <Menu.Label className="track-menu-label">{artist.written}</Menu.Label>
            <Menu.RadioGroup
              className="track-menu-group"
              value={artist.artist_id}
              onValueChange={(id) => {
                if (id !== artist.artist_id) {
                  onChoose(artist.written, id);
                }
              }}
            >
              <Menu.RadioItem className="track-menu-item" value={artist.artist_id}>
                <span className="which-artist-text">{t("The one it is by now")}</span>
                <Chosen />
              </Menu.RadioItem>
              {artist.namesakes.map((namesake) => (
                <Menu.RadioItem
                  key={namesake.artist_id}
                  className="track-menu-item"
                  value={namesake.artist_id}
                >
                  <span className="which-artist-text">{namesakeLabel(namesake, t)}</span>
                  <Chosen />
                </Menu.RadioItem>
              ))}
            </Menu.RadioGroup>
            <Menu.Item
              className="track-menu-item"
              onSelect={() => {
                onChoose(artist.written, null);
              }}
            >
              <span className="track-menu-icon" aria-hidden>
                <PlusIcon />
              </span>
              {t("Create another artist named {{name}}", { name: artist.written })}
            </Menu.Item>
          </Fragment>
        ))}
      </Menu.Content>
    </Menu.Root>
  );
}

/** A check at the end of the artist the song is by now. */
function Chosen() {
  return (
    <Menu.ItemIndicator className="track-menu-chosen">
      <CheckIcon aria-hidden />
    </Menu.ItemIndicator>
  );
}
