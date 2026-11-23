# First Library load

> [!IMPORTANT]
> **Approved for implementation.** Start the device check while the browser loads
> the application, rather than after React mounts. Keep the existing admission
> and sign-in rules. This is a proposal for first navigation, not for returning
> to an open tab; see [Cheap reloads](Cheap%20reloads.md) for the latter.

## What the listener waits for

The startup mark paints before the Library is usable. Here the finish line is
the first song title button inserted into the Library table. It is a repeatable
proxy for readiness, not a measure of when a user sees the next frame, clicks
the button, or hears audio. Waiting for all network activity would include
background work that does not block that row.

## Measurements

The production build at `d639d52` ran on a temporary loopback server with a
signed-in test account, 1,738 generated tracks and sources, 64 artist names,
128 album names, no covers, and no enabled plugins. No household database,
browser session, or music was used. For each network profile, headless Chromium
opened three fresh browser contexts and navigated twice in each. The first
navigation had an empty browser cache; the second reused the same context.
The server stayed running. The shaped profile used 60 ms latency and
1,048,576 bytes/s in each direction, with no CPU throttling.

| Median navigation to first song (ms) | Local, cold | Local, warm | Shaped, cold | Shaped, warm |
| --- | ---: | ---: | ---: | ---: |
| Current app, initial run | 481 | 247 | 986 | 415 |
| Current app, repeat control | 492 | 248 | 987 | 436 |
| Browser experiment: start admission early | 422 | 196 | 792 | 376 |

**Where the second goes.** In the shaped cold run nearest the initial median:

| Milestone | Time since navigation |
| --- | ---: |
| HTML received / first content painted | 62 / 236 ms |
| Entry JavaScript requested / received | 67 / 473 ms |
| `/api/device` requested / received | 594 / 660 ms |
| `/api/me` requested / received | 661 / 726 ms |
| `/api/tracks` requested / received | 773 / 872 ms |
| First song button inserted | 986 ms |

The entry script is 1,074,556 bytes uncompressed and 312,607 bytes on the
wire before headers; the stylesheet is 35,294 compressed bytes. In contrast,
the fixture's track list is 33,938 compressed bytes. The first 594 ms elapse
*before the app asks who may use it*. Not all of that is transfer: the gap
after the entry arrives includes module evaluation, scheduling and initial
rendering; resource timings alone cannot divide it further.

[`App.tsx`](../../../web/src/App.tsx) asks for the device in an effect, then
asks for the account. Only then does it mount `Library`, whose
[`useLibrary`](../../../web/src/library/useLibrary.ts) asks for tracks and
favorites together. The first table also needs time after the track response
ends. Code for idle-preloaded editors is not the explanation for this trace:
their preload is scheduled after the Library loads.

**There is a separate cold-server case.** The very first loopback navigation
took 1,389 ms; `/api/tracks` alone took 627 ms, versus 18–19 ms on the next two
cold-browser loopback runs. That is consistent with a first response build,
but is only one observation, not a database profile. Do not treat every slow
start as an asset problem. These measurements do not establish why a particular
phone or household session takes several seconds.

## Recommended first change

The experiment started the device request at document start, then fetched the
account **only after a positive admission answer**. The unmodified app consumed
the pending responses. Each measured navigation made one request to each
endpoint. No production code was changed. Against the repeat control the
shaped cold median fell by 195 ms (20%); warm fell by 60 ms. The runs were
sequential, not randomized. A browser initialization script gets an earlier
start than a downloaded module; treat this as evidence for overlap, not a
promise of a 195 ms improvement. Only the signed-in loopback host was tested;
the experiment did not cover every admitted device or failure path. The
difference also includes variation in rendering after the tracks arrived.

Start with **device lookup only**: React still handles account lookup and
revocation. Compare that with the two-read experiment before adding an early
account read. Prefer the simpler version if both meet the review criterion.

| Part | Proposed responsibility |
| --- | --- |
| Small startup module | Start admission without waiting for the Library dependency graph. Start loading the app in parallel, not after the answer. Measure the emitted build to check the module really stays small. |
| First account lookup | Keep this in the mounted app unless measuring the extra overlap justifies moving it. Use `letIn` for every device state. Share results only for this navigation; do not cache identity across accounts or start track reads early. |
| Application root | Consume that initial result once; preserve the waiting, refused, signed-out and signed-in screens. Later revocation or account changes start fresh reads. |

- [ ] A waiting or refused device never starts a speculative account or track
  request. Preserve the current fallback when the device endpoint is unavailable.
- [ ] A signed-out listener sees the login form, never the Library. A late initial
  answer cannot undo a later refusal or account change.
- [ ] Test an admitted remote device as well as the host. If account lookup
  moves earlier, retain a device refusal received before React subscribes:
  recheck admission, show the refusal screen, and make no track request.
- [ ] One device and one account read for an admitted initial navigation,
  including React development-mode remounts. Normal later reads still work.
- [ ] Alternate the current, early-device and early-device-plus-account builds
  on the same fixture, at least five cold/warm pairs per profile. Report first
  paint, track request start, first song, request counts, bytes and ranges.
  Aim for at least 100 ms lower median on
  shaped cold loads with no repeatable warm or sign-in regression. This is a
  review criterion, not a timing assertion for shared CI runners.

Use controlled promises for admission, session and stale-response tests, and
one browser flow for a signed-in first navigation. Measure time to the login
form and the device refusal screen separately: neither shows a song row.

## Alternatives and decision

| Option | When it earns a separate change |
| --- | --- |
| Reduce initial JavaScript | Profile the entry's largest eager imports if most of the delay remains before `/api/device`. Splitting a component needed immediately can add a round trip rather than save one. |
| Optimize catalog reads or first table render | Repeat fresh-server trials and capture query/build versus browser time if `/api/tracks` or the interval after it dominates on a representative slow device. |
| Combine admission and session into a server endpoint | Consider only if overlapping the existing reads is insufficient. It changes an API and must reproduce both admission and sign-in semantics. |

**Decision for review:** try the bounded admission change first, or first
collect a trace on the affected device if its delay is substantially longer
than this fixture's. No schema change, dependency, server rewrite or change
to cache policy is proposed.
