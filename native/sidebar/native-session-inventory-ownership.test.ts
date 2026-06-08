import { describe, expect, test } from "vitest";
import { resolveNativeSessionInventoryOwnership } from "./native-session-inventory-ownership";

describe("resolveNativeSessionInventoryOwnership", () => {
  test("marks presentation project rows as gxserver owned", () => {
    expect(
      resolveNativeSessionInventoryOwnership({
        hasGxserverProjectContext: true,
        hasGxserverSessionReference: false,
      }),
    ).toEqual({
      isLocalOnly: false,
      ownership: "gxserver",
    });
  });

  test("marks combined gxserver session references as gxserver owned", () => {
    expect(
      resolveNativeSessionInventoryOwnership({
        hasGxserverProjectContext: false,
        hasGxserverSessionReference: true,
      }),
    ).toEqual({
      isLocalOnly: false,
      ownership: "gxserver",
    });
  });

  test("marks native-only panes as local", () => {
    expect(resolveNativeSessionInventoryOwnership({})).toEqual({
      isLocalOnly: true,
      ownership: "local",
    });
  });
});
