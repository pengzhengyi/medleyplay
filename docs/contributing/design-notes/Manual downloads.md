# Manual downloads

> [!NOTE]
> **Status: implemented.** This note describes how the household gets a site
> Track's audio when medleyplay can't: adding a Track whose video can't be read,
> seeing that its Download failed, and adding the file themselves. How medleyplay
> downloads on its own is in [Bilibili](Bilibili.md); what the web client shows
> around it is in [Web client](Web%20client.md).

## Contents

- [Principles](#principles)
- [Looking up a code or a link](#looking-up-a-code-or-a-link)
- [Adding a video that can't be read](#adding-a-video-that-cant-be-read)
- [A failed Download](#a-failed-download)
- [Adding the file](#adding-the-file)
- [Other ways to get it](#other-ways-to-get-it)
- [The web client](#the-web-client)
- [What the API shows](#what-the-api-shows)
- [Testing](#testing)
- [Left for later](#left-for-later)

## Principles

- **medleyplay always tries first.** Adding a Track starts its Download, as it
  does now; the household's own file is for when that fails, or for any time
  they would rather.
- **A file the household adds is a Download like any other,** a *manual
  Download*: it plays, joins the queue and the lock screen, works Offline, and
  shows in *Downloaded*. Nothing after it knows how it was made, except its
  backend, `manual`.
- **medleyplay never runs another tool.** The other ways it lists are for the
  household to run on their own computer; a refusal from the site is never
  answered by asking again some other way.
- **The file wins.** Adding a file cancels the Track's Download Job, and
  replaces a Download it already has.

## Looking up a code or a link

- **The interactive lookup is an Account's Job.** Submitting it keeps only the
  video or short link and its part number. A refresh or server restart does not
  lose the lookup. *Downloaded* lists the Account's unfinished choices, including
  failures. *Choose parts* opens the saved result without asking the site again.
  Closing the dialog keeps the result; adding the chosen parts or explicitly
  dismissing the lookup removes it. Looking up a video never adds a Track.
- **The lookup takes a code as well as a link:** a bare `BV` or `av` id, such as
  `BV1Xx41117Tz` or `av170001`, becomes `https://www.bilibili.com/video/<id>`
  before the allowlist sees it. Only that shape is turned into a link; any other
  text is still checked as a link.
- **The plugin canonicalizes it as it does a link,** so `av` ids still become
  `BV` ids.

## Adding a video that can't be read

- **A lookup whose read fails still answers,** with `readable: false` and why,
  instead of an error, whatever the failure: a fault, a network failure, a
  refusal, *gone*, or *needs a login*. The answer's `reason` is `fault`,
  `network`, `refused`, `gone`, or `needs_login`, and its `message` is the
  site's or the plugin's own words. It names the video and the part the link
  did, or part 1, and offers no title, uploader, or qualities. A link that names
  no video fails its lookup. Invalid input or an unavailable plugin is refused
  at submission.
- **An unreadable result stays ready for manual entry.** Confirming its parts
  does not retry the read. Only the direct, synchronous API uses a ten-minute
  memory of reads.
- **Adding then trusts the household's details:** distinct part numbers from
  1 to 9999, titles, and artists. Quality must be *best*. The duration is
  unknown until a file arrives.
- **Each part still gets a Track, a Source, and a Download Job,** so the
  downloader gets its try; a video the site says is *gone* gets one attempt, and
  its Source becomes *unavailable* as before.
- **Offline, looking up and adding are still refused,** since a short link must
  be followed and the read needs the site.

## A failed Download

- **A site Track's Download has failed** when it has no Download and the latest
  download Job of its Source failed: its attempts ran out, or the login was
  refused. A new Job, from a retry or from the policy, makes it *downloading*
  again. A song inside a longer file fails as its album file does.
- **The Track says so:** `download_failed` on the Track, beside `downloaded`,
  and `site`, the kind of site its audio comes from, such as `bilibili`, or
  `null` for a Track from a Library, so the client knows which Tracks can take a
  file by hand. The Track's download state, with the failure's message, is
  `GET /api/tracks/{id}/download`: `status` is `downloaded`, `downloading`,
  `failed`, `unavailable` (the site no longer has the video), or `none`, with the
  Source's `kind`, the part's `link`, a `message` for a failure, the
  `backend` of a Download, and the `job_id` of the Job downloading it or the one
  that failed, which `POST /api/jobs/{id}/retry` runs again.
- **Nothing changes in how the Track plays:** playing a failed Track answers its
  failed Job, as it does now.

## Adding the file

- **`PUT /api/tracks/{id}/download?name=<file name>` takes the file as the
  request body,** not a form, so no multipart parser is needed. Any signed-in
  Account may add one, as any may add a link.
- **The Track's Source is its site Source,** the first if it has several; a
  Track without one answers 409.
- **The file is checked** before it is kept:
  - its name's extension is one the player serves: `m4a`, `mp4`, `mp3`, `flac`,
    `ogg`, `oga`, `opus`, `wav`, `aif`, `aifc`, or `aiff`;
  - it is at most 1 GiB, counted as it arrives, so a larger one stops with 413
    (one that says its size first is refused before it is read);
  - tinytag reads it as audio with a positive duration, as the type its
    extension names; otherwise 422. A fragmented MP4 whose header holds no
    length is refused for want of one.
- **It is written beside the Downloads,** under a temporary name, fsynced, then
  renamed over `downloads/<source id>.<ext>` in the transaction that records
  it. A crash before the commit leaves a file no Download names, which the sweep
  at startup removes.
- **The transaction** cancels the Source's active download Job, replaces any
  earlier Download and its file, and records the Download with the backend
  `manual`, no quality, its size, and the time. A Track without a duration takes
  the file's.
- **The policy never removes a manual Download,** since it couldn't come back
  by itself: it is not *replaceable*, as a Download whose Source is unavailable
  isn't. It still counts toward the storage limit.
- **Offline, a file can still be added:** nothing contacts the site.

## Other ways to get it

- **The web client keeps the list,** per Source kind, so the plugin API and the
  plugins don't change. Each way has a name, a line on when to try it, and a
  command with the part's link filled in, with a button to copy it. The buttons
  work on a page served over plain HTTP, as a server on the local network is.
- **For `bilibili`:** yt-dlp through the household's proxy, yt-dlp with the
  browser's cookies for a video that needs a login, BBDown, yutto, lux, and
  you-get, in the order the household found them to work. The yt-dlp commands
  name the file by the video's id and part; BBDown and yutto save the audio under
  the video's title; lux and you-get save the whole video, which medleyplay takes
  when it is an `.mp4` file.
- **The proxy in the first command is an example,** `socks5h://127.0.0.1:7890`:
  the proxy medleyplay holds may carry a password and is for admins only, so the
  client never reads it.
- **The list shows** in the add dialog, folded, and in the dialog for adding
  the file, open.

## The web client

- **Search with *Bilibili* chosen** takes a link or a code. *Enter* looks it up
  and opens the add dialog; this is all *searching Bilibili* means for now. The
  box doesn't search the Library as you type while a site is chosen.
- **The add dialog, when the video was read:** its title and uploader; each
  part with its suggested title and artist, editable, and a box to choose it;
  the quality; and *Add*.
- **When it couldn't be read:** why, then one part with its number, a title,
  and an artist to fill in, and *Add*; the household can add more parts or
  remove one.
- **After adding,** the dialog closes and says how many Tracks were added and
  that they are downloading, or waiting for Online when the Mode is Offline.
- ***Downloaded* shows the songs downloading** above those downloaded: each
  one's cover, title, artist, and state over a bar. *Queued*, *Waiting for
  Online*, and *Retry scheduled* are distinct. A retry's tooltip gives its
  earliest start time and any failure the Account may read. The bar stays empty
  while a Job waits; while running it shows stages such as *Preparing download*,
  a percentage when known, and the part being fetched or joined for a joined file.
  The list is read once, then follows each `download_source` Job on the event
  stream: its progress moves the bar, its end drops the song, and a Job the list
  doesn't hold reads the list again, once for each such Job. Only the latest read
  shows, with progress events received during that read applied over it. Jobs
  that have already ended do not reappear.
- **The Downloading row menu** opens the song in the Library or links to the
  source video. The Account that requested the Job or an admin can cancel it.
  Cancellation removes the active row once the server confirms the Job has
  ended; it leaves the song in the Library. Retry remains in the failed
  download menu; an active download cannot be paused or retried.
- **A failed Track** shows a warning mark where its availability shows, named
  *Download failed* in its tooltip and to a screen reader, small so the title
  keeps its room. It opens a menu that reads, when opened, why the Download
  failed, as the server
  says it, over *Retry download* and *Add the file…*. Retrying runs the failed
  Job again; the menu stays open until the server answers, and says why if it
  refuses, such as to an Account that didn't ask for the Download. The Track's
  menu has *Add the file yourself…* for any site Track, failed or not.
- **In *Downloaded*,** *Dismiss failed download* in the warning menu hides that
  failed attempt for the household. *Dismiss all failed downloads* hides those
  shown in the view. When the latest failure is dismissed and the Track has no
  saved Download or Library file, the Library hides it and the player removes
  it from Up next, including queues restored from disk. The Track and its
  missing artist or album details are left out of Clean up, including for
  dismissals made before opening the view. Files and Job history are unchanged.
  A new attempt or a saved file makes the Track visible again.
- **Retry a dismissed part from its saved video lookup.** After a download
  fails because it needs sign-in, save a valid Bilibili login and reopen the
  lookup. **Retry download** beside the part queues the same Source with its
  saved quality. It does not add a Track, erase a failure, or close the
  lookup. Connection failures that are still waiting do not need a manual
  retry. Provider refusals and unclassified failures do not get this action.
- **The add-the-file dialog:** the failure's message, the other ways, a file
  picker, and *Add*, with the upload's progress; *Stop* beside it stops an upload
  under way. When it finishes, the dialog closes and the Track shows as downloaded and
  plays like any other.

## What the API shows

| Route | Who | Does |
| --- | --- | --- |
| `POST /api/links/lookups` | Signed in | Submit a link or code; `202` returns the lookup id and state |
| `GET /api/links/lookups` | Signed in | The Account's open choices, newest first |
| `GET /api/links/lookups/{id}` | Lookup owner | The state and, when ready, the saved result with parts already added marked |
| `POST /api/links/lookups/{id}` | Lookup owner | Confirm the quality and chosen parts; remove the choice after a successful add |
| `POST /api/links/lookups/{id}/retry` | Lookup owner who requested the download, or a lookup owner who is an admin | Retry `failed_job_id` for `part`, without closing the lookup |
| `DELETE /api/links/lookups/{id}` | Lookup owner | Dismiss without adding; stop a pending lookup |
| `POST /api/links/lookup` | Signed in | Direct lookup without a saved choice; answers `readable: false` when the read fails |
| `POST /api/links` | Signed in | Direct add by link, including a video that could not be read |
| `GET /api/tracks/{id}/download` | Signed in | The Track's site Source: its link, whether it is downloaded, downloading, failed, or unavailable, and the failure's message; 409 without a site Source |
| `PUT /api/tracks/{id}/download` | Signed in | Adds the file in the body as the Track's Download; 413 too large, 422 not audio, 409 no site Source |
| `GET /api/downloads` | Signed in | The Downloads under way, oldest first: each Track and its Job, with the Job's state, progress, and whether it waits for Online |
| `POST /api/downloads/failed/dismiss` | Signed in | Hide the failed download Jobs named by `job_ids`; other Jobs and saved files are unchanged |

Tracks in every list include `download_failed`, `site`, and `download_failure_job_id`
for a failed attempt still shown in *Downloaded*. `download_dismissed` marks
Tracks that the Library and player hide, regardless of when they were dismissed.
On a readable saved lookup, `retry_job_id` identifies a dismissed sign-in
failure after the requester or admin saves a valid login. On retry, the server
checks in the same transaction that the attempt is still the latest, the login
is valid and newer than the failure, and the Track has no saved audio.

## Testing

- **Through the test plugin `tube`,** scripted to fail: a lookup that can't
  read answers `readable: false` for each kind of failure, the add that follows
  doesn't read again until the lookup memory ends, and adding with the
  household's details makes Tracks and Jobs.
- **Adding the file:** each accepted extension, a name with no extension or
  another one, an empty file, one over the limit, a file tinytag can't read, a
  Track without a site Source, a running Job cancelled, an earlier Download
  replaced, the duration filled in, and Offline.
- **The policy** keeps a manual Download over the limit and removes a
  downloaded one beside it.
- **Damaged files:** a Hypothesis property cuts real WAV, MP3, and MP4 files
  short and fills them with noise, under every accepted extension; each is
  audio with a length or is refused, never another error.
- **The web client:** the code and link lookups, both add dialogs, the failed
  state, the other ways with the link filled in, and an upload, in Vitest; and
  Playwright against a second server whose Bilibili is `tube`, which adds a
  video, a failed Download and its file, and a video that can't be read, and
  checks the dialogs at 320, 390, and 1280 pixels wide for sideways scrolling.

## Left for later

- **Finding a file in a folder** the household downloads into, matched by its
  video id, instead of uploading it.
- **Removing a manual Download** by hand.
- **Other ways for other sites,** when there are other sites.
