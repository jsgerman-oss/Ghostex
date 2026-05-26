import { describe, expect, test } from "vitest";
import {
  createBeadConversationLinkId,
  normalizeBeadConversationLinks,
} from "./bead-conversation-links";

describe("bead conversation links", () => {
  test("should keep multiple beads linked to the same Ghostex conversation", () => {
    /*
     * CDXC:ProjectBoard 2026-05-26-10:20:
     * The link model must allow several Beads issues to route to one agent conversation.
     * Normalize link records independently by bead id instead of deduplicating by Ghostex session id.
     */
    const links = normalizeBeadConversationLinks(
      [
        {
          beadId: "zmux-123",
          ghostexSessionId: "session-a",
          id: "link-1",
          projectId: "project-a",
          status: "active",
        },
        {
          beadId: "zmux-456",
          ghostexSessionId: "session-a",
          id: "link-2",
          projectId: "project-a",
          status: "active",
        },
      ],
      "project-a",
    );

    expect(links).toHaveLength(2);
    expect(links.map((link) => link.beadId)).toEqual(["zmux-123", "zmux-456"]);
    expect(new Set(links.map((link) => link.ghostexSessionId))).toEqual(new Set(["session-a"]));
  });

  test("should derive stable ids from project, bead, and Ghostex session", () => {
    expect(createBeadConversationLinkId("My Project", "ZMUX 123", "session/a")).toBe(
      "My-Project:ZMUX-123:session-a",
    );
  });

  test("should discard unusable records and normalize optional metadata", () => {
    const links = normalizeBeadConversationLinks(
      [
        { beadId: "zmux-1" },
        {
          agentName: " codex ",
          agentSessionId: " 019-session ",
          beadDisplayId: " ZMX-1 ",
          beadId: " zmux-1 ",
          ghostexSessionId: " session-1 ",
          sessionPersistenceProvider: "zmx",
          status: "archived",
        },
      ],
      "project-a",
    );

    expect(links).toMatchObject([
      {
        agentName: "codex",
        agentSessionId: "019-session",
        beadDisplayId: "ZMX-1",
        beadId: "zmux-1",
        ghostexSessionId: "session-1",
        projectId: "project-a",
        sessionPersistenceProvider: "zmx",
        status: "archived",
      },
    ]);
  });
});
