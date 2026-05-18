import { describe, expect, test } from "vitest";
import {
  formatProjectEditorDiffStatsLabel,
  getEmptyBrowserGroupExpandTooltip,
  shouldTreatProjectAsEmptySessionGroup,
  shouldShowOpenProjectFolderIcon,
  shouldShowProjectEditorDiffStats,
} from "./session-group-section";

describe("getEmptyBrowserGroupExpandTooltip", () => {
  test("should block expanding an empty collapsed browser group", () => {
    expect(
      getEmptyBrowserGroupExpandTooltip({
        browserTabCount: 0,
        isBrowserGroup: true,
        isCollapsed: true,
      }),
    ).toBe("No browser tabs open");
  });

  test("should allow non-empty browser groups to expand normally", () => {
    expect(
      getEmptyBrowserGroupExpandTooltip({
        browserTabCount: 1,
        isBrowserGroup: true,
        isCollapsed: true,
      }),
    ).toBeUndefined();
  });

  test("should allow workspace groups to expand normally", () => {
    expect(
      getEmptyBrowserGroupExpandTooltip({
        browserTabCount: 0,
        isBrowserGroup: false,
        isCollapsed: true,
      }),
    ).toBeUndefined();
  });
});

describe("shouldTreatProjectAsEmptySessionGroup", () => {
  test("identifies an empty project group so expanding it can create a first terminal", () => {
    expect(
      shouldTreatProjectAsEmptySessionGroup({
        hasProjectContext: true,
        sessionCount: 0,
      }),
    ).toBe(true);
  });

  test("does not treat non-project or non-empty groups as empty project groups", () => {
    expect(
      shouldTreatProjectAsEmptySessionGroup({
        hasProjectContext: false,
        sessionCount: 0,
      }),
    ).toBe(false);
    expect(
      shouldTreatProjectAsEmptySessionGroup({
        hasProjectContext: true,
        sessionCount: 1,
      }),
    ).toBe(false);
  });
});

describe("shouldShowOpenProjectFolderIcon", () => {
  test("keeps empty expanded project rows visually closed", () => {
    expect(
      shouldShowOpenProjectFolderIcon({
        isCollapsed: false,
        sessionCount: 0,
      }),
    ).toBe(false);
  });

  test("shows the open folder only for expanded projects with sessions", () => {
    expect(
      shouldShowOpenProjectFolderIcon({
        isCollapsed: false,
        sessionCount: 1,
      }),
    ).toBe(true);
    expect(
      shouldShowOpenProjectFolderIcon({
        isCollapsed: true,
        sessionCount: 1,
      }),
    ).toBe(false);
  });
});

describe("formatProjectEditorDiffStatsLabel", () => {
  test("formats the compact changed-lines summary by default", () => {
    expect(
      formatProjectEditorDiffStatsLabel({
        additions: 9,
        deletions: 11,
        files: 1,
        isLoading: false,
        isRepo: true,
      }),
    ).toBe("+9 -11");
  });

  test("caps the compact project diff counts for stable sidebar width", () => {
    expect(
      formatProjectEditorDiffStatsLabel({
        additions: 1200,
        deletions: 1001,
        files: 120,
        isLoading: false,
        isRepo: true,
      }),
    ).toBe("+999 -999");
  });

  test("includes the capped file count when enabled", () => {
    expect(
      formatProjectEditorDiffStatsLabel(
        {
          additions: 1200,
          deletions: 1001,
          files: 120,
          isLoading: false,
          isRepo: true,
        },
        true,
      ),
    ).toBe("99 +999 -999");
  });
});

describe("shouldShowProjectEditorDiffStats", () => {
  test("hides the project git status when additions and deletions are both zero", () => {
    expect(
      shouldShowProjectEditorDiffStats({
        additions: 0,
        deletions: 0,
        files: 0,
        isLoading: false,
        isRepo: true,
      }),
    ).toBe(false);
  });

  test("shows the project git status when additions are nonzero", () => {
    expect(
      shouldShowProjectEditorDiffStats({
        additions: 1,
        deletions: 0,
        files: 1,
        isLoading: false,
        isRepo: true,
      }),
    ).toBe(true);
  });

  test("shows the project git status when deletions are nonzero", () => {
    expect(
      shouldShowProjectEditorDiffStats({
        additions: 0,
        deletions: 1,
        files: 1,
        isLoading: false,
        isRepo: true,
      }),
    ).toBe(true);
  });
});
