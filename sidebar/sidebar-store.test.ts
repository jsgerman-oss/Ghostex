import { beforeEach, describe, expect, test } from "vitest";
import type {
  SidebarHydrateMessage,
  SidebarSessionGroup,
  SidebarSessionItem,
  SidebarSessionStateMessage,
} from "../shared/session-grid-contract";
import {
  createInitialSidebarStoreDataState,
  resetSidebarStore,
  useSidebarStore,
} from "./sidebar-store";

describe("sidebar store", () => {
  beforeEach(() => {
    resetSidebarStore();
  });

  test("should track the latest order sync result for the matching sidebar section", () => {
    useSidebarStore.getState().applyOrderSyncResultMessage({
      itemIds: ["claude", "codex"],
      kind: "agent",
      requestId: "req-agent",
      status: "success",
      type: "sidebarOrderSyncResult",
    });

    let state = useSidebarStore.getState();
    expect(state.latestAgentOrderSyncResult).toEqual({
      itemIds: ["claude", "codex"],
      kind: "agent",
      requestId: "req-agent",
      status: "success",
      type: "sidebarOrderSyncResult",
    });
    expect(state.latestCommandOrderSyncResult).toBeUndefined();

    useSidebarStore.getState().applyOrderSyncResultMessage({
      itemIds: ["test", "build"],
      kind: "command",
      requestId: "req-command",
      status: "error",
      type: "sidebarOrderSyncResult",
    });

    state = useSidebarStore.getState();
    expect(state.latestAgentOrderSyncResult).toBeUndefined();
    expect(state.latestCommandOrderSyncResult).toEqual({
      itemIds: ["test", "build"],
      kind: "command",
      requestId: "req-command",
      status: "error",
      type: "sidebarOrderSyncResult",
    });
  });

  test("should track and clear sidebar command run feedback", () => {
    useSidebarStore.getState().applyCommandRunStateMessage({
      commandId: "build",
      runId: "run-build",
      state: "running",
      type: "sidebarCommandRunStateChanged",
    });

    let state = useSidebarStore.getState();
    expect(state.commandRunStates.build).toEqual({
      activeRunIds: ["run-build"],
      status: "running",
    });

    useSidebarStore.getState().applyCommandRunStateMessage({
      commandId: "build",
      runId: "run-build",
      state: "success",
      type: "sidebarCommandRunStateChanged",
    });

    state = useSidebarStore.getState();
    expect(state.commandRunStates.build).toEqual({
      activeRunIds: [],
      status: "success",
    });

    useSidebarStore.getState().clearCommandRunState("build");

    expect(useSidebarStore.getState().commandRunStates.build).toBeUndefined();
  });

  test("should clear sidebar command run feedback from extension messages", () => {
    useSidebarStore.getState().applyCommandRunStateMessage({
      commandId: "build",
      runId: "run-build",
      state: "running",
      type: "sidebarCommandRunStateChanged",
    });

    useSidebarStore.getState().applyCommandRunStateClearedMessage({
      commandId: "build",
      type: "sidebarCommandRunStateCleared",
    });

    expect(useSidebarStore.getState().commandRunStates.build).toBeUndefined();
  });

  test("should preserve the synthetic chats group marker during hydration", () => {
    useSidebarStore.getState().applySidebarMessage(
      createHydrateMessage([
        {
          ...createGroup("combined-chats", [createSession("chat-session-1", "Chat")]),
          isChatCollection: true,
          title: "Chats",
        },
      ]),
    );

    expect(useSidebarStore.getState().groupsById["combined-chats"]?.isChatCollection).toBe(true);
  });

  test("should update only the targeted session record on sessionPresentationChanged", () => {
    useSidebarStore
      .getState()
      .applySidebarMessage(
        createHydrateMessage([
          createGroup("group-1", [
            createSession("session-1", "groups"),
            createSession("session-2", "notes"),
          ]),
          createGroup("group-2", [createSession("session-3", "logs")]),
        ]),
      );

    const before = useSidebarStore.getState();
    const previousGroupsById = before.groupsById;
    const previousSessionIdsByGroup = before.sessionIdsByGroup;
    const previousSession = before.sessionsById["session-1"];
    const previousSiblingSession = before.sessionsById["session-2"];

    useSidebarStore.getState().applySessionPresentationMessage({
      session: {
        ...previousSession,
        lifecycleState: "done",
        primaryTitle: "updated groups",
      },
      type: "sessionPresentationChanged",
    });

    const after = useSidebarStore.getState();
    expect(after.groupsById).toBe(previousGroupsById);
    expect(after.sessionIdsByGroup).toBe(previousSessionIdsByGroup);
    expect(after.sessionsById["session-1"]).not.toBe(previousSession);
    expect(after.sessionsById["session-1"]?.lifecycleState).toBe("done");
    expect(after.sessionsById["session-1"]?.primaryTitle).toBe("updated groups");
    expect(after.sessionsById["session-2"]).toBe(previousSiblingSession);
  });

  test("should preserve unchanged HUD slice references across session snapshots", () => {
    useSidebarStore
      .getState()
      .applySidebarMessage(
        createHydrateMessage([
          createGroup("group-1", [
            createSession("session-1", "groups"),
            createSession("session-2", "notes"),
          ]),
        ]),
      );

    const before = useSidebarStore.getState();
    const sessionState: SidebarSessionStateMessage = {
      groups: [
        createGroup("group-1", [
          {
            ...createSession("session-1", "groups"),
            activity: "attention",
            activityLabel: "Needs attention",
          },
          createSession("session-2", "notes"),
        ]),
      ],
      hud: {
        ...before.hud,
        agents: before.hud.agents.map((agent) => ({ ...agent })),
        commands: before.hud.commands.map((command) => ({ ...command })),
        git: {
          ...before.hud.git,
          files: before.hud.git.files.map((file) => ({ ...file })),
          pr: before.hud.git.pr ? { ...before.hud.git.pr } : null,
        },
        pendingAgentIds: [...before.hud.pendingAgentIds],
        projectSettingsProjects: before.hud.projectSettingsProjects?.map((project) => ({
          ...project,
        })),
        recentProjects: before.hud.recentProjects.map((project) => ({ ...project })),
        settings: before.hud.settings ? { ...before.hud.settings } : undefined,
        visibleSlotLabels: [...before.hud.visibleSlotLabels],
      },
      pinnedPrompts: [],
      previousSessions: [],
      revision: 2,
      scratchPadContent: "",
      type: "sessionState",
    };

    /**
     * CDXC:AppModals 2026-05-29-19:44:
     * Attention/activity snapshots may rebuild HUD objects without changing
     * agents or settings. Open modals subscribe to those slices, so preserving
     * unchanged references keeps unrelated session status updates from
     * reinitializing modal drafts.
     */
    useSidebarStore.getState().applySidebarMessage(sessionState);

    const after = useSidebarStore.getState();
    expect(after.sessionsById["session-1"]?.activity).toBe("attention");
    expect(after.hud.agents).toBe(before.hud.agents);
    expect(after.hud.commands).toBe(before.hud.commands);
    expect(after.hud.git).toBe(before.hud.git);
    expect(after.hud.pendingAgentIds).toBe(before.hud.pendingAgentIds);
    expect(after.hud.projectSettingsProjects).toBe(before.hud.projectSettingsProjects);
    expect(after.hud.recentProjects).toBe(before.hud.recentProjects);
    expect(after.hud.settings).toBe(before.hud.settings);
    expect(after.hud.visibleSlotLabels).toBe(before.hud.visibleSlotLabels);
  });
});

