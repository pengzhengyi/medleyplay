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
- **The server relays and remembers nothing.** It keeps the computer's last
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
  (`host`); the server checks the claim itself.
- **The page that played last on the host is the speaker.** A host page claims
  it when its event stream is ready and whenever it starts playing, so of two
  host tabs, the one the household used last answers.
- **It reports on every change it would show**: the queue, which entry plays,
  playing or paused, shuffle and repeat, the volume, a seek. It doesn't report
  as the time goes by: a remote counts the seconds itself from the last report.
- **A browser may refuse to start playing** a page no one has clicked on yet,
  as Safari does. The speaker then reports it is waiting for a click, and the
  remote says so beside its play button: *Click once on the computer to let it
  play*.
- **A speaker that goes away** — its page closed, its stream ended — is
  forgotten, and remotes say *The computer isn't playing*.

## The remote

- **The remote's player shows the speaker's report**: the queue, the Track
  playing, its position counted on from when the report was sent, the volume.
  The remote looks each Track up in its own Library, as the speaker did.
- **What the listener does is a command**, one per action the player has:
  `play` a list from an entry, `playAll`, `playNext`, `add`, `toggle`,
  `pause`, `next`, `previous`, `seek`, `move`, `remove`, `clear`, `shuffle`,
  `repeat`, `volume`, `mute`. A command names Tracks and entries by id and key,
  never by position, so one sent as the queue changes still means what it
  meant.
- **A command is fire and forget.** The speaker's next report shows its
  result; a command for an entry already gone does nothing. A volume dragged
  sends at most one command every 150 ms, and the last one always.
- **The remote's own audio stays silent** while it plays on the computer.
- **The sleep timer runs on the remote**, pausing the speaker, while the
  remote's page is open.

## Moving the music

Choosing where to play moves what plays, as Spotify Connect does:

```text
phone plays, Play on → the computer   phone's queue and second → computer, playing; phone pauses
computer plays, Play on → this phone  computer's queue and second → phone, playing; computer pauses
```

- **The move is one command, `take`**, carrying the queue and the second to
  start from. Moving onto a phone happens in that phone's page, from the last
  report.
- **Nothing playing moves nothing**: choosing the computer while the phone is
  paused or idle just shows what the computer has.

## The server

All in memory, in `RemoteService`; nothing is stored.

| Route | Who | Does |
| --- | --- | --- |
| `PUT /api/remote/speaker` | a page on the host | Claim the speaker for this account, naming the page |
| `PUT /api/remote/report` | the speaker | Replace the report; another page answers 409 |
| `POST /api/remote/commands` | any page of the account | Pass a command to the speaker; none answers 409 |

- **A page names itself** with a random id it makes on loading, sent as
  `?page=` when it opens `GET /api/events`. When that stream ends, a speaker
  of that name is forgotten.
- **The event stream carries two new events** to the account's own streams:
  `remote`, the report as it stands (or none), sent when the stream opens and
  whenever it changes, with how long ago it was sent so the remote's clock
  needn't agree with the computer's; and `command`, sent only to the speaker's
  stream, one per command, in order.
- **Commands wait in a short line per speaker**, at most 64; a speaker that
  falls behind further is forgotten, as a stream that falls behind is.
- **Reports and commands are checked for shape** with Pydantic: a known
  command, ids and keys of the right form, a queue of at most 10,000 entries.
  The server never interprets them.

## The web client

- **`usePlayer` is the speaker's engine**, and gains a way to apply commands
  and to report.
- **`useRemotePlayer` is the remote's**: it implements the same `Player` from
  the `remote` event, and sends commands. `Library` uses one or the other,
  whichever *Play on* names.
- ***Play on*** is a button in the player, shown only on a page that isn't the
  host while the account has a speaker: a speaker icon with a menu of *This
  phone* and *The computer*. The choice is kept per device, in local storage.
- **The *Listen on your device* guide** says the phone plays on itself, or on
  the computer with *Play on*.

## Testing

- **Server:** only a host page claims; only the speaker reports; a command
  reaches the speaker's stream and no other; one with no speaker answers 409;
  the speaker is forgotten when its stream ends; a remote's stream hears each
  report, with its age; another account's stream hears nothing.
- **Client:** `useRemotePlayer` shows a report, counts the position on, and
  sends a command for each action; the speaker applies each command and
  reports each change; *Play on* moves the music both ways; the waiting-for-a-
  click message.

## Left for later

- **A speaker with no page**: the server playing through the computer's own
  audio output, so a server with no screen can be the speaker.
- **Any device as the speaker**, so a phone can play on a tablet.
- **The lock screen on a remote**: its controls drive the phone's own audio,
  which a remote doesn't play.
