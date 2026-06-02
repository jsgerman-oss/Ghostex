import { describe, expect, test } from "vitest";
import { getSessionCardAccessibleLabel } from "./sortable-session-card";

describe("getSessionCardAccessibleLabel", () => {
  test("keeps session row labels independent from focused styling", () => {
    expect(
      getSessionCardAccessibleLabel({
        isFocused: false,
        title: "Fix sidebar session rows",
      }),
    ).toBe("Fix sidebar session rows");

    expect(
      getSessionCardAccessibleLabel({
        isFocused: true,
        title: "Fix sidebar session rows",
      }),
    ).toBe("Fix sidebar session rows, current session");
  });

  test("falls back to a stable label when the title is empty", () => {
    expect(
      getSessionCardAccessibleLabel({
        isFocused: false,
        title: " ",
      }),
    ).toBe("Session");
  });
});
