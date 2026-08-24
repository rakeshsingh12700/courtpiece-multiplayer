const path = require("path");
const express = require("express");
const { createServer } = require("http");
const { Server } = require("socket.io");
const { Room, isHigher, teamOf, RANK_VALUE } = require("./game");

const app = express();
const httpServer = createServer(app);
// No origin restriction: this is a public, room-code-based game with no
// cookies or per-origin auth to protect, so there's nothing CORS is
// actually guarding here - and Socket.IO defaults to rejecting cross-origin
// requests outright, which silently breaks its own HTTP-polling transport
// (a plain XMLHttpRequest, fully subject to CORS) for any client not
// served from this exact origin. That forced the Flutter app onto
// WebSocket-only, which has no CORS requirement but is also less tolerant
// of real mobile-network hiccups than polling-with-upgrade is - a
// WebSocket a flaky connection drops outright is often a request plain
// polling would have simply retried.
const io = new Server(httpServer, { cors: { origin: true } });

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

// Temporary local-only route so the debug APK can be downloaded straight
// from a phone browser (dist-apk/ is gitignored - never deployed to Render).
app.use("/download", express.static(path.join(__dirname, "dist-apk")));

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
const TURN_SECONDS = 25;
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

// Who's currently winning the trick so far, using the same comparison the
// engine itself uses to resolve a finished trick.
function currentTrickBest(room) {
  if (!room.currentTrick.length) return null;
  let best = room.currentTrick[0];
  for (const play of room.currentTrick.slice(1)) {
    if (isHigher(play.card, best.card, room.leadSuit, room.trumpSuit)) best = play;
  }
  return best;
}

// A small set of ordinary trick-taking rules - no lookahead, no memory of
// past tricks, nothing resembling ML. This alone reads as "a person who
// knows the basics" rather than "picks a random legal card", which is the
// entire gap between a bot that's obviously a bot and one that isn't:
//   - Leading: an ace of a plain (non-trump) suit is close to a free trick.
//     Otherwise lead low from your longest suit - keeps strength in hand
//     and probes for a suit an opponent is short in.
//   - Following, partner already winning: no need to spend anything good -
//     play your lowest legal card.
//   - Following, an opponent winning: win as cheaply as possible if you
//     can beat them at all (never more card than the trick needs, which is
//     what keeps this from burning trump it doesn't have to); otherwise
//     duck with your lowest card rather than wasting a good one.
//
// On top of the "correct" move above, two deliberate probabilities make it
// feel like an ordinary player instead of a solved calculator: a real
// player doesn't cash an ace the instant they get the chance every single
// time, and doesn't always take a trick just because they technically can -
// sometimes they hold back. Both stay mild (70/30, 85/15) so the bot reads
// as a good-but-human player, not an obviously bad one.
function chooseSmartCard(room, seat) {
  const legal = room.legalMoves(seat);
  if (legal.length <= 1) return legal[0];
  const trump = room.trumpSuit;
  const byRankAsc = (a, b) => RANK_VALUE[a.rank] - RANK_VALUE[b.rank];

  if (!room.currentTrick.length) {
    const bySuit = {};
    for (const c of legal) (bySuit[c.suit] = bySuit[c.suit] || []).push(c);
    const nonTrumpSuits = Object.keys(bySuit).filter((s) => s !== trump);
    const suits = nonTrumpSuits.length ? nonTrumpSuits : Object.keys(bySuit);
    suits.sort((a, b) => bySuit[b].length - bySuit[a].length);
    const lowFromLength = bySuit[suits[0]].slice().sort(byRankAsc)[0];

    const aceLead = legal.find((c) => c.rank === "A" && c.suit !== trump);
    if (aceLead) return Math.random() < 0.7 ? aceLead : lowFromLength;
    return lowFromLength;
  }

  const best = currentTrickBest(room);
  const sorted = legal.slice().sort(byRankAsc);
  if (best && teamOf(best.seat) === teamOf(seat)) return sorted[0];

  const winners = best ? sorted.filter((c) => isHigher(c, best.card, room.leadSuit, room.trumpSuit)) : sorted;
  if (!winners.length) return sorted[0];
  return Math.random() < 0.85 ? winners[0] : sorted[0];
}

