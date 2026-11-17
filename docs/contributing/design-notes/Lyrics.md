# Lyrics

> [!NOTE]
> **Status: in part built.** Lyrics are kept per song and source, read from the
> files, looked up on LRCLIB as songs come up, and read and written through the
> API, as this note says. The lyrics shown while a song plays, the editor, and other
> sites are planned, in that order.

## Contents

- [What it offers](#what-it-offers)
- [Where lyrics come from](#where-lyrics-come-from)
- [Reading lyrics](#reading-lyrics)
- [Lyrics from the files](#lyrics-from-the-files)
- [Looking lyrics up on LRCLIB](#looking-lyrics-up-on-lrclib)
- [What the API shows](#what-the-api-shows)
- [Testing](#testing)
- [Planned](#planned)

## What it offers

The words of the song playing, timed line by line where a source times them, as
Apple Music shows them: beside the cover in Now Playing, the line sung now under
the title in the player, and a button that shows or hides them. An AI model is
never a source of lyrics: it would make them up.

## Where lyrics come from

Each source's lyrics are kept apart (`track_lyrics`, one row per song and source),
as the source gave them, and the first held shows:

| Source | Origin | State |
| --- | --- | --- |
| What the household entered | `household` | Built |
| A `.lrc` file beside the audio, named as it is | `sidecar` | Built |
| The audio's tags (ID3 USLT or SYLT, Vorbis LYRICS, MP4 ©lyr) | `tag` | Built |
| LRCLIB, an open lyrics database | `lrclib` | Built |

- **Instrumental is an answer:** a source may say a song has no lyrics, which shows
  as such and is kept as lyrics are.
- **Lyrics of the household's or its files' are never replaced** by lyrics looked up,
  and such a song is never looked up.

## Reading lyrics

Lyrics are read when shown, so a better reading needs no lookup again. Text with a
timed line is LRC; any other is plain lyrics, shown as written.

```text
[ti:Melt]                         a tag about the song, not a line
[offset:+500]                     every line half a second earlier
[00:12.34]朝目が覚めて               a line, and the time it is sung
[00:12.34]Waking up               the same time again: its translation
[00:30.00][01:30.00]Chorus        a line sung at each time
[01:00.00]<01:00.00>Hello <01:00.50>world   each word at its own time
```

- **Lines are in time order,** an empty one being a pause in the singing.
- **At most** 64 KiB of text and 2,000 timed lines.

## Lyrics from the files

A Library scan reads both, and keeps them apart, so removing one leaves the other.

- **The tags:** the tag reader returns a file's lyrics with its other tags. Of
  several entries, as an MP3 may hold, the first timed one is read, else the first;
  an ID3 `SYLT` frame comes as LRC. Lyrics longer than 64 KiB are left unread.
  Tags read again without lyrics drop the `tag` lyrics.
- **The `.lrc` beside the audio,** named as it is, in any case (`Melt.LRC` beside
  `Melt.mp3`): read when new or changed, or by a full scan, as the `.info.json` is,
  its stamp kept in the Source's details (`lrc`). It is read as UTF-8, with or
  without a byte order mark, as UTF-16 with one, and otherwise as GB18030, which many
  Chinese `.lrc` files are written in. One that can't be read as lyrics keeps the
  lyrics read before and notes why (`lrc_error`); one that can't be opened is read
  again next scan; one removed takes its lyrics with it.
- **Every file is read once more:** the reader's version is 4, so the first scan
  after this reads each file's tags again.
- **A song inside a longer file** has none of its file's lyrics: the file's are the
  whole album's.

## Looking lyrics up on LRCLIB

- **An enricher, `lyrics`,** in the plugin `lyrics`, so it shares the enrichers'
  lanes, modes, refusal stop, and Settings ([Track details](Track%20details.md#enrichers)).
  It answers lyrics rather than details: it records no values.
- **Asked as songs come up by default:** the song playing and the one after it, as
  the web client's look-ahead asks every enricher set to *Next to play*, so the song
  playing has its lyrics and the next one has them ready. *Manually* is the other
  way; *All missing* is not offered, as it would ask a free service about the whole
  Library. The plugin is on unless the config turns it off, as an open API's is.
- **What is asked:** a song's title, artist, album, and length, without its file's
  name, as MusicBrainz is. A song inside a longer file is asked about itself, by its
  own title and length; a whole album is not asked about.
- **How LRCLIB is asked:** `GET /api/get` with the title, artist, album, and length
  in seconds, which LRCLIB matches within two seconds; a song it doesn't find so is
  searched for (`/api/search`) by title and artist, the first result within two
  seconds of its length taken. A song of no known length is searched for, and the
  first result with its exact title and artist taken. Timed lyrics are taken over
  plain ones.
- **Politely:** one request at a time, half a second apart, a User-Agent naming
  medleyplay and where to reach it, a timeout on each. A 429 or 503 is waited out as
  `Retry-After` says, with up to 30% more, three times at most; a 403 is a refusal,
  which stops the enricher until an admin resets it; any other answer it can't use is
  invalid.
- **Asked again:** a song LRCLIB didn't know, a month later, or at once when its
  title, artist, album, or length changes; one whose lyrics were found, only when
  someone asks again.

## What the API shows

| Route | Who | Does |
| --- | --- | --- |
| `GET /api/tracks/{id}/lyrics` | Signed in | The lyrics the song shows: where they came from, whether timed or instrumental, each line with its time, translation, and timed words, or the plain text; `null` for none |
| `PUT /api/tracks/{id}/lyrics` | Signed in | The household's lyrics, `{text}` (LRC or plain) or `{instrumental: true}`; 422 for empty text |
| `DELETE /api/tracks/{id}/lyrics` | Signed in | Drops the household's, answering what shows now |
| `POST /api/enrichers/lyrics/tracks/{id}` | Signed in | Looks the song up now; `?again` for one found before |

## Testing

- **Reading:** LRC with several times on a line, an offset, translations, timed
  words, pauses, plain text, and the limits.
- **From the files:** the tag reader over MP3s holding lyrics, one, several, and too
  many; the scan program over `.lrc` files in UTF-8, GBK, and with a byte order mark,
  in capitals, with no audio, unchanged, changed, and unreadable; and real scans that
  show the tags' lyrics, the `.lrc`'s over them, an `.lrc` added and removed, tags
  that lose their lyrics, and an `.lrc` that can't be read.
- **Which songs are asked about:** a whole album, a song inside a longer file, lyrics
  held, found, or not found, and asking again.
- **Looking up:** real Jobs against the test plugin, which answers by title: lyrics
  timed and plain, an instrumental, nothing, a refusal, and a failure.
- **LRCLIB:** the client over a fake transport: what is asked, the search when the
  first ask finds nothing, the two-second window, the User-Agent, waiting out 429,
  503 too long, 403, 400, and an answer of another shape. No test contacts LRCLIB.

## Planned

- **Showing them:** a column beside the cover in Now Playing, the line sung now
  large and those sung dim, a line clicked seeking to it, translations under their
  lines; the line sung now under the title in the player; and an icon button that
  shows or hides them, remembered.
- **The editor:** in Edit details, LRC or plain text, and a mode that plays the song
  and stamps each line as Space is pressed, each nudged by a tenth of a second, and
  the whole shifted.
- **Other sites:** more providers, such as NetEase, each turned on in Settings and
  asked after LRCLIB. NetEase offers no public API, so only its plain endpoints are
  used, never anything that copies its request signing.