function createHydrateMessage(
  groups: SidebarSessionGroup[],
  options?: {
    revision?: number;
  },
): SidebarHydrateMessage {
  const initialHud = createInitialSidebarStoreDataState().hud;

  return {
    groups,
    hud: {
      ...initialHud,
    },
    pinnedPrompts: [],
    previousSessions: [],
    revision: options?.revision ?? 1,
    scratchPadContent: "",
    type: "hydrate",
  };
}

function createGroup(groupId: string, sessions: SidebarSessionItem[]): SidebarSessionGroup {
  return {
    groupId,
    isActive: groupId === "group-1",
    isFocusModeActive: false,
    layoutVisibleCount: 1,
    sessions,
    title: groupId === "group-1" ? "Main" : "Group 2",
    viewMode: "grid",
    visibleCount: 1,
  };
}

function createSession(sessionId: string, primaryTitle: string): SidebarSessionItem {
  return {
    activity: sessionId === "session-1" ? "working" : "idle",
    activityLabel: sessionId === "session-1" ? "Codex active" : undefined,
    alias: primaryTitle,
    column: 0,
    isFocused: sessionId === "session-1",
    lifecycleState: sessionId === "session-1" ? "running" : "done",
    isRunning: sessionId === "session-1",
    isVisible: sessionId === "session-1",
    primaryTitle,
    row: 0,
    sessionId,
    shortcutLabel: "⌘⌥1",
  };
}
