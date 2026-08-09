// Copy that actually works on a teacher's phone.
//
// Many teachers prep on mobile, where the async Clipboard API is the happy path
// but not a guarantee: iOS Safari refuses `writeText` outside a trusted gesture,
// older Android WebViews lack it entirely, and any non-secure context (a LAN
// preview over http) has no `navigator.clipboard` at all. So: try the modern
// API, then fall back to a selection + `execCommand("copy")`, which is still the
// only thing that works on those devices.
//
// The fallback element is deliberately fiddly for a reason:
//  - `readonly` + `contenteditable` keeps iOS from opening the keyboard,
//  - `font-size: 16px` keeps iOS from zooming the page,
//  - `position: fixed; top: 0` keeps the page from scrolling to the element,
//  - a Range plus `setSelectionRange` covers both iOS and desktop selection.

function fallbackCopy(text: string): boolean {
  if (typeof document === "undefined") return false;

  const holder = document.createElement("textarea");
  holder.value = text;
  holder.setAttribute("readonly", "");
  holder.contentEditable = "true";
  holder.style.position = "fixed";
  holder.style.top = "0";
  holder.style.left = "0";
  holder.style.width = "1px";
  holder.style.height = "1px";
  holder.style.padding = "0";
  holder.style.border = "0";
  holder.style.opacity = "0";
  holder.style.fontSize = "16px";
  document.body.appendChild(holder);

  const selection = window.getSelection();
  const previous = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;

  let copied = false;
  try {
    const range = document.createRange();
    range.selectNodeContents(holder);
    selection?.removeAllRanges();
    selection?.addRange(range);
    holder.setSelectionRange(0, text.length);
    copied = document.execCommand("copy");
  } catch {
    copied = false;
  } finally {
    document.body.removeChild(holder);
    selection?.removeAllRanges();
    // Give the teacher their own selection back — copying a turn should not
    // silently destroy the passage they had highlighted.
    if (previous) selection?.addRange(previous);
  }

  return copied;
}

/**
 * Writes `text` to the clipboard. Resolves `true` on success, `false` when every
 * path failed — the caller is expected to tell the teacher rather than pretend.
 * Must be called from within a user gesture (click / keydown).
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (!text) return false;

  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Permission denied, insecure context, or Safari being Safari.
    }
  }

  return fallbackCopy(text);
}
