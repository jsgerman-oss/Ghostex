import test from "node:test";
import assert from "node:assert/strict";
import { applyAgentActivityTransition } from "../src/session-status/index.js";

test("explicit hook activity bypasses launch suppression and plain title downgrades", () => {
  /*
  CDXC:SessionStatus 2026-06-07-09:22:
  gxserver hook events are the authoritative working-state source. A direct hook
  working event must win during launch suppression, and unrelated terminal
  titles such as Monaco Ctrl+G must not downgrade explicit working. A stopped
  spinner title for the same semantic title still clears working because some
  agents do not reliably emit a hook stop event.
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

test("same-title Codex spinner stop clears explicit hook working", () => {
  const titleWorking = applyAgentActivityTransition({
    agentId: "codex",
    event: "title",
    nowMs: Date.parse("2026-06-07T04:53:27.000Z"),
    title: "⠏ Ghostex 4.0.0 Beta",
  });
  assert.equal(titleWorking.activity, "working");
  assert.equal(titleWorking.workingSource, "title");

  const explicitWorking = applyAgentActivityTransition({
    activity: "working",
    agentId: "codex",
    nowMs: Date.parse("2026-06-07T04:53:29.000Z"),
    previous: titleWorking,
  });
  assert.equal(explicitWorking.activity, "working");
  assert.equal(explicitWorking.workingSource, "explicit");

  const unrelatedTitle = applyAgentActivityTransition({
    agentId: "codex",
    event: "title",
    nowMs: Date.parse("2026-06-07T04:53:31.000Z"),
    previous: explicitWorking,
    title: "Monaco Ctrl+G Switch",
  });
  assert.equal(unrelatedTitle.activity, "working");
  assert.equal(unrelatedTitle.workingSource, "explicit");
  assert.equal(unrelatedTitle.lastTitle, "⠏ Ghostex 4.0.0 Beta");

  const stoppedSpinner = applyAgentActivityTransition({
    agentId: "codex",
    event: "title",
    nowMs: Date.parse("2026-06-07T05:00:55.000Z"),
    previous: unrelatedTitle,
    title: "Ghostex 4.0.0 Beta",
  });
  assert.equal(stoppedSpinner.activity, "attention");
  assert.equal(stoppedSpinner.workingSource, undefined);
  assert.equal(stoppedSpinner.lastTitle, "Ghostex 4.0.0 Beta");
});
