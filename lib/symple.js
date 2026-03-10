const http = require('http');
const https = require('https');
const fs = require('fs');
const Peer = require('./peer');
const debug = require('debug')('symple:server');
const { Server } = require('socket.io');
const { createAdapter } = require('@socket.io/redis-adapter');
const { createClient } = require('redis');

/**
 * Symple server class.
 *
 * @param {Object} config - configuration object
 * @param {number} config.port - the port to listen on
 * @param {string} config.redis - redis connection URL
 * @param {Object} config.ssl - ssl configuration
 * @param {number} config.sessionTTL - session timeout value in minutes (-1 to disable)
 * @param {boolean} config.authentication - enable/disable token authentication
 * @param {boolean} config.dynamicRooms - enable/disable dynamic room joining
 * @param {Object} config.cors - CORS configuration for Socket.IO
 */
class Symple {
  constructor(config) {
    this.config = config || {};
  }

  // Initialize the Symple server.
  init() {
    this.initHTTP();
    this.initSocketIO();
    this.initRedis();
  }

  // Shutdown the Symple server.
  shutdown() {
    if (this.io) this.io.close();
    if (this.server) this.server.close();
    if (this.redis) this.redis.quit();
    if (this.pub) this.pub.quit();
    if (this.sub) this.sub.quit();
  }

  // Initialize HTTP server.
  initHTTP() {
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

  // Initialize the Socket.IO server.
  initSocketIO() {
    const opts = {};
    if (this.config.cors) {
      opts.cors = this.config.cors;
    }

    this.io = new Server(this.server, opts);

    // Authentication middleware
    this.io.use((socket, next) => {
      this.authorize(socket, socket.handshake.auth, (status, message) => {
        if (status === 200) {
          next();
        } else {
          next(new Error(message));
        }
      });
    });

    // Handle socket connections
    this.io.on('connection', (socket) => {
      this.onConnection(socket);
    });
  }

  // Initialize the Redis client and adapter.
  initRedis() {
    if (this.config.redis && !this.redis) {
      this.redis = createClient({ url: this.config.redis });
      this.redis.on('error', this.onRedisError);
      this.redis.connect();
    }

    if (this.config.redis) {
      this.initRedisAdapter();
    }
  }

  initRedisAdapter() {
    this.pub = createClient({ url: this.config.redis });
    this.sub = this.pub.duplicate();

    this.pub.on('error', this.onRedisError);
    this.sub.on('error', this.onRedisError);

    Promise.all([this.pub.connect(), this.sub.connect()]).then(() => {
      this.io.adapter(createAdapter(this.pub, this.sub, { key: 'symple' }));
    });
  }

  // Called upon client socket connected.
  onConnection(socket) {
    debug(socket.id, 'connection');

    // Message
    socket.on('message', (m, ack) => {
      if (m) {
        this.broadcast(socket, m);
        this.respond(ack, 200);
      }
    });

    // Dynamic rooms
    if (this.config.dynamicRooms) {
      socket.on('join', (room, ack) => {
        debug(socket.id, 'joining room', room);
        socket.join(room);
        this.respond(ack, 200, 'Joined room: ' + room);
      });

      socket.on('leave', (room, ack) => {
        debug(socket.id, 'leaving room', room);
        socket.leave(room);
        this.respond(ack, 200, 'Left room: ' + room);
      });
    }

    // Handle socket disconnection
    socket.on('disconnect', () => {
      this.onDisconnect(socket);
    });
  }

  // Called upon client socket disconnect.
  onDisconnect(socket) {
    debug(socket.id, 'is disconnecting');

    if (socket.peer) {
      if (socket.peer.online) {
        socket.peer.online = false;
        this.broadcast(socket, socket.peer.toPresence());
      }
      socket.leave(socket.peer.user);
    }
  }

  // Authorize a new connection.
  authorize(socket, auth, fn) {
    if (this.config.authentication) {
      if (!auth.user || !auth.token) {
        return fn(401, 'Authentication failed: Missing user or token param');
      }

      debug(socket.id, 'authenticating', auth);
      this.getSession(auth.token, (err, session) => {
        if (err) {
          return fn(401, 'Authentication failed: ' + err);
        }
        debug(socket.id, 'authentication success');
        this.authorizeValidPeer(socket, Object.assign({}, auth, session), fn);
      });
    } else {
      if (!auth.user) {
        return fn(401, 'Authentication failed: Missing user param');
      }
      this.authorizeValidPeer(socket, auth, fn);
    }
  }

  // Create and validate a peer from auth data.
  authorizeValidPeer(socket, data, fn) {
    const peer = new Peer(Object.assign({}, data, {
      id: socket.id,
      online: true,
      name: data.name || data.user,
      host: socket.handshake.headers['x-real-ip']
        || socket.handshake.headers['x-forwarded-for']
        || socket.handshake.address
    }));

    if (peer.valid()) {
      socket.join(peer.user);
      socket.peer = peer;
      debug(socket.id, 'authentication success', peer);
      this.onAuthorize(socket);
      return fn(200, 'Welcome ' + peer.name);
    }

    debug(socket.id, 'authentication failed: invalid peer object', peer);
    return fn(401, 'Invalid peer session');
  }

  // Hook called after successful authorization.
  // Override to add custom post-auth logic.
  onAuthorize(socket) {
    // Override in subclass or instance
  }

  onRedisError(err) {
    console.error('Redis client error:', err);
  }

  // Broadcast a message over the given socket.
  broadcast(socket, message) {
    if (!message || typeof message !== 'object' || !message.from) {
      debug(socket.id, 'dropping invalid message:', message);
      return;
    }

    debug(socket.id, 'broadcasting message:', message);

    const to = message.to;
    if (typeof to === 'undefined') {
      if (this.config.dynamicRooms) {
        socket.rooms.forEach((room) => {
          if (room !== socket.id && room !== socket.peer.user) {
            socket.broadcast.to(room).emit('message', message);
          }
        });
      } else {
        socket.broadcast.emit('message', message);
      }
    } else if (typeof to === 'string') {
      const addr = this.parseAddress(to);
      socket.broadcast.to(addr.user || addr.id).emit('message', message);
    } else if (Array.isArray(to)) {
      for (let i = 0; i < to.length; i++) {
        socket.broadcast.to(to[i]).emit('message', message);
      }
    } else {
      debug(socket.id, 'cannot route message', message);
    }
  }

  respond(ack, status, message, data) {
    if (typeof ack !== 'function') return;
    const res = { type: 'response', status };
    if (message) res.message = message;
    if (data) res.data = data.data || data;
    debug('responding', res);
    ack(res);
  }

  // Get a peer session from Redis by token.
  getSession(token, fn) {
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

  // Touch a peer session to extend its TTL.
  touchSession(token, fn) {
    if (this.config.sessionTTL === -1) return;

    const expiry = Math.floor(Date.now() / 1000) + (this.config.sessionTTL * 60);
    this.redis.expireAt('symple:session:' + token, expiry).then(() => {
      if (fn) fn(null, true);
    }).catch((err) => {
      if (fn) fn(err, null);
    });
  }

  // Parse a peer address with the format: user|id
  parseAddress(str) {
    const arr = str.split('|');
    const addr = { user: arr[0] };
    if (arr.length > 1) {
      addr.id = arr[1];
    }
    return addr;
  }
}

module.exports = Symple;
