/*
CDXC:GxserverProtocol 2026-05-30-14:04:
Existing Ghostex client code imports shared contracts from `shared/`. Re-export gxserver's protocol source of truth here so later macOS/sidebar and gx/ghostex CLI work can depend on the same TypeScript types without duplicating endpoint names or JSON field shapes.
*/

export * from "../gxserver/protocol/index";
