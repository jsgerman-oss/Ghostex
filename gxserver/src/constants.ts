/*
CDXC:GxserverLifecycle 2026-05-30-14:04:
gxserver milestone 1 uses system Node 22 LTS or newer and a fixed local API port of 58744 because the existing macOS bridge owns 58743. Ghostex must report missing or old Node clearly and must not bundle or auto-install a private Node runtime.
*/

import {
  GXSERVER_LOCAL_API_HOST,
  GXSERVER_LOCAL_API_PORT,
  GXSERVER_MACOS_BRIDGE_PORT,
  GXSERVER_PRODUCT,
  GXSERVER_PROTOCOL_VERSION,
  GXSERVER_REMOTE_API_HOST,
  GXSERVER_REMOTE_API_PORT,
} from "../protocol/index.js";

export {
  GXSERVER_LOCAL_API_HOST,
  GXSERVER_LOCAL_API_PORT,
  GXSERVER_MACOS_BRIDGE_PORT,
  GXSERVER_PRODUCT,
  GXSERVER_PROTOCOL_VERSION,
  GXSERVER_REMOTE_API_HOST,
  GXSERVER_REMOTE_API_PORT,
};

export const GXSERVER_MIN_NODE_MAJOR = 22;
export const GXSERVER_NODE_INSTALL_URL = "https://nodejs.org/en/download";
export const GXSERVER_CONTROL_PLANE_CAPABILITIES = [
  "health",
  "events",
  "localFullApi",
  "remoteLimitedApi",
  "strictProtocolVersion",
] as const;
