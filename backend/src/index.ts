import { createSignalingServer } from "./server.js";

const port = Number.parseInt(process.env.PORT ?? "3001", 10);
const { httpServer, io } = createSignalingServer();

httpServer.listen(port, "0.0.0.0", () => {
  console.log(`Signaling server listening on port ${port}`);
});

function shutdown(signal: string): void {
  console.log(`${signal} received; shutting down`);
  // Closing Socket.IO also drains and closes its attached HTTP server.
  io.close(() => process.exit(0));

  setTimeout(() => process.exit(1), 10_000).unref();
}

process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));
