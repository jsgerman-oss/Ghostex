import type { GxserverRpcErrorCode } from "../../protocol/index.js";

export type GxserverRepositoryCloneErrorCode = Extract<
  GxserverRpcErrorCode,
  "badRequest" | "dependencyUnavailable" | "forbidden" | "notFound"
>;

export class GxserverRepositoryCloneError extends Error {
  readonly code: GxserverRepositoryCloneErrorCode;

  constructor(code: GxserverRepositoryCloneErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "GxserverRepositoryCloneError";
  }
}
