import dotenv from "dotenv";

dotenv.config();

function parseOrigins(raw) {
  if (!raw) return ["http://localhost:3000", "http://localhost:5173"];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export const config = Object.freeze({
  port: Number(process.env.PORT) || 4000,
  corsOrigins: parseOrigins(process.env.CORS_ORIGIN),
  disconnectGraceMs: (Number(process.env.DISCONNECT_GRACE_SECONDS) || 60) * 1000,
  emptyRoomTtlMs: (Number(process.env.EMPTY_ROOM_TTL_SECONDS) || 30) * 1000,
});
