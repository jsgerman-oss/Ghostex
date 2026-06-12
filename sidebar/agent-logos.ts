import ampCliLogo from "../src/assets/amp-cli.svg" with { type: "text" };
import antigravityCliLogo from "../src/assets/antigravity-cli.svg" with { type: "text" };
import browserLogo from "../src/assets/browser.svg" with { type: "text" };
import claudeLogo from "../src/assets/claude.svg" with { type: "text" };
import codebuddyLogo from "../src/assets/codebuddy.svg" with { type: "text" };
import cursorCliLogo from "../src/assets/cursor-cli.svg" with { type: "text" };
import codexLogo from "../src/assets/codex.svg" with { type: "text" };
import copilotLogo from "../src/assets/copilot.svg" with { type: "text" };
import factoryDroidLogo from "../src/assets/factory-droid.svg" with { type: "text" };
import geminiLogo from "../src/assets/gemini.svg" with { type: "text" };
import grokBuildLogo from "../src/assets/grok-build.svg" with { type: "text" };
import hermesAgentLogo from "../src/assets/hermes-agent.svg" with { type: "text" };
import kiroLogo from "../src/assets/kiro.svg" with { type: "text" };
import ompLogo from "../src/assets/omp.svg" with { type: "text" };
import opencodeLogo from "../src/assets/opencode.svg" with { type: "text" };
import piLogo from "../src/assets/pi.svg" with { type: "text" };
import qoderLogo from "../src/assets/qoder.svg" with { type: "text" };
import rovoDevLogo from "../src/assets/rovo-dev.svg" with { type: "text" };
import t3Logo from "../src/assets/t3.svg" with { type: "text" };
import type { SidebarAgentIcon } from "../shared/sidebar-agents";

/**
 * CDXC:AgentDetection 2026-04-27-07:07
 * Sidebar card agent icons render as CSS masks. Native WKWebView can create
 * the span correctly while failing to paint a relative-file SVG mask, so agent
 * logos must be inline data URLs shared by masks and regular image sources.
 *
 * CDXC:AgentsHub 2026-05-13-08:08
 * Hub profile chips reuse these same mask data URLs. Storybook may resolve
 * text imports to data URLs, while the native Bun build reads raw SVG text, so
 * keep both forms valid instead of using bundler-specific import query syntax.
 */
function svgTextToDataUrl(svgText: string): string {
  if (svgText.startsWith("data:image/svg+xml,")) {
    return svgText;
  }
  return `data:image/svg+xml,${encodeURIComponent(svgText)}`;
}

export const AGENT_LOGOS: Record<SidebarAgentIcon, string> = {
  "amp-cli": svgTextToDataUrl(ampCliLogo),
  "antigravity-cli": svgTextToDataUrl(antigravityCliLogo),
  browser: svgTextToDataUrl(browserLogo),
  claude: svgTextToDataUrl(claudeLogo),
  codebuddy: svgTextToDataUrl(codebuddyLogo),
  "cursor-cli": svgTextToDataUrl(cursorCliLogo),
  codex: svgTextToDataUrl(codexLogo),
  copilot: svgTextToDataUrl(copilotLogo),
  "factory-droid": svgTextToDataUrl(factoryDroidLogo),
  gemini: svgTextToDataUrl(geminiLogo),
  "grok-build": svgTextToDataUrl(grokBuildLogo),
  "hermes-agent": svgTextToDataUrl(hermesAgentLogo),
  kiro: svgTextToDataUrl(kiroLogo),
  omp: svgTextToDataUrl(ompLogo),
  opencode: svgTextToDataUrl(opencodeLogo),
  pi: svgTextToDataUrl(piLogo),
  qoder: svgTextToDataUrl(qoderLogo),
  "rovo-dev": svgTextToDataUrl(rovoDevLogo),
  t3: svgTextToDataUrl(t3Logo),
};

/**
 * CDXC:NativePaneReorder 2026-05-03-04:59
 * Sidebar agent SVGs are mask assets, so their visible color comes from CSS,
 * not the SVG fill. Native title bars and drag ghosts receive this same color
 * map with the data URL so AppKit can tint the template image to match the
 * session card.
 */
export const AGENT_LOGO_COLORS: Record<SidebarAgentIcon, string> = {
  "amp-cli": "#ffffff",
  "antigravity-cli": "#749bff",
  browser: "#82b7ff",
  claude: "#d97757",
  codebuddy: "#72d6ff",
  "cursor-cli": "#edecec",
  codex: "#ffffff",
  copilot: "#ffffff",
  "factory-droid": "#ff7a1a",
  gemini: "#8b9aff",
  "grok-build": "#ffffff",
  "hermes-agent": "#f3c46b",
  kiro: "#a6e3ff",
  omp: "#c8ff62",
  opencode: "#6d96c0",
  pi: "#c8ff62",
  qoder: "#a991ff",
  "rovo-dev": "#4fc3a1",
  t3: "#ff6af3",
};
