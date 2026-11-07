/**
 * @file A stand-in for the event stream: a test sends the events the server would.
 */

/** An `EventSource` that hears only what a test sends; stub it in with `vi.stubGlobal`. */
export class FakeEventSource {
  static last: FakeEventSource | undefined;
  readonly listeners = new Map<string, ((event: MessageEvent<string>) => void)[]>();
  closed = false;

  constructor(readonly url: string) {
    FakeEventSource.last = this;
  }

  addEventListener(name: string, listener: (event: MessageEvent<string>) => void): void {
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), listener]);
  }

  close(): void {
    this.closed = true;
  }

  send(name: string, data: unknown = {}): void {
    for (const listener of this.listeners.get(name) ?? []) {
      listener(new MessageEvent(name, { data: JSON.stringify(data) }));
    }
  }
}

/** The event stream the page opened last. */
export function stream(): FakeEventSource {
  const found = FakeEventSource.last;
  if (found === undefined) {
    throw new Error("The page didn't open the event stream.");
  }
  return found;
}
