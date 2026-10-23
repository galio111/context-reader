/** WebKit suppresses even parent-installed event handlers in script-disabled
 * frames. Observe native ranges from the parent without relaxing the sandbox.
 * Event-capable browsers retain their precise mouse-release path.
 */
export function observeSandboxedSelection(frame: HTMLIFrameElement, handledByEvents: () => boolean, submit: () => void) {
  let previous = "", submitted = "", changedAt = 0;
  let start: Node | null = null, end: Node | null = null;
  const timer = frame.ownerDocument.defaultView!.setInterval(() => {
    if (frame.ownerDocument.visibilityState === "hidden") return;
    const selection = frame.contentDocument?.getSelection();
    if (!selection?.rangeCount || selection.isCollapsed) {
      previous = submitted = ""; start = end = null; return;
    }
    const range = selection.getRangeAt(0);
    const signature = `${range.startOffset}:${range.endOffset}:${selection.toString()}`;
    if (handledByEvents()) {
      previous = submitted = signature; start = range.startContainer; end = range.endContainer; return;
    }
    if (signature !== previous || start !== range.startContainer || end !== range.endContainer) {
      previous = signature; start = range.startContainer; end = range.endContainer; changedAt = Date.now(); return;
    }
    if (signature === submitted || Date.now() - changedAt < 180) return;
    submit();
    // Submission expands partial words. Remember the expanded range so our own
    // highlight does not enqueue another request on the next observation.
    const expanded = selection.rangeCount ? selection.getRangeAt(0) : null;
    previous = submitted = expanded ? `${expanded.startOffset}:${expanded.endOffset}:${selection.toString()}` : "";
    start = expanded?.startContainer ?? null; end = expanded?.endContainer ?? null;
  }, 90);
  return () => frame.ownerDocument.defaultView!.clearInterval(timer);
}
