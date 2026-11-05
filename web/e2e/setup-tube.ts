/**
 * @file Prepares the `tube` server once: Alice as the admin, and the Mode settled Online.
 *
 * Its Tracks come from links, which each test adds; a link is looked up only while
 * medleyplay is Online, which a new server becomes a moment after it starts. On a
 * busy machine its first connectivity check can fail, and the next comes 30 seconds
 * later, so the wait outlasts that.
 */

import { expect, test as setup } from "@playwright/test";

import { ALICE, SIGNED_IN_TUBE } from "./fixtures";

setup("sign in as Alice on the tube server", async ({ request }) => {
  setup.setTimeout(90_000);
  const created = await request.post("/api/setup", { data: ALICE });
  expect(created.status()).toBe(201);
  await expect
    .poll(
      async () => ((await (await request.get("/api/mode")).json()) as { online: boolean }).online,
      { timeout: 75_000 },
    )
    .toBe(true);
  await request.storageState({ path: SIGNED_IN_TUBE });
});
