import test from "node:test";
import assert from "node:assert/strict";
import { getUnsupportedNodeMessage, parseNodeMajor } from "../src/node-version.js";

test("parseNodeMajor accepts v-prefixed and plain Node versions", () => {
  assert.equal(parseNodeMajor("v22.11.0"), 22);
  assert.equal(parseNodeMajor("26.0.0"), 26);
});

test("Node 22 and newer satisfy gxserver requirements", () => {
  assert.equal(getUnsupportedNodeMessage("v22.0.0"), undefined);
  assert.equal(getUnsupportedNodeMessage("v26.0.0"), undefined);
});

test("old Node versions explain install requirements without fallback", () => {
  const message = getUnsupportedNodeMessage("v21.7.3");
  assert.match(message ?? "", /Node\.js 22 LTS or newer/);
  assert.match(message ?? "", /nodejs\.org\/en\/download/);
  assert.match(message ?? "", /does not bundle, auto-install, or fall back/);
});
