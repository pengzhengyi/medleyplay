/**
 * @file The addresses another device on the network opens to listen, from the ones the
 * server says it can be reached at.
 */

/** Where the page itself was opened, as `location` says. */
export interface Here {
  readonly protocol: string;
  readonly hostname: string;
  readonly port: string;
}

const THIS_MACHINE = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/**
 * The full addresses to open, the surest first: where this page was opened when that
 * is not this machine alone, since it already works, then each the server gave, all on
 * this page's port.
 */
export function listenAddressesOf(hosts: readonly string[], here: Here): string[] {
  const port = here.port === "" ? "" : `:${here.port}`;
  const first = THIS_MACHINE.has(here.hostname) ? [] : [here.hostname];
  return [...new Set([...first, ...hosts])].map((host) => `${here.protocol}//${host}${port}`);
}
