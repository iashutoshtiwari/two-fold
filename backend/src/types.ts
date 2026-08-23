export type LeaveReason = "left" | "disconnect";

export interface JoinRoomPayload {
  roomId: string;
}

export type JoinRoomResponse =
  | {
      ok: true;
      roomId: string;
      peerCount: number;
      role: "offerer" | "answerer";
    }
  | {
      ok: false;
      error: "INVALID_ROOM" | "ROOM_FULL";
      message: string;
    };

export interface LeaveRoomResponse {
  ok: true;
}

export interface SessionDescriptionPayload {
  type: "offer" | "answer";
  sdp?: string;
}

export interface IceCandidatePayload {
  candidate: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  usernameFragment?: string | null;
}

export interface PeerJoinedPayload {
  peerId: string;
}

export interface PeerDisconnectedPayload {
  peerId: string;
  reason: LeaveReason;
}

export interface ServerToClientEvents {
  "peer-joined": (payload: PeerJoinedPayload) => void;
  offer: (description: SessionDescriptionPayload) => void;
  answer: (description: SessionDescriptionPayload) => void;
  "ice-candidate": (candidate: IceCandidatePayload) => void;
  "peer-disconnected": (payload: PeerDisconnectedPayload) => void;
}

export interface ClientToServerEvents {
  "join-room": (
    payload: JoinRoomPayload,
    acknowledge: (response: JoinRoomResponse) => void,
  ) => void;
  "leave-room": (acknowledge?: (response: LeaveRoomResponse) => void) => void;
  "peer-disconnected": () => void;
  offer: (description: SessionDescriptionPayload) => void;
  answer: (description: SessionDescriptionPayload) => void;
  "ice-candidate": (candidate: IceCandidatePayload) => void;
}

export interface SocketData {
  roomId?: string;
}

