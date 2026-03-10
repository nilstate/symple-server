/**
 * Peer model — an arbitrary data store for connected clients.
 *
 * Properties:
 * - id       the peer session id
 * - online   the peer online status
 * - group    the peer group
 * - access   the peer access level [1 - 10]
 * - user     the peer user name
 * - user_id  the peer user id
 */

class Peer {
  constructor(data) {
    if (data) {
      this.read(data);
    }
  }

  read(from) {
    for (const key in from) {
      if (from.hasOwnProperty(key)) {
        this[key] = from[key];
      }
    }
  }

  write(to) {
    for (const key in this) {
      if (this.hasOwnProperty(key)) {
        to[key] = this[key];
      }
    }
  }

  toPresence(p) {
    if (typeof p !== 'object') p = {};
    p.type = 'presence';
    p.data = this.toPeer(p.data);
    if (!p.from) p.from = this.address();

    // Remove sensitive data
    if (typeof p.data.token === 'string') {
      delete p.data.token;
    }

    // Allow the peer to change name
    if (typeof p.name === 'string') {
      this.name = p.name;
    }

    return p;
  }

  toPeer(p) {
    if (typeof p !== 'object') p = {};
    this.write(p);
    return p;
  }

  address() {
    return this.user + '|' + this.id;
  }

  valid() {
    return !!(this.id && this.user);
  }
}

module.exports = Peer;
