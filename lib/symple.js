const http = require('http');
const https = require('https');
const fs = require('fs');
const { WebSocketServer } = require('ws');
const Peer = require('./peer');
const debug = require('debug')('symple:server');
const { createClient } = require('redis');

/**
 * Symple v4 server.
 *
 * Native WebSocket transport (no Socket.IO).
 * Auth via first message after connection.
 * Rooms managed manually (Map of Sets).
 *
 * @param {Object} config - configuration object
 * @param {number} config.port - the port to listen on
 * @param {string} config.redis - redis connection URL
 * @param {Object} config.ssl - ssl configuration
 * @param {number} config.sessionTTL - session timeout value in minutes (-1 to disable)
 * @param {boolean} config.authentication - enable/disable token authentication
 * @param {boolean} config.dynamicRooms - enable/disable dynamic room joining
 */
class Symple {
  constructor (config) {
    this.config = config || {};
    this.peers = new Map();       // peerId -> { peer, ws, rooms }
    this.rooms = new Map();       // roomName -> Set of peerIds
    this.wsToPeer = new Map();    // ws -> peerId
  }

  // Initialize the Symple server.
  init () {
    this.initHTTP();
    this.initWebSocket();
    this.initRedis();
  }

  // Shutdown the Symple server.
  shutdown () {
    // Broadcast shutdown notice
    const notice = JSON.stringify({
      type: 'event',
      subtype: 'shutdown',
      message: 'Server shutting down'
    });
    for (const [, entry] of this.peers) {
      try { entry.ws.send(notice); } catch (e) {}
      try { entry.ws.close(); } catch (e) {}
    }

    if (this.wss) this.wss.close();
    if (this.server) this.server.close();
    if (this.sub) this.sub.quit();
    if (this.redis) this.redis.quit();

    this.peers.clear();
    this.rooms.clear();
    this.wsToPeer.clear();
  }

  // Initialize HTTP server.
  initHTTP () {
    if (this.server) return;

    this.server = (this.config.ssl && this.config.ssl.enabled)
      ? https.createServer({
        key: fs.readFileSync(this.config.ssl.key),
        cert: fs.readFileSync(this.config.ssl.cert)
      })
      : http.createServer();

    this.server.listen({
      port: process.env.PORT || this.config.port
    });
  }

  // Initialize the WebSocket server.
  initWebSocket () {
    this.wss = new WebSocketServer({ server: this.server });

    this.wss.on('connection', (ws, req) => {
      debug('new websocket connection');

      // Auth timeout: close if not authenticated within 10 seconds
      const authTimer = setTimeout(() => {
        if (!this.wsToPeer.has(ws)) {
          debug('auth timeout, closing connection');
          this.sendError(ws, 408, 'Authentication timeout');
          ws.close();
        }
      }, 10000);

      ws.on('message', (data) => {
        let msg;
        try {
          msg = JSON.parse(data);
        } catch (e) {
          debug('json parse error:', e.message);
          return;
        }

        if (typeof msg !== 'object') return;

        const peerId = this.wsToPeer.get(ws);

        if (!peerId) {
          // Not authenticated: only accept auth
          if (msg.type === 'auth') {
            clearTimeout(authTimer);
            this.onAuth(ws, req, msg);
          } else {
            this.sendError(ws, 401, 'Not authenticated');
            ws.close();
          }
          return;
        }

        const entry = this.peers.get(peerId);
        if (!entry) return;

        const type = msg.type;

        if (type === 'message' || type === 'presence' ||
            type === 'command' || type === 'event') {
          this.onMessage(entry, msg);
        } else if (type === 'join') {
          this.onJoin(entry, msg.room);
        } else if (type === 'leave') {
          this.onLeave(entry, msg.room);
        } else if (type === 'close') {
          ws.close();
        }
      });

      ws.on('close', () => {
        clearTimeout(authTimer);
        this.onDisconnect(ws);
      });

      ws.on('error', (err) => {
        debug('websocket error:', err.message);
      });
    });
  }

  // Initialize the Redis client for sessions and pub/sub.
  initRedis () {
    if (!this.config.redis) return;

    if (!this.redis) {
      this.redis = createClient({ url: this.config.redis });
      this.redis.on('error', this.onRedisError);
      this.redis.connect();
    }

    // Subscribe to the broadcast channel for server-side message injection.
    // This allows Ruby/Rails backends (via symple-client-ruby) to push
    // messages to connected WebSocket peers through Redis pub/sub.
    this.sub = this.redis.duplicate();
    this.sub.on('error', this.onRedisError);
    this.sub.connect().then(() => {
      this.sub.subscribe('symple:broadcast', (data) => {
        try {
          const msg = JSON.parse(data);
          this.onRedisMessage(msg);
        } catch (e) {
          debug('redis message parse error:', e.message);
        }
      });
      debug('subscribed to symple:broadcast');
    });
  }

