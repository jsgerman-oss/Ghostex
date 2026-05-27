import { describe, expect, test } from "vitest";
import {
  formatProjectEditorDiffStatsLabel,
  shouldTreatProjectAsEmptySessionGroup,
  shouldShowOpenProjectFolderIcon,
  shouldShowProjectEditorDiffStats,
} from "./session-group-section";

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
        additions: 12000,
        deletions: 10001,
        files: 120,
        isLoading: false,
        isRepo: true,
      }),
    ).toBe("+9999 -9999");
  });

  test("includes the capped file count when enabled", () => {
    expect(
      formatProjectEditorDiffStatsLabel(
        {
          additions: 12000,
          deletions: 10001,
          files: 120,
          isLoading: false,
          isRepo: true,
        },
        true,
      ),
    ).toBe("99 +9999 -9999");
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
