import { afterEach, describe, expect, test, vi } from "vitest";
import { createNativeSidebarGxserverClient } from "./gxserver-client";

describe("native sidebar gxserver client", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("sends authenticated protocol-versioned health and RPC requests from native bootstrap", async () => {
    /*
    CDXC:GxserverVerification 2026-05-30-18:37:
    The macOS React sidebar client wrapper is part of the hard cutover contract. It must consume native bootstrap auth, send gxserver protocol headers, build RPC envelopes, and reject protocol drift instead of routing shared state through the retired app-owned backend.
    */
    const requests: Array<{ body?: unknown; headers: Record<string, string>; method: string; url: string }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const headers = normalizeHeaders(init?.headers);
        const bodyText = typeof init?.body === "string" ? init.body : undefined;
        requests.push({
          body: bodyText ? JSON.parse(bodyText) : undefined,
          headers,
          method: init?.method ?? "GET",
          url,
        });

        if (url.endsWith("/api/health/server")) {
          return jsonResponse({
            capabilities: [],
            listeners: {
              local: { enabled: true, host: "127.0.0.1", kind: "local", port: 58744 },
              remote: { auth: { mode: "bearerToken", required: true }, enabled: false, host: "0.0.0.0", kind: "remote", port: 58745 },
            },
            migration: { appliedMigrations: [], currentVersion: 2, stateDbFile: "/tmp/state.db" },
            ok: true,
            pid: 123,
            port: 58744,
            product: "gxserver",
            protocolVersion: 1,
            serverId: "S7k",
            startedAt: "2026-05-30T10:00:00.000Z",
            tools: [],
            version: "0.1.0-test",
          });
        }
        if (url.endsWith("/api/listProjects")) {
          return jsonResponse({
            ok: true,
            product: "gxserver",
            protocolVersion: 1,
            requestId: "projects-request",
            result: { projects: [] },
          });
        }
        if (url.endsWith("/api/readAgentSettings")) {
          return jsonResponse({
            ok: true,
            product: "gxserver",
            protocolVersion: 1,
            requestId: "agent-settings-request",
            result: {
              isPersisted: true,
              settings: { agentAcceptAllEnabled: true },
            },
          });
        }
        if (url.endsWith("/api/readPresentationSnapshot")) {
          return jsonResponse({
            ok: true,
            product: "gxserver",
            protocolVersion: 1,
            requestId: "presentation-request",
            result: {
              snapshot: {
                generatedAt: "2026-06-02T07:16:00.000Z",
                groups: [],
                projects: [],
                revision: 1,
                sessions: [],
              },
            },
          });
        }
        throw new Error(`Unexpected request ${url}`);
      }),
    );

    const client = createNativeSidebarGxserverClient({
      authToken: "token-123",
      baseUrl: "http://127.0.0.1:60000",
    });
    const snapshot = await client.fetchStartupSnapshot();

    expect(snapshot.projects).toEqual([]);
    expect(snapshot.presentation?.sessions).toEqual([]);
    expect(requests.map((request) => request.url)).toEqual([
      "http://127.0.0.1:60000/api/health/server",
      "http://127.0.0.1:60000/api/readAgentSettings",
      "http://127.0.0.1:60000/api/listProjects",
      "http://127.0.0.1:60000/api/readPresentationSnapshot",
    ]);
    for (const request of requests) {
      expect(request.headers.authorization).toBe("Bearer token-123");
      expect(request.headers["x-gxserver-protocol-version"]).toBe("1");
    }
    expect(requests[1].body).toEqual({ params: {}, protocolVersion: 1 });
    expect(requests[2].body).toEqual({ params: {}, protocolVersion: 1 });
    expect(requests[3].body).toEqual({ params: {}, protocolVersion: 1 });
  });

  test("updates bootstrap from native status events and hard-fails protocol mismatch", async () => {
    const client = createNativeSidebarGxserverClient({
      authToken: "old-token",
      baseUrl: "http://127.0.0.1:58744",
    });
    expect(
      client.applyNativeStatus(
        JSON.stringify({
          authToken: "new-token",
          baseUrl: "http://127.0.0.1:60001",
          protocolVersion: 1,
        }),
      ),
    ).toMatchObject({ authToken: "new-token" });

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        expect(String(input)).toBe("http://127.0.0.1:60001/api/listSessions");
        expect(normalizeHeaders(init?.headers).authorization).toBe("Bearer new-token");
        return jsonResponse({
          ok: true,
          product: "gxserver",
          protocolVersion: 999,
          requestId: "bad-protocol",
          result: { sessions: [] },
        });
      }),
    );

    await expect(client.rpc("/api/listSessions")).rejects.toThrow(/Update Ghostex and gxserver/);
  });

  test("routes arbitrary path Git-root lookup through gxserver RPC", async () => {
    const requests: Array<{ body?: unknown; headers: Record<string, string>; method: string; url: string }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const bodyText = typeof init?.body === "string" ? init.body : undefined;
        requests.push({
          body: bodyText ? JSON.parse(bodyText) : undefined,
          headers: normalizeHeaders(init?.headers),
          method: init?.method ?? "GET",
          url,
        });
        return jsonResponse({
          ok: true,
          product: "gxserver",
          protocolVersion: 1,
          requestId: "resolve-git-root",
          result: { gitRoot: "/tmp/example-repo" },
        });
      }),
    );

    /*
    CDXC:GxserverVerification 2026-06-02-12:14:
    Native CLI open-path routing must call gxserver's local-only repository fact endpoint instead of shelling out to Git in the macOS app. The client test pins the RPC envelope so UI code has one ownership-compliant path.
    */
    const client = createNativeSidebarGxserverClient({
      authToken: "token-123",
      baseUrl: "http://127.0.0.1:60000",
    });
    await expect(client.resolveGitRootForPath({ path: "/tmp/example-repo/src" })).resolves.toEqual({
      gitRoot: "/tmp/example-repo",
    });

    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe("http://127.0.0.1:60000/api/resolveGitRootForPath");
    expect(requests[0].method).toBe("POST");
    expect(requests[0].headers.authorization).toBe("Bearer token-123");
    expect(requests[0].headers["x-gxserver-protocol-version"]).toBe("1");
    expect(requests[0].body).toEqual({
      params: { path: "/tmp/example-repo/src" },
      protocolVersion: 1,
    });
  });
});

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
    status,
  });
}

function normalizeHeaders(headers: HeadersInit | undefined): Record<string, string> {
  const normalized: Record<string, string> = {};
  new Headers(headers).forEach((value, key) => {
    normalized[key.toLowerCase()] = value;
  });
  return normalized;
}
