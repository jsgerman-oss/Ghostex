import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  areSidebarTooltipsSuppressed,
  SIDEBAR_TOOLTIP_DISMISS_EVENT,
  SIDEBAR_TOOLTIP_SUPPRESSION_CHANGED_EVENT,
  setSidebarTooltipsSuppressedForDrag,
} from "./app-tooltip";

const originalWindow = globalThis.window;

describe("sidebar tooltip drag suppression", () => {
  beforeEach(() => {
    (globalThis as typeof globalThis & { window: EventTarget }).window = new EventTarget();
    setSidebarTooltipsSuppressedForDrag(false);
  });

  afterEach(() => {
    setSidebarTooltipsSuppressedForDrag(false);
    if (originalWindow === undefined) {
      delete (globalThis as typeof globalThis & { window?: Window }).window;
    } else {
      globalThis.window = originalWindow;
    }
  });

  test("dismisses open tooltips and announces suppression changes while dragging", () => {
    const events: string[] = [];
    window.addEventListener(SIDEBAR_TOOLTIP_DISMISS_EVENT, () => events.push("dismiss"));
    window.addEventListener(SIDEBAR_TOOLTIP_SUPPRESSION_CHANGED_EVENT, () =>
      events.push("changed"),
    );

    setSidebarTooltipsSuppressedForDrag(true);

    expect(areSidebarTooltipsSuppressed()).toBe(true);
    expect(events).toEqual(["dismiss", "changed"]);

    setSidebarTooltipsSuppressedForDrag(true);
    expect(events).toEqual(["dismiss", "changed"]);

    setSidebarTooltipsSuppressedForDrag(false);
    expect(areSidebarTooltipsSuppressed()).toBe(false);
    expect(events).toEqual(["dismiss", "changed", "changed"]);
  });
});
