import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const tasksPlaceholderSource = readFileSync(new URL("./tasks-placeholder.tsx", import.meta.url), "utf8");

function sourceBetween(start: string, end: string): string {
  const startIndex = tasksPlaceholderSource.indexOf(start);
  const endIndex = tasksPlaceholderSource.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return tasksPlaceholderSource.slice(startIndex, endIndex);
}

function collectFunctionalUpdaterCalls(source: string, setterCallStart: string): string[] {
  const calls: string[] = [];
  let searchIndex = 0;
  while (searchIndex < source.length) {
    const startIndex = source.indexOf(setterCallStart, searchIndex);
    if (startIndex === -1) {
      break;
    }
    const openParenIndex = source.indexOf("(", startIndex);
    expect(openParenIndex).toBeGreaterThan(startIndex);
    let depth = 0;
    let endIndex = openParenIndex;
    for (; endIndex < source.length; endIndex += 1) {
      const char = source[endIndex];
      if (char === "(") {
        depth += 1;
      } else if (char === ")") {
        depth -= 1;
        if (depth === 0) {
          endIndex += 1;
          break;
        }
      }
    }
    expect(depth).toBe(0);
    calls.push(source.slice(startIndex, endIndex));
    searchIndex = endIndex;
  }
  return calls;
}

describe("Project Board form event handling", () => {
  test("snapshots form values before functional state updaters", () => {
    /*
     * CDXC:ProjectBoardForms 2026-06-09-15:36:
     * New automation and ticket text entry should keep the Kanban page mounted even when React defers functional state updaters.
     * Updater closures must use already-captured primitives instead of reading value or checked from the React event object.
     */
    const projectBoardSource = sourceBetween("function ProjectBoardApp()", "function TicketMetaFields(");
    const updaterCalls = [
      ...collectFunctionalUpdaterCalls(projectBoardSource, "setAutomationDraft((current) =>"),
      ...collectFunctionalUpdaterCalls(projectBoardSource, "setDetail((current) =>"),
      ...collectFunctionalUpdaterCalls(projectBoardSource, "setNewTicket((current) =>"),
    ];

    expect(updaterCalls).not.toHaveLength(0);
    expect(
      updaterCalls.filter((call) => /event\.(?:currentTarget|target)\.(?:checked|value)/u.test(call)),
    ).toEqual([]);
  });
});
