# Symple Server

Realtime messaging and presence server built on [Socket.IO](https://socket.io/) and [Redis](https://redis.io/).

## Features

- **Presence** — peer online/offline status broadcasting
- **Scoped messaging** — direct (peer-to-peer), user-level, room-level, or global broadcast
- **Dynamic rooms** — clients can join and leave rooms at runtime
- **Token authentication** — session validation via Redis (or anonymous mode)
- **Horizontal scaling** — Redis pub/sub adapter for multi-instance deployments
- **SSL/TLS** — optional HTTPS support

## Requirements

- Node.js >= 18
- Redis (for authentication, sessions, and multi-instance scaling)

## Quick Start

```bash
git clone https://github.com/sourcey/symple-server.git
cd symple-server
npm install
cp .env.example .env   # edit as needed
npm start
```

The server listens on port **4500** by default.

## Configuration

All configuration is via environment variables (loaded from `.env` via [dotenv](https://github.com/motdotla/dotenv)).

| Variable | Default | Description |
|---|---|---|
| `PORT` | `4500` | Port to listen on (also `SYMPLE_PORT`) |
| `SYMPLE_SESSION_TTL` | `-1` | Session TTL in minutes (`-1` = no expiry) |
| `SYMPLE_AUTHENTICATION` | `false` | Require token auth (needs Redis) |
| `SYMPLE_DYNAMIC_ROOMS` | `true` | Allow clients to join/leave rooms |
| `SYMPLE_REDIS_URL` | `redis://localhost:6379` | Redis connection URL |
| `SYMPLE_REDIS_HOST` | `localhost` | Redis host (fallback if no URL) |
| `SYMPLE_REDIS_PORT` | `6379` | Redis port (fallback if no URL) |
| `SYMPLE_CORS_ORIGINS` | `*` (allow all) | Comma-separated origins or `*` |
| `SYMPLE_CORS_METHODS` | `GET,POST` | Allowed HTTP methods |
| `SYMPLE_CORS_CREDENTIALS` | — | Enable credentials (`true`/`false`) |
| `SYMPLE_SSL_ENABLED` | `false` | Enable HTTPS |
| `SYMPLE_SSL_KEY` | — | Path to SSL key file |
| `SYMPLE_SSL_CERT` | — | Path to SSL certificate file |

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

## License

MIT
