import { WebSocket, WebSocketServer } from "ws";
import {
  GXSERVER_PROTOCOL_VERSION,
  type GxserverEvent,
  type GxserverPresentationRevision,
  type GxserverPresentationSnapshot,
  type GxserverServerId,
} from "../protocol/index.js";

export type GxserverPresentationSnapshotProvider = (input: {
  clientId?: string;
  lastRevision?: GxserverPresentationRevision;
}) => Promise<GxserverPresentationSnapshot> | GxserverPresentationSnapshot;

export class GxserverEventHub {
  readonly server: WebSocketServer;
  readonly serverId: GxserverServerId;
  #presentationSnapshotProvider?: GxserverPresentationSnapshotProvider;

  constructor(serverId: GxserverServerId) {
    this.serverId = serverId;
    this.server = new WebSocketServer({ noServer: true });
    this.server.on("connection", (socket) => {
      this.send(socket, {
        protocolVersion: GXSERVER_PROTOCOL_VERSION,
        serverId,
        type: "eventStreamReady",
      });
      socket.on("message", (message) => {
        void this.#handleMessage(socket, message);
      });
    });
  }

  setPresentationSnapshotProvider(provider: GxserverPresentationSnapshotProvider): void {
    this.#presentationSnapshotProvider = provider;
  }

  broadcast(event: GxserverEvent): void {
    const payload = `${JSON.stringify(event)}\n`;
    for (const client of this.server.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  }

  close(): Promise<void> {
    for (const client of this.server.clients) {
      client.terminate();
    }
    return new Promise((resolve, reject) => {
      this.server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  private send(socket: WebSocket, event: GxserverEvent): void {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(`${JSON.stringify(event)}\n`);
    }
  }

  async #handleMessage(socket: WebSocket, message: WebSocket.RawData): Promise<void> {
    const parsed = parseEventStreamMessage(message);
    if (parsed?.type !== "subscribePresentation" || !this.#presentationSnapshotProvider) {
      return;
    }
    /*
    CDXC:GxserverPresentationEvents 2026-06-01-15:08:
    Presentation WebSocket reconnects use fresh snapshots in this pass because gxserver does not persist a replay log yet. The event stream still carries revisions so clients can apply ordered deltas and replace local state whenever a gap cannot be proven safe.
    */
    const snapshot = await this.#presentationSnapshotProvider({
      clientId: typeof parsed.clientId === "string" ? parsed.clientId : undefined,
      lastRevision: typeof parsed.lastRevision === "number" ? parsed.lastRevision as GxserverPresentationRevision : undefined,
    });
    this.send(socket, {
      clientId: typeof parsed.clientId === "string" ? parsed.clientId : undefined,
      protocolVersion: GXSERVER_PROTOCOL_VERSION,
      revision: snapshot.revision,
      serverId: this.serverId,
      snapshot,
      type: "presentationSnapshot",
    });
  }
}

function parseEventStreamMessage(message: WebSocket.RawData): Record<string, unknown> | undefined {
  try {
    const text = Array.isArray(message) ? Buffer.concat(message).toString("utf8") : Buffer.from(message as Buffer).toString("utf8");
    const parsed = JSON.parse(text) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}
