# Symple Server

Realtime messaging and presence server over native WebSocket.

Part of the Symple ecosystem:

- **[symple-client](https://github.com/nilstate/symple-client)** - JavaScript client (browser & Node.js)
- **[symple-client-ruby](https://github.com/nilstate/symple-client-ruby)** - Ruby/Rails server-side emitter

## Features

- **Presence** - peer online/offline status broadcasting
- **Scoped messaging** - direct (peer-to-peer), user-level, room-level, or global broadcast
- **Team/group permissions** - peers only see and message others in their assigned rooms
- **Dynamic rooms** - clients can optionally join and leave rooms at runtime
- **Token authentication** - session validation via Redis (or anonymous mode)
- **Server-side emission** - push messages from Ruby/Rails via Redis pub/sub
- **SSL/TLS** - optional HTTPS/WSS support

## Quick Start

```bash
git clone https://github.com/nilstate/symple-server.git
cd symple-server
npm install
npm start
```

The server listens on port **4500** by default. No Redis required - it runs in single-instance mode out of the box.

## Configuration

All configuration is via environment variables (loaded from `.env` via [dotenv](https://github.com/motdotla/dotenv)). Copy `.env.example` to `.env` to get started.

| Variable | Default | Description |
|---|---|---|
| `PORT` | `4500` | Port to listen on (also `SYMPLE_PORT`) |
| `SYMPLE_SESSION_TTL` | `-1` | Session TTL in minutes (`-1` = no expiry) |
| `SYMPLE_AUTHENTICATION` | `false` | Require token auth (needs Redis) |
| `SYMPLE_DYNAMIC_ROOMS` | `true` | Allow clients to join/leave rooms |
| `SYMPLE_REDIS_URL` | - | Redis connection URL (enables Redis features) |
| `SYMPLE_REDIS_HOST` | - | Redis host (alternative to URL) |
| `SYMPLE_REDIS_PORT` | - | Redis port (alternative to URL) |
| `SYMPLE_SSL_ENABLED` | `false` | Enable HTTPS/WSS |
| `SYMPLE_SSL_KEY` | - | Path to SSL key file |
| `SYMPLE_SSL_CERT` | - | Path to SSL certificate file |

### Redis

Redis is **optional**. Without it, the server runs in single-instance mode with in-memory state. Set `SYMPLE_REDIS_URL` to enable:

- **Token authentication** - session lookup at `symple:session:<token>`
- **Server-side emission** - push messages from Ruby/Rails via [symple-client-ruby](https://github.com/nilstate/symple-client-ruby)

## Authentication

When `SYMPLE_AUTHENTICATION=true`, clients must provide `user` and `token` in the auth message (the first WebSocket message after connection). The server looks up the session in Redis at `symple:session:<token>` and merges it with the auth data.

When `SYMPLE_AUTHENTICATION=false` (default), clients only need to provide `user`.

## Teams and Permissions

Rooms are the permission boundary. A peer can only see presence from and send direct messages to peers that share at least one room. Every peer is auto-joined to their own user room on authentication.

There are three ways to assign rooms:

### 1. Via Redis session (recommended for web apps)

When your backend creates a session, include a `rooms` array. The server auto-joins the peer on authentication:

```ruby
# Rails: on login, create a Symple session with team memberships
Symple.session.set(api_token.token, {
  user: user.username,
  rooms: user.teams.pluck(:slug)  # ["team-a", "design", "project-42"]
}, ttl: 1.week.to_i)
```

The client connects with the token; the server looks up the session, finds the rooms, and auto-joins:

```javascript
const client = new SympleClient({
  url: 'wss://your-server.com',
  token: 'the-api-token',
  peer: { user: 'alice', name: 'Alice' }
})
```

### 2. Via auth message (for simple setups)

The client can include `rooms` directly in the auth message. This only works when `SYMPLE_AUTHENTICATION=false` (no token validation), so the client is trusted:

```javascript
// Client sends: { type: "auth", user: "alice", rooms: ["lobby", "vip"] }
```

### 3. Via dynamic rooms (for open systems)

With `SYMPLE_DYNAMIC_ROOMS=true` (default), clients can join and leave rooms freely after authentication. This gives no permission scoping; any peer can join any room. Set `SYMPLE_DYNAMIC_ROOMS=false` to lock rooms to server-assigned only.

### Permission model

| Scenario | Behavior |
|---|---|
| Alice in `["team-a"]`, Bob in `["team-a"]` | Can see each other's presence, can DM |
| Alice in `["team-a"]`, Bob in `["team-b"]` | Invisible to each other, DMs blocked |
| Alice in `["team-a", "design"]`, Bob in `["design"]` | Can see each other via `design` room |
| Broadcast to room `"team-a"` | Only reaches peers in `team-a` |

The welcome message includes the full room list so the client knows its memberships:

```json
{ "type": "welcome", "protocol": "symple/4", "status": 200, "peer": {...}, "rooms": ["alice", "team-a", "design"] }
```

## Message Routing

Messages are routed based on the `to` field:

| `to` value | Behavior |
|---|---|
| Undefined | Broadcast to all sender's rooms (excluding sender) |
| `"user\|id"` | Direct message to a specific peer (must share a room) |
| `"user"` | Broadcast to the user's room |
| `["room1", "room2"]` | Broadcast to multiple rooms |

## Programmatic Usage

```javascript
const Symple = require('./lib/symple');
const { createConfig } = require('./config');

const config = createConfig();
const server = new Symple(config);

// Custom authentication with room assignment (supports async)
server.authenticate = async (peer, auth) => {
  const user = await db.users.findByToken(auth.token);
  if (!user) return { allowed: false };
  return {
    allowed: true,
    rooms: user.teams  // ["team-a", "design"]
  };
};

// Post-auth hook (peer is already registered)
server.onAuthorize = function(ws, peer) {
  console.log('Peer connected:', peer.name);
};

server.init();
```

## C++ Server

A C++ implementation with the same protocol is available in [libsourcey](https://github.com/nilstate/libsourcey/tree/master/src/symple).

## Debug Logging

Enable debug output with:

```bash
DEBUG=symple:* npm start
```

## More Information

For more details, visit [0state.com/symple](https://0state.com/symple).

## License

MIT
