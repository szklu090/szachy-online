/* ============================================================
 * Serwer szachow online
 *  - HTTP (Express) serwuje klienta z /public
 *  - WebSocket (ws) obsluguje pokoje, ruchy, zegar, czat
 *  - serwer jest "autorytatywny": sprawdza legalnosc ruchow
 * ============================================================ */

import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocketServer } from 'ws';
import { Chess } from './public/chess.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_req, res) => res.json({ ok: true, rooms: rooms.size }));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

/* ---------------------- Pokoje ---------------------- */

const rooms = new Map();
const RECONNECT_TIMEOUT = 5 * 60 * 1000; // 5 min po rozlaczeniu obu graczy

function makeCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = '';
    for (let i = 0; i < 6; i++) {
      code += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
  } while (rooms.has(code));
  return code;
}

function createRoom(tc) {
  const id = makeCode();
  const room = {
    id,
    game: new Chess(),
    seats: { w: null, b: null },
    tc: tc || null,
    clock: tc ? { w: tc.initial, b: tc.initial } : null,
    clockRunning: null,
    lastTick: Date.now(),
    result: null,
    drawOffer: null,
    undoRequest: null,
    rematchOffer: null,
    started: false,
    chat: [],
    cleanupTimer: null,
    spectators: new Set(),
  };
  rooms.set(id, room);
  return room;
}

function seatOf(room, color) {
  return room.seats[color];
}

function playerName(room, color) {
  return room.seats[color] ? room.seats[color].name : '—';
}

function otherColor(color) {
  return color === 'w' ? 'b' : 'w';
}

/* ---------------------- Wysylanie ---------------------- */

