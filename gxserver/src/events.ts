import { WebSocket, WebSocketServer } from "ws";
import { GXSERVER_PROTOCOL_VERSION, type GxserverEvent, type GxserverServerId } from "../protocol/index.js";

export class GxserverEventHub {
  readonly server: WebSocketServer;
  readonly serverId: GxserverServerId;

  constructor(serverId: GxserverServerId) {
    this.serverId = serverId;
    this.server = new WebSocketServer({ noServer: true });
    this.server.on("connection", (socket) => {
      this.send(socket, {
        protocolVersion: GXSERVER_PROTOCOL_VERSION,
        serverId,
        type: "eventStreamReady",
      });
    });
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
}
