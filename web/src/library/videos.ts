/**
 * @file The video a Track came from, as the page links to it.
 */

/** The name of the site `page` is on, such as *Bilibili*; its host for a site this doesn't know. */
export function siteNameOf(page: string): string {
  const host = new URL(page).hostname;
  return host === "bilibili.com" || host.endsWith(".bilibili.com") ? "Bilibili" : host;
}
