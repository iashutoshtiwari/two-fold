import { createServer as createHttpServer, type Server as HttpServer } from "node:http";

import express, { type Express } from "express";
import { Server, type Socket } from "socket.io";

import type {
  ClientToServerEvents,
  IceCandidatePayload,
  JoinRoomResponse,
  ServerToClientEvents,
  SessionDescriptionPayload,
  SocketData,
} from "./types.js";

type SignalingSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;

export interface SignalingServer {
  app: Express;
  httpServer: HttpServer;
  io: Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
  rooms: Map<string, Set<string>>;
}

const ROOM_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

function parseAllowedOrigins(value: string | undefined): true | string[] {
  if (!value || value.trim() === "*") {
    return true;
  }

  return value
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

export function createSignalingServer(): SignalingServer {
  const app = express();
  const httpServer = createHttpServer(app);
  const rooms = new Map<string, Set<string>>();
  const io = new Server<
    ClientToServerEvents,
    ServerToClientEvents,
    Record<string, never>,
    SocketData
  >(httpServer, {
    cors: {
      origin: parseAllowedOrigins(process.env.ALLOWED_ORIGINS),
      methods: ["GET", "POST"],
    },
    transports: ["websocket", "polling"],
  });

  app.disable("x-powered-by");
  app.get("/health", (_request, response) => {
    response.status(200).json({
      status: "ok",
      connections: io.engine.clientsCount,
      rooms: rooms.size,
    });
  });

  function leaveRoom(socket: SignalingSocket, reason: "left" | "disconnect"): void {
    const roomId = socket.data.roomId;
    if (!roomId) {
      return;
    }

    const room = rooms.get(roomId);
    room?.delete(socket.id);

    if (!room || room.size === 0) {
      rooms.delete(roomId);
    }

    socket.to(roomId).emit("peer-disconnected", { peerId: socket.id, reason });
    socket.leave(roomId);
    delete socket.data.roomId;
  }

  function currentRoom(socket: SignalingSocket): string | null {
    const roomId = socket.data.roomId;
    if (!roomId || !rooms.get(roomId)?.has(socket.id)) {
      return null;
    }
    return roomId;
  }

  io.on("connection", (socket) => {
    socket.on("join-room", async (payload, acknowledge) => {
      const respond = typeof acknowledge === "function" ? acknowledge : () => undefined;
      const roomId = typeof payload?.roomId === "string" ? payload.roomId.trim() : "";

      if (!ROOM_ID_PATTERN.test(roomId)) {
        respond({
          ok: false,
          error: "INVALID_ROOM",
          message: "Room IDs must be 1-64 letters, numbers, hyphens, or underscores.",
        });
        return;
      }

      if (socket.data.roomId === roomId) {
        const peerCount = rooms.get(roomId)?.size ?? 1;
        respond({
          ok: true,
          roomId,
          peerCount,
          role: peerCount === 1 ? "offerer" : "answerer",
        });
        return;
      }

      const targetRoom = rooms.get(roomId);
      if (targetRoom && targetRoom.size >= 2) {
        const response: JoinRoomResponse = {
          ok: false,
          error: "ROOM_FULL",
          message: "This room already has two peers.",
        };
        respond(response);
        return;
      }

      if (socket.data.roomId) {
        leaveRoom(socket, "left");
      }

      const room = targetRoom ?? new Set<string>();
      const role = room.size === 0 ? "offerer" : "answerer";
      room.add(socket.id);
      rooms.set(roomId, room);
      socket.data.roomId = roomId;
      await socket.join(roomId);

      respond({ ok: true, roomId, peerCount: room.size, role });

      if (room.size === 2) {
        socket.to(roomId).emit("peer-joined", { peerId: socket.id });
      }
    });

    socket.on("offer", (description: SessionDescriptionPayload) => {
      const roomId = currentRoom(socket);
      if (roomId && description) {
        socket.to(roomId).emit("offer", description);
      }
    });
    socket.on("answer", (description: SessionDescriptionPayload) => {
      const roomId = currentRoom(socket);
      if (roomId && description) {
        socket.to(roomId).emit("answer", description);
      }
    });
    socket.on("ice-candidate", (candidate: IceCandidatePayload) => {
      const roomId = currentRoom(socket);
      if (roomId && candidate) {
        // The room is capped at two members, so this targets exactly one peer.
        socket.to(roomId).emit("ice-candidate", candidate);
      }
    });

    socket.on("leave-room", (acknowledge) => {
      leaveRoom(socket, "left");
      acknowledge?.({ ok: true });
    });

    // Kept as a supported alias for clients using the requested event name.
    socket.on("peer-disconnected", () => leaveRoom(socket, "left"));
    socket.on("disconnect", () => leaveRoom(socket, "disconnect"));
  });

  return { app, httpServer, io, rooms };
}
