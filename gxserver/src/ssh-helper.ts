import {
  GXSERVER_LOCAL_API_PORT,
  type GxserverConnectionProfile,
  type GxserverRemoteAttachMetadata,
  type GxserverServerId,
  type GxserverSshForwardPlan,
  type GxserverZmxSessionName,
} from "../protocol/index.js";

export interface GxserverSshTarget {
  host: string;
  port?: number;
  user?: string;
}

export class GxserverSshProfileError extends Error {
  readonly code: "badRequest";

  constructor(message: string) {
    super(message);
    this.code = "badRequest";
    this.name = "GxserverSshProfileError";
  }
}

/*
CDXC:GxserverSshRemote 2026-05-30-15:25:
SSH profiles are explicit helper connections, not a gxserver PTY transport. The client checks/starts gxserver over SSH, opens a local port forward to the remote loopback listener, and attaches terminal UI by running `zmx attach` through SSH so the remote gxserver can keep running after the tunnel or app disconnects.

CDXC:GxserverSshRemote 2026-05-30-20:18:
Tunnel commands must fail fast when the local bind or remote forward cannot be established. `ExitOnForwardFailure=yes` lets the CLI surface SSH/port setup failures instead of hanging on an apparently running `ssh -N -L` process that never carries gxserver RPC.
*/
export function parseSshProfileUrl(sshUrl: string): GxserverSshTarget {
  let url: URL;
  try {
    url = new URL(sshUrl);
  } catch {
    throw new GxserverSshProfileError(`Invalid SSH profile URL: ${sshUrl}`);
  }
  if (url.protocol !== "ssh:") {
    throw new GxserverSshProfileError("SSH profile URLs must use ssh://.");
  }
  if (!url.hostname) {
    throw new GxserverSshProfileError("SSH profile URL must include a host.");
  }
  return {
    host: url.hostname,
    ...(url.port ? { port: Number(url.port) } : {}),
    ...(url.username ? { user: decodeURIComponent(url.username) } : {}),
  };
}

export function createSshForwardPlan(options: {
  localPort: number;
  profile: Pick<GxserverConnectionProfile, "id" | "serverId" | "sshUrl">;
  remoteLocalPort?: number;
}): GxserverSshForwardPlan {
  const sshUrl = options.profile.sshUrl;
  if (!sshUrl) {
    throw new GxserverSshProfileError(`SSH profile ${options.profile.id} is missing sshUrl.`);
  }
  const target = parseSshProfileUrl(sshUrl);
  const remoteLocalPort = options.remoteLocalPort ?? GXSERVER_LOCAL_API_PORT;
  return {
    baseUrl: `http://127.0.0.1:${options.localPort}`,
    checkCommand: buildSshCheckGxserverCommand(target),
    installGuidance:
      "gxserver is not installed on the remote host. Install the Ghostex server package there, then retry; the SSH helper does not install software silently.",
    localPort: options.localPort,
    portForwardCommand: buildSshPortForwardCommand(target, options.localPort, remoteLocalPort),
    remoteLocalPort,
    startCommand: buildSshStartGxserverCommand(target),
  };
}

export function buildSshAttachMetadata(options: {
  profileId: string;
  serverId?: GxserverServerId;
  sshUrl: string;
  zmxName: GxserverZmxSessionName;
}): GxserverRemoteAttachMetadata {
  const target = parseSshProfileUrl(options.sshUrl);
  return {
    attachCommand: shellCommand(buildSshZmxAttachCommand(target, options.zmxName)),
    profileId: options.profileId,
    provider: "zmx",
    ...(options.serverId ? { serverId: options.serverId } : {}),
    transport: "ssh",
    zmxName: options.zmxName,
  };
}

export function buildSshCheckGxserverCommand(target: GxserverSshTarget): readonly string[] {
  return [
    "ssh",
    ...sshTargetArgs(target),
    "command -v gxserver >/dev/null && gxserver status --json",
  ];
}

export function buildSshStartGxserverCommand(target: GxserverSshTarget): readonly string[] {
  return ["ssh", ...sshTargetArgs(target), "gxserver start --background"];
}

export function buildSshPortForwardCommand(
  target: GxserverSshTarget,
  localPort: number,
  remoteLocalPort: number = GXSERVER_LOCAL_API_PORT,
): readonly string[] {
  return [
    "ssh",
    "-N",
    "-o",
    "ExitOnForwardFailure=yes",
    "-L",
    `${localPort}:127.0.0.1:${remoteLocalPort}`,
    ...sshTargetArgs(target),
  ];
}

export function buildSshZmxAttachCommand(target: GxserverSshTarget, zmxName: GxserverZmxSessionName): readonly string[] {
  return ["ssh", ...sshTargetArgs(target), "zmx", "attach", zmxName];
}

function sshTargetArgs(target: GxserverSshTarget): readonly string[] {
  return [...(target.port ? ["-p", String(target.port)] : []), target.user ? `${target.user}@${target.host}` : target.host];
}

function shellCommand(args: readonly string[]): string {
  return args.map(shellQuote).join(" ");
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_/:=@%+.,-]+$/u.test(value)) {
    return value;
  }
  return `'${value.replaceAll("'", "'\\''")}'`;
}
