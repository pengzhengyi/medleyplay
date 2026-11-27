const WEBKIT_IME_KEY = 229;

export function composing(event: KeyboardEvent): boolean {
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- Safari can signal IME confirmation with only key code 229.
  return event.isComposing || event.keyCode === WEBKIT_IME_KEY;
}
