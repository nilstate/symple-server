/**
 * Integration test: JS server + JS client (native WebSocket).
 * Run: node test/integration.mjs
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const Symple = require('../lib/symple');
const WebSocket = require('ws');

// Polyfill WebSocket for Node (client uses browser WebSocket API)
globalThis.WebSocket = WebSocket;

const { default: SympleClient } = await import('../../symple-client/src/client.js');

const PORT = 14600;

// Start JS server
const server = new Symple({
  port: PORT,
  dynamicRooms: true
});
server.init();

function wait (ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

let passed = 0;
let failed = 0;

function assert (condition, msg) {
  if (condition) {
    passed++;
    console.log('  PASS:', msg);
  } else {
    failed++;
    console.error('  FAIL:', msg);
  }
}

async function test () {
  console.log('--- Test: connect and authenticate ---');

  const alice = new SympleClient({
    url: `ws://127.0.0.1:${PORT}`,
    peer: { user: 'alice', name: 'Alice' },
    reconnection: false
  });

  let aliceOnline = false;
  alice.on('connect', () => { aliceOnline = true; });

  alice.connect();
  await wait(500);
  assert(aliceOnline, 'alice connected');
  assert(alice.peer.id, 'alice has peer id: ' + alice.peer.id);
  assert(server.peers.size === 1, 'server has 1 peer');

  console.log('--- Test: two peers + message routing ---');

  const bob = new SympleClient({
    url: `ws://127.0.0.1:${PORT}`,
    peer: { user: 'bob', name: 'Bob' },
    reconnection: false
  });

  let bobOnline = false;
  bob.on('connect', () => { bobOnline = true; });

  bob.connect();
  await wait(500);
  assert(bobOnline, 'bob connected');
  assert(server.peers.size === 2, 'server has 2 peers');

  // Both join a shared room
  alice.join('test');
  bob.join('test');
  await wait(200);

  // Alice sends message to bob
  let bobGotMessage = false;
  bob.on('message', (m) => {
    if (m.data && m.data.text === 'hello bob') {
      bobGotMessage = true;
    }
  });

  alice.send({
    type: 'message',
    to: 'bob',
    data: { text: 'hello bob' }
  });

  await wait(300);
  assert(bobGotMessage, 'bob received message from alice');

  console.log('--- Test: disconnect presence ---');

  let aliceGotOffline = false;
  alice.on('presence', (p) => {
    if (p.data && p.data.user === 'bob' && !p.data.online) {
      aliceGotOffline = true;
    }
  });

  bob.disconnect();
  await wait(500);
  assert(aliceGotOffline, 'alice saw bob go offline');
  assert(server.peers.size === 1, 'server has 1 peer after bob disconnect');

  console.log('--- Test: graceful shutdown ---');

  let aliceDisconnected = false;
  alice.on('disconnect', () => { aliceDisconnected = true; });

  server.shutdown();
  await wait(300);
  assert(aliceDisconnected, 'alice disconnected on shutdown');

  // -------------------------------------------------------------------
  // authenticate hook + room scoping
  // -------------------------------------------------------------------

  console.log('--- Test: authenticate hook with room assignment ---');

  const PORT2 = PORT + 1;
  const server2 = new Symple({ port: PORT2, dynamicRooms: false });

  server2.authenticate = async (peer, auth) => {
    if (auth.token === 'good') {
      return { allowed: true, rooms: ['team-a'] };
    }
    return { allowed: false, message: 'Bad token' };
  };

  server2.init();

  const goodClient = new SympleClient({
    url: `ws://127.0.0.1:${PORT2}`,
    peer: { user: 'alice' },
    token: 'good',
    reconnection: false
  });

  const badClient = new SympleClient({
    url: `ws://127.0.0.1:${PORT2}`,
    peer: { user: 'eve' },
    token: 'bad',
    reconnection: false
  });

  let goodOnline = false;
  let badError = false;

  goodClient.on('connect', () => { goodOnline = true; });
  badClient.on('error', () => { badError = true; });

  goodClient.connect();
  await wait(500);
  assert(goodOnline, 'good token accepted');

  badClient.connect();
  await wait(500);
  assert(badError, 'bad token rejected');

  console.log('--- Test: room-scoped direct messaging ---');

  const PORT3 = PORT + 2;
  const server3 = new Symple({ port: PORT3, dynamicRooms: false });

  server3.authenticate = async (peer, auth) => {
    // alice in team-a, bob in team-a, eve in team-b
    const teams = { alice: ['shared'], bob: ['shared'], eve: ['other'] };
    return { allowed: true, rooms: teams[auth.user] || [] };
  };

  server3.init();

  const a = new SympleClient({ url: `ws://127.0.0.1:${PORT3}`, peer: { user: 'alice' }, token: 'x', reconnection: false });
  const b = new SympleClient({ url: `ws://127.0.0.1:${PORT3}`, peer: { user: 'bob' }, token: 'x', reconnection: false });
  const e = new SympleClient({ url: `ws://127.0.0.1:${PORT3}`, peer: { user: 'eve' }, token: 'x', reconnection: false });

  let aOnline = false, bOnline = false, eOnline = false;
  a.on('connect', () => { aOnline = true; });
  b.on('connect', () => { bOnline = true; });
  e.on('connect', () => { eOnline = true; });

  a.connect();
  b.connect();
  e.connect();
  await wait(500);
  assert(aOnline && bOnline && eOnline, 'all three connected');

  // Bob should receive alice's message (same room)
  let bobGot = false;
  b.on('message', (m) => {
    if (m.data && m.data.text === 'hi bob') bobGot = true;
  });

  // Eve should NOT receive alice's message (different room)
  let eveGot = false;
  e.on('message', (m) => {
    if (m.data && m.data.text === 'hi eve') eveGot = true;
  });

  // Alice DMs bob (shared room)
  a.send({ type: 'message', to: `bob|${b.peer.id}`, data: { text: 'hi bob' } });

  // Alice tries to DM eve (no shared room - should be blocked)
  a.send({ type: 'message', to: `eve|${e.peer.id}`, data: { text: 'hi eve' } });

  await wait(500);
  assert(bobGot, 'bob received DM from alice (shared room)');
  assert(!eveGot, 'eve did NOT receive DM from alice (no shared room)');

  a.disconnect();
  b.disconnect();
  e.disconnect();
  goodClient.disconnect();
  badClient.disconnect();
  server2.shutdown();
  server3.shutdown();
  await wait(200);

  // Summary
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

test().catch((err) => {
  console.error('Test error:', err);
  server.shutdown();
  process.exit(1);
});
