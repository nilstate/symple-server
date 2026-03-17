# Symple Server

Realtime messaging and presence server built on [Socket.IO](https://socket.io/).

Part of the Symple ecosystem:

- **[symple-client](https://github.com/sourcey/symple-client)** — JavaScript client (browser & Node.js)
- **[symple-client-ruby](https://github.com/sourcey/symple-client-ruby)** — Ruby/Rails server-side emitter

## Features

- **Presence** — peer online/offline status broadcasting
- **Scoped messaging** — direct (peer-to-peer), user-level, room-level, or global broadcast
- **Dynamic rooms** — clients can join and leave rooms at runtime
- **Token authentication** — session validation via Redis (or anonymous mode)
- **Horizontal scaling** — optional Redis pub/sub adapter for multi-instance deployments
- **SSL/TLS** — optional HTTPS support

## Quick Start

```bash
git clone https://github.com/sourcey/symple-server.git
cd symple-server
npm install
npm start
```

The server listens on port **4500** by default. No Redis required — it runs in single-instance mode out of the box.

## Configuration

All configuration is via environment variables (loaded from `.env` via [dotenv](https://github.com/motdotla/dotenv)). Copy `.env.example` to `.env` to get started.

| Variable | Default | Description |
|---|---|---|
| `PORT` | `4500` | Port to listen on (also `SYMPLE_PORT`) |
| `SYMPLE_SESSION_TTL` | `-1` | Session TTL in minutes (`-1` = no expiry) |
| `SYMPLE_AUTHENTICATION` | `false` | Require token auth (needs Redis) |
| `SYMPLE_DYNAMIC_ROOMS` | `true` | Allow clients to join/leave rooms |
| `SYMPLE_REDIS_URL` | — | Redis connection URL (enables Redis features) |
| `SYMPLE_REDIS_HOST` | — | Redis host (alternative to URL) |
| `SYMPLE_REDIS_PORT` | — | Redis port (alternative to URL) |
| `SYMPLE_CORS_ORIGINS` | `*` (allow all) | Comma-separated origins or `*` |
| `SYMPLE_CORS_METHODS` | `GET,POST` | Allowed HTTP methods |
| `SYMPLE_CORS_CREDENTIALS` | — | Enable credentials (`true`/`false`) |
| `SYMPLE_SSL_ENABLED` | `false` | Enable HTTPS |
| `SYMPLE_SSL_KEY` | — | Path to SSL key file |
| `SYMPLE_SSL_CERT` | — | Path to SSL certificate file |

### Redis

Redis is **optional**. Without it, the server runs in single-instance mode with in-memory Socket.IO. Set `SYMPLE_REDIS_URL` to enable:

- **Horizontal scaling** — multiple server instances via the `@socket.io/redis-adapter`
- **Token authentication** — session lookup at `symple:session:<token>`
- **Server-side emission** — push messages from Ruby/Rails via [symple-client-ruby](https://github.com/sourcey/symple-client-ruby)

## Authentication

When `SYMPLE_AUTHENTICATION=true`, clients must provide `user` and `token` in the Socket.IO handshake auth. The server looks up the session in Redis at `symple:session:<token>` and merges it with the auth data.

When `SYMPLE_AUTHENTICATION=false` (default), clients only need to provide `user`.

## Message Routing

Messages are routed based on the `to` field:

| `to` value | Behavior |
|---|---|
| Undefined | Broadcast to joined rooms (or globally if `dynamicRooms` is off) |
| `"user\|id"` | Direct message to a specific peer |
| `["room1", "room2"]` | Broadcast to multiple rooms |

## Programmatic Usage

```javascript
const Symple = require('./lib/symple');
const { createConfig } = require('./config');

const config = createConfig();
const server = new Symple(config);

// Override the post-auth hook
server.onAuthorize = function(socket) {
  console.log('Peer connected:', socket.peer.name);
};

server.init();
```

## Debug Logging

Enable debug output with:

```bash
DEBUG=symple:* npm start
```

## More Information

For more details, visit [sourcey.com/code/symple](https://sourcey.com/code/symple).

## License

MIT
