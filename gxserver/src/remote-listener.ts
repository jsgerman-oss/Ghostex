import {
  GXSERVER_REMOTE_API_HOST,
  GXSERVER_REMOTE_API_PORT,
  type GxserverListenerConfig,
} from "../protocol/index.js";

export class GxserverRemoteListenerConfigError extends Error {
  readonly code = "badRequest" as const;

  constructor(message: string) {
    super(message);
    this.name = "GxserverRemoteListenerConfigError";
  }
}

/*
CDXC:GxserverTailscaleListener 2026-05-30-15:25:
Remote exposure is a trusted-network API for Tailscale or direct private networks, not a relay/account/NAT service. Enabling the remote listener keeps bearer-token auth required and binds the separate remote port so local-only endpoints remain blocked by the endpoint catalog.
*/
export function createTailscaleRemoteListenerConfig(options: {
  enabled?: boolean;
  host?: string;
  port?: number;
} = {}): GxserverListenerConfig {
  return normalizeRemoteListenerConfig({
    auth: { mode: "bearerToken", required: true },
    enabled: options.enabled ?? true,
    host: options.host ?? GXSERVER_REMOTE_API_HOST,
    kind: "remote",
    port: options.port ?? GXSERVER_REMOTE_API_PORT,
  });
}

export function normalizeRemoteListenerConfig(config: Partial<GxserverListenerConfig>): GxserverListenerConfig {
  const port = Number(config.port ?? GXSERVER_REMOTE_API_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new GxserverRemoteListenerConfigError("Remote gxserver listener port must be between 1 and 65535.");
  }
  const host = String(config.host ?? GXSERVER_REMOTE_API_HOST).trim();
  if (!host) {
    throw new GxserverRemoteListenerConfigError("Remote gxserver listener host is required.");
  }
  return {
    auth: { mode: "bearerToken", required: true },
    enabled: Boolean(config.enabled),
    host,
    kind: "remote",
    port,
  };
}
