import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  createConnectionTokenSecretRef,
  deleteConnectionProfile,
  getConnectionProfile,
  getGxserverClientConnectionPaths,
  listConnectionProfiles,
  readConnectionProfileToken,
  readConnectionProfiles,
  storeConnectionProfileToken,
  upsertConnectionProfile,
} from "../src/connection-profiles.js";
import {
  GxserverCredentialStoreError,
  createMemoryCredentialStore,
  createOsCredentialStore,
  createUnavailableCredentialStore,
  type GxserverCredentialCommandRunner,
} from "../src/credential-store.js";
import { createTailscaleRemoteListenerConfig, normalizeRemoteListenerConfig } from "../src/remote-listener.js";
import { parseGxserverGlobalSessionRef, requireGxserverRouteRef } from "../src/remote-routing.js";
import { normalizeExistingDirectoryPath } from "../src/project-paths.js";
import {
  buildSshAttachMetadata,
  buildSshPortForwardCommand,
  createSshForwardPlan,
  parseSshProfileUrl,
} from "../src/ssh-helper.js";

test("connection profile CRUD stores metadata in the shared client connections file", async () => {
  const homeDir = await mkdtemp(path.join(tmpdir(), "gxserver-connections-"));
  try {
    const paths = getGxserverClientConnectionPaths(homeDir);
    assert.deepEqual(await readConnectionProfiles(paths), { profiles: [], version: 1 });

    const profile = await upsertConnectionProfile(
      {
        baseUrl: "http://studio.tailnet.test:58745",
        id: "studio",
        name: "Studio",
        serverId: "S7k" as never,
        tokenSecretRef: createConnectionTokenSecretRef("studio"),
        transport: "tailscale",
      },
      paths,
      new Date("2026-05-30T11:25:00.000Z"),
    );

    assert.equal(profile.id, "studio");
    assert.equal(profile.transport, "tailscale");
    assert.equal((await getConnectionProfile("Studio", paths))?.serverId, "S7k");
    assert.equal((await listConnectionProfiles(paths)).length, 1);

    const updated = await upsertConnectionProfile(
      {
        ...profile,
        name: "Studio Remote",
      },
      paths,
      new Date("2026-05-30T11:26:00.000Z"),
    );
    assert.equal(updated.createdAt, "2026-05-30T11:25:00.000Z");
    assert.equal(updated.updatedAt, "2026-05-30T11:26:00.000Z");
    assert.equal(await deleteConnectionProfile("studio", paths), true);
    assert.deepEqual(await listConnectionProfiles(paths), []);
  } finally {
    await rm(homeDir, { force: true, recursive: true });
  }
});

test("connection profile tokens are read through credential-store refs only", async () => {
  const store = createMemoryCredentialStore();
  const ref = await storeConnectionProfileToken(store, "studio", "token-123");
  assert.deepEqual(ref, {
    account: "connection:studio:authToken",
    service: "ghostex.gxserver",
  });

  assert.equal(
    await readConnectionProfileToken(store, {
      createdAt: "2026-05-30T11:25:00.000Z",
      id: "studio",
      name: "Studio",
      tokenSecretRef: ref,
      transport: "direct",
      updatedAt: "2026-05-30T11:25:00.000Z",
      baseUrl: "http://studio.test:58745",
    }),
    "token-123",
  );
});

test("credential store abstraction reports unavailable stores and shell-backed success", async () => {
  const unavailable = createUnavailableCredentialStore("Install libsecret.");
  await assert.rejects(unavailable.get(createConnectionTokenSecretRef("studio")), (error) => {
    assert.equal(error instanceof GxserverCredentialStoreError, true);
    assert.equal((error as GxserverCredentialStoreError).code, "unavailable");
    assert.equal((error as GxserverCredentialStoreError).guidance, "Install libsecret.");
    return true;
  });

  const calls: Array<{ args: readonly string[]; command: string; stdin?: string }> = [];
  const runner: GxserverCredentialCommandRunner = async (command, args, options) => {
    calls.push({ args, command, stdin: options?.stdin });
    return { stdout: command === "security" && args[0] === "find-generic-password" ? "stored-token\n" : "" };
  };
  const darwin = createOsCredentialStore({ platform: "darwin", runner });
  const ref = createConnectionTokenSecretRef("studio");
  await darwin.set(ref, "stored-token");
  assert.equal(await darwin.get(ref), "stored-token");
  assert.deepEqual(calls[0], {
    args: ["add-generic-password", "-U", "-s", "ghostex.gxserver", "-a", "connection:studio:authToken", "-w"],
    command: "security",
    stdin: "stored-token\n",
  });
  assert.equal(calls[0]?.args.includes("stored-token"), false);
});

