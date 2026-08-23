import type { AddressInfo } from "node:net";

import { io as createClient, type Socket as ClientSocket } from "socket.io-client";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createSignalingServer, type SignalingServer } from "../src/server.js";
import type {
  ClientToServerEvents,
  JoinRoomResponse,
  ServerToClientEvents,
} from "../src/types.js";

type TestClient = ClientSocket<ServerToClientEvents, ClientToServerEvents>;

describe("signaling server", () => {
  let server: SignalingServer;
  let baseUrl: string;
  const clients: TestClient[] = [];

  beforeEach(async () => {
    server = createSignalingServer();
    await new Promise<void>((resolve) => server.httpServer.listen(0, "127.0.0.1", resolve));
    const address = server.httpServer.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    for (const client of clients) {
      client.disconnect();
    }
    clients.length = 0;

    await new Promise<void>((resolve) => server.io.close(() => resolve()));
    if (server.httpServer.listening) {
      await new Promise<void>((resolve, reject) =>
        server.httpServer.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  async function connectClient(): Promise<TestClient> {
    const client: TestClient = createClient(baseUrl, {
      forceNew: true,
      transports: ["websocket"],
      reconnection: false,
    });
    clients.push(client);

    await new Promise<void>((resolve, reject) => {
      client.once("connect", resolve);
      client.once("connect_error", reject);
    });
    return client;
  }

  function join(client: TestClient, roomId: string): Promise<JoinRoomResponse> {
    return new Promise((resolve) => client.emit("join-room", { roomId }, resolve));
  }

  function once<EventName extends keyof ServerToClientEvents>(
    client: TestClient,
    eventName: EventName,
  ): Promise<Parameters<ServerToClientEvents[EventName]>[0]> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${eventName}`)), 2_000);
      client.once(eventName, ((payload: unknown) => {
        clearTimeout(timer);
        resolve(payload as Parameters<ServerToClientEvents[EventName]>[0]);
      }) as never);
    });
  }

  it("reports health without exposing framework headers", async () => {
    const response = await request(server.app).get("/health").expect(200);

    expect(response.headers).not.toHaveProperty("x-powered-by");
    expect(response.body).toEqual({ status: "ok", connections: 0, rooms: 0 });
  });

  it("validates room IDs and caps rooms at two peers", async () => {
    const first = await connectClient();
    const second = await connectClient();
    const third = await connectClient();

    await expect(join(first, "not a valid room")).resolves.toMatchObject({
      ok: false,
      error: "INVALID_ROOM",
    });
    await expect(join(first, "demo-room")).resolves.toMatchObject({
      ok: true,
      peerCount: 1,
      role: "offerer",
    });

    const peerJoined = once(first, "peer-joined");
    await expect(join(second, "demo-room")).resolves.toMatchObject({
      ok: true,
      peerCount: 2,
      role: "answerer",
    });
    await expect(peerJoined).resolves.toMatchObject({ peerId: second.id });

    await expect(join(third, "demo-room")).resolves.toMatchObject({
      ok: false,
      error: "ROOM_FULL",
    });
    expect(server.rooms.get("demo-room")?.size).toBe(2);
  });

  it("relays offers, answers, and ICE candidates only to the other peer", async () => {
    const first = await connectClient();
    const second = await connectClient();
    await join(first, "signals");
    await join(second, "signals");

    const offer = { type: "offer" as const, sdp: "test-offer" };
    const receivedOffer = once(second, "offer");
    first.emit("offer", offer);
    await expect(receivedOffer).resolves.toEqual(offer);

    const answer = { type: "answer" as const, sdp: "test-answer" };
    const receivedAnswer = once(first, "answer");
    second.emit("answer", answer);
    await expect(receivedAnswer).resolves.toEqual(answer);

    const candidate = {
      candidate: "candidate:1 1 UDP 1 127.0.0.1 5000 typ host",
      sdpMid: "0",
      sdpMLineIndex: 0,
    };
    const receivedCandidate = once(second, "ice-candidate");
    first.emit("ice-candidate", candidate);
    await expect(receivedCandidate).resolves.toEqual(candidate);
  });

  it("notifies the remaining peer and cleans room state on leave and disconnect", async () => {
    const first = await connectClient();
    const second = await connectClient();
    await join(first, "cleanup");
    await join(second, "cleanup");

    const explicitLeave = once(first, "peer-disconnected");
    await new Promise<void>((resolve) => second.emit("leave-room", () => resolve()));
    await expect(explicitLeave).resolves.toMatchObject({ peerId: second.id, reason: "left" });
    expect(server.rooms.get("cleanup")?.size).toBe(1);

    await join(second, "cleanup");
    const disconnected = once(first, "peer-disconnected");
    const secondId = second.id;
    second.disconnect();
    await expect(disconnected).resolves.toEqual({ peerId: secondId, reason: "disconnect" });

    first.disconnect();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(server.rooms.has("cleanup")).toBe(false);
  });
});

