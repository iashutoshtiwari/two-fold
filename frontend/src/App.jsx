import { useEffect, useRef, useState } from "react";

import { ChatSidebar } from "./components/ChatSidebar";
import { useWebRTC } from "./hooks/useWebRTC";

const STATUS_TEXT = {
  idle: "Ready to join",
  "acquiring-media": "Requesting camera and microphone…",
  "connecting-signaling": "Connecting to signaling…",
  "waiting-for-peer": "Waiting for another peer",
  negotiating: "Establishing a secure peer connection…",
  connected: "Peer connected",
  reconnecting: "Connection interrupted — recovering…",
  "signaling-disconnected": "Signaling offline — reconnecting…",
  "ice-failed": "Network path failed — restarting ICE…",
  error: "Connection error",
};

function attachStream(video, stream) {
  if (!video || video.srcObject === stream) {
    return;
  }

  video.srcObject = stream;
  if (stream) {
    video.play().catch(() => undefined);
  }
}

function VideoPanel({ label, videoRef, stream, muted = false }) {
  return (
    <div className="relative grid min-h-64 place-items-center overflow-hidden bg-zinc-900 md:min-h-[calc(100dvh-120px)]">
      {stream ? null : (
        <div className="absolute inset-0 grid place-items-center">
          <div className="text-center">
            <div className="mx-auto mb-3 grid h-16 w-16 place-items-center rounded-full border border-white/10 bg-zinc-800 text-xl text-zinc-500">
              {label === "You" ? "Y" : "P"}
            </div>
            <p className="text-sm text-zinc-600">
              {label === "You" ? "Join to enable your camera" : "Waiting for peer video"}
            </p>
          </div>
        </div>
      )}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={muted}
        className={`h-full w-full object-cover transition-opacity ${stream ? "opacity-100" : "opacity-0"}`}
      />
      <span className="absolute bottom-3 left-3 rounded-lg bg-black/60 px-2.5 py-1 text-xs font-medium backdrop-blur">
        {label}
      </span>
    </div>
  );
}

export default function App() {
  const [roomId, setRoomId] = useState("");
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const {
    status,
    error,
    isJoined,
    localStream,
    remoteStream,
    messages,
    isDataChannelOpen,
    join,
    leave,
    sendMessage,
  } = useWebRTC(roomId);

  useEffect(() => attachStream(localVideoRef.current, localStream), [localStream]);
  useEffect(() => attachStream(remoteVideoRef.current, remoteStream), [remoteStream]);

  const isBusy = status === "acquiring-media" || status === "connecting-signaling";
  const isWarning =
    status === "reconnecting" || status === "signaling-disconnected" || status === "ice-failed";

  return (
    <main className="flex min-h-dvh flex-col bg-zinc-950 text-zinc-100">
      <header className="border-b border-white/10 bg-zinc-950 px-4 py-3 sm:px-6">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-3">
          <div className="mr-auto flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-lg bg-indigo-500 text-xs font-bold">TF</div>
            <div>
              <h1 className="text-sm font-semibold tracking-wide">Two Fold</h1>
              <p className="text-xs text-zinc-500">One-to-one WebRTC</p>
            </div>
          </div>

          <label className="sr-only" htmlFor="room-id">
            Room ID
          </label>
          <input
            id="room-id"
            value={roomId}
            onChange={(event) => setRoomId(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && roomId.trim() && !isJoined && !isBusy) {
                join();
              }
            }}
            disabled={isJoined || isBusy}
            maxLength={64}
            autoComplete="off"
            placeholder="Room ID"
            className="w-44 rounded-lg border border-white/10 bg-zinc-900 px-3.5 py-2 text-sm outline-none placeholder:text-zinc-600 focus:border-indigo-400 disabled:opacity-60 sm:w-56"
          />
          {isJoined ? (
            <button
              type="button"
              onClick={leave}
              className="rounded-lg border border-rose-400/30 bg-rose-400/10 px-4 py-2 text-sm font-semibold text-rose-300 hover:bg-rose-400/20"
            >
              Leave
            </button>
          ) : (
            <button
              type="button"
              onClick={() => join()}
              disabled={!roomId.trim() || isBusy}
              className="rounded-lg bg-indigo-500 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-400 disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-600"
            >
              {isBusy ? "Joining…" : "Join"}
            </button>
          )}
        </div>
      </header>

      <div className="mx-auto flex min-h-0 w-full max-w-[1600px] flex-1 flex-col lg:flex-row">
        <section className="flex min-h-0 flex-1 flex-col" aria-label="Video call">
          <div
            className={`flex items-center gap-2 border-b px-4 py-2.5 text-xs ${
              error
                ? "border-rose-400/20 bg-rose-400/10 text-rose-200"
                : isWarning
                  ? "border-amber-400/20 bg-amber-400/10 text-amber-200"
                  : "border-white/10 bg-zinc-900/60 text-zinc-400"
            }`}
            role={error ? "alert" : "status"}
          >
            <span
              aria-hidden="true"
              className={`h-2 w-2 shrink-0 rounded-full ${
                status === "connected"
                  ? "bg-emerald-400"
                  : error
                    ? "bg-rose-400"
                    : isWarning
                      ? "animate-pulse bg-amber-400"
                      : "bg-zinc-600"
              }`}
            />
            <span>{error || STATUS_TEXT[status]}</span>
          </div>

          <div className="grid min-h-0 flex-1 gap-px bg-white/10 md:grid-cols-2">
            <VideoPanel label="You" videoRef={localVideoRef} stream={localStream} muted />
            <VideoPanel label="Peer" videoRef={remoteVideoRef} stream={remoteStream} />
          </div>
        </section>

        <ChatSidebar messages={messages} isOpen={isDataChannelOpen} onSend={sendMessage} />
      </div>
    </main>
  );
}