test("SSH helper plans remote gxserver check, background start, forwarding, and zmx attach", () => {
  const target = parseSshProfileUrl("ssh://madda@example.test:2222");
  assert.deepEqual(target, { host: "example.test", port: 2222, user: "madda" });

  const plan = createSshForwardPlan({
    localPort: 60000,
    profile: {
      id: "studio",
      serverId: "S7k" as never,
      sshUrl: "ssh://madda@example.test:2222",
    },
  });
  assert.equal(plan.baseUrl, "http://127.0.0.1:60000");
  assert.deepEqual(plan.checkCommand, [
    "ssh",
    "-p",
    "2222",
    "madda@example.test",
    "command -v gxserver >/dev/null && gxserver status --json",
  ]);
  assert.deepEqual(buildSshPortForwardCommand(target, 60000), [
    "ssh",
    "-N",
    "-o",
    "ExitOnForwardFailure=yes",
    "-L",
    "60000:127.0.0.1:58744",
    "-p",
    "2222",
    "madda@example.test",
  ]);
  assert.match(plan.installGuidance, /does not install software silently/);

  const attach = buildSshAttachMetadata({
    profileId: "studio",
    serverId: "S7k" as never,
    sshUrl: "ssh://madda@example.test:2222",
    zmxName: "S7k-P3a91-G8v20" as never,
  });
  assert.equal(attach.attachCommand, "ssh -p 2222 madda@example.test zmx attach S7k-P3a91-G8v20");
  assert.equal(attach.transport, "ssh");
});

test("Tailscale remote listener config is explicit and always auth-gated", () => {
  assert.deepEqual(createTailscaleRemoteListenerConfig({ host: "100.101.102.103", port: 58745 }), {
    auth: { mode: "bearerToken", required: true },
    enabled: true,
    host: "100.101.102.103",
    kind: "remote",
    port: 58745,
  });
  assert.equal(normalizeRemoteListenerConfig({ enabled: false }).auth?.required, true);
  assert.throws(() => normalizeRemoteListenerConfig({ port: 70_000 }), /between 1 and 65535/);
});

test("remote project path validation accepts absolute and tilde directories only", async () => {
  const homeDir = await mkdtemp(path.join(tmpdir(), "gxserver-project-home-"));
  try {
    const projectDir = path.join(homeDir, "repo");
    await mkdir(projectDir);
    assert.equal(normalizeExistingDirectoryPath("~/repo", "path", homeDir), projectDir);
    assert.throws(() => normalizeExistingDirectoryPath("relative", "path", homeDir), /absolute path/);

    const filePath = path.join(homeDir, "file.txt");
    await writeFile(filePath, "");
    assert.throws(() => normalizeExistingDirectoryPath(filePath, "path", homeDir), /not a directory/);
    assert.throws(() => normalizeExistingDirectoryPath(path.join(homeDir, "missing"), "path", homeDir), /does not exist/);
  } finally {
    await rm(homeDir, { force: true, recursive: true });
  }
});

test("multi-server refs parse and require server/project/session for routing", () => {
  assert.deepEqual(parseGxserverGlobalSessionRef("S7k:P3a91:G8v20"), {
    projectId: "P3a91",
    serverId: "S7k",
    sessionId: "G8v20",
  });
  assert.deepEqual(requireGxserverRouteRef({ globalRef: "S7k:P3a91:G8v20" }), {
    projectId: "P3a91",
    serverId: "S7k",
    sessionId: "G8v20",
  });
  assert.throws(() => requireGxserverRouteRef({ projectId: "P3a91", sessionId: "G8v20" }), /serverId is required/);
});
