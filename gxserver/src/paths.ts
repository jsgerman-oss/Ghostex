import os from "node:os";
import path from "node:path";

export interface GxserverPaths {
  authDir: string;
  authTokenFile: string;
  configFile: string;
  homeDir: string;
  identityFile: string;
  logsDir: string;
  logFile: string;
  migrationsDir: string;
  rootDir: string;
  runtimeDir: string;
  runtimeMetadataFile: string;
  stateDbFile: string;
  zmxDir: string;
}

/*
CDXC:GxserverStorage 2026-05-30-14:16:
gxserver owns durable shared daemon state under `~/.ghostex/gxserver`, with explicit paths for auth, config, SQLite state, JSONL logs, runtime metadata, zmx working files, migration artifacts, and stable daemon identity. Keep these paths centralized so future client/API beads do not invent parallel storage locations.
*/
export function getGxserverPaths(homeDir = os.homedir()): GxserverPaths {
  const rootDir = path.join(homeDir, ".ghostex", "gxserver");
  const authDir = path.join(rootDir, "auth");
  const logsDir = path.join(rootDir, "logs");
  const migrationsDir = path.join(rootDir, "migrations");
  const runtimeDir = path.join(rootDir, "runtime");
  const zmxDir = path.join(rootDir, "zmx");
  return {
    authDir,
    authTokenFile: path.join(authDir, "token"),
    configFile: path.join(rootDir, "config.json"),
    homeDir,
    identityFile: path.join(rootDir, "identity.json"),
    logsDir,
    logFile: path.join(logsDir, "gxserver.jsonl"),
    migrationsDir,
    rootDir,
    runtimeDir,
    runtimeMetadataFile: path.join(runtimeDir, "server.json"),
    stateDbFile: path.join(rootDir, "state.db"),
    zmxDir,
  };
}
