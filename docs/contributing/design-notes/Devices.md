# Devices

> [!NOTE]
> **Status: built.** This note describes which devices may reach the
> server: the household's choice for new devices, how a new device asks and is
> answered, and the list of allowed devices in Settings. Signing in, which
> comes after, is in [Architecture](Architecture.md).

## Contents

- [Principles](#principles)
- [Who is admitted](#who-is-admitted)
- [The host](#the-host)
- [A device](#a-device)
- [Asking and answering](#asking-and-answering)
- [Settings and the API](#settings-and-the-api)
- [The web client](#the-web-client)
- [What it protects](#what-it-protects)
- [Testing](#testing)
- [Left for later](#left-for-later)

## Principles

- **A device is admitted before anyone signs in.** A device the household
  hasn't let in can't reach the sign-in form's API, so it can't guess passwords
  or lock an account out with wrong ones.
- **The host is always admitted.** A request from the machine the server runs
  on is never asked about.
- **One choice, for new devices:** *Ask first*, the default, *Allow all*, or
  *Block new devices*. Allowed devices keep their access under each; Remove is
  how one loses it. An admin makes the choice.
- **An answer is remembered per device, not per address.** A phone keeps its
  answer when the router gives it another address; a browser whose data is
  cleared is a new device and asks again.
- **Only allowed devices are stored.** A device waiting for an answer, or
  turned away, is kept in memory and forgotten on restart; it simply asks
  again.
- **No change cuts off the device making it.** An admin on a phone can't
  remove that phone from that phone.

## Who is admitted

A pure function decides, from the choice, where the request comes from, and
what is known of the device:

| Request from | Ask first | Allow all | Block new devices |
| --- | --- | --- | --- |
| The host | admitted | admitted | admitted |
| Any device, before the first account exists | admitted | admitted | admitted |
| An allowed device | admitted | admitted | admitted |
| A new or waiting device | waits | admitted | refused |
| A device turned away | refused | admitted | refused |

- **Allow all opens the door and records nothing.** Its devices aren't added
  to the list, so changing back to *Ask first* asks each of them, a guest's
  phone included.
- **Before the first account exists there is nothing to protect**, and the
  household may set up from a phone; the device that sets up is allowed.
- **Upgrading keeps everyone in.** The upgrade marks each session it finds, and
  a browser holding one is allowed the first time it asks, so a server with no
  screen isn't locked out by the upgrade. Sessions idle out after 30 days, so
  this ends by itself.

A request that isn't admitted gets `403` with code `device_waiting` or
`device_refused`. What still answers: the web client's files, so a waiting
device can say it is waiting, and `GET /api/device`, its own state. Every other
path under `/api`, sign-in included, is refused.

The check is a middleware that runs after the Host check and before the Origin
check.

## The host

A request comes from the host when its peer address is a loopback address or
the address it connected to. That needs no list of the machine's addresses, so
a new interface or a new DHCP lease changes nothing.

- **Only the connection decides**, never a header: the Host check accepts
  `Host: localhost` from any peer. An IPv4 address seen through an IPv6 socket,
  as `::ffff:192.168.1.5`, is unwrapped first.
- **Forwarding headers are ignored.** The server runs with Uvicorn's
  `proxy_headers` off, so `X-Forwarded-For` never becomes the peer, and a
  request carrying `Forwarded`, `X-Forwarded-For`, or `Via` is never the host:
  behind a proxy on the host, every request would otherwise come from
  loopback.

## A device

A device is a browser holding a `medleyplay_device` cookie: a random token,
HttpOnly and SameSite Lax, kept for 400 days, the longest a browser keeps a
cookie. Only the token's SHA-256 hash is stored, as for sessions. A cookie the
server didn't give is ignored and replaced, so one planted by another site on
the same host does nothing.

| Field | What it is |
| --- | --- |
| `id` | Random, so an answer given to a device that was forgotten can't reach another |
| `label` | What the browser says it is, as "Safari on iPhone" |
| `address` | The address it last connected from |
| `allowed_at`, `last_seen_at` | When it was allowed, and last connected |

- **Only `GET /api/device` gives a cookie.** The web client asks it first and
  waits for the answer, so a page's first few requests, sent at once, can't
  make a device each. A crawler or a link preview that only fetches the page
  leaves nothing.
- **A session belongs to the device it signed in on.** Removing a device ends
  its sessions, and with them its event stream within 15 seconds, so allowing
  it again later means signing in again. The host's sessions belong to no
  device.
- **The label is a guess for people**, worked out from the User-Agent in a few
  lines: the browser (Edge, Chrome, Firefox, Safari) and the system (iPhone,
  iPad, Android, Mac, Windows, Linux). Nothing decides on it.
- **`last_seen_at` is written at most once a minute** for a device, so
  admitting a request reads memory without writing to the database. The
  service keeps the choice and the allowed devices in memory, written through
  on every change; one server process owns the database.

## Asking and answering

```text
phone: GET /api/device ──> waiting, code 4821, cookie set
phone: "Waiting for approval. Code 4821" ── asks again every 3 s
host:  header shows "1 device waiting" ──> Allow
phone: GET /api/device says allowed ──> the sign-in form
```

- **The code lets the person at the host tell which device is asking**, when
  two ask at once, or one claims to be a phone it isn't. It is not a secret.
- **Who answers: any admin, on the host or an allowed device.** The event
  stream sends signed-in admins a `devices` event with the waiting devices
  whenever one starts waiting or is answered.
- **Allow stores the device; Turn away refuses it for a day**, so it doesn't
  ask again on every poll.
- **Waiting is bounded.** At most 10 devices wait, at most 3 from one address,
  each for at most an hour. A device that would be one too many is refused
  until a place frees, rather than pushing out one already waiting.

## Settings and the API

The choice is one document in `device_setting`, with a revision, like the
Mode's settings. Allowed devices are rows in `device`.

| Route | Who | Does |
| --- | --- | --- |
| `GET /api/device` | anyone | This device's state and label, and its code while waiting; `host` for the host |
| `GET /api/devices` | admins | The choice, its revision, and the waiting and allowed devices |
| `PUT /api/devices/setting` | admins | Change the choice read at `revision`; a stale one answers 409 |
| `POST /api/devices/{id}/allow` | admins | Allow a waiting device |
| `POST /api/devices/{id}/turn-away` | admins | Refuse a waiting device for a day |
| `DELETE /api/devices/{id}` | admins | Remove an allowed device, ending its sessions |
| `DELETE /api/devices` | admins | Remove every allowed device but this one |

Removing the device making the request answers 409, saying to remove it from
the host or another device.

## The web client

- **A waiting device shows one screen:** "Waiting for approval", its code, and
  where to answer, until the answer comes. A refused one says "This device
  can't connect." Any API call that answers `device_waiting` or
  `device_refused` brings that screen up, so a removed phone stops at once.
- **Admins see waiting devices in the header**, as a pill beside the Mode
  badge: "1 device waiting". It opens a menu with each device's label, address
  and code, and Allow and Turn away. The pill is the request's place on the
  screen, so it needs no toast.
- **Settings has an *Other devices* section**: the choice, then the waiting
  devices and the allowed ones, each with its label, address, and when it was
  last seen. Allowed devices have Remove, and the list has Remove all, which
  asks once more first. This device is tagged and has no Remove.

## What it protects

The gate keeps out devices the household didn't let in: a guest on the Wi-Fi,
a neighbor on a shared network. It does not stop an attacker who can read the
LAN's plain HTTP, who could copy an allowed device's cookie as they could a
session's.

## Testing

- **Domain:** the admission table above, row by row; which peers are the host;
  the label for each browser and system.
- **Application:** a new device waits and gets a code; the waiting limits
  refuse the eleventh device and the fourth from one address, and an hour
  frees a place; a device turned away stays refused for a day; `last_seen_at`
  is written at most once a minute; a pre-upgrade session is allowed; removing
  a device ends its sessions; removing the device making the request is
  refused; a stale revision conflicts.
- **Persistence:** the upgrade marks the sessions it finds, and undoing it
  keeps them.
- **Web:** through the app with test clients whose addresses are set: the host
  is admitted without a cookie; a phone waits, is allowed, and signs in; the
  client's files answer a waiting device; a forwarded request from loopback is
  not the host; an admin's event stream names the waiting devices.
- **Client:** the waiting screen, the header pill, and the Settings section,
  with a stand-in server. The browser tests run on the host, so they never see
  the waiting screen; it is checked with the stand-in only.

## Left for later

- A `medleyplay devices` command, for a server with no screen whose every
  allowed browser has been cleared. Until then, opening the page on the host
  through an SSH tunnel (`ssh -L 8000:localhost:8000 host`) reaches it from
  loopback.
- Naming a device, as "Mia's phone", in place of its label.
