import { describe, expect, it } from "vitest";

import { otherWays, partLink } from "./otherWays";

const LINK = "https://www.bilibili.com/video/BV1Xx41117Tz?p=2";

describe("the other ways to get a Bilibili part's file", () => {
  it("lists yt-dlp through the proxy first, then with the browser's login", () => {
    expect(otherWays("bilibili", LINK).map((way) => way.name)).toEqual([
      "yt-dlp through your proxy",
      "yt-dlp with your browser's login",
      "BBDown",
      "yutto",
      "lux",
      "you-get",
    ]);
  });

  it("fills the part's link into every command", () => {
    for (const way of otherWays("bilibili", LINK)) {
      expect(way.command).toContain(`"${LINK}"`);
    }
  });

  it("names the files the video's id and the part, for the tools that take a name", () => {
    const [proxied] = otherWays("bilibili", LINK);

    expect(proxied?.command).toBe(
      `yt-dlp --proxy "socks5h://127.0.0.1:7890" -f ba -o "BV1Xx41117Tz-p2.%(ext)s" "${LINK}"`,
    );
  });

  it("lists nothing for a site it knows no way for", () => {
    expect(otherWays("example", "https://example.com/video/1")).toEqual([]);
  });
});

describe("a link to a part of a video", () => {
  it("is the site's link with the part's number", () => {
    expect(partLink("bilibili", "BV1Xx41117Tz", 3)).toBe(
      "https://www.bilibili.com/video/BV1Xx41117Tz?p=3",
    );
  });
});
