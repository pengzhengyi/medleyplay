# Segments

> [!NOTE]
> **Status: in progress.** Splitting a file into songs, the songs API, playing a
> song, and the editor are built; listening from a row's start, and moving rows
> by dragging, follow. This note
> describes splitting one long file, such as a whole album uploaded as one video,
> into its songs, and playing them as Tracks. Where a song list comes from is in
> [Track details](Track%20details.md).

## Contents

- [What a segment is](#what-a-segment-is)
- [Song lists](#song-lists)
- [Splitting a file](#splitting-a-file)
- [Playing a segment](#playing-a-segment)
- [The web client](#the-web-client)
- [Snapping starts to the gaps](#snapping-starts-to-the-gaps)
- [What the API shows](#what-the-api-shows)
- [Testing](#testing)
- [Left for later](#left-for-later)

## What a segment is

- **A segment is one song inside a longer file:** a Track whose Source is a
  stretch of another Source's audio.

  ```text
  BV1dm4y1s7ak.m4a   2:28:46   the album file
    1  00:00  Intro              a segment
    2  03:12  Night Drive        a segment
    3  07:40  Blue Room          a segment
  ```

- **Its Source has the kind `segment`:** its locator is
  `<album file's Source id>/<segment id>`, and its details hold the start and
  end. So every Track still has a Source, and availability, playback, smart
  playlists, the policy, and removing a Library each look through the segment to
  the album file's Source. A segment Source has no file of its own; removing the
  album file's Source removes its segments, and their Tracks with them.
- **The file keeps its own Track,** the *album file*. Once split it is marked
  `split` and is an album; see [Track details](Track%20details.md#the-details).
  Artists, Albums, search, and smart playlists show its segments
  instead, the Library shows them folded under it, and a Playlist that held it before it was split still plays it whole.
- **A segment Track is a Track like any other:** its own favorite, rating,
  plays, place in Playlists and the queue, and details. Its length is its end
  less its start, and it was added when its album file was.
- **The file is never cut,** so splitting costs no disk.

Seeking far into these files is fast: a check in Chromium and WebKit seeks
5,000 seconds into a 2.5-hour fragmented `m4a` from Bilibili in under 0.7 s, and
both read its full length.

## Song lists

- **A song list is the songs' starts, in order,** each with a title and an
  optional artist; a song ends where the next starts, and the last at the end of
  the file.
- **It is checked:** starts rise strictly from 0 or later, every song is at
  least a second long and starts before the file ends, at most 300 songs, and
  titles and artists as for any Track.
- **Lists are found** in the video's chapters or description, read by the
  parser in [Track details](Track%20details.md#what-medleyplay-reads), and the
  household can paste one: one song a line, its time first or last, such as
  `00:00 Intro`, `1. 03:12 Night Drive - Blue Room`, or `Blue Room 1:07:40`.
- **A found list is a proposal.** It shows in the editor, and in the album view
  as *Split into N songs*; nothing is split until someone in the household says
  so.

## Splitting a file

- **Splitting is an act of the household,** from the editor, never a side
  effect of a scan or an enricher.
- **Each song keeps an id,** made when it is first added. Saving the editor's
  rows matches them by id: a song moved, renamed, or retimed stays the same
  Track, with its ratings, plays, and Playlist entries; a new row is a new Track;
  a row deleted removes its Track, with its favorites, ratings, and plays, so
  *Save* says how many songs it removes first.
- **A segment's details** default to its album file's album fields, through an
  `album_file` origin just above `file_name`, with its title and artist from its
  row and its track number from its place. The album is the file's album, or its
  title when it names none; the album artist is the file's album artist, or its
  artist; a song with no artist of its own is the album artist's. A change to the
  album file's details reaches its songs at once. The household can edit any of
  them.
- **A rescan that changes the file** keeps its songs, and the last song's length
  follows the file's. Each split remembers the file's length; once the length
  differs by a second or more, the songs are marked to check, and the album view
  says so.
- **A removed song's id is never reused,** so an editor left open can't give its
  ratings to a new song, and an album file's Source can't be removed while its
  songs remain.
- **Removing a Library** removes the songs split from its files, with their
  Tracks.
- **Unsplitting** removes every segment, after asking.

## Playing a segment

- **Asking to play a segment** answers as the album file would, with the
  segment's start and end.
- **The player moves on at the end** rather than on `ended`: a timer set from
  the position, checked again on each `timeupdate`, ends the song within a few
  milliseconds of its end.
- **The next segment of the same file plays on without a gap:** when the queue's
  next song starts where this one ends, the player only changes what is showing.
  Any other song in the same file, by *Next*, shuffle, or a click, is a seek
  within the loaded file, without loading it again.
- **The seek bar, the times, the saved position, and the lock screen** use the
  segment's own position and length, and seeking stays within it.
- **A play counts as for any Track,** by the segment's own length.
- **The lock screen** shows each song's title and cover; an album played with
  the iPhone locked is checked by hand before this is done, since a locked
  screen may slow the page's timers.

## The web client

- **A split file gives way to its songs** in Artists, Albums, Downloaded, and
  search, so the songs make up its album there; a Playlist that held the file
  before it was split still plays it whole. The Library lists the file itself,
  with its songs folded under it; see
  [Web client](Web%20client.md#the-library).
- **The songs are edited beside the details:** *Edit details* has a way to
  them, *Split into songs* or *11 songs*, which shows the songs editor in place
  of the details, with *Details* to go back to what was typed there. ***Split
  into songs…*** on a file's menu, and ***Edit songs…*** on any of its songs,
  open the same dialog on the songs, and leaving them closes it.
- **The rows are the songs:** a row per song with its start, such as `3:12` or
  `1:07:40`, its title, and its artist; add, remove, and move rows, by dragging
  a row's handle or with its buttons. Saving says first how many songs it
  removes with their ratings and plays, and so does ***Unsplit***.
- **Ways to fill the rows sit above them,** each a small button:
  - ***List*** opens the rows as text, one song a line, in CodeMirror, loaded
    only when opened: lines are numbered, each time and artist is colored, the
    Library's artists are offered after a dash, and the server checks the list
    as it is typed with `POST …/songs/check`, so each line that is no song is
    marked and listed with why, and a problem chosen moves to its line. The
    parser is the paste's, so what checks clean is what the server takes.
  - **The video's list**, one button per list found in its details.
  - ***AI*** uses the list the AI suggested, or, with none yet, asks the AI
    about the file as *Suggest details with AI* does, says so while it runs,
    and fills the rows once it answers.
- **A list filled in keeps each song it still names:** a song with the same
  title, folded, or else starting at the same time, keeps its id, so filling
  from a list after editing the text loses no ratings or plays. What filled the
  rows is said beside the buttons, such as *11 songs from deepseek-chat, starts
  estimated*: an AI model names the songs well, but guesses where they start.
- **What looks wrong is said, never refused:** by rules of thumb, a song longer
  than 15 minutes says under its row *24:39 long: it may be two songs*, and when
  the songs average more than 12 minutes, a note above them says *an album this
  long usually has more, so a song may be missing*. A live set or a symphony
  breaks both, so neither stops a save. The lists found are a second opinion of
  each other: when the video's and the AI's count different songs, the editor
  says so beside the buttons that fill from them, as *The video lists 12 songs,
  the AI 4.*
- **Listening in the editor:** a row's ***Play*** plays just that song, from its
  start to where the next starts, and pauses the music playing; its ***Check***
  plays its first five seconds and its last five, or a song of ten seconds or
  less whole, to hear where it starts and ends; pressing either again stops it.
  ***Start here*** then takes the row's start from where the file is playing, to
  the millisecond. The editor's player is its own, so the queue is untouched; a
  Download not yet here says it is being prepared.

## Snapping starts to the gaps

A start from a video's text or an AI model is often seconds off; for an album
uploaded whole, the songs are parted by a second or more of silence, which the
file itself says exactly. ***Snap***, beside the buttons that fill the rows, moves
each start to the gap in the audio nearest it:

```text
Bad, 48 minutes, as the AI guessed     ↳ snapped
  4:08  The Way You Make Me Feel         4:07.672
  9:05  Speed Demon                      9:05.774
 13:08  Liberian Girl                   13:08     no gap within half a minute: it runs on from Speed Demon
```

- **Each start but the first** moves to the end of the gap nearest it, within
  half a minute either way, keeping the songs in order and giving each gap to
  one song; one with no gap that near stays. Silences closer than a second are
  one gap, as a fade can break one in two. A moment of silence opening the file
  never moves the first song.
- **Only when pressed,** and said in place: the moved starts are outlined, with
  *Moved to the gap in the audio* as their description, and beside the buttons
  *Moved 9 of 10 starts to the gaps in the audio*, with ***Undo***. Any edit
  ends both. A snapped start is kept to the millisecond.
- **The gaps are found once a file,** by the plugin `ffmpeg`, which runs
  ffmpeg's `silencedetect` (quieter than -40 dB, half a second or more) over the
  whole file: about three seconds for an hour of audio. It is a Job of the kind
  `find_silences`, needing no network, through the plugin point
  `SilenceFinder`. What it finds is kept with the Track's length then; a file
  whose length changed is read again. A file that must be copied or downloaded
  first is prepared as playing it would be, and the editor asks again until it is.
- **ffmpeg is the server's own,** found on its path, and not installed with
  medleyplay. Without it the plugin answers so, and the editor says *Snapping
  needs ffmpeg installed on the server*; a file ffmpeg can't read says so too.
- **A live recording has few gaps,** applause filling them, so snapping moves
  little there; *Check* and *Start here* remain the way to place its songs.

## What the API shows

| Route | Who | Does |
| --- | --- | --- |
| `GET /api/tracks/{id}/songs` | Signed in | The album file's songs, with ids and ends, its length, whether to check them, and the lists found |
| `PUT /api/tracks/{id}/songs` | Signed in | The household's rows, by id; answers the segment Tracks |
| `POST /api/tracks/{id}/songs/read` | Signed in | The songs a pasted list names, or the first line that isn't one |
| `POST /api/tracks/{id}/songs/check` | Signed in | The songs a list names as it is typed, and every problem, each with its line: no time, no title, too long, a start before or within a second of the one above or past the file's end; or too few or too many songs |
| `DELETE /api/tracks/{id}/songs` | Signed in | Unsplits the file |
| `POST /api/tracks/{id}/playback` | Signed in | Now answers a segment's `start_ms` and `end_ms` |
| `GET /api/tracks/{id}/silences` | Signed in | What is known of the gaps in the file's audio: found, with each gap; being found; being prepared; not looked for; or not found, as ffmpeg is missing or couldn't read it |
| `POST /api/tracks/{id}/silences/find` | Signed in | Finds them, unless known or being found; 409 while the `ffmpeg` plugin is off, 422 for a song of a split file |

Tracks in every list gain `segment_of`, the album file's id, and `split`.

## Testing

- **The list check and the parser** with a corpus of pasted lists, and a
  Hypothesis property that a list's segments tile the file without a gap or an
  overlap.
- **Checking a list as it is typed:** every problem with its line, and a
  Hypothesis property that a list checks clean exactly when it reads as a list.
- **The editor** in Vitest: filling from each source keeping the songs still
  named, the AI asked and answering, a song played to its end, a check jumping
  to the last five seconds; and one Playwright run that types a list in
  CodeMirror against the real check and fills the rows.
- **Saving rows:** a first split, a song inserted in the middle keeping every
  other song's ratings, a delete, a move, a retime, unsplitting, a rescan within
  and past a second, and removing the Library.
- **Through the segment's Source:** availability, playback, a smart playlist
  that matches songs but not their split album file, and the policy.
- **Snapping:** the rule in Vitest against the gaps ffmpeg found in an upload
  of *Bad*; the plugin against its recorded `silencedetect` log, and the real
  program on two tones a second and a half apart when it is installed; and the
  service in real Jobs on a WAV of two tones, with ffmpeg and with a path that
  has none.
- **The player** in Vitest with a fake media element: ending at the end, playing
  on into the next segment without a reload, seeking within one, the saved
  position, and a play counted by the segment's length; and one Playwright run
  that plays across two segments of a real file.

## Left for later

- **Snapping a live recording,** whose gaps are applause, perhaps by dips in
  loudness rather than silence.
- **Exporting a split file** as separate files.
