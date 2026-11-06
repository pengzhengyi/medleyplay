import { describe, expect, it } from "vitest";

import { listenAddressesOf } from "./listen";

const HOSTS = ["192.168.1.20", "mac-mini.local"];

describe("the addresses to open on another device", () => {
  it("are the server's, on this page's port, when the page was opened on this machine", () => {
    const here = { protocol: "http:", hostname: "localhost", port: "8000" };

    expect(listenAddressesOf(HOSTS, here)).toEqual([
      "http://192.168.1.20:8000",
      "http://mac-mini.local:8000",
    ]);
  });

  it("start with where the page was opened, once, when another device can open it too", () => {
    const here = { protocol: "http:", hostname: "mac-mini.local", port: "8000" };

    expect(listenAddressesOf(HOSTS, here)).toEqual([
      "http://mac-mini.local:8000",
      "http://192.168.1.20:8000",
    ]);
  });

  it("leave out the port the page has none of", () => {
    const here = { protocol: "https:", hostname: "music.home", port: "" };

    expect(listenAddressesOf([], here)).toEqual(["https://music.home"]);
  });
});
