import { useCallback, useLayoutEffect, useRef, useState } from 'react';

export default function useTranscriptScroll(key, active) {
  const scroller = useRef(null), following = useRef(true), lastTop = useRef(0);
  const [showLatest, setShowLatest] = useState(false);
  const scrollToBottom = useCallback(() => {
    const node = scroller.current;
    if (!node || !following.current) return;
    // Instant movement avoids queued smooth animations falling behind a stream.
    node.scrollTop = node.scrollHeight;
    lastTop.current = node.scrollTop;
  }, []);
  const jumpToLatest = useCallback(() => {
    following.current = true; setShowLatest(false); scrollToBottom();
  }, [scrollToBottom]);
  const onScroll = useCallback(event => {
    const node = event.currentTarget, nearBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 64;
    if (nearBottom) { following.current = true; setShowLatest(false); }
    // Content growth can fire scroll events too. Only movement UP detaches us;
    // an increased scrollHeight alone must never disable stream following.
    else if (node.scrollTop < lastTop.current - 1) { following.current = false; setShowLatest(true); }
    lastTop.current = node.scrollTop;
  }, []);
  useLayoutEffect(() => {
    if (!active) return;
    jumpToLatest();
    const node = scroller.current;
    if (!node) return;
    let frame;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame); frame = requestAnimationFrame(scrollToBottom);
    });
    observer.observe(node);
    if (node.firstElementChild) observer.observe(node.firstElementChild);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [key, active, jumpToLatest, scrollToBottom]);
  // React commits tokens before paint; ResizeObserver also covers late layout,
  // expanded reasoning, font changes, and resizing the conversation pane.
  useLayoutEffect(() => { if (active) scrollToBottom(); });
  return { scroller, onScroll, jumpToLatest, showLatest };
}
