import { useEffect, useState, type RefObject } from "react";

export type ScrollGlowState = {
  hasOverflow: boolean;
  showBottomGlow: boolean;
  showTopGlow: boolean;
};

const SCROLL_GLOW_EPSILON_PX = 2;

function getScrollableContentHeight(element: HTMLElement): number {
  /**
   * CDXC:SidebarScroll 2026-05-08-10:53
   * Bottom-of-list scrolling must preserve the user's offset. Child
   * getBoundingClientRect() values move upward as scrollTop increases, so
   * using them made the list look non-overflowing at the bottom and reset to
   * the top. scrollHeight is stable across scroll positions.
   */
  return element.scrollHeight;
}

export function useScrollGlowState(
  scrollContainerRef: RefObject<HTMLElement | null>,
): ScrollGlowState {
  const [scrollGlowState, setScrollGlowState] = useState<ScrollGlowState>({
    hasOverflow: false,
    showBottomGlow: false,
    showTopGlow: false,
  });

  useEffect(() => {
    const element = scrollContainerRef.current;
    if (!element) {
      return;
    }

    let animationFrameId = 0;

    const updateScrollGlowState = () => {
      animationFrameId = 0;

      const contentHeight = getScrollableContentHeight(element);
      const hasOverflow = contentHeight - element.clientHeight > SCROLL_GLOW_EPSILON_PX;
      /**
       * CDXC:SidebarScroll 2026-05-05-05:29
       * Combined-mode sparse project lists must not rubber-band or preserve a
       * stale scroll offset after sessions are collapsed/closed. When the
       * measured content fits, pin the session-list viewport back to the top
       * and let CSS disable wheel scrolling for that non-overflowing state.
       */
      if (!hasOverflow && element.scrollTop !== 0) {
        element.scrollTop = 0;
      }
      const showTopGlow = hasOverflow && element.scrollTop > SCROLL_GLOW_EPSILON_PX;
      const remainingBottom = contentHeight - element.clientHeight - element.scrollTop;
      const showBottomGlow = hasOverflow && remainingBottom > SCROLL_GLOW_EPSILON_PX;

      setScrollGlowState((previous) =>
        previous.hasOverflow === hasOverflow &&
        previous.showTopGlow === showTopGlow &&
        previous.showBottomGlow === showBottomGlow
          ? previous
          : {
              hasOverflow,
              showBottomGlow,
              showTopGlow,
            },
      );
    };

    const scheduleScrollGlowUpdate = () => {
      if (animationFrameId !== 0) {
        return;
      }

      animationFrameId = window.requestAnimationFrame(updateScrollGlowState);
    };

    const resizeObserver = new ResizeObserver(() => {
      scheduleScrollGlowUpdate();
    });
    const mutationObserver = new MutationObserver(() => {
      scheduleScrollGlowUpdate();
    });

    resizeObserver.observe(element);
    mutationObserver.observe(element, {
      attributes: true,
      childList: true,
      characterData: true,
      subtree: true,
    });
    element.addEventListener("scroll", scheduleScrollGlowUpdate, { passive: true });
    window.addEventListener("resize", scheduleScrollGlowUpdate);
    scheduleScrollGlowUpdate();

    return () => {
      if (animationFrameId !== 0) {
        window.cancelAnimationFrame(animationFrameId);
      }

      resizeObserver.disconnect();
      mutationObserver.disconnect();
      element.removeEventListener("scroll", scheduleScrollGlowUpdate);
      window.removeEventListener("resize", scheduleScrollGlowUpdate);
    };
  }, [scrollContainerRef]);

  return scrollGlowState;
}
