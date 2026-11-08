# Track details

> [!NOTE]
> **Status: in progress.** This note describes a Track's details (its title,
> artist, album, cover, and the rest), where each value comes from, how the
> household's own values win, and how medleyplay finds what a file doesn't say.
> The enrichers for Bilibili, MusicBrainz, and AI are built.
> Splitting a long file into songs is in [Segments](Segments.md).

## Contents

- [Why](#why)
- [The details](#the-details)
- [Origins and precedence](#origins-and-precedence)
- [The household's values](#the-households-values)
- [What medleyplay reads](#what-medleyplay-reads)
- [Covers](#covers)
- [Enrichers](#enrichers)
- [What the API shows](#what-the-api-shows)
- [Build order](#build-order)
- [Testing](#testing)
- [Left for later](#left-for-later)

## Why

A file saved from a video site often says nothing about its music: no tags, no
cover, only a name such as `BV1dm4y1s7ak.m4a`. Its details are in the video's
title and description, in a file the download tool can write beside it, or in
the household's head. medleyplay reads each, keeps where each value came from,
and lets the household's word win.

## The details

| Field | Kind | Example |
| --- | --- | --- |
| `title` | text | 過食性:アイドル症候群 |
| `artist` | text, as written | GUMI/MAYU |
| `album` | text | ケビョウニンゲン |
| `album_artist` | text | MAYU |
| `track_number`, `disc_number` | whole numbers from 1 | 3, 1 |
| `year` | a year | 2014 |
| `genre` | text | Vocaloid |
| `cover` | a cover's id; see [Covers](#covers) | `9f2c…` |
| `kind` | `song`, or `album` for a whole album in one file | album |

- **Text** is at most 512 characters, trimmed. The household's value outside these
  rules is refused; a value read from a file or a site is cut to fit instead, and
  blank text or a number out of range is no value.
- **The Track's row keeps the shown value** of each field, so sorting, search,
  smart playlists, and the Albums and Artists views read it as they do now.
- **A song list,** the songs inside a long file, is kept the same way; see
  [Segments](Segments.md).
- **A Track's kind** says whether it is one song or one file holding a whole
  album: two values only, with no releases, EPs, or singles to tell apart. The
  question is whether someone picks it as a whole; a live set or a compilation in
  one file is an album. The household may name it, as *Mark as album* and
  *Mark as song* in a Track's menu do; otherwise it is worked out
  when read, so it never goes stale as a file's length becomes known or its
  songs change:

  | The Track | Its kind | Why |
  | --- | --- | --- |
  | A song of a split file | song | `segment` |
  | A split file | album | `split` |
  | Named by an origin | as named | `named` |
  | Any other, 20 minutes or longer | album | `length` |
  | Any other, shorter or of unknown length | song | `length` |
  | Any other, with the guess turned off | song | `default` |

  The length is the household's setting `album_minutes`, 20 by default, which
  an admin changes in *Settings → Songs and albums* or sets to `null` to guess
  nothing. The first three reasons settle the kind; `length` and `default` are
  assumptions, which the page draws apart. Changing the setting sends every open
  page a `tracks` event over the event stream, and each reads the Tracks again.

  The Track's row keeps only a kind an origin names, and the API answers the kind
  worked out. Calling a split file a song, or giving a song of one a kind, is
  refused; splitting a file forgets the household's word that it was a song, so
  unsplitting it guesses again. A split file's kind never reaches its songs, as
  its album fields do.

## Origins and precedence

Each value is kept with its *origin*, so a later finding never overwrites the
household's word, and a source can be read again without losing anyone else's
values.

| Origin | What it is |
| --- | --- |
| `household` | A value someone in the household entered |
| `files` | The file's tags, and an image beside it with its name |
| `musicbrainz` | A release matched in MusicBrainz, with its cover |
| `video` | The video's own text: its title, uploader, description, and chapters, read from a file beside the audio, pasted by the household, or read from the site, and the video's cover |
| `album_file` | For a song inside a long file, its album file's album fields; see [Segments](Segments.md) |
| `file_name` | The file's name, the title of last resort |
| `ai` | What an AI model suggested from the video's text; a suggestion, never shown |

- **The shown value is the first origin that has one,** in the table's order,
  `ai` left out: it only suggests, so it takes part in no shown value and
  *Edit details* offers it beside the field instead.
  `files` comes before `video`, since tags are written on purpose, and when a
  file's tags are garbled, the household's value is the way out.
- **The album fields travel together:** `album`, `album_artist`, `year`,
  `track_number`, `disc_number`, and `cover` are shown from the first origin
  that names an album, so one Track never mixes two releases. A household value
  for any of them still wins on its own. When that origin has no cover, the
  cover comes from the first origin naming no album, which can't belong to
  another release: a video's details name the album, and the image beside the
  file is its cover. An album the household names corrects the one it
  replaces, such as a spelling, so that album's cover stays until the household
  gives its own or empties it.
- **Empty text is a value:** the household can set a field to show nothing, and
  dropping its value shows the next origin's again.
- **A scan reads a file again** when it changed, or when the medleyplay that last
  read it read less from a file, so a field the tag reader learns fills in on the
  next scan.
- **Every value is a row** of `track_value`: the Track, the field, the origin,
  the value, and when it was recorded. One function writes values and rewrites
  the Track's shown values in the same transaction; the scan, adding a link,
  and the household all write through it, and nothing else writes the row.
- **Adding a site Track** records its title and artist as `video`, since they are
  the site's text, which the household may have tidied but needn't own.
- **The migration** records today's values: a Library Track's title as
  `file_name` when it is the file's name and as `files` otherwise, its other
  fields as `files`, and a site Track's as `video`.

## The household's values

- **Any signed-in Account may edit a Track's details,** as any may add a link:
  the catalog is the household's.
- ***Edit details*** shows each field's value, where it came from, and what each
  other origin says, so the household can take a found value with one click or
  type its own. Its boxes show what saving would show, as the album fields
  change together: naming an album of the household's own empties the file's
  track number at once. The client keeps its own copy of the shown-value rule
  for this; the server and the client are checked against one table of cases
  (`tests/support/shown_details.json`), so the two can't drift.
- **How the dialog lays it out:** the cover large at the side, with the ways to
  fill the details in under it, and the fields beside them. Over the cover, on
  hover or focus, and always on a touch screen, are *Save image*, *Replace*,
  and, for the household's own cover, *Remove*. Each value's origin is a small
  tag, a mark and a word such as *BV* or *MB*, which says *From the video* in
  full in its tooltip and to screen readers. Each other origin's value carries
  its origin's mark.
- **Looking the song up from the dialog:** a button for each lookup the song
  may be asked about, as in its menu, sits under the cover, and how the one
  asked goes shows beside them. Once it is done, the dialog reads the details
  again, keeping what was typed, so the new values show at once.
- **Saving sends only what changed,** each value set or dropped, so an edit of
  one field never overwrites another made meanwhile on another device. A value
  the household types or chooses that reads as what would show anyway, such as
  `03` over the file's track 3, is dropped rather than saved, so the found value
  still follows the file.
- ***Paste the video's details*** takes a video's title and description, copied
  from the site in a browser, and reads them as the `video` origin, as if the
  file beside the audio had held them. This works for any video, and asks the
  site nothing. What it reads replaces what the video said before, including
  what adding a site link recorded and what the site enricher read, since all are
  the video's own text; the latest text read wins. The text is kept with the Track, so the
  dialog opens with it to correct and read again, and the songs it lists stay
  for [Segments](Segments.md). A paste with no words is refused.
- **Many Tracks at once:** the same values, such as an album and its artist, can
  be set on several Tracks.

## What medleyplay reads

- **The file's tags,** as now, and its embedded cover.
- **The file's length:** a fragmented MP4, as Bilibili's downloads are, has no
  length in its header, and the tag reader answers none for about a third of
  them. The tags plugin reads it from the file's fragments instead.
- **Files beside the audio,** with its name: `<name>.info.json`, the video
  details yt-dlp writes with `--write-info-json`, and `<name>.jpg`, `.jpeg`,
  `.png`, or `.webp`, a cover such as `--write-thumbnail` writes (see
  [Covers](#covers)). A scan notes them, and reads them again when they change.
  - **An `.info.json` is read** when it is new, when its size or modified time
    differs from what the last scan kept, and on a full scan, even when the audio
    file is unchanged. Its title, description, and chapters become the Track's
    video text, as a paste would; any other `.json`, and an `.info.json` with no
    audio file of that name beside it, is ignored. A file over 5 MiB is not read.
  - **The latest text read wins:** a changed file replaces a paste, and a paste
    stands until the file changes, even when a full scan reads it again. Without
    a paste, a full scan parses the unchanged file again, so a better reading
    from a newer medleyplay shows.
  - **A malformed or oversized file keeps the earlier text** and values. The scan
    notes the error on the Source, and a later good read clears it; one that
    couldn't be opened, as on a drive too slow to answer, is read again next scan.
  - **The file is nobody's word:** text that isn't valid Unicode keeps a
    replacement character, a chapter's title is cut to a title's length, and
    chapters past a thousand, or starting more than a week in, are left out.
  - **A removed file drops only text read from a file,** with the `video` values
    it gave; a household paste stays. A sidecar with no words records nothing.
- **The video id** comes from the Track's Bilibili Source, or from a file name
  that is a `BV` id, such as `BV1dm4y1s7ak.m4a`.
- **The video's text is read by one parser,** a pure function of the core: it
  drops bracketed tags such as `【MV】` or `[Hi-Res]`, splits `artist - title`
  and `title / artist`, takes a year ending the artist's name, as in
  `朴树2003《生如夏花》`, as the year, recognizes an album by words such as `专辑`, `全专`, or
  `Full Album`, and reads a song list from the chapters or from timestamps in
  the description, such as `03:21 Song - Artist`.

## Covers

- **A cover is an image kept once** in `covers/` in the data folder, named by
  the SHA-256 of its bytes, so the songs of an album share one file.
- **Accepted:** JPEG, PNG, or WebP, known by their first bytes, not their names,
  at most 10 MiB.
- **Where covers come from:** the file's tags; an image beside the file with its
  name; the video's cover, which the site enricher reads with the video's text;
  and the household's upload. The video's cover is the `video` origin's `cover`,
  kept through the same store as every other cover.
- **A scan finds two covers.** The tag reader returns the file's embedded front
  cover when it is a JPEG, PNG, or WebP of at most 10 MiB; any other image is no
  cover. An image beside the file is `<name>.jpg`, `.jpeg`, `.png`, or `.webp`,
  the name `--write-thumbnail` gives, matched as an `.info.json` is: in the
  audio's folder, with the audio's path minus its suffix, whatever the case of
  its extension, the first found in that order. An image with no audio file of
  its name beside it is ignored and never becomes a Track.
- **When they are read.** The embedded cover is read with the file's tags: when
  the file is new or changed, on a full scan, and when a newer medleyplay reads
  more than the one that last read it. The image beside the file is read when it
  is new, when its extension, size, or modified time differs from what the last
  scan kept, and on a full scan, even when the audio file is unchanged.
- **Precedence.** A scan records the cover it finds as the `files` origin's
  `cover`, with the file's other tag values, and an embedded cover wins over an
  image beside the file. The household's cover is the `household` origin, which
  a scan never touches, so it stays over both. A removed image drops the cover it
  gave, and a file with an embedded cover keeps that one.
- **An image that isn't a cover,** one over 10 MiB or whose bytes aren't a JPEG,
  PNG, or WebP image, is noted as an error on the Source and does not fail the
  scan. It keeps the cover the earlier image gave, and a later good read clears
  the error; one that couldn't be opened, as on a drive too slow to answer, is
  read again next scan.
- **A scan result holds no image bytes.** The scan's Job copies each image into
  its working folder as it reads it, named by the SHA-256 of its bytes, so the
  songs of an album share one copy, and the result carries only the copy's path.
  Applying the result moves the copy into `covers/` as the upload does.
- **A cover is a detail** like the others, its value the cover's name, and one of
  the album fields, so it comes from the origin naming the album, or from the
  one the household's album corrects, or else from an origin naming none, and a split file's songs take their file's. The
  household may also name an existing cover, or none with empty text.
- **Served** with the type its bytes say, `nosniff`, and
  `Cache-Control: private, max-age=31536000, immutable`, since its name is its
  content.
- **The web client** shows covers beside each title in the table and in Up next,
  on an album's card (the first cover among its songs), in the player and on the
  lock screen through the Media Session's artwork, and in *Edit details* with the
  household's upload. An image that fails to load shows the stand-in instead.
- **A cover no value names** is removed by the sweep at startup, so one replaced
  or removed stays on disk until the server next starts.

## Enrichers

An *enricher* proposes values from somewhere the scan doesn't look. It is a
plugin at its own extension point, `TRACK_ENRICHER`, so a buggy or slow one can't
harm the core, and each is turned on or off like any plugin. `bilibili-details`,
`musicbrainz`, and `ai-details` are built and, like `bilibili`, are off until the
config file turns them on, since each contacts a site or a provider.

- **Each enricher has a mode, manual by default,** which an admin chooses in its
  part of Settings and the household keeps:

  | Mode | Asks |
  | --- | --- |
  | *Manually* | Only when someone chooses *Find details online*, *Find on MusicBrainz*, or *Suggest details with AI* in a Track's menu or its details |
  | *Next to play* | Also about the song playing and the one after it, once each in a page, as each comes up; a song of a split file through its file |
  | *All missing* | Also about every Track it may be asked about, at once when chosen, and about each that becomes one: a sweep runs a few seconds after a scan, a Download, a Track added, or a Job's end, and every hour besides |

  Every mode keeps the site's stop, the day between asks of one subject, and the
  lane's pace, so finding all asks one Track at a time. A sweep that fails is
  logged, and the next goes ahead. Settings says how many Tracks the enricher
  may be asked about now.
- **The song's cover shows a lookup as it goes,** from the Job's events on the
  page's event stream. A spinner shows while it is asked; a clock shows while it
  waits for Online. A check shows for a few seconds once it is done. A warning
  shows if it failed, and its tooltip and accessible name say why. Screen readers
  hear the lookup asked through a status region. The page shows no notice for it,
  as the cover is where it happens.
- **It is asked** with the Track's shown values and their origins (without the
  values the enricher recorded itself), its length, its file's name, whether it
  is a whole album by its Kind, its video id when it reads videos, and its
  video text when it reads that. It answers with values for any field, or
  with the video's text (title, description, and chapters) in place of parsed
  values, and may write one cover into a folder of the Job's, which it names, as
  a download names its file. `bilibili-details` answers the video's text and its
  cover.
- **The core checks an answer** like the household's input. Values are checked
  as the household's are and recorded under the enricher's origin, replacing that
  origin's earlier values for the Track. The video's text is read by the same
  parser as a sidecar or a paste, as the `video` origin, so *Edit details* shows
  the text that was read; the cover is recorded as the origin's `cover`.
- **Which Tracks are asked for.** For `bilibili-details`, a Track with a video id
  (its Bilibili Source, or a Library file named for a `BV` id), that is not a
  segment (its album file is asked instead), whose video text didn't come from a
  file beside it or from the household, and whose video wasn't asked about in the
  last 24 hours. For `musicbrainz`, see [MusicBrainz](#musicbrainz); for
  `ai-details`, see [AI suggestions](#ai-suggestions). What each
  subject (a video, or a Track and what it was searched for) was last asked about
  is kept in the database, so a restart forgets nothing. A video that is gone
  counts as asked; a failure that a retry could fix, such as a lost connection or
  a fault in the plugin, doesn't.
- **Site text yields to every other source.** A sidecar read later replaces
  site text, a full scan that reads an unchanged sidecar again included, since
  only a paste stands over an unchanged sidecar. Text the household entered while
  a Job runs stays: the Job records nothing over it.
- **Each Track is one Job per enricher,** of the kind `enrich_track` and the
  target `track:<id>:<enricher>`, so asking a second enricher about a Track
  queues its own Job rather than returning the first one's. The Jobs of one enricher run one at
  a time, with at least a pause between two calls: 5 seconds for
  `bilibili-details`, 1 second for `musicbrainz`, and 2 seconds for `ai-details`,
  counted from the end of one to the start of the next. Like other network Jobs
  they wait while the Mode is Offline, and `bilibili-details` goes through the
  site's proxy as Downloads do: the plugin's page, API, and cover requests all use
  one handler, which takes the proxy as given. `musicbrainz` and `ai-details` have
  no proxy, since neither is the household's Bilibili route.
- **The first refusal stops the enricher.** When the site refuses a request (an
  HTTP 403 or 412, or one of its risk-control codes, such as 352 or 412, in
  yt-dlp's error, MusicBrainz's 403, or a 401 or 403 from every AI provider), the Job
  fails as *refused*, every Job of that enricher that
  hasn't started fails with a message saying why, and nothing more is asked until
  an admin resets it in Settings. The stopped state is kept in the database. A
  Job retried while the enricher is stopped fails without asking. A video that
  doesn't exist, or is private, fails that Track's Job alone.
- **A segment is never enriched;** its album file is.

| Enricher | Origin | Reads | State |
| --- | --- | --- | --- |
| `bilibili-details` | `video` | The video's text and cover through yt-dlp, for a video with an id | Built |
| `musicbrainz` | `musicbrainz` | The MusicBrainz API and the Cover Art Archive, at most once a second | Built |
| `ai-details` | `ai`, suggestions only | An AI model of the household's choice, with the household's key | Built |

- **The site enricher is its own plugin,** not part of `bilibili`, so its faults
  never stop Downloads. It reuses the Bilibili plugin's yt-dlp wrapper and info
  readers. It fetches a cover only from Bilibili's image hosts, and a cover it
  can't fetch, or that is no JPEG, PNG, or WebP image of at most 10 MiB, leaves
  the text without one.
- **Each enricher stops on its own:** MusicBrainz refusing a request leaves
  `bilibili-details` running, and the reverse.
- **The AI enricher only suggests:** its values show in *Edit details* for the
  household to take, never as shown values, since it reads the same text the
  parser does.

### MusicBrainz

`musicbrainz` finds the release a Track is on, and its front cover. It is a
hand-written client on `requests` with a Pydantic model for each field it reads,
and is synchronous: the one-request-a-second limit sets its pace, so an async
library would add nothing.

- **Which Tracks are searched for.** A Track that is not a segment and shows a
  title and an artist that don't come only from its file's name; a `BV…` file
  name is no search term. It needs no video, and video text the household entered
  doesn't matter. A Track whose Kind is album, as the Library shows it (split
  into songs, named an album, or as long as the household's album length), is
  matched as a release, never as one recording, so it needs an album and an
  artist (its album artist, else its artist). Changing its Kind asks about it
  again. What MusicBrainz itself recorded is no search term, so its answer never
  changes the question.
- **The search.** A Lucene query of the shown title, artist, and album when
  known, with every character Lucene reads as syntax escaped; Chinese and Japanese
  text passes through unchanged.

  ```text
  recording:"過食性\:アイドル症候群" AND artist:"GUMI\/MAYU" AND release:"ケビョウニンゲン"
  release:"生如夏花" AND artist:"朴树"                 a long file, searched as a release
  ```

  When nothing passes the match with the album, a song is searched once more by
  title and artist alone, since the album shown may be no release's, such as a
  video's playlist name.

- **The match.** A candidate scores at least 90 and, when both lengths are known,
  has a length within 5 seconds of the Track's. Candidates rank by score, then a
  release whose title is the shown album (ignoring case and the width of
  characters), then an official release, then the earliest date, which picks an
  original over a reissue, such as *OK Computer* of 1997 over one of 2016. No
  candidate is an answer with no values, and counts as asked, not as a failure.
- **What it records,** under the `musicbrainz` origin, from a release lookup with
  `inc=recordings+artist-credits+media+genres`: title, artist, album, album
  artist, year, the recording's track and disc numbers, and its genre; for a long
  file, only the album, album artist, year, and genre. The genre is the three
  genres MusicBrainz's editors counted most, ties by name, joined as
  `alternative rock; rock; britpop`: the recording's, else the release's. The cover is fetched from the Cover Art Archive
  (`front-500`, following its redirect) only when the lookup says the release has
  a front cover; it must be a JPEG, PNG, or WebP image of at most 10 MiB, and a
  cover that is missing or fails these checks never fails the Job.
- **Etiquette.** The User-Agent is `medleyplay/<version> ( https://github.com/pengzhengyi/medleyplay )`.
  Requests are at most a second apart: the lane's pause between Jobs, and the
  client's own pause, on an injected clock, between the search, lookup, and cover
  requests of one Job. Every request asks for `fmt=json` and has a timeout. A 503
  is MusicBrainz's rate limit: the client waits as long as `Retry-After` says (2
  seconds without it), up to 3 tries in all; a longer wait than 10 seconds, or the
  last try failing, fails the Job as a network failure, which waits and tries
  again later. A 403 is a refusal, which stops the enricher.
- **Asked once a day** per Track and what it was searched for: the subject kept is
  a hash of the Track's id, title, artist, album, and album artist. Correcting a
  title asks again at once, and two Tracks with the same words are each asked.
  This is why the question must not include MusicBrainz's own answer.
- **Where its values show.** `musicbrainz` sits between `files` and `video`, so a
  file's own tags and the household's values stay over it, and it replaces what
  only the video said. Its album fields travel together as any origin's do.

### AI suggestions

`ai-details` asks an AI model what a Track's video text says, and records the
answer as suggestions. It never changes what a Track shows: the household takes a
suggestion with one click in *Edit details*, or loads a suggested song list in the
songs editor.

- **The providers are the household's choice,** set by an admin in Settings → AI:
  each a base URL, a model, and a key, up to 5, in the order they are asked. Each
  saved provider is a card that opens to its address and model as read-only
  fields, with *Change model*, *Replace key*, and *Remove*, which keep its place;
  a drag handle or the up and down buttons reorder the cards. One hand-written
  client on `requests` speaks the
  OpenAI chat protocol, so it works unchanged with DeepSeek, OpenAI, Anthropic's
  compatible endpoint, and a local Ollama; the section offers each as a preset
  that fills the base URL and a model. It sends `POST {base_url}/chat/completions`
  with the key as a bearer token, the model, a system and a user message,
  `response_format` set to a JSON object, temperature 0, and a bound on the
  answer, and uses nothing only some providers accept: no JSON schema, no tools,
  no streaming. A base URL is `http` or `https` with no login, query, or fragment,
  and `http` only for an address on the machine itself.
- **A key is a secret.** It is kept in the Keychain, as logins and proxies are,
  under a name of its own that the provider's row keeps; the provider set up when
  only one could be keeps `ai:key`, so no migration touches the Keychain. The API
  takes a key as a secret and never answers it, so a card shows only that a key is
  set. Removing a provider removes its row, then deletes its key; a key a crash
  leaves behind is named by no row and read by nothing. Every key reaches the Job
  process in memory with the Job's start, each in the one header of its request,
  never in a Job's request, a log, a message, or an error; every message of a Job
  is redacted of each again. A refused setting answers 422 without repeating what
  was sent. A provider on the machine itself, such as Ollama, needs no key. A
  provider whose key the Keychain no longer holds is skipped and marked *Key
  missing* on its card.
- **What is sent.** Only the Track's video text (title, description, and chapters,
  wherever the text came from), its file's name, its length, and the details it
  shows. The description is cut to its first 6,000 characters, and Settings says
  so beside a plain sentence that the video's text goes to the provider. The
  system message names the answer's shape, as a JSON model must be shown it, and
  says the video's text is data, not instructions.
- **What comes back** is a JSON object whose fields are all optional: a title,
  artist, album, year, and a song list of start, title, and artist. It is checked
  as the household's input is: text of at most 512 characters, a year from 1000 to
  2999, and at most 300 songs whose starts rise at least a second a song. A value
  over its limit is rejected, never cut. An answer that does not validate is asked
  for once more, showing the model its own answer and the fields that failed; if
  that fails too, the Job fails as an invalid answer, and the Track counts as asked.
  An answer cut off at its length bound, or empty, is invalid at once.
- **Failures, and the next provider.** A provider that can't be reached, stays
  busy, refuses the key (401 or 403), or answers with nothing to use (another 4xx,
  or an answer invalid even when asked again) is passed over, and the next is
  asked. A 429 or 5xx is waited out as long as `Retry-After` says (5 seconds
  without it), up to 3 tries and at most 30 seconds a wait, only by the last
  provider; one with another after it is passed over at once. When none answers, a
  refusal by every provider stops the enricher, as a site's refusal stops one,
  until an admin resets it; any that couldn't be reached or stayed busy makes it a
  network failure, which waits and tries again later; otherwise the Job fails as
  an invalid answer. Why each provider passed over failed is kept on its row, with
  when, until it answers again, and its card shows it, such as *Key refused 2 hr.
  ago*, so a broken first provider shows rather than hiding behind the next.
- **Which Tracks are asked for.** A Track that has video text, from the site, a
  file beside it, or the household, and is not a segment, once the provider is set
  up. Asked once a day per Track and text: the subject kept is a hash of the
  Track's id and its video text, so pasting better text asks again at once.
- **Where the suggestions are kept.** The values are the Track's `ai` origin,
  replaced whole by the next suggestion, so an answer that suggests nothing clears
  the last. A suggested song list is kept apart, one per Track, only when it is a
  song list the songs editor accepts. Both go with the Track.
- **Where they show.** *Edit details* offers each suggested value beside its field
  with *Use*, which copies it into the household's edit, to be saved or not; a
  suggestion equal to what the box holds is not offered. The songs editor fills
  its rows from a suggested list with its *AI* button, which asks the AI when it
  has suggested none; see [Segments](Segments.md#the-web-client). Neither the web client's
  `shownOf` nor the server's precedence includes the `ai` origin; both are checked
  against the same cases.
- **Its own lane.** Jobs of `ai-details` run one at a time, at least 2 seconds
  apart. They wait while the Mode is Offline, a local provider included.

## What the API shows

| Route | Who | Does |
| --- | --- | --- |
| `GET /api/tracks/{id}/details` | Signed in | Every field's shown value and origin, each origin's value, and the video's text read |
| `PUT /api/tracks/{id}/details` | Signed in | The household's values for the Track, replacing its earlier ones |
| `POST /api/tracks/details` | Signed in | Sets the given household values on many Tracks |
| `POST /api/tracks/{id}/video-text` | Signed in | Reads a pasted title and description as the `video` origin; answers the details and the songs listed |
| `GET /api/covers/{id}` | Signed in | A cover's image |
| `PUT /api/tracks/{id}/cover` | Signed in | The household's cover, as the request body; answers the details |
| `DELETE /api/tracks/{id}/cover` | Signed in | Drops the household's cover, so the next origin's shows |
| `GET /api/enrichers/{name}` | Signed in | Whether the enricher is on, why the site stopped it if it did, its mode, and the Tracks it may be asked about |
| `POST /api/enrichers/{name}/tracks/{id}` | Signed in | Queues the Track's Job, or returns the one already active; 409 with why when the Track is not eligible |
| `PUT /api/enrichers/{name}/mode` | Admin | Sets the mode, `manual`, `next`, or `all`; answers the enricher, and with `all` queues every eligible Track first |
| `POST /api/enrichers/{name}/find-all` | Admin | Queues every eligible Track and answers how many |
| `POST /api/enrichers/{name}/reset` | Admin | Lets a stopped enricher be asked again; 204, also when it was not stopped |
| `GET /api/ai` | Admin | The providers in order: each one's id, base URL, model, whether it has a key, and why it last failed; the presets; the limits |
| `POST /api/ai/providers` | Admin | Adds a provider after the others, with its key when it needs one; 409 for one set up already or one too many; 422 never repeats the body |
| `PUT /api/ai/providers/{id}/key` | Admin | Replaces the provider's key, keeping its place |
| `PUT /api/ai/providers/{id}/model` | Admin | Asks another model of the provider, keeping its place and key |
| `PUT /api/ai/order` | Admin | Asks the providers in the order of the ids given; 409 when they are not every provider once |
| `DELETE /api/ai/providers/{id}` | Admin | Forgets the provider and deletes its key; 204, also when it is gone |

Tracks in every list gain `cover`, `track_number`, `disc_number`, `year`,
`genre`, `kind`, and `kind_reason`, why it is that kind: `named`, `split`,
`segment`, `length`, or `default`. The details answer `kind` as its value and
that reason. `GET /api/settings` gains `album_minutes`.

## Build order

1. **Lengths:** read a fragmented file's length from its fragments.
2. **Details and origins:** `track_value`, the one writer, the migration, and
   *Edit details*, with many Tracks at once.
3. **Covers,** with embedded and beside-the-file images.
4. **The video's text:** the parser, *Paste the video's details*, and
   `<name>.info.json` beside the file.
5. **Segments:** see [Segments](Segments.md).
6. **The site enricher** for Bilibili, **MusicBrainz,** and **AI,** all built.

## Testing

- **Precedence** as a Hypothesis property: the shown value is the first origin's
  in the order, the album fields come from one origin, the cover from it or,
  when it has none, from an origin naming no album, dropping the household's
  value shows the next, and the Track's row always equals its shown values.
- **The parser** against a corpus of real-shaped titles and descriptions as
  multi-line literals: bracketed tags, `artist - title`, album words, and
  timestamp lists with and without hours, numbering, and artists.
- **Files beside the audio:** an `.info.json` read, changed, removed, and
  malformed, and a cover beside the file.
- **Lengths** against fragmented and plain MP4 files made with ffmpeg.
- **Covers:** each accepted type, a renamed file of another type, one over the
  limit, two Tracks sharing one cover, and the sweep.
- **Enrichers** through a test plugin, in real Job processes: eligibility rule by
  rule, the recorded text and cover, a sidecar or paste winning, the 24 hours, one
  at a time with the pause between calls (on a fake clock), a refusal stopping the
  enricher and failing its queued Jobs, a reset, waiting while Offline, and bulk
  queueing for admins only. The Bilibili plugin is read against a real video's
  recorded yt-dlp answer, with its network at a fake of yt-dlp. The MusicBrainz
  client runs over a fake `requests` transport that answers from recorded
  MusicBrainz answers (a real search and lookup for *Let Down* by *Radiohead*, and
  two made by hand for 朴树's 生如夏花), with a fake clock for its pauses: query
  escaping, ranking, the length window and the score floor, the cover present,
  absent, oversized, and not an image, a 503 waited out and then failing, and a 403
  stopping the enricher. The AI client runs over a fake `requests` transport as well:
  the request body and URL for each provider's base URL, a key only in the header,
  an answer valid, invalid then valid, and invalid twice, one cut off, a 401 and a
  429 and a lost connection, each passing over to the next provider, and no key
  ever in a message or a log. In real Jobs,
  the suggestion is recorded and shown nowhere, replaced by the next, and a
  refused key stops the enricher. No test contacts a site, MusicBrainz, or a model.

## Left for later

- **Waiting while Offline for a local provider:** a provider on the machine itself
  would not contact the Internet, but every Job of the enrich kind waits for the
  Mode; telling them apart would touch how Jobs hold, for one setup.
- **Asking again at once** when the household pastes better text for a Track the
  AI has just been asked about.
- **Counting what a provider charges.** Settings does not show a spend.
- **Choosing among close MusicBrainz matches:** the best candidate is taken; the
  household corrects a wrong one in *Edit details*. A long file's songs are not
  matched one by one to the release's tracks.
- **Reading each part of a multi-part video:** the site's text describes the
  whole video, so after one part is asked, the others are left alone for a day.
- **Covers in `medleyplay backup`,** which copies only the database.
- **A folder's `cover.jpg`** for every file in it.
- **Lyrics,** and naming songs by their audio with AcoustID.
