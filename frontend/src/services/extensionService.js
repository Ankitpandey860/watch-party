import api from "./api";

// Browser-extension pairing (see backend/src/routes/extensionRoutes.js). The WEB app side only:
// it asks for a one-time pairing code, shows status, and revokes. The extension redeems the code
// itself; this app never sees the extension's credential.
export const extensionService = {
  // POST /extension/pairing { roomId } -> { code: "ABCD-EFGH", expiresInSeconds }
  async createPairingCode(roomId) {
    const { data } = await api.post("/extension/pairing", { roomId });
    return data;
  },
  // GET /extension/status?roomId= -> { paired, connected, label, expiresAt }
  async status(roomId) {
    const { data } = await api.get("/extension/status", { params: { roomId } });
    return data;
  },
  // POST /extension/revoke { roomId } -> { revoked }
  async revoke(roomId) {
    const { data } = await api.post("/extension/revoke", { roomId });
    return data;
  },
};

export default extensionService;
