import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage } from "http";
import type { ServerType } from "@hono/node-server";
import { verifySessionToken } from "../auth/session";
import { findUserById } from "../queries/users";
import { findTenantById } from "../queries/tenants";
import { getDb } from "../queries/connection";
import { agentLocations } from "@db/schema";
import { logger } from "./logger";

const DEBOUNCE_MS = 3_000;

const tenantRooms = new Map<number, Set<WebSocket>>();
const pendingSaves = new Map<string, ReturnType<typeof setTimeout>>();

async function saveLocation(userId: number, tenantId: number, lat: string, lng: string) {
  try {
    await getDb().insert(agentLocations).values({
      tenantId,
      agentId: userId,
      lat,
      lng,
    });
  } catch (err) {
    logger.error("failed to save agent location", { error: err instanceof Error ? err.message : String(err) });
  }
}

export function attachWebSocket(server: ServerType) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 100 * 1024 }); // 100KB max

  server.on("upgrade", (req: IncomingMessage, socket, head) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const token = url.searchParams.get("token");

    if (!token) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    verifySessionToken(token)
      .then(async (claim) => {
        if (!claim) {
          socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
          socket.destroy();
          return;
        }

        const user = await findUserById(claim.userId);
        if (!user || user.status !== "active") {
          socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
          socket.destroy();
          return;
        }

        const tenant = await findTenantById(user.tenantId);
        if (!tenant || tenant.status !== "active") {
          socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
          socket.destroy();
          return;
        }

        wss.handleUpgrade(req, socket, head, (ws) => {
          const room = tenant.id;
          if (!tenantRooms.has(room)) tenantRooms.set(room, new Set());
          tenantRooms.get(room)!.add(ws);

          ws.send(JSON.stringify({ type: "connected", userId: user.id }));

          ws.on("message", (raw) => {
            try {
              const msg = JSON.parse(raw.toString());
              if (msg.type === "location" && typeof msg.lat === "number" && typeof msg.lng === "number") {
                const key = `${user.id}`;
                if (pendingSaves.has(key)) clearTimeout(pendingSaves.get(key)!);

                pendingSaves.set(key, setTimeout(() => {
                  pendingSaves.delete(key);
                  saveLocation(user.id, room, String(msg.lat), String(msg.lng));
                }, DEBOUNCE_MS));

                const clients = tenantRooms.get(room);
                if (!clients) return;
                for (const client of clients) {
                  if (client !== ws && client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify({
                      type: "agent_location",
                      agentId: user.id,
                      agentName: user.name,
                      lat: msg.lat,
                      lng: msg.lng,
                      accuracy: msg.accuracy,
                    }));
                  }
                }
              }
            } catch {
              // ignore malformed messages
            }
          });

          ws.on("close", () => {
            tenantRooms.get(room)?.delete(ws);
            if (tenantRooms.get(room)?.size === 0) tenantRooms.delete(room);
            if (pendingSaves.has(String(user.id))) {
              clearTimeout(pendingSaves.get(String(user.id))!);
              pendingSaves.delete(String(user.id));
            }
          });
        });
      })
      .catch(() => {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
      });
  });

  return wss;
}
