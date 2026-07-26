import { ROLES } from "../constants/roles.js";

export class Participant {
  /**
   * @param {object} opts
   * @param {string} opts.id - stable userId (uuid), survives reconnects/refreshes
   * @param {string} opts.username
   * @param {string} [opts.role]
   */
  constructor({ id, username, role = ROLES.PARTICIPANT }) {
    this.id = id;
    this.username = username;
    this.role = role;
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

  /** Shape sent to the frontend — matches ParticipantCard's expected `participant` prop. */
  toPublic() {
    return {
      id: this.id,
      username: this.username,
      role: this.role,
      online: this.online,
    };
  }
}

export default Participant;
