/** @file Adds synthetic Bilibili fixtures through the queued lookup flow. */

import { type APIRequestContext, expect } from "@playwright/test";

/** Add one part without contending for the provider lane through the synchronous API. */
export async function addBilibili(
  request: APIRequestContext,
  link: string,
  title: string,
  artist: string,
): Promise<number> {
  const submitted = await request.post("/api/links/lookups", { data: { link } });
  await expect(submitted).toBeOK();
  const { id } = (await submitted.json()) as { readonly id: number };
  const path = `/api/links/lookups/${String(id)}`;
  await expect
    .poll(
      async () => {
        const saved = await request.get(path);
        await expect(saved).toBeOK();
        return ((await saved.json()) as { readonly state: string }).state;
      },
      { timeout: 15_000 },
    )
    .toBe("succeeded");
  const added = await request.post(path, { data: { parts: [{ part: 1, title, artist }] } });
  await expect(added).toBeOK();
  const [first] = (await added.json()) as { readonly track_id: number }[];
  if (first === undefined) throw new Error("The fixture did not add a track.");
  return first.track_id;
}
