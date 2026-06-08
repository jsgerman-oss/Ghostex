export const SIDEBAR_SESSION_TAGS = [
  "favorite",
  "high-priority",
  "low-priority",
  "todo",
  "research",
  "in-progress",
  "testing",
  "blocked",
  "on-hold",
  "done",
  "bug",
  "feature",
  "design",
] as const;

export type SidebarSessionTag = (typeof SIDEBAR_SESSION_TAGS)[number];

export type SidebarSessionTagOption = {
  label: string;
  value: SidebarSessionTag;
};

export type SidebarSessionTagSection = {
  label: "Priority" | "Progress" | "Type";
  options: readonly SidebarSessionTagOption[];
};

/**
 * CDXC:SessionTags 2026-06-05-12:30:
 * Session tags replace the single Favorite affordance with one mutually exclusive session marker. Keep the list centralized so sidebar rows, Previous Sessions, macOS, Electron, and gxserver share the same persisted values and user-facing labels.
 *
 * CDXC:SessionTags 2026-06-05-14:45:
 * Testing and Blocked are first-class tags. Todo remains distinct from progress work state and uses a bright neutral icon color in the sidebar/menu palette instead of green.
 *
 * CDXC:SessionTags 2026-06-05-15:22:
 * The session tag menu and filters are grouped by meaning: Priority tags first, workflow Progress tags in lifecycle order, and Type tags last. Research is a Type tag, not a Progress tag. In Progress is a user-assigned progress tag, separate from runtime activity state, and must use the persisted value `in-progress`.
 *
 * CDXC:SessionTags 2026-06-05-19:12:
 * Type tags are limited to Research, Bug, Feature, and Design so the tag picker, filters, and persisted union expose only the current supported classification set.
 */
export const SIDEBAR_SESSION_TAG_SECTIONS: readonly SidebarSessionTagSection[] = [
  {
    label: "Priority",
    options: [
      { label: "Favorite", value: "favorite" },
      { label: "High Priority", value: "high-priority" },
      { label: "Low Priority", value: "low-priority" },
    ],
  },
  {
    label: "Progress",
    options: [
      { label: "Todo", value: "todo" },
      { label: "In Progress", value: "in-progress" },
      { label: "Testing", value: "testing" },
      { label: "Blocked", value: "blocked" },
      { label: "On Hold", value: "on-hold" },
      { label: "Done", value: "done" },
    ],
  },
  {
    label: "Type",
    options: [
      { label: "Research", value: "research" },
      { label: "Bug", value: "bug" },
      { label: "Feature", value: "feature" },
      { label: "Design", value: "design" },
    ],
  },
];

export const SIDEBAR_SESSION_TAG_OPTIONS: readonly SidebarSessionTagOption[] =
  SIDEBAR_SESSION_TAG_SECTIONS.flatMap((section) => section.options);

const SIDEBAR_SESSION_TAG_SET = new Set<string>(SIDEBAR_SESSION_TAGS);

export function isSidebarSessionTag(value: unknown): value is SidebarSessionTag {
  return typeof value === "string" && SIDEBAR_SESSION_TAG_SET.has(value);
}

export function normalizeSidebarSessionTag(value: unknown): SidebarSessionTag | undefined {
  return isSidebarSessionTag(value) ? value : undefined;
}

export function getSidebarSessionTagLabel(tag: SidebarSessionTag | undefined): string | undefined {
  return SIDEBAR_SESSION_TAG_OPTIONS.find((option) => option.value === tag)?.label;
}

export function getEffectiveSidebarSessionTag(input: {
  isFavorite?: boolean;
  sessionTag?: SidebarSessionTag;
}): SidebarSessionTag | undefined {
  return input.sessionTag ?? (input.isFavorite === true ? "favorite" : undefined);
}

export function getRestoredPreviousSessionTag(input: {
  isFavorite?: boolean;
  sessionTag?: SidebarSessionTag | null;
}): SidebarSessionTag | undefined {
  /*
  CDXC:PreviousSessions 2026-06-06-05:29:
  Restoring a Previous Sessions row must keep the user's durable tag marker attached to the recreated session. Legacy Favorite-only rows restore as the `favorite` tag so the new tag model does not lose older session intent.
  */
  return normalizeSidebarSessionTag(input.sessionTag) ?? (input.isFavorite === true ? "favorite" : undefined);
}

export function getRestoredPreviousSessionSidebarOrder(input: {
  sidebarOrder?: number | null;
}): number | undefined {
  /*
  CDXC:ManualSessionSorting 2026-06-06-05:29:
  Previous-session restore should return near the old manual sidebar position only when gxserver has a saved positive sidebarOrder from an explicit manual/pinned order. Rows without a saved manual position keep the normal new-session order at the top.
  */
  return typeof input.sidebarOrder === "number" && Number.isFinite(input.sidebarOrder) && input.sidebarOrder > 0
    ? input.sidebarOrder
    : undefined;
}