  // Route a message received from Redis pub/sub.
  onRedisMessage (msg) {
    if (!msg || typeof msg !== 'object') return;

    debug('redis message:', msg.type, msg.to);

    const to = msg.to;
    if (typeof to === 'string') {
      const addr = this.parseAddress(to);
      if (addr.id) {
        this.sendTo(addr.id, msg);
      } else {
        this.broadcastToRoom(addr.user, msg);
      }
    } else if (Array.isArray(to)) {
      for (const room of to) {
        if (typeof room === 'string') {
          this.broadcastToRoom(room, msg);
        }
      }
    }
  }

  // Handle authentication.
  onAuth (ws, req, msg) {
    const user = msg.user;
    if (!user) {
      this.sendError(ws, 401, 'Missing user field');
      return;
    }

    const doRegister = async (data) => {
      const id = this.randomId();
      const peer = new Peer(Object.assign({}, data, {
        id,
        online: true,
        name: data.name || user,
        host: req.headers['x-real-ip'] ||
              req.headers['x-forwarded-for'] ||
              req.socket.remoteAddress
      }));

      if (!peer.valid()) {
        this.sendError(ws, 401, 'Invalid peer session');
        return;
      }

      // Authentication hook. Override to validate credentials and
      // assign rooms from a database. Return { allowed, rooms } or
      // throw to reject. Supports async (database lookups, etc).
      //
      // Example:
      //   server.authenticate = async (peer, auth) => {
      //     const user = await db.users.findByToken(auth.token);
      //     if (!user) return { allowed: false };
      //     return { allowed: true, rooms: user.teams };
      //   };
      if (this.authenticate) {
        try {
          const result = await this.authenticate(peer, data);
          if (result && result.allowed === false) {
            this.sendError(ws, 401, result.message || 'Authentication failed');
            return;
          }
          if (result && Array.isArray(result.rooms)) {
            data.rooms = (data.rooms || []).concat(result.rooms);
          }
        } catch (err) {
          this.sendError(ws, 401, err.message || 'Authentication failed');
          return;
        }
      }

      const entry = { peer, ws, rooms: new Set() };

      // Auto-join user room
      entry.rooms.add(user);
      this.addToRoom(user, id);

      // Auto-join team/group rooms from session data and auth hook.
      // The session (from Redis or auth message) can include a `rooms`
      // array. This is the permission boundary: peers only see presence
      // and receive messages within their rooms.
      const sessionRooms = data.rooms;
      if (Array.isArray(sessionRooms)) {
        for (const room of sessionRooms) {
          if (typeof room === 'string' && room) {
            entry.rooms.add(room);
            this.addToRoom(room, id);
          }
        }
      }

      this.peers.set(id, entry);
      this.wsToPeer.set(ws, id);

      // Send welcome
      ws.send(JSON.stringify({
        type: 'welcome',
        protocol: 'symple/4',
        status: 200,
        peer: peer.toPeer(),
        rooms: Array.from(entry.rooms)
      }));

      debug(id, 'authenticated as', user);

      // Broadcast online presence
      this.broadcast(entry, {
        type: 'presence',
        from: peer.address(),
        data: peer.toPeer()
      });

      this.onAuthorize(ws, peer);
    };

    if (this.config.authentication) {
      if (!msg.token) {
        this.sendError(ws, 401, 'Authentication failed: Missing token');
        return;
      }
      this.getSession(msg.token, (err, session) => {
        if (err) {
          this.sendError(ws, 401, 'Authentication failed: ' + err);
          return;
        }
        doRegister(Object.assign({}, msg, session));
      });
    } else {
      doRegister(msg);
    }
  }

  // Handle routable messages.
  onMessage (entry, msg) {
    // Enforce from field (prevent spoofing)
    msg.from = entry.peer.address();
    this.route(entry, msg);
  }

  // Handle join room request.
  onJoin (entry, room) {
    if (!room) return;
    if (!this.config.dynamicRooms) {
      try {
        entry.ws.send(JSON.stringify({
          type: 'error', message: 'Dynamic rooms disabled'
        }));
      } catch (e) {}
      return;
    }

    entry.rooms.add(room);
    this.addToRoom(room, entry.peer.id);

    try {
      entry.ws.send(JSON.stringify({ type: 'join:ok', room }));
    } catch (e) {}
    debug(entry.peer.id, 'joined room:', room);
  }

  // Handle leave room request.
  onLeave (entry, room) {
    if (!room) return;

    entry.rooms.delete(room);
    this.removeFromRoom(room, entry.peer.id);

    try {
      entry.ws.send(JSON.stringify({ type: 'leave:ok', room }));
    } catch (e) {}
    debug(entry.peer.id, 'left room:', room);
  }

