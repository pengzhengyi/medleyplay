/**
 * @file Copying text to the clipboard, also on a page served over plain HTTP.
 */

/**
 * Copy `text` to the clipboard; return whether it worked. The clipboard API exists only
 * on pages served securely, which a server on the local network is not, so a hidden
 * text box and the older copy command stand in.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // No clipboard API, or the browser refused it: use the older command.
  }
  const box = document.createElement("textarea");
  box.value = text;
  box.setAttribute("readonly", "");
  box.style.position = "fixed";
  box.style.opacity = "0";
  document.body.append(box);
  box.select();
  try {
    // The only way to copy on a page served without the clipboard API.
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    box.remove();
  }
}