// How many turns in a row a human seat has been auto-played because they
// didn't respond in time. Bolted onto the room the same way _turnTimer and
// turnDeadline already are (server-only bookkeeping, not core game state).
function missStreak(room) {
  if (!room.missStreak) room.missStreak = [0, 0, 0, 0];
  return room.missStreak;
}

const MISSES_BEFORE_AUTOBOT = 3;

// welcomeBack fires from chooseTrump/playCard, which only ever run from a
// real connected client's socket event - a bot's own moves are driven
// straight from autoPlayTurn, never through here - so reaching this always
// means the person is genuinely present again. Reset their miss streak and
// un-bench them if they'd been benched.
function welcomeBack(room, seat) {
  missStreak(room)[seat] = 0;
  if (room.players[seat] && room.players[seat].isBot) {
    room.players[seat].isBot = false;
  }
}

// A human who's stepped away and missed 3 turns in a row gets converted to
// a bot seat - fast (0.7-1.6s) smart-AI turns instead of the slow 25s human
// timeout, so the table isn't stuck waiting on someone who isn't there. A
// genuine manual play from that seat immediately reverts it via welcomeBack
// above - this is a pause, not a kick.
function recordMiss(room, seat) {
  if (room.players[seat] && room.players[seat].isBot) return; // already benched
  const streak = missStreak(room);
  streak[seat] = (streak[seat] || 0) + 1;
  if (streak[seat] >= MISSES_BEFORE_AUTOBOT && room.players[seat]) {
    room.players[seat].isBot = true;
    streak[seat] = 0;
    io.to(room.code).emit("autoPlayed", { seat, kind: "benched" });
  }
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
    recordMiss(room, seat);
    io.to(room.code).emit("autoPlayed", { seat, kind: "trump", suit });
    armTurn(room);
    return;
  }

  if (room.phase !== "playing") return;

  const seat = room.turnSeat;
  const card = chooseSmartCard(room, seat);
  if (!card) return;
  const result = room.playCard(seat, card.id);
  if (!result.ok) return;

  recordMiss(room, seat);
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
  // A trivial round-trip the client can use to detect a dead/zombie
  // connection fast (seconds, not the ~30s it'd take waiting for a game
  // update) - deliberately has nothing to do with rooms or turns, so it
  // never gets confused with "the other player is just thinking".
  socket.on("ping", (cb) => { if (cb) cb(); });

  socket.on("createRoom", ({ playerId, name, icon }, cb) => {
    const code = randomCode();
    const room = new Room(code);
    rooms.set(code, room);
    joinRoomInternal(socket, room, playerId, name, icon, cb);
  });

  socket.on("joinRoom", ({ playerId, name, icon, code }, cb) => {
    const room = rooms.get((code || "").toUpperCase());
    if (!room) return cb && cb({ ok: false, error: "Room not found" });
    joinRoomInternal(socket, room, playerId, name, icon, cb);
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
    if (room.chooseTrump(seat, suit)) {
      welcomeBack(room, seat);
      armTurn(room);
    }
  });

  socket.on("playCard", ({ playerId, cardId }) => {
    const room = roomOfPlayer(playerId);
    if (!room) return;
    const seat = seatOf(room, playerId);
    if (seat === -1) return;
    const result = room.playCard(seat, cardId);
    if (result.ok) {
      welcomeBack(room, seat);
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
    // The very first round of a fresh table has no previous result to base
    // the trump caller on, so it was defaulting to dealerSeat(0)+1 = seat 1
    // every single time - always a bot (whoever filled seat 1), never
    // whichever human happened to create the room. Randomize the dealer so
    // every seat has a genuine equal chance to call trump first.
    room.dealerSeat = Math.floor(Math.random() * 4);
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

function joinRoomInternal(socket, room, playerId, name, icon, cb) {
  const safeIcon = typeof icon === "string" ? icon.slice(0, 8) : null;
  const seat = room.addPlayer(playerId, (name || "Player").slice(0, 16), safeIcon);
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