  // Handle disconnect.
  onDisconnect (ws) {
    const peerId = this.wsToPeer.get(ws);
    if (!peerId) {
      this.wsToPeer.delete(ws);
      return;
    }

    const entry = this.peers.get(peerId);
    if (entry) {
      debug(peerId, 'disconnected');

      // Broadcast offline presence
      entry.peer.online = false;
      this.broadcast(entry, {
        type: 'presence',
        from: entry.peer.address(),
        data: entry.peer.toPeer()
      });

      // Clean up rooms
      for (const room of entry.rooms) {
        this.removeFromRoom(room, peerId);
      }

      this.peers.delete(peerId);
    }

    this.wsToPeer.delete(ws);
  }

  // Check if two peers share at least one room.
  sharesRoom (entryA, entryB) {
    for (const room of entryA.rooms) {
      if (entryB.rooms.has(room)) return true;
    }
    return false;
  }

  // Route a message to recipients.
  route (sender, msg) {
    const to = msg.to;

    if (typeof to === 'undefined') {
      // No recipient: broadcast to all sender's rooms (excluding sender)
      for (const room of sender.rooms) {
        this.broadcastToRoom(room, msg, sender.peer.id);
      }
    } else if (typeof to === 'string') {
      const addr = this.parseAddress(to);
      if (addr.id) {
        // Full address: send to specific peer.
        // Permission check: sender and recipient must share a room.
        const target = this.peers.get(addr.id);
        if (target && this.sharesRoom(sender, target)) {
          this.sendTo(addr.id, msg);
        } else if (target) {
          debug(sender.peer.id, 'blocked direct message to', addr.id, '(no shared room)');
        }
      } else {
        // User name only: broadcast to user's room
        this.broadcastToRoom(addr.user, msg, sender.peer.id);
      }
    } else if (Array.isArray(to)) {
      for (const room of to) {
        if (typeof room === 'string') {
          this.broadcastToRoom(room, msg, sender.peer.id);
        }
      }
    }
  }

  // Broadcast a message from a peer to all its rooms (excluding sender).
  broadcast (sender, msg) {
    for (const room of sender.rooms) {
      this.broadcastToRoom(room, msg, sender.peer.id);
    }
  }

  // Broadcast to a specific room.
  broadcastToRoom (room, msg, excludeId) {
    const members = this.rooms.get(room);
    if (!members) return;

    const str = JSON.stringify(msg);
    for (const peerId of members) {
      if (peerId === excludeId) continue;
      const entry = this.peers.get(peerId);
      if (entry) {
        try { entry.ws.send(str); } catch (e) {}
      }
    }
  }

  // Send to a specific peer by ID.
  sendTo (peerId, msg) {
    const entry = this.peers.get(peerId);
    if (!entry) return false;
    try {
      entry.ws.send(JSON.stringify(msg));
      return true;
    } catch (e) {
      return false;
    }
  }

  // Hook called after successful authorization.
  // Override to add custom post-auth logic.
  onAuthorize (ws, peer) {
    // Override in subclass or instance
  }

  // Send an error message over a WebSocket.
  sendError (ws, status, message) {
    try {
      ws.send(JSON.stringify({ type: 'error', status, message }));
    } catch (e) {}
  }

  // Room management
  addToRoom (room, peerId) {
    if (!this.rooms.has(room)) {
      this.rooms.set(room, new Set());
    }
    this.rooms.get(room).add(peerId);
  }

  removeFromRoom (room, peerId) {
    const members = this.rooms.get(room);
    if (members) {
      members.delete(peerId);
      if (members.size === 0) {
        this.rooms.delete(room);
      }
    }
  }

  // Redis session management
  onRedisError (err) {
    console.error('Redis client error:', err);
  }

  getSession (token, fn) {
    this.redis.get('symple:session:' + token).then((value) => {
      debug('symple session', token, value);
      if (value === null) {
        fn('No session', null);
      } else {
        const session = JSON.parse(value);
        if (typeof session !== 'object') {
          return fn('Session must be an object', null);
        }
        fn(null, session);
      }
    }).catch((error) => {
      fn('Redis error: ' + error.message, null);
    });
  }

  touchSession (token, fn) {
    if (this.config.sessionTTL === -1) return;

    const expiry = Math.floor(Date.now() / 1000) + (this.config.sessionTTL * 60);
    this.redis.expireAt('symple:session:' + token, expiry).then(() => {
      if (fn) fn(null, true);
    }).catch((err) => {
      if (fn) fn(err, null);
    });
  }

  // Parse a peer address with the format: user|id
  parseAddress (str) {
    const arr = str.split('|');
    const addr = { user: arr[0] };
    if (arr.length > 1) {
      addr.id = arr[1];
    }
    return addr;
  }

  // Generate a random peer ID.
  randomId () {
    return Math.random().toString(36).slice(2) +
           Math.random().toString(36).slice(2);
  }
}

module.exports = Symple;
