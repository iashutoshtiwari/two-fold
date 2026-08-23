import { useCallback, useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";

const SIGNALING_URL = import.meta.env.VITE_SIGNALING_URL || "http://localhost:3001";
const MAX_MESSAGE_LENGTH = 2000;
const DISCONNECT_GRACE_PERIOD_MS = 8000;

function readIceServers() {
  const configuredServers = import.meta.env.VITE_ICE_SERVERS;
  if (configuredServers) {
    try {
      const parsed = JSON.parse(configuredServers);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      // Fall back to the default STUN server.
    }
  }
  return [{ urls: "stun:stun.l.google.com:19302" }];
}

function mediaErrorMessage(error) {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError" || error.name === "SecurityError") {
      return "Camera or microphone permission was denied. Allow access and try again.";
    }
    if (error.name === "NotFoundError") {
      return "No camera or microphone was found.";
    }
    if (error.name === "NotReadableError") {
      return "The camera or microphone is already in use.";
    }
  }
  return "Unable to access the camera and microphone.";
}

function createMessageId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
}

export function useWebRTC(roomId) {
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState(null);
  const [isJoined, setIsJoined] = useState(false);
  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [messages, setMessages] = useState([]);
  const [isDataChannelOpen, setIsDataChannelOpen] = useState(false);

  const socketRef = useRef(null);
  const peerConnectionRef = useRef(null);
  const dataChannelRef = useRef(null);
  const localStreamRef = useRef(null);
  const remoteStreamRef = useRef(null);
  const roomIdRef = useRef(roomId);
  const desiredJoinedRef = useRef(false);
  const joinedRef = useRef(false);
  const hadJoinedRef = useRef(false);
  const peerPresentRef = useRef(false);
  const politeRef = useRef(false);
  const makingOfferRef = useRef(false);
  const ignoreOfferRef = useRef(false);
  const settingRemoteAnswerRef = useRef(false);
  const pendingCandidatesRef = useRef([]);
  const disconnectTimerRef = useRef(null);

  roomIdRef.current = roomId;

  const appendMessage = useCallback((message) => {
    setMessages((current) => [...current.slice(-199), message]);
  }, []);

  const configureDataChannel = useCallback(
    (channel) => {
      dataChannelRef.current?.close();
      dataChannelRef.current = channel;

      channel.onopen = () => setIsDataChannelOpen(true);
      channel.onclose = () => setIsDataChannelOpen(false);
      channel.onerror = () => setError("The chat channel encountered an error.");
      channel.onmessage = (event) => {
        try {
          const value = JSON.parse(event.data);
          if (
            value &&
            typeof value === "object" &&
            typeof value.text === "string" &&
            value.text.length <= MAX_MESSAGE_LENGTH
          ) {
            appendMessage({
              id: typeof value.id === "string" ? value.id : createMessageId(),
              text: value.text,
              timestamp: typeof value.timestamp === "number" ? value.timestamp : Date.now(),
              sender: "remote",
            });
          }
        } catch {
          // Ignore malformed peer data.
        }
      };
    },
    [appendMessage],
  );

  const clearDisconnectTimer = useCallback(() => {
    if (disconnectTimerRef.current) {
      clearTimeout(disconnectTimerRef.current);
      disconnectTimerRef.current = null;
    }
  }, []);

  const destroyPeerConnection = useCallback(() => {
    clearDisconnectTimer();

    const channel = dataChannelRef.current;
    dataChannelRef.current = null;
    if (channel) {
      channel.onopen = null;
      channel.onclose = null;
      channel.onmessage = null;
      channel.onerror = null;
      channel.close();
    }
    setIsDataChannelOpen(false);

    const connection = peerConnectionRef.current;
    peerConnectionRef.current = null;
    if (connection) {
      connection.onicecandidate = null;
      connection.ontrack = null;
      connection.ondatachannel = null;
      connection.onnegotiationneeded = null;
      connection.onconnectionstatechange = null;
      connection.close();
    }

    pendingCandidatesRef.current = [];
    makingOfferRef.current = false;
    ignoreOfferRef.current = false;
    settingRemoteAnswerRef.current = false;
    remoteStreamRef.current = null;
    setRemoteStream(null);
  }, [clearDisconnectTimer]);

  const negotiate = useCallback(async (connection, iceRestart = false) => {
    if (
      !joinedRef.current ||
      !peerPresentRef.current ||
      makingOfferRef.current ||
      connection.signalingState !== "stable"
    ) {
      return;
    }

    try {
      makingOfferRef.current = true;
      setStatus("negotiating");
      const offer = await connection.createOffer({ iceRestart });
      if (connection.signalingState !== "stable") {
        return;
      }
      await connection.setLocalDescription(offer);
      if (connection.localDescription) {
        socketRef.current?.emit("offer", connection.localDescription.toJSON());
      }
    } catch (cause) {
      console.error("Failed to negotiate WebRTC connection", cause);
      setError("Could not connect to the peer. Leave and try again.");
      setStatus("error");
    } finally {
      makingOfferRef.current = false;
    }
  }, []);

  const ensurePeerConnection = useCallback(() => {
    const existing = peerConnectionRef.current;
    if (existing && existing.connectionState !== "closed") {
      return existing;
    }

    const connection = new RTCPeerConnection({ iceServers: readIceServers() });
    peerConnectionRef.current = connection;

    for (const track of localStreamRef.current?.getTracks() || []) {
      connection.addTrack(track, localStreamRef.current);
    }

    connection.onicecandidate = ({ candidate }) => {
      if (candidate) {
        socketRef.current?.emit("ice-candidate", candidate.toJSON());
      }
    };

    connection.ontrack = ({ track, streams }) => {
      const incoming = remoteStreamRef.current || streams[0] || new MediaStream();
      if (!incoming.getTracks().some((existingTrack) => existingTrack.id === track.id)) {
        incoming.addTrack(track);
      }
      remoteStreamRef.current = incoming;
      setRemoteStream(incoming);

      track.onended = () => {
        incoming.removeTrack(track);
        if (incoming.getTracks().length === 0) {
          remoteStreamRef.current = null;
          setRemoteStream(null);
        }
      };
    };

    connection.ondatachannel = ({ channel }) => configureDataChannel(channel);
    connection.onnegotiationneeded = () => negotiate(connection);
    connection.onconnectionstatechange = () => {
      switch (connection.connectionState) {
        case "connected":
          clearDisconnectTimer();
          setError(null);
          setStatus("connected");
          break;
        case "disconnected":
          setStatus("reconnecting");
          clearDisconnectTimer();
          disconnectTimerRef.current = setTimeout(() => {
            if (connection.connectionState === "disconnected") {
              setStatus("ice-failed");
              setError("The peer connection was interrupted. Retrying...");
              if (!politeRef.current) {
                negotiate(connection, true);
              }
            }
          }, DISCONNECT_GRACE_PERIOD_MS);
          break;
        case "failed":
          clearDisconnectTimer();
          setStatus("ice-failed");
          setError("The peer connection failed. Retrying...");
          if (!politeRef.current) {
            negotiate(connection, true);
          }
          break;
        case "closed":
          clearDisconnectTimer();
          break;
        default:
          break;
      }
    };

    return connection;
  }, [clearDisconnectTimer, configureDataChannel, negotiate]);

  const createChatChannel = useCallback(() => {
    const connection = ensurePeerConnection();
    if (!dataChannelRef.current || dataChannelRef.current.readyState === "closed") {
      configureDataChannel(connection.createDataChannel("chat", { ordered: true }));
    }
  }, [configureDataChannel, ensurePeerConnection]);

  const flushCandidates = useCallback(async (connection) => {
    const candidates = pendingCandidatesRef.current.splice(0);
    for (const candidate of candidates) {
      await connection.addIceCandidate(candidate);
    }
  }, []);

  const installSocketHandlers = useCallback(
    (socket) => {
      socket.on("peer-joined", () => {
        peerPresentRef.current = true;
        politeRef.current = false;
        setError(null);
        createChatChannel();
        negotiate(ensurePeerConnection());
      });

      socket.on("offer", async (description) => {
        const connection = ensurePeerConnection();
        const readyForOffer =
          !makingOfferRef.current &&
          (connection.signalingState === "stable" || settingRemoteAnswerRef.current);
        const offerCollision = !readyForOffer;
        ignoreOfferRef.current = !politeRef.current && offerCollision;
        if (ignoreOfferRef.current) {
          return;
        }

        try {
          setStatus("negotiating");
          await connection.setRemoteDescription(description);
          await flushCandidates(connection);
          await connection.setLocalDescription();
          if (connection.localDescription) {
            socket.emit("answer", connection.localDescription.toJSON());
          }
        } catch (cause) {
          console.error("Failed to handle remote offer", cause);
          setError("The remote offer could not be applied.");
          setStatus("error");
        }
      });

      socket.on("answer", async (description) => {
        const connection = peerConnectionRef.current;
        if (!connection) {
          return;
        }
        try {
          settingRemoteAnswerRef.current = true;
          await connection.setRemoteDescription(description);
          await flushCandidates(connection);
        } catch (cause) {
          console.error("Failed to handle remote answer", cause);
          setError("The remote answer could not be applied.");
          setStatus("error");
        } finally {
          settingRemoteAnswerRef.current = false;
        }
      });

      socket.on("ice-candidate", async (candidate) => {
        const connection = ensurePeerConnection();
        try {
          if (connection.remoteDescription) {
            await connection.addIceCandidate(candidate);
          } else {
            pendingCandidatesRef.current.push(candidate);
          }
        } catch (cause) {
          if (!ignoreOfferRef.current) {
            console.error("Failed to add ICE candidate", cause);
          }
        }
      });

      socket.on("peer-disconnected", () => {
        peerPresentRef.current = false;
        politeRef.current = false;
        destroyPeerConnection();
        if (desiredJoinedRef.current) {
          ensurePeerConnection();
          setError(null);
          setStatus("waiting-for-peer");
        }
      });

      socket.on("disconnect", (reason) => {
        joinedRef.current = false;
        setIsJoined(false);
        peerPresentRef.current = false;
        destroyPeerConnection();
        if (desiredJoinedRef.current && reason !== "io client disconnect") {
          ensurePeerConnection();
          setStatus("signaling-disconnected");
          setError("Signaling was interrupted. Reconnecting automatically...");
        }
      });
    },
    [createChatChannel, destroyPeerConnection, ensurePeerConnection, flushCandidates, negotiate],
  );

  const requestRoomJoin = useCallback(
    (socket) =>
      new Promise((resolve, reject) => {
        socket.timeout(5000).emit(
          "join-room",
          { roomId: roomIdRef.current.trim() },
          (timeoutError, response) => {
            if (timeoutError) {
              reject(new Error("The signaling server did not respond."));
              return;
            }
            if (!response?.ok) {
              reject(new Error(response?.message || "Unable to join the room."));
              return;
            }

            joinedRef.current = true;
            hadJoinedRef.current = true;
            peerPresentRef.current = response.peerCount === 2;
            politeRef.current = response.role === "answerer";
            setIsJoined(true);
            setError(null);
            setStatus(response.peerCount === 2 ? "negotiating" : "waiting-for-peer");
            resolve();
          },
        );
      }),
    [],
  );

  const join = useCallback(async () => {
    const normalizedRoomId = roomId.trim();
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(normalizedRoomId)) {
      setError("Room IDs may contain letters, numbers, hyphens, and underscores.");
      setStatus("error");
      return;
    }
    if (desiredJoinedRef.current) {
      return;
    }

    desiredJoinedRef.current = true;
    roomIdRef.current = normalizedRoomId;
    setError(null);
    setMessages([]);
    setStatus("acquiring-media");

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Camera and microphone access requires HTTPS or localhost.");
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" },
      });
      if (!desiredJoinedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      localStreamRef.current = stream;
      setLocalStream(stream);
      ensurePeerConnection();

      setStatus("connecting-signaling");
      const socket = io(SIGNALING_URL, {
        autoConnect: false,
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 500,
        reconnectionDelayMax: 5000,
        timeout: 8000,
      });
      socketRef.current = socket;
      installSocketHandlers(socket);

      socket.on("connect", () => {
        if (desiredJoinedRef.current && hadJoinedRef.current && !joinedRef.current) {
          requestRoomJoin(socket).catch((cause) => {
            setError(cause instanceof Error ? cause.message : "Could not rejoin the room.");
            setStatus("error");
          });
        }
      });

      await new Promise((resolve, reject) => {
        socket.once("connect", resolve);
        socket.once("connect_error", reject);
        socket.connect();
      });
      await requestRoomJoin(socket);
    } catch (cause) {
      desiredJoinedRef.current = false;
      const message =
        cause instanceof DOMException
          ? mediaErrorMessage(cause)
          : cause instanceof Error
            ? cause.message
            : "Unable to join the room.";
      setError(message);
      setStatus("error");
      socketRef.current?.disconnect();
      socketRef.current = null;
      destroyPeerConnection();
      localStreamRef.current?.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
      setLocalStream(null);
    }
  }, [destroyPeerConnection, ensurePeerConnection, installSocketHandlers, requestRoomJoin, roomId]);

  const leave = useCallback(() => {
    desiredJoinedRef.current = false;
    joinedRef.current = false;
    hadJoinedRef.current = false;
    peerPresentRef.current = false;

    const socket = socketRef.current;
    socketRef.current = null;
    if (socket) {
      socket.emit("leave-room");
      socket.disconnect();
    }

    destroyPeerConnection();
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;
    setLocalStream(null);
    setIsJoined(false);
    setMessages([]);
    setError(null);
    setStatus("idle");
  }, [destroyPeerConnection]);

  const sendMessage = useCallback(
    (text) => {
      const normalizedText = text.trim().slice(0, MAX_MESSAGE_LENGTH);
      const channel = dataChannelRef.current;
      if (!normalizedText || !channel || channel.readyState !== "open") {
        return false;
      }

      const message = {
        id: createMessageId(),
        text: normalizedText,
        timestamp: Date.now(),
      };
      channel.send(JSON.stringify(message));
      appendMessage({ ...message, sender: "local" });
      return true;
    },
    [appendMessage],
  );

  useEffect(() => {
    return () => {
      desiredJoinedRef.current = false;
      socketRef.current?.emit("leave-room");
      socketRef.current?.disconnect();
      clearDisconnectTimer();
      dataChannelRef.current?.close();
      peerConnectionRef.current?.close();
      localStreamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, [clearDisconnectTimer]);

  return {
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
  };
}

