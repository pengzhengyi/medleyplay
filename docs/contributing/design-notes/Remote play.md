# Remote play

> [!NOTE]
> **Status: built.** This note describes how a phone plays music on the
> computer medleyplay runs on, as a remote, or on itself, as it always could.
> The player itself, its queue and how a Track loads, is in
> [Playback](Playback.md); which devices may connect is in [Devices](Devices.md).

## Contents

- [Principles](#principles)
- [Words](#words)
- [The speaker](#the-speaker)
- [The remote](#the-remote)
- [Moving the music](#moving-the-music)
- [The server](#the-server)
- [The web client](#the-web-client)
- [Testing](#testing)
- [Left for later](#left-for-later)

## Principles

- **Where the music plays is the listener's choice, per device.** A phone plays
  on itself, or on the computer, chosen in the player: *Play on* this phone or
  the computer.
- **The computer plays through its own medleyplay page**, the one the household
  already keeps open there. The server plays nothing itself, so it needs no
  audio library and plays a song inside a longer file exactly as the page does.
- **A remote is the same player with another engine.** The page's views take a
  player; on a remote, that player shows what the computer plays and sends what
  the listener does to it. Every view works unchanged.
- **The server relays and stores nothing.** It keeps the computer's last
  report in memory and passes commands on; a restart forgets both, and the
  computer's page reports again when its event stream comes back.
- **One account, one speaker.** A phone controls the computer only while both
  are signed in as the same account, so the plays the computer counts are that
  account's.

## Words

| Word | Meaning |
| --- | --- |
| Speaker | The medleyplay page on the host that plays aloud for an account |
| Remote | A page on another device playing on the speaker instead of itself |
| Report | What the speaker plays, sent to the server whenever it changes |
| Command | One thing a remote asks the speaker to do: play, pause, skip, seek, … |

## The speaker

- **Only a page on the host can be the speaker**, as `GET /api/device` says
  (`host`); the server checks each report itself.
- **A host page becomes the speaker by reporting**: while it plays, or while it
  has a queue and the account has no speaker. It reports first once its event
  stream has answered, so a queue it restored on loading plays for the account.
  Of two host tabs, the one the household played on last answers; a tab doesn't
  report just because another became the speaker, or the two would take turns.
  A tab with nothing queued never reports.
- **A page is the speaker while one of its event streams is open.** A stream
  that reconnects keeps it; once the last one ends, it is forgotten, and
  remotes say so.
- **It reports on every change it would show**: the queue, which entry plays,
  playing or paused, shuffle and repeat, the volume, the sleep timer, whether
  the entry's play has counted. It doesn't report as the time goes by: a remote
  counts the seconds itself. It reports again when its position drifts more
  than 2 s from what its last report foretold, as after a seek, and every 20 s
  while it is the speaker. It sends one report at a time, at most one every
  150 ms, the latest kept, so a volume dragged on the computer doesn't flood
  the remotes.
- **A report is a window of the queue**, in the order it plays: from 50 entries
  before the one playing, at most 500, with the queue's length. A queue of
  thousands costs the same as one of fifty.
- **A browser may refuse to start playing** a page no one has pressed play on,
  as Safari does. The speaker then reports it is *blocked*, and the remote says
  beside its play button: *Click once on the computer to let it play*.
- **Several accounts signed in on the host** each have their own speaker, and
  play at once.

## The remote

- **The remote's player shows the speaker's report**: the queue window, the
  Track playing, its position counted on from when the report was sent, the
  volume. The remote looks each Track up in its own Library.
- **What the listener does is a command**, one per action the player has:
  `play` a list from an entry, `playAll`, `playNext`, `add`, `toggle`, `pause`,
  `next`, `previous`, `seek`, `move`, `remove`, `clear`, `shuffle`, `repeat`,
  `volume`, `mute`, `sleep`. A command names Tracks and entries by id and key,
  never by place; `seek` names the entry it means, and does nothing once
  another plays. The commands follow the player's actions, not the queue's
  reducer, since an action such as `next` does more than change the queue.
- **A remote sends one command at a time**, so they arrive in the order they
  were made. The speaker's next report shows each result. Play and pause show
  at once, until that report, or for 3 s when none comes, as when the
  computer's browser still won't play. A volume dragged sends at most one
  command every 150 ms, and the last one always. The remote counts the seconds
  only while it is in use.
- **A refused command says why in the player**: nothing playing on the computer
  (409), or too many commands waiting (429). With no report for a minute, the
  player says *The computer isn't responding*.
- **The sleep timer runs on the speaker**, so it pauses the computer even when
  the phone's page sleeps; the remote sets it and shows it.
- **The remote's own audio stays silent** while it plays on the computer.

## Moving the music

Choosing where to play moves what plays, as Spotify Connect does:

```text
phone plays, Play on → the computer   phone's queue and second → computer, playing; phone pauses
computer plays, Play on → this device  computer's queue window and second → phone, playing; computer pauses
```

- **The move onto the computer is one command, `take`**, carrying the whole
  queue, its own order when shuffled, the second to start from, and whether the
  play of the entry playing has already counted, so it isn't counted twice.
- **The device the music leaves stops only once the server has passed the
  command on**: the phone pauses after `take`, the computer is asked to pause
  before the phone plays. A refusal leaves the music where it was, and *Play
  on* says why. Both commands go in the remote's line, after any sent before.
- **Moving onto the phone takes the report's window**, the 500 entries around
  the one playing, and whether its play has counted.
- **Nothing playing moves nothing**: choosing the computer while the phone is
  paused or idle just shows what the computer has.

## The server

All in memory, in `RemoteService`; nothing is stored.

| Route | Who | Does |
| --- | --- | --- |
| `PUT /api/remote/report` | a page on the host | Report what it plays; answers whether it is the speaker; elsewhere 403 |
| `POST /api/remote/commands` | any page of the account | Pass a command to the speaker; none answers 409, a full line 429 |

- **A page names itself** with a random id it makes on loading, sent as
  `?page=` when it opens `GET /api/events` and in each report.
- **The event stream carries two new events** to the account's own streams:
  `remote`, the speaker's page and report (or none), sent when the stream
  opens and whenever the speaker reports, comes, or goes, with how long ago it
  reported, so the remote's clock needn't agree with the computer's; and
  `command`, sent only to the speaker's stream, one per command, in order.
- **Commands wait in a line per speaker**, at most 64. The speaker's stream
  takes every waiting command whenever it wakes, so a notice of commands
  waiting may be dropped like progress; a line that is full refuses the next
  command and leaves the speaker as it is.
- **Reports and commands are checked for shape** with Pydantic: a known
  command, ids and keys of the right form, at most 20,000 entries in a command
  and 500 in a report, a message of at most 300 characters; a `take` names
  each entry once, plays one of them, and orders each once. The server never
  otherwise interprets them.

## The web client

- **`usePlayer` is the speaker's engine.** It gains `handoff`, what plays and
  whether its play counted, and `take`, playing a queue from a second; a play
  the browser refuses is the status *blocked*.
- **`useSpeaker`** reports the host page's player and carries out the commands
  its stream hears. **`useRemotePlayer`** is the remote's `Player`, from the
  `remote` event. `Library` uses one or the other, whichever *Play on* names.
  The rules both share, the report, the window, the count of the seconds, and
  how a command is carried out, are pure functions in `player/remote.ts`.
- ***Play on*** is a speaker button in the player, beside *Up next*, on every
  page that isn't on the host: a menu of *This device* and *The computer*. The
  computer is offered only while medleyplay plays there, and otherwise says to
  open it. Playing on the computer, the button says *Computer*. The choice
  lasts while the page is open; with the speaker gone, the page plays on
  itself again.
- **The *Listen on your device* guide** says the phone plays on itself, or on
  the computer with *Play on*.

## Testing

- **Server:** a host page that plays becomes the speaker, one with nothing
  queued never does, and one paused leaves another in place; a page on a
  phone may not report; a phone hears whether the play has counted; a command
  reaches the speaker's stream and no other, in order; none answers 409 and a
  full line 429; the speaker stays while a stream reconnects and goes with its
  last; another account hears nothing; commands and reports of the wrong
  shape, a `take` naming an entry twice among them, answer 422.
- **Client:** the report and its window; the remote's queue and its count of
  the seconds; how each command is carried out; the remote player's commands,
  one at a time and in order, play and pause at once and for a while only,
  the volume's pace, a refusal, *not responding*, *blocked*, and the sleep
  timer; the speaker's reports, on a change, a seek, a heartbeat, once its
  stream answers, not when another tab takes over, and at their pace; a
  station refilling a queue a remote sees only part of; *Play on* through the
  page, a refused move among them.

## Left for later

- **A speaker with no page**: the server playing through the computer's own
  audio output, so a server with no screen can be the speaker.
- **Any device as the speaker**, so a phone can play on a tablet.
- **The lock screen on a remote.** Its controls drive the phone's own audio,
  which a remote doesn't play, so a phone playing on the computer has no lock
  screen controls.
- **Telling a page as soon as it stops being the speaker**, rather than when
  it next reports.
