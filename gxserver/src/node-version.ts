import { GXSERVER_MIN_NODE_MAJOR, GXSERVER_NODE_INSTALL_URL } from "./constants.js";

export function parseNodeMajor(version: string): number | undefined {
  const normalized = version.trim().replace(/^v/, "");
  const [major] = normalized.split(".");
  if (!major || !/^\d+$/.test(major)) {
    return undefined;
  }
  return Number(major);
}

export function getUnsupportedNodeMessage(version = process.version): string | undefined {
  const major = parseNodeMajor(version);
  if (major === undefined || major < GXSERVER_MIN_NODE_MAJOR) {
    return [
      `gxserver requires Node.js ${GXSERVER_MIN_NODE_MAJOR} LTS or newer, but found ${version}.`,
      `Install Node ${GXSERVER_MIN_NODE_MAJOR} LTS or newer from ${GXSERVER_NODE_INSTALL_URL} or with a system package manager such as Homebrew.`,
      "Ghostex does not bundle, auto-install, or fall back to a private Node runtime for gxserver.",
    ].join(" ");
  }
  return undefined;
}

export function assertSupportedNodeVersion(version = process.version): void {
  const message = getUnsupportedNodeMessage(version);
  if (message) {
    throw new Error(message);
  }
}
