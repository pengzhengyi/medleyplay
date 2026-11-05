/**
 * @file A stand-in for `XMLHttpRequest`, which sends a file with its progress: the test
 * says what the server answers and how far the upload got.
 */

import { vi } from "vitest";

/** One upload: what was sent, and the events the test sends back. */
export class FakeUploads {
  /** Every request made, oldest first. */
  readonly requests: FakeRequest[] = [];

  /** Replace `XMLHttpRequest` with a stand-in, and return where its requests are kept. */
  static install(): FakeUploads {
    const uploads = new FakeUploads();
    vi.stubGlobal(
      "XMLHttpRequest",
      class extends FakeRequest {
        constructor() {
          super();
          uploads.requests.push(this);
        }
      },
    );
    return uploads;
  }

  /** The latest request. */
  get last(): FakeRequest {
    const found = this.requests.at(-1);
    if (found === undefined) {
      throw new Error("Nothing was uploaded.");
    }
    return found;
  }
}

/** The part of `XMLHttpRequest` the client uses, with controls for the test. */
export class FakeRequest {
  method = "";
  url = "";
  body: unknown = undefined;
  status = 0;
  responseText = "";
  aborted = false;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  readonly upload: { onprogress: ((event: ProgressEvent) => void) | null } = { onprogress: null };

  open(method: string, url: string): void {
    this.method = method;
    this.url = url;
  }

  send(body: unknown): void {
    this.body = body;
  }

  abort(): void {
    this.aborted = true;
    this.onabort?.();
  }

  /** The server answered with `status` and `text`. */
  answer(status: number, text: string): void {
    this.status = status;
    this.responseText = text;
    this.onload?.();
  }

  /** `sent` of `total` bytes went. */
  progress(sent: number, total: number): void {
    this.upload.onprogress?.({ lengthComputable: true, loaded: sent, total } as ProgressEvent);
  }

  /** The request failed before the server answered. */
  fail(): void {
    this.onerror?.();
  }
}
