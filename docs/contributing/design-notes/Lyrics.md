# Lyrics

> [!NOTE]
> **Status: built.** Lyrics are kept per song and source, read from the
> files, looked up on LRCLIB as songs come up, read and written through the API, and
> shown while a song plays, and edited and synced in Edit details, as this note
> says, and looked up on NetEase Cloud Music once the household turns it on.

## Contents

- [What it offers](#what-it-offers)
- [Where lyrics come from](#where-lyrics-come-from)
- [Reading lyrics](#reading-lyrics)
- [Lyrics from the files](#lyrics-from-the-files)
- [Looking lyrics up on LRCLIB](#looking-lyrics-up-on-lrclib)
- [Looking lyrics up on NetEase](#looking-lyrics-up-on-netease)
- [Finding lyrics by hand](#finding-lyrics-by-hand)
- [What the API shows](#what-the-api-shows)
- [Showing them](#showing-them)
- [Editing them](#editing-them)
- [Testing](#testing)

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
| NetEase Cloud Music, once turned on, for a song LRCLIB lacks | `netease` | Built |

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

## Looking lyrics up on NetEase

- **Off until an admin turns it on:** Settings → Lyrics → *Also look on NetEase Cloud
  Music* saves `lyrics_sites: ["netease"]` in the household's settings. The `lyrics`
  enricher then asks NetEase for a song LRCLIB has no lyrics for, in the same Job; a
  refusal or failure from LRCLIB answers without asking NetEase.
- **Turning it on asks again:** the sites turned on are part of what a song is looked
  up by, so a song LRCLIB didn't know is looked up again at once, rather than a month
  later. With none turned on, a song is looked up by what it was before.
- **Only its plain endpoints:** NetEase offers no public API. medleyplay asks
  `GET /api/search/get` by title and artist, then `GET /api/song/lyric` by the id
  found, as itself, with the User-Agent it sends LRCLIB; nothing copies the signing or
  encryption NetEase's own apps use, and no header pretends to be a browser.
- **Which result:** the first with the song's title, compared without case or width,
  within two seconds of its length; of no known length, the first with its title and
  one of its artists.
- **What is kept:** the timed lyrics, a translation NetEase holds after them, each line
  at the time of the line it translates, or that the song is instrumental. Lyrics too
  long with their translation are kept without it.
- **Politely:** one request a second at most, a timeout on each. A 403, or the code
  NetEase answers a request it takes for a bot's, is a refusal, which stops the
  enricher until an admin resets it; a busy answer fails the lookup without asking
  again.

## Finding lyrics by hand

A lookup takes the one song a site matches to the file's title, artist, and length.
When it finds none, or the wrong one, as for a video whose title is not the song's,
the household looks for the lyrics itself, by a title and artist of its own.

- **The plugin's lyrics finder** (`lyrics_finder`) answers the songs each site finds
  of a title and artist, each with its lyrics: LRCLIB's search, at most five, then
  NetEase's first three, each asked for its lyrics, once the household turned NetEase
  on. Each site's songs come closest in length to the file first; a song with no
  lyrics, and not instrumental, isn't offered. A site refusing is said so, and what
  was found before it is kept.
- **Finding is a Job** in the lyrics enricher's lane, so it keeps the same pace with
  the lookups. What it finds is kept for the song, with what was asked, and finding
  again replaces it. Nothing changes the song's lyrics until the household uses one
  and saves.
- **An AI model's pick.** With an AI set up and the `ai-details` plugin on, the
  editor asks once the songs are found: a Job in the AI's lane shows a model the
  song's title, artist, album, and length, and each song found as a letter with its
  site, title, artist, album, length, and kind, never its lyrics. The model answers
  with one letter, or none, and why. The pick is marked *AI pick*, why in its tooltip,
  while those are the songs found; finding again drops it.

## What the API shows

| Route | Who | Does |
| --- | --- | --- |
| `GET /api/tracks/{id}/lyrics` | Signed in | The lyrics the song shows: where they came from, whether timed or instrumental, each line with its time, translation, and timed words, or the plain text, and the text as the source gave it, to edit; `null` for none |
| `PUT /api/tracks/{id}/lyrics` | Signed in | The household's lyrics, `{text}` (LRC or plain) or `{instrumental: true}`; 422 for empty text |
| `DELETE /api/tracks/{id}/lyrics` | Signed in | Drops the household's, answering what shows now |
| `POST /api/enrichers/lyrics/tracks/{id}` | Signed in | Looks the song up now; `?again` for one found before |
| `POST /api/tracks/{id}/lyrics/find` | Signed in | Finds the songs titled `{title, artist}` on the lyrics sites, for the song; 202, 409 while the lyrics plugin is off |
| `GET /api/tracks/{id}/lyrics/found` | Signed in | What was last found: the title and artist asked, each song found with its site, album, length, and lyrics, an AI model's pick and why, whether either is being asked, why either failed, and whether a model may be asked |
| `POST /api/tracks/{id}/lyrics/choose` | Signed in | Asks an AI model which song found is the song; 202, 409 with no songs found, no model set up, or the `ai-details` plugin off |
| `PUT /api/settings` | Admin | `lyrics_sites`, the sites asked after LRCLIB: `[]` or `["netease"]`; left out, they stay as saved |

## Showing them

- **Beside the cover in Now Playing,** in the place Up next takes, which they give
  way to: timed lyrics follow the song, the line sung now large and bright, those
  before and after it dim, each translation small under its line, a pause in the
  singing a small ♪. The line sung now sits a third of the way down, and the list
  scrolls smoothly to it, at once under reduced motion. Scrolling it oneself stops it
  following for four seconds. A line pressed plays from its time.
- **Plain lyrics** read as written; an instrumental says *Instrumental*; a song with
  none says *No lyrics for this song*; nothing shows while they are read.
- **The line sung now in the player,** under the artist, in the accent color;
  nothing between lines or for plain lyrics.
- **The *Lyrics* button** beside Up next in Now Playing shows or hides both, and this
  browser remembers it; they show until it is pressed. Pressed while Up next is open,
  it shows the lyrics in its place.
- **Which song's:** the song playing, a song of a file playing whole too, whose time
  counts from where the file reaches it; a whole album in one file has none. They are
  read again when a lookup of the song's lyrics finishes.
- **On a phone** the lyrics take the cover's place, as Up next does.

## Editing them

*Lyrics* in a song's Edit details opens the editor in place of the details, as the
songs of a file open; a whole album in one file has none. It starts from the lyrics
the song shows, as their source gave them, and says where they came from.

- **As text:** LRC or plain, typed or pasted, or *Instrumental* for a song with no
  lyrics.
- **Synced to the song:** each line a row, its time beside it. The song plays from
  its start, and Space, or *Stamp*, stamps the next line at the time played, then
  moves on; a line pressed is stamped next. A line's time pressed plays from there,
  and each line, or every line at once, moves a tenth of a second earlier or later.
  Lines not stamped yet are counted, and saved as plain lines. Syncing writes the
  text back as LRC, so the two modes edit the same lyrics.
- **Found:** the songs the sites have of a title and artist, which start as the
  song's own and may be changed. Opened for a song never looked for, it looks at
  once. Each song found shows its site, album, length, whether it is timed, plain,
  or instrumental, and its first two lines; *Use* fills the text with its lyrics,
  saying where they are from until saved. An AI model's pick is tagged *AI pick*.
- **Saving** makes them the household's, which show over every other source's and
  stop the song being looked up; *Remove yours* drops them, showing the next source's
  again. Either goes back to the details, and the lyrics shown are read again. A
  refusal, such as too many lines, shows in the editor, which stays open.

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
- **Finding by hand:** each site's finder over a fake transport (songs closest in
  length first, none without lyrics, at most a few, a refusal), the sites in turn,
  real Jobs that keep and replace what was found, and the editor's *Find*: looking on
  opening only once, looking again by other words, nothing found, a failure, and a
  song used then saved.
- **The AI's pick:** the chooser over a fake model (a letter, none, an unknown
  letter, a refusal), real Jobs that keep the pick and drop it on finding again, and
  the editor asking once, marking the pick, and saying why asking failed.
- **Showing them:** the line at a time (before the first, at each start, past the
  last), how far into a song of a file playing whole; reading them for the song
  playing and again on a finished lookup; the panel's lines, translation, pause,
  seeking, plain text, instrumental, none, and reading; the player's line; and Now
  Playing's button hiding both, remembered.
- **Editing them:** LRC written from lines, each stamped, moved, or all shifted; the
  editor starting from the lyrics shown, saving text or an instrumental, removing the
  household's, a refusal, stamping with Space and *Stamp* only while the song plays,
  and playing from the start and from a line; Edit details opening it in place and
  going back.
- **LRCLIB:** the client over a fake transport: what is asked, the search when the
  first ask finds nothing, the two-second window, the User-Agent, waiting out 429,
  503 too long, 403, 400, and an answer of another shape. No test contacts LRCLIB.
- **NetEase:** the client over a fake transport: plain GETs naming medleyplay, a
  second apart; the result taken by title and length, or title and artist; none
  found, none held, an instrumental three ways, a translation, lyrics too long with
  it and without it; a refusal by status and by code, busy answers, and answers of
  another shape. NetEase asked only when turned on and LRCLIB has none, and a song
  LRCLIB lacked looked up again at once when it is turned on. No test contacts
  NetEase.
