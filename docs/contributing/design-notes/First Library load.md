# First Library load

> [!NOTE]
> **Status: implemented.** The page checks the device and account while the
> browser loads the application. This note covers first navigation; see
> [Cheap reloads](Cheap%20reloads.md) for returning to an open tab.

## What blocks the first song

The startup mark can paint before the user can play anything. For an admitted,
signed-in device, the first song depends on the application script, the account
check, the track response, and the first table render. The page overlaps device
and account reads with script loading. It waits for the account before fetching
tracks.

## Admission on first navigation

- The [HTML page](../../../web/index.html) starts `/api/device`. If the server
  reports a known admitted state, the page starts `/api/me`. The first mounted
  app takes the pending responses and removes the handoff; retrying the app
  reads a fresh session.
- The [root component](../../../web/src/App.tsx) subscribes to device refusals
  before consuming either response through the API client. A refusal during
  the account read triggers a fresh admission check, not the login form. A
  stale response cannot replace a newer admission result or session. Checks
  from the waiting or refusal screens follow the same ordering.
- Only the initial mount uses those responses. React can retry its effect
  without sending the same device request again. Later checks always read the
  server. No track data or identity is kept when the browser opens the page again.
- If the device is waiting or refused, the page shows its status and does not
  read the account or tracks. If the device endpoint is unavailable, the root
  falls back to asking for the account as it does without the handoff.

## Measurements

Production builds shared a loopback server and a synthetic Library with 1,738
tracks, no covers, and no plugins. Chrome used a fresh browser context for each
cold navigation and reused it for the immediately following warm navigation.
The server stayed running. The simulated connection used 60 ms latency and
1,048,576 bytes/s in each direction without CPU throttling.

| Time to first song, median (range), ms | Original order | Early device and account |
| --- | ---: | ---: |
| Simulated connection, cold | 1,509 (1,391–1,900) | 1,303 (1,250–1,448) |
| Simulated connection, warm | 926 (831–1,082) | 1,012 (722–1,346) |
| Loopback, cold | 1,226 (1,099–1,890) | 1,211 (1,157–1,600) |
| Loopback, warm | 828 (568–1,178) | 764 (664–992) |

These are seven alternating pairs per connection. In two earlier trials,
starting only the device read saved 75 ms on the simulated cold connection;
starting both reads saved 136–141 ms. The table shows the final build. Warm
and loopback results varied across trials and do not establish a repeatable
gain or regression. Time to the signed-out form on the simulated
cold connection went from 986 to 857 ms. Each navigation requested the device
and account once; only signed-in page loads requested tracks.

On the simulated cold connection the track request started at a median of
1,009 ms in the original build and 888 ms with both reads early. First paint of
page content was 368 vs. 348 ms. The change gets the first song ready sooner;
it does not speed up the startup mark or shrink the application script.

The finish line is the first song title button inserted into the table. This
measures readiness, not when the listener hears audio. Tests cover request
ordering, waiting and refusal, fallback, stale responses, and sign-in. These
benchmarks are not timing assertions in CI and do not represent every device or
library.

## What to measure next

Profile the downloads and evaluation of the scripts needed before the Library
appears. Measure a separate server restart series before changing the catalog:
one early loopback run spent 627 ms on the first track response, versus 18–19 ms
on its next two cold-browser runs. Finally, separate JSON parsing, preparing the
table, and rendering the first row before changing how the full list is loaded.