function send(ws, msg) {
  if (ws && ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function buildState(room, color) {
  const g = room.game;
  return {
    t: 'state',
    room: room.id,
    startFen: g.startFen,
    fen: g.fen(),
    turn: g.turn,
    history: g.history.map((h) => ({
      san: h.san,
      from: h.from,
      to: h.to,
      color: h.color,
    })),
    you: color,
    players: {
      w: room.seats.w
        ? { name: room.seats.w.name, connected: room.seats.w.connected }
        : null,
      b: room.seats.b
        ? { name: room.seats.b.name, connected: room.seats.b.connected }
        : null,
    },
    timeControl: room.tc,
    clock: room.clock,
    clockRunning: room.clockRunning,
    result: room.result,
    drawOffer: room.drawOffer,
    undoRequest: room.undoRequest,
    rematchOffer: room.rematchOffer,
    started: room.started,
    check: g.inCheck(),
    legalCount: g.moves().length,
  };
}

function broadcastState(room) {
  for (const color of ['w', 'b']) {
    const seat = room.seats[color];
    if (seat) send(seat.ws, buildState(room, color));
  }
}

function broadcastClock(room) {
  if (!room.clock) return;
  const msg = { t: 'clock', w: room.clock.w, b: room.clock.b, running: room.clockRunning };
  for (const color of ['w', 'b']) {
    const seat = room.seats[color];
    if (seat) send(seat.ws, msg);
  }
}

function broadcastChat(room, msg) {
  for (const color of ['w', 'b']) {
    const seat = room.seats[color];
    if (seat) send(seat.ws, msg);
  }
}

/* ---------------------- Zegar ---------------------- */

function startClockIfReady(room) {
  if (!room.seats.w || !room.seats.b) return;
  if (!room.seats.w.connected || !room.seats.b.connected) return;
  room.started = true;
  if (!room.tc || room.result || room.clockRunning) return;
  room.clockRunning = 'w';
  room.lastTick = Date.now();
}

function endGame(room, result, reason, winner = null) {
  if (room.result) return;
  room.result = {
    result,
    reason,
    winner: winner || (result === '1-0' ? 'w' : result === '0-1' ? 'b' : null),
  };
  room.clockRunning = null;
  room.drawOffer = null;
  room.undoRequest = null;
  broadcastState(room);
}

function tick() {
  const now = Date.now();
  for (const room of rooms.values()) {
    if (!room.clock || room.result || !room.clockRunning) continue;
    if (!room.seats.w?.connected || !room.seats.b?.connected) {
      room.lastTick = now;
      continue;
    }
    const elapsed = now - room.lastTick;
    room.lastTick = now;
    const c = room.clockRunning;
    room.clock[c] = Math.max(0, room.clock[c] - elapsed);
    if (room.clock[c] === 0) {
      const winner = otherColor(c);
      // brak materialu do mata - remis
      if (room.game.isInsufficientMaterial()) {
        endGame(room, '1/2-1/2', 'timeout-insufficient');
      } else {
        endGame(room, winner === 'w' ? '1-0' : '0-1', 'timeout', winner);
      }
    }
  }
  for (const room of rooms.values()) broadcastClock(room);
}
setInterval(tick, 250);

/* ---------------------- Ruchy ---------------------- */

function applyClientMove(room, color, from, to, promotion) {
  const g = room.game;
  if (room.result) return { error: 'Partia jest zakonczona.' };
  if (!room.started) return { error: 'Oczekiwanie na drugiego gracza.' };
  if (g.turn !== color) return { error: 'To nie Twoja kolej.' };

  const rec = g.move({ from, to, promotion });
  if (!rec) return { error: 'Nielegalny ruch.' };

  // zegar: nalicz czas biezacemu graczowi, dodaj przyrost
  if (room.clock) {
    if (room.clockRunning) {
      const now = Date.now();
      room.clock[color] = Math.max(0, room.clock[color] - (now - room.lastTick));
    }
    room.lastTick = Date.now();
    if (room.tc.increment) room.clock[color] += room.tc.increment;
    room.clockRunning = g.turn;
    room.started = true;
  }

  room.drawOffer = null;
  room.undoRequest = null;

  const over = g.gameOver();
  if (over) {
    endGame(room, over.result, over.reason);
  } else {
    broadcastState(room);
    broadcastClock(room);
  }
  return { ok: true };
}

/* ---------------------- Zapis / odczyt ---------------------- */

function makeSnapshot(room) {
  const g = room.game;
  return {
    version: 1,
    app: 'szachy-online',
    room: room.id,
    startFen: g.startFen,
    moves: g.history.map((h) => ({
      from: h.from,
      to: h.to,
      promotion: h.promotion || null,
    })),
    timeControl: room.tc,
    clock: room.clock,
    result: room.result,
    players: {
      w: playerName(room, 'w'),
      b: playerName(room, 'b'),
    },
    savedAt: new Date().toISOString(),
    pgn: g.pgn(room.result ? room.result.result : '*'),
  };
}

function loadSnapshot(room, data) {
  if (!data || typeof data !== 'object') return 'Nieprawidlowy plik zapisu.';
  const startFen = typeof data.startFen === 'string' ? data.startFen : undefined;
  const moves = Array.isArray(data.moves) ? data.moves : [];

  const g = new Chess();
  try {
    g.reset(startFen || undefined);
  } catch (e) {
    return 'Nieprawidlowy FEN w zapisie.';
  }

  for (let i = 0; i < moves.length; i++) {
    const m = moves[i];
    if (!m || typeof m.from !== 'string' || typeof m.to !== 'string') {
      return `Nieprawidlowy ruch nr ${i + 1} w zapisie.`;
    }
    const rec = g.move({ from: m.from, to: m.to, promotion: m.promotion || undefined });
    if (!rec) return `Ruch nr ${i + 1} (${m.from}-${m.to}) jest nielegalny w tej pozycji.`;
  }

  room.game = g;
  room.result = null;
  room.drawOffer = null;
  room.undoRequest = null;
  room.rematchOffer = null;

  if (data.timeControl && typeof data.timeControl.initial === 'number') {
    room.tc = {
      initial: data.timeControl.initial,
      increment: data.timeControl.increment || 0,
    };
    room.clock =
      data.clock && typeof data.clock.w === 'number'
        ? { w: data.clock.w, b: data.clock.b }
        : { w: room.tc.initial, b: room.tc.initial };
  } else {
    room.tc = null;
    room.clock = null;
  }
  room.clockRunning = null;
  room.lastTick = Date.now();
  room.started = !!(room.seats.w && room.seats.b);
  if (room.started && room.clock && !room.result) {
    room.clockRunning = g.turn;
  }
  return null;
}

/* ---------------------- Obsluga wiadomosci ---------------------- */

function findRoomOf(ws) {
  return ws.roomId ? rooms.get(ws.roomId) || null : null;
}

function detach(ws) {
  const room = findRoomOf(ws);
  if (!room) return;
  const color = ws.color;
  const seat = room.seats[color];
  if (seat && seat.ws === ws) {
    seat.connected = false;
    seat.ws = null;
    broadcastState(room);
    broadcastChat(room, {
      t: 'chat',
      system: true,
      text: `${seat.name} rozlaczyl sie.`,
      time: Date.now(),
    });
  }
  if (!room.seats.w?.connected && !room.seats.b?.connected) {
    clearTimeout(room.cleanupTimer);
    room.cleanupTimer = setTimeout(() => {
      const r = rooms.get(room.id);
      if (r && !r.seats.w?.connected && !r.seats.b?.connected) {
        rooms.delete(r.id);
      }
    }, RECONNECT_TIMEOUT);
  }
  ws.roomId = null;
  ws.color = null;
}

function handleMessage(ws, raw) {
  let msg;
  try {
    msg = JSON.parse(raw);
  } catch {
    return send(ws, { t: 'error', message: 'Bledna wiadomosc.' });
  }

  switch (msg.t) {
    case 'create': {
      detach(ws);
      const tc = normalizeTc(msg.tc);
      const room = createRoom(tc);
      const color = 'w';
      room.seats[color] = {
        ws,
        name: sanitizeName(msg.name),
        clientId: msg.clientId || null,
        connected: true,
      };
      ws.roomId = room.id;
      ws.color = color;
      ws.clientId = msg.clientId || null;
      send(ws, { t: 'joined', room: room.id, color });
      broadcastState(room);
      break;
    }

    case 'join': {
      const room = rooms.get(String(msg.room || '').toUpperCase());
      if (!room) return send(ws, { t: 'error', message: 'Nie ma takiego pokoju.' });
      detach(ws);
      const name = sanitizeName(msg.name);
      const clientId = msg.clientId || null;

      // reconnect na to samo miejsce (tylko gdy miejsce jest wolne)
      let color = null;
      if (clientId) {
        for (const c of ['w', 'b']) {
          const s = room.seats[c];
          if (s && s.clientId && s.clientId === clientId && !s.connected) {
            color = c;
            s.ws = ws;
            s.connected = true;
            s.name = name || s.name;
            break;
          }
        }
      }
      if (!color) {
        color = !room.seats.w ? 'w' : !room.seats.b ? 'b' : null;
        if (!color) return send(ws, { t: 'error', message: 'Pokoj jest pelny.' });
        room.seats[color] = { ws, name, clientId, connected: true };
      }

      ws.roomId = room.id;
      ws.color = color;
      ws.clientId = clientId;
      clearTimeout(room.cleanupTimer);
      room.lastTick = Date.now();

      send(ws, { t: 'joined', room: room.id, color });
      broadcastChat(room, {
        t: 'chat',
        system: true,
        text: `${name} dolaczyl do gry.`,
        time: Date.now(),
      });
      startClockIfReady(room);
      broadcastState(room);
      break;
    }

    case 'move': {
      const room = findRoomOf(ws);
      if (!room || !ws.color) return;
      const res = applyClientMove(room, ws.color, msg.from, msg.to, msg.promotion);
      if (res.error) send(ws, { t: 'error', message: res.error });
      break;
    }

    case 'undo': {
      const room = findRoomOf(ws);
      if (!room || !ws.color || room.result) return;
      const me = ws.color;
      if (msg.action === 'request') {
        if (!room.game.history.length) {
          return send(ws, { t: 'error', message: 'Nie ma czego cofac.' });
        }
        room.undoRequest = me;
        broadcastState(room);
      } else if (msg.action === 'accept') {
        if (room.undoRequest !== otherColor(me)) return;
        // cofaj az wroczy kolej na proszacego
        let guard = 0;
        do {
          room.game.undo();
          guard++;
        } while (room.undoRequest !== room.game.turn && room.game.history.length && guard < 2);
        room.undoRequest = null;
        room.result = null;
        room.clockRunning = room.clock ? room.game.turn : null;
        room.lastTick = Date.now();
        broadcastState(room);
      } else if (msg.action === 'decline') {
        if (room.undoRequest !== otherColor(me)) return;
        room.undoRequest = null;
        broadcastState(room);
      }
      break;
    }

    case 'draw': {
      const room = findRoomOf(ws);
      if (!room || !ws.color) return;
      const me = ws.color;
      if (msg.action === 'offer') {
        if (room.result) return;
        room.drawOffer = me;
        broadcastChat(room, {
          t: 'chat',
          system: true,
          text: `${playerName(room, me)} proponuje remis.`,
          time: Date.now(),
        });
        broadcastState(room);
      } else if (msg.action === 'accept') {
        if (room.drawOffer !== otherColor(me)) return;
        endGame(room, '1/2-1/2', 'agreement', null);
      } else if (msg.action === 'decline') {
        if (room.drawOffer !== otherColor(me)) return;
        room.drawOffer = null;
        broadcastState(room);
      }
      break;
    }

    case 'resign': {
      const room = findRoomOf(ws);
      if (!room || !ws.color || room.result) return;
      const winner = otherColor(ws.color);
      endGame(room, winner === 'w' ? '1-0' : '0-1', 'resign', winner);
      broadcastChat(room, {
        t: 'chat',
        system: true,
        text: `${playerName(room, ws.color)} poddaje partie.`,
        time: Date.now(),
      });
      break;
    }

    case 'rematch': {
      const room = findRoomOf(ws);
      if (!room || !ws.color) return;
      const me = ws.color;
      if (msg.action === 'offer') {
        room.rematchOffer = me;
        broadcastState(room);
      } else if (msg.action === 'accept') {
        if (room.rematchOffer !== otherColor(me)) return;
        startRematch(room);
      } else if (msg.action === 'decline') {
        room.rematchOffer = null;
        broadcastState(room);
      }
      break;
    }

    case 'chat': {
      const room = findRoomOf(ws);
      if (!room || !ws.color) return;
      const text = String(msg.text || '').slice(0, 400).trim();
      if (!text) return;
      broadcastChat(room, {
        t: 'chat',
        from: ws.color,
        name: playerName(room, ws.color),
        text,
        time: Date.now(),
      });
      break;
    }

    case 'save': {
      const room = findRoomOf(ws);
      if (!room) return;
      send(ws, { t: 'saved', data: makeSnapshot(room) });
      break;
    }

    case 'load': {
      const room = findRoomOf(ws);
      if (!room || !ws.color) return;
      const err = loadSnapshot(room, msg.data);
      if (err) return send(ws, { t: 'error', message: err });
      broadcastChat(room, {
        t: 'chat',
        system: true,
        text: `${playerName(room, ws.color)} wczytal zapisana partie.`,
        time: Date.now(),
      });
      const over = room.game.gameOver();
      if (over) {
        endGame(room, over.result, over.reason);
      } else {
        broadcastState(room);
        broadcastClock(room);
      }
      break;
    }

    case 'ping':
      send(ws, { t: 'pong', time: Date.now() });
      break;

    default:
      break;
  }
}

function startRematch(room) {
  // zamien kolory
  const w = room.seats.w;
  const b = room.seats.b;
  room.seats.w = b;
  room.seats.b = w;
  if (room.seats.w && room.seats.w.ws) room.seats.w.ws.color = 'w';
  if (room.seats.b && room.seats.b.ws) room.seats.b.ws.color = 'b';

  room.game = new Chess();
  room.result = null;
  room.drawOffer = null;
  room.undoRequest = null;
  room.rematchOffer = null;
  room.started = false;
  room.lastTick = Date.now();
  if (room.tc) {
    room.clock = { w: room.tc.initial, b: room.tc.initial };
    room.clockRunning = null;
  }
  for (const c of ['w', 'b']) {
    if (room.seats[c] && room.seats[c].ws) room.seats[c].ws.color = c;
  }
  startClockIfReady(room);
  broadcastChat(room, {
    t: 'chat',
    system: true,
    text: 'Nowa partia! Kolory zostaly zamienione.',
    time: Date.now(),
  });
  broadcastState(room);
  broadcastClock(room);
}

function detachOther() {
  /* nieuzywane */
}

/* ---------------------- Narzedzia ---------------------- */

function sanitizeName(name) {
  const n = String(name || '').replace(/[<>&"']/g, '').trim().slice(0, 20);
  return n || 'Gracz';
}

function normalizeTc(tc) {
  if (!tc || tc === 'unlimited' || tc.initial === null) return null;
  const initial = Math.max(10000, Math.min(4 * 60 * 60 * 1000, Number(tc.initial) || 0));
  const increment = Math.max(0, Math.min(60000, Number(tc.increment) || 0));
  if (!initial) return null;
  return { initial, increment };
}

/* ---------------------- WebSocket ---------------------- */

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => (ws.isAlive = true));

  ws.on('message', (raw) => {
    try {
      handleMessage(ws, raw.toString());
    } catch (e) {
      console.error('Blad obslugi wiadomosci:', e);
      send(ws, { t: 'error', message: 'Blad serwera.' });
    }
  });

  ws.on('close', () => detach(ws));
  ws.on('error', () => detach(ws));
});

setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, 30000);

/* ---------------------- Start ---------------------- */

function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const net of list || []) {
      if (net.family === 'IPv4' && !net.internal) out.push(net.address);
    }
  }
  return out;
}

server.listen(PORT, HOST, () => {
  console.log('\n  ♟  Szachy online - serwer uruchomiony\n');
  console.log(`  Port: ${PORT}`);
  if (HOST === '0.0.0.0') {
    console.log(`  Lokalnie:   http://localhost:${PORT}`);
    for (const ip of lanAddresses()) {
      console.log(`  W sieci LAN: http://${ip}:${PORT}`);
    }
    console.log('\n  Aby grac przez internet z dowolnym miejscem, wystaw port np. tak:');
    console.log(`    npx localtunnel --port ${PORT}`);
    console.log(`    lub: cloudflared tunnel --url http://localhost:${PORT}\n`);
  }
});
