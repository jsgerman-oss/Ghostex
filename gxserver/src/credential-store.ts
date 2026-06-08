import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { GxserverCredentialSecretRef } from "../protocol/index.js";

const execFileAsync = promisify(execFile);

export type GxserverCredentialStoreStatus = "available" | "unavailable";

export class GxserverCredentialStoreError extends Error {
  readonly code: "failed" | "notFound" | "unavailable";
  readonly guidance?: string;

  constructor(code: "failed" | "notFound" | "unavailable", message: string, guidance?: string) {
    super(message);
    this.code = code;
    this.guidance = guidance;
    this.name = "GxserverCredentialStoreError";
  }
}

export interface GxserverCredentialStore {
  delete(ref: GxserverCredentialSecretRef): Promise<void>;
  get(ref: GxserverCredentialSecretRef): Promise<string>;
  status(): Promise<{ guidance?: string; status: GxserverCredentialStoreStatus }>;
  set(ref: GxserverCredentialSecretRef, secret: string): Promise<void>;
}

export type GxserverCredentialCommandRunner = (
  command: string,
  args: readonly string[],
  options?: { stdin?: string },
) => Promise<{ stderr?: string; stdout: string }>;

/*
CDXC:GxserverRemoteCredentials 2026-05-30-15:25:
Remote connection profiles store only non-secret metadata in `~/.ghostex/clients/connections.json`. Auth tokens are addressed by stable OS credential-store refs so the desktop app and gx CLI can share profiles without writing bearer tokens to JSON; when a platform store is unavailable, connection setup must fail with guidance instead of inventing a plaintext fallback.

CDXC:GxserverRemoteCredentials 2026-05-30-20:47:
Credential-store writes must not put bearer tokens in process argv. Use platform stdin/password-prompt paths where available so same-user process inspection sees only metadata, not the remote gxserver secret.
*/
export function createUnavailableCredentialStore(guidance = defaultCredentialGuidance(process.platform)): GxserverCredentialStore {
  const unavailable = async (): Promise<never> => {
    throw new GxserverCredentialStoreError("unavailable", "No supported OS credential store is available.", guidance);
  };
  return {
    delete: unavailable,
    get: unavailable,
    set: unavailable,
    status: async () => ({ guidance, status: "unavailable" }),
  };
}

export function createMemoryCredentialStore(initial = new Map<string, string>()): GxserverCredentialStore {
  const secrets = new Map(initial);
  return {
    delete: async (ref) => {
      secrets.delete(secretKey(ref));
    },
    get: async (ref) => {
      const secret = secrets.get(secretKey(ref));
      if (!secret) {
        throw new GxserverCredentialStoreError("notFound", `No gxserver credential exists for ${ref.account}.`);
      }
      return secret;
    },
    set: async (ref, secret) => {
      secrets.set(secretKey(ref), secret);
    },
    status: async () => ({ status: "available" }),
  };
}

export function createOsCredentialStore(options: {
  platform?: NodeJS.Platform;
  runner?: GxserverCredentialCommandRunner;
} = {}): GxserverCredentialStore {
  const platform = options.platform ?? process.platform;
  const runner = options.runner ?? defaultRunner;
  if (platform === "darwin") {
    return createDarwinCredentialStore(runner);
  }
  if (platform === "linux") {
    return createLinuxCredentialStore(runner);
  }
  return createUnavailableCredentialStore(defaultCredentialGuidance(platform));
}

function createDarwinCredentialStore(runner: GxserverCredentialCommandRunner): GxserverCredentialStore {
  return {
    delete: async (ref) => {
      await runCredentialCommand(runner, "security", ["delete-generic-password", "-s", ref.service, "-a", ref.account], true);
    },
    get: async (ref) => {
      const result = await runCredentialCommand(runner, "security", [
        "find-generic-password",
        "-s",
        ref.service,
        "-a",
        ref.account,
        "-w",
      ]);
      return result.stdout.trim();
    },
    set: async (ref, secret) => {
      await runCredentialCommand(
        runner,
        "security",
        ["add-generic-password", "-U", "-s", ref.service, "-a", ref.account, "-w"],
        false,
        `${secret}\n`,
      );
    },
    status: async () => ({ status: "available" }),
  };
}

function createLinuxCredentialStore(runner: GxserverCredentialCommandRunner): GxserverCredentialStore {
  return {
    delete: async (ref) => {
      await runCredentialCommand(runner, "secret-tool", ["clear", "service", ref.service, "account", ref.account], true);
    },
    get: async (ref) => {
      const result = await runCredentialCommand(runner, "secret-tool", [
        "lookup",
        "service",
        ref.service,
        "account",
        ref.account,
      ]);
      return result.stdout.trim();
    },
    set: async (ref, secret) => {
      await runCredentialCommand(
        runner,
        "secret-tool",
        ["store", "--label=Ghostex gxserver connection", "service", ref.service, "account", ref.account],
        false,
        secret,
      );
    },
    status: async () => ({ status: "available" }),
  };
}

async function runCredentialCommand(
  runner: GxserverCredentialCommandRunner,
  command: string,
  args: readonly string[],
  ignoreNotFound = false,
  stdin?: string,
): Promise<{ stderr?: string; stdout: string }> {
  try {
    return await runner(command, args, stdin === undefined ? undefined : { stdin });
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    if (ignoreNotFound && /not found|could not be found|The specified item could not be found/i.test(message)) {
      return { stdout: "" };
    }
    throw new GxserverCredentialStoreError("failed", message);
  }
}

async function defaultRunner(
  command: string,
  args: readonly string[],
  options?: { stdin?: string },
): Promise<{ stderr?: string; stdout: string }> {
  const child = execFileAsync(command, [...args]);
  if (options?.stdin !== undefined) {
    child.child.stdin?.end(options.stdin);
  }
  const result = await child;
  return { stderr: result.stderr, stdout: result.stdout };
}

function secretKey(ref: GxserverCredentialSecretRef): string {
  return `${ref.service}:${ref.account}`;
}

function defaultCredentialGuidance(platform: NodeJS.Platform): string {
  if (platform === "win32") {
    return "Install or enable a Windows Credential Manager integration before adding gxserver remote tokens.";
  }
  if (platform === "linux") {
    return "Install Secret Service/libsecret tooling such as `secret-tool` and unlock a keyring before adding gxserver remote tokens.";
  }
  return "Enable macOS Keychain access before adding gxserver remote tokens.";
}
