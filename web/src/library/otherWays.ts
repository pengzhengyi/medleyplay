/**
 * @file The other ways to get a site Track's file, for the household to run themselves.
 *
 * medleyplay never runs these or retries a refusal by them; it only shows each
 * command with the part's link filled in.
 */

/** One way to get a file: its name, when to try it, and the command to run. */
export interface Way {
  readonly name: string;
  readonly when: string;
  readonly command: string;
}

/** Return the link to part `part` of the video `video` on a site of `kind`. */
export function partLink(kind: string, video: string, part: number): string {
  return kind === "bilibili" ? `https://www.bilibili.com/video/${video}?p=${String(part)}` : video;
}

/**
 * Return the other ways to get the file of the part at `link` on a site of `kind`, in
 * the order to try them; none for a site this knows no way for.
 */
export function otherWays(kind: string, link: string): readonly Way[] {
  if (kind !== "bilibili") {
    return [];
  }
  const id = /\/video\/([^/?]+)/.exec(link)?.[1] ?? "video";
  const part = /[?&]p=(\d+)/.exec(link)?.[1];
  const name = part === undefined ? id : `${id}-p${part}`;
  return [
    {
      name: "yt-dlp through your proxy",
      when: "Try this first. Put your own proxy's address in place of the example.",
      command: `yt-dlp --proxy "socks5h://127.0.0.1:7890" -f ba -o "${name}.%(ext)s" "${link}"`,
    },
    {
      name: "yt-dlp with your browser's login",
      when: "For a video that needs a login. Use the browser you are signed in to Bilibili with.",
      command: `yt-dlp --cookies-from-browser chrome -f ba -o "${name}.%(ext)s" "${link}"`,
    },
    {
      name: "BBDown",
      when: "Saves the audio under the video's title.",
      command: `BBDown --audio-only "${link}"`,
    },
    {
      name: "yutto",
      when: "Saves the audio under the video's title.",
      command: `yutto --audio-only "${link}"`,
    },
    {
      name: "lux",
      when: "Saves the whole video; medleyplay accepts it when it is an .mp4 file.",
      command: `lux -O "${name}" "${link}"`,
    },
    {
      name: "you-get",
      when: "Saves the whole video; medleyplay accepts it when it is an .mp4 file.",
      command: `you-get -O "${name}" "${link}"`,
    },
  ];
}
