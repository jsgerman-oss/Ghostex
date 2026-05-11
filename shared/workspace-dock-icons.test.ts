import { describe, expect, test } from "vitest";

import { resolveWorkspaceProjectIconDataUrl } from "./workspace-dock-icons";

const pngDataUrl = "data:image/png;base64,cHJvamVjdC1pY29u";
const svgDataUrl = "data:image/svg+xml;base64,PHN2Zy8+";

describe("resolveWorkspaceProjectIconDataUrl", () => {
  test("prefers the typed image icon for shared React and native project chrome", () => {
    /**
     * CDXC:ProjectIcons 2026-05-11-01:50
     * macOS notification attachments and future React titlebar project UI must
     * consume the same validated project image data URL from workspace state.
     */
    expect(
      resolveWorkspaceProjectIconDataUrl({
        icon: { dataUrl: pngDataUrl, kind: "image" },
        iconDataUrl: svgDataUrl,
      }),
    ).toBe(pngDataUrl);
  });

  test("keeps legacy iconDataUrl available when no typed image icon exists", () => {
    expect(
      resolveWorkspaceProjectIconDataUrl({
        icon: { icon: "terminal", kind: "tabler" },
        iconDataUrl: svgDataUrl,
      }),
    ).toBe(svgDataUrl);
  });

  test("rejects invalid image data URLs", () => {
    expect(resolveWorkspaceProjectIconDataUrl({ iconDataUrl: "https://example.com/icon.png" })).toBe(
      undefined,
    );
  });
});
