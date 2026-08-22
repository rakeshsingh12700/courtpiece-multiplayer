const path = require("path");
const express = require("express");
const { createServer } = require("http");
const { Server } = require("socket.io");
const { Room } = require("./game");

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

// No-cache while we are tuning the UI mid-game, so a plain refresh on
// everyone's phone always picks up the latest build.
app.use(
  express.static(path.join(__dirname, "public"), {
    etag: false,
    maxAge: 0,
    setHeaders: (res) => res.set("Cache-Control", "no-store"),
  })
);

// Hosting platforms ping this to know the instance is up.
app.get("/healthz", (req, res) => res.json({ ok: true, rooms: rooms.size }));

const rooms = new Map(); // code -> Room
const playerRooms = new Map(); // playerId -> code

function randomCode() {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  let code;
  do {
    code = Array.from({ length: 4 }, () => letters[Math.floor(Math.random() * letters.length)]).join("");
  } while (rooms.has(code));
  return code;
}

// A turn auto-plays after this long, so one person putting their phone down
// (or dropping off the wifi) never stalls the whole table.
const TURN_SECONDS = 20;
const BOT_NAMES = ["Bot Tiger", "Bot Fox", "Bot Panda", "Bot Lion", "Bot Falcon", "Bot Otter"];

function broadcastState(room) {
  for (let seat = 0; seat < 4; seat++) {
    const p = room.players[seat];
    if (p && p.connected && p.socketId) {
      const state = room.stateFor(seat);
      state.turnSeconds = TURN_SECONDS;
      state.turnDeadline = room.turnDeadline || null;
      io.to(p.socketId).emit("state", state);
    }
  }
}

function clearTurnTimer(room) {
  if (room._turnTimer) clearTimeout(room._turnTimer);
  room._turnTimer = null;
  room.turnDeadline = null;
}

// A bot "thinks" briefly instead of waiting out the full human turn clock -
// fast enough to test a game solo, slow enough to see what it did.
const BOT_MIN_MS = 700;
const BOT_MAX_MS = 1600;

function seatOnTheSpot(room) {
  return room.phase === "trumpSelect" ? room.trumpCallerSeat : room.turnSeat;
}

// Restart the clock for whoever is now on the spot, then push state.
function armTurn(room) {
  clearTurnTimer(room);
  if (room.phase === "playing" || room.phase === "trumpSelect") {
    const seat = seatOnTheSpot(room);
    const isBot = !!(room.players[seat] && room.players[seat].isBot);
    const delayMs = isBot ? BOT_MIN_MS + Math.random() * (BOT_MAX_MS - BOT_MIN_MS) : TURN_SECONDS * 1000;
    room.turnDeadline = Date.now() + delayMs;
    room._turnTimer = setTimeout(() => autoPlayTurn(room), delayMs);
  }
  broadcastState(room);
}

function autoPlayTurn(room) {
  room._turnTimer = null;

  if (room.phase === "trumpSelect") {
    // Call the suit they hold most of - a reasonable stand-in for a human choice.
    const seat = room.trumpCallerSeat;
    const counts = {};
    for (const card of room.hands[seat] || []) counts[card.suit] = (counts[card.suit] || 0) + 1;
    const suit = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
    if (!suit || !room.chooseTrump(seat, suit)) return;
    io.to(room.code).emit("autoPlayed", { seat, kind: "trump", suit });
    armTurn(room);
    return;
  }

  if (room.phase !== "playing") return;

  const seat = room.turnSeat;
  const legal = room.legalMoves(seat);
  if (!legal.length) return;
  const card = legal[Math.floor(Math.random() * legal.length)];
  const result = room.playCard(seat, card.id);
  if (!result.ok) return;

  io.to(room.code).emit("autoPlayed", { seat, kind: "card", card });
  afterPlay(room, result);
}

// Shared tail for a card being played, whether by a person or by the timer.
function afterPlay(room, result) {
  if (result.trickComplete && !result.roundOver) {
    // Hold the finished trick on screen briefly before the next turn starts.
    clearTurnTimer(room);
    broadcastState(room);
    setTimeout(() => {
      room.lastTrick = null;
      armTurn(room);
    }, 1800);
    return;
  }
  if (result.roundOver) {
    clearTurnTimer(room);
    broadcastState(room);
    return;
  }
  armTurn(room);
}

io.on("connection", (socket) => {
  socket.on("createRoom", ({ playerId, name }, cb) => {
    const code = randomCode();
    const room = new Room(code);
    rooms.set(code, room);
    joinRoomInternal(socket, room, playerId, name, cb);
  });

  socket.on("joinRoom", ({ playerId, name, code }, cb) => {
    const room = rooms.get((code || "").toUpperCase());
    if (!room) return cb && cb({ ok: false, error: "Room not found" });
    joinRoomInternal(socket, room, playerId, name, cb);
  });

  socket.on("addBot", ({ playerId }) => {
    const room = roomOfPlayer(playerId);
    if (!room || room.phase !== "lobby") return;
    const seat = room.addBot(BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)]);
    if (seat !== -1) broadcastState(room);
  });

  socket.on("chooseTrump", ({ playerId, suit }) => {
    const room = roomOfPlayer(playerId);
    if (!room) return;
    const seat = seatOf(room, playerId);
    if (seat === -1) return;
    if (room.chooseTrump(seat, suit)) armTurn(room);
  });

  socket.on("playCard", ({ playerId, cardId }) => {
    const room = roomOfPlayer(playerId);
    if (!room) return;
    const seat = seatOf(room, playerId);
    if (seat === -1) return;
    const result = room.playCard(seat, cardId);
    if (result.ok) {
      afterPlay(room, result);
    } else {
      socket.emit("errorMsg", result.error);
    }
  });

  socket.on("nextRound", ({ playerId }) => {
    const room = roomOfPlayer(playerId);
    if (!room) return;
    if (room.phase !== "roundEnd") return;
    room.nextDealerAndContinue();
    armTurn(room);
  });

  socket.on("startGame", ({ playerId }) => {
    const room = roomOfPlayer(playerId);
    if (!room) return;
    if (room.seatedCount() < 4) return;
    if (room.phase !== "lobby") return;
    room.startRound();
    armTurn(room);
  });

  socket.on("disconnect", () => {
    const playerId = socket.data.playerId;
    if (!playerId) return;
    const room = roomOfPlayer(playerId);
    if (!room) return;
    room.removeBySocketDisconnect(playerId);
    broadcastState(room);
  });
});

function joinRoomInternal(socket, room, playerId, name, cb) {
  const seat = room.addPlayer(playerId, (name || "Player").slice(0, 16));
  if (seat === -1) return cb && cb({ ok: false, error: "Room is full" });
  room.players[seat].socketId = socket.id;
  room.players[seat].connected = true;
  socket.data.playerId = playerId;
  playerRooms.set(playerId, room.code);
  socket.join(room.code);
  cb && cb({ ok: true, code: room.code, seat });
  broadcastState(room);
}

function roomOfPlayer(playerId) {
  const code = playerRooms.get(playerId);
  return code ? rooms.get(code) : null;
}

function seatOf(room, playerId) {
  return room.players.findIndex((p) => p && p.id === playerId);
}

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`Court Piece server running on http://localhost:${PORT}`);
});
