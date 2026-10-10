import { ROLES } from "../constants/roles.js";

export class Participant {
  /**
   * @param {object} opts
   * @param {string} opts.id        - the authenticated principal's id (user id or guest id); server-assigned
   * @param {string} opts.username  - room-unique display name
   * @param {string} [opts.role]
   * @param {"user"|"guest"} [opts.kind]
   */
  constructor({ id, username, role = ROLES.PARTICIPANT, kind = "user" }) {
    this.id = id;
    this.username = username;
    this.role = role;
    this.kind = kind;
    this.online = false; // flips true once the socket actually joins
    this.socketId = null;
    this.joinedAt = Date.now();
    this.disconnectTimer = null; // grace-period removal timer, set on disconnect
  }

  attachSocket(socketId) {
    this.socketId = socketId;
    this.online = true;
    this.clearDisconnectTimer();
  }

  markOffline() {
    this.online = false;
    this.socketId = null;
  }

  clearDisconnectTimer() {
    if (this.disconnectTimer) {
      clearTimeout(this.disconnectTimer);
      this.disconnectTimer = null;
    }
  }

  /** Shape sent to clients. `id` is a public identifier, NOT a credential. */
  toPublic() {
    return { id: this.id, username: this.username, role: this.role, kind: this.kind, online: this.online };
  }
}

export default Participant;
