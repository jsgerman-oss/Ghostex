#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readGxserverBuildIdentity } from "./build-identity.js";
import {
  getGxserverStatus,
  startGxserverBackground,
  stopGxserverAndZmxSessions,
  stopGxserverControlPlane,
} from "./lifecycle.js";
import { getUnsupportedNodeMessage } from "./node-version.js";
import { runGxserverForeground } from "./server.js";

const GXSERVER_COLOR_DISABLING_ENVIRONMENT_KEYS = [
  "ANSI_COLORS_DISABLED",
  "NO_COLOR",
  "NODE_DISABLE_COLORS",
] as const;

removeGxserverColorDisablingEnvironment();

const cliDir = dirname(fileURLToPath(import.meta.url));
const version = await readPackageVersion(cliDir);
const buildIdentity = await readGxserverBuildIdentity(cliDir, version);

try {
  const unsupportedNodeMessage = getUnsupportedNodeMessage();
  if (unsupportedNodeMessage) {
    throw new Error(unsupportedNodeMessage);
  }

  const [command, ...rest] = process.argv.slice(2);
  if (!command || command === "--foreground") {
    const result = await runGxserverForeground({ buildIdentity, version });
    if (result.reused) {
      console.log("gxserver is already running and uses the expected protocol.");
    }
  } else if (command === "start") {
    printStatus(await startGxserverBackground({ buildIdentity, version }), rest.includes("--json"));
  } else if (command === "stop") {
    printStatus(await stopGxserverControlPlane({ buildIdentity, version }), rest.includes("--json"));
  } else if (command === "stop-all") {
    printStatus(await stopGxserverAndZmxSessions({ buildIdentity, version }), rest.includes("--json"));
  } else if (command === "status") {
    printStatus(await getGxserverStatus({ buildIdentity, version }), rest.includes("--json"));
  } else if (command === "--version" || command === "version") {
    console.log(version);
  } else if (command === "--help" || command === "help") {
    printHelp();
  } else {
    throw new Error(`Unknown gxserver command: ${command}`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

function printStatus(status: unknown, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(status, null, 2));
    return;
  }
  if (
    typeof status === "object" &&
    status !== null &&
    "message" in status &&
    typeof status.message === "string"
  ) {
    console.log(status.message);
    return;
  }
  console.log(String(status));
}

function printHelp(): void {
  console.log(`gxserver ${version}

Usage:
  gxserver           Run gxserver in the foreground
  gxserver start     Start gxserver in the background
  gxserver stop      Stop only the gxserver control plane
  gxserver stop-all  Stop gxserver and kill tracked zmx sessions
  gxserver status    Print gxserver runtime state
  gxserver --version Print the gxserver package version
`);
}

async function readPackageVersion(cliDir: string): Promise<string> {
  const packageJsonPath = resolve(cliDir, "..", "..", "package.json");
  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8")) as { version?: string };
  return packageJson.version ?? "0.0.0";
}

function removeGxserverColorDisablingEnvironment(): void {
  /*
  CDXC:GxserverColorEnv 2026-06-07-00:38:
  gxserver owns color-capable terminal and agent provider lifecycles. Strip NO_COLOR-style variables at CLI process start so direct daemon launches cannot store or propagate color-disabled process.env snapshots.
  */
  for (const key of GXSERVER_COLOR_DISABLING_ENVIRONMENT_KEYS) {
    delete process.env[key];
  }
}
