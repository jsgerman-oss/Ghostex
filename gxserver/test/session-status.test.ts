import test from "node:test";
import assert from "node:assert/strict";
import { applyAgentActivityTransition } from "../src/session-status/index.js";

test("explicit hook activity bypasses launch suppression and plain title downgrades", () => {
  /*
  CDXC:SessionStatus 2026-06-07-08:51:
  gxserver hook events are the authoritative working-state source. A direct hook
  working event must win during launch suppression, and unrelated terminal
  titles such as Monaco Ctrl+G must not downgrade explicit working.
  */
  const launched = applyAgentActivityTransition({
    agentId: "codex",
    event: "launch",
    nowMs: Date.parse("2026-06-07T06:47:25.000Z"),
  });
  assert.equal(launched.activity, "idle");
  assert.equal(launched.suppressedUntil, "2026-06-07T06:47:37.000Z");

  const working = applyAgentActivityTransition({
    activity: "working",
    agentId: "codex",
    nowMs: Date.parse("2026-06-07T06:47:30.000Z"),
    previous: launched,
  });
  assert.equal(working.activity, "working");
  assert.equal(working.workingSource, "explicit");

  const plainTitle = applyAgentActivityTransition({
    agentId: "codex",
    event: "title",
    nowMs: Date.parse("2026-06-07T06:47:31.000Z"),
    previous: working,
    title: "Monaco Ctrl+G Switch",
  });
  assert.equal(plainTitle.activity, "working");
  assert.equal(plainTitle.workingSource, "explicit");

  const attention = applyAgentActivityTransition({
    activity: "attention",
    agentId: "codex",
    nowMs: Date.parse("2026-06-07T06:47:31.500Z"),
    previous: plainTitle,
  });
  assert.equal(attention.activity, "attention");
});
