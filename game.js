// Court Piece (Rung) - Single Rung mode - core game engine.
// 4 players, fixed partnerships: seats 0 & 2 vs seats 1 & 3.
// Dealer deals 5 cards first; the trump caller picks a suit; remaining 8 cards
// are dealt; then 13 tricks are played. First team to 7 tricks wins the round.

const SUITS = ["S", "H", "D", "C"];
const SUIT_NAMES = { S: "Spades", H: "Hearts", D: "Diamonds", C: "Clubs" };
const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
const RANK_VALUE = Object.fromEntries(RANKS.map((r, i) => [r, i]));

function svgSymbolId(card) {
  const suitName = { S: "spade", H: "heart", D: "diamond", C: "club" }[card.suit];
  const rankPart = { A: "1", J: "jack", Q: "queen", K: "king" }[card.rank] || card.rank;
  return `${suitName}_${rankPart}`;
}

function makeDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ suit, rank, id: `${suit}${rank}` });
    }
  }
  return deck;
}

function shuffle(deck) {
  const d = deck.slice();
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

function teamOf(seat) {
  return seat % 2 === 0 ? "A" : "B";
}

class Room {
  constructor(code) {
    this.code = code;
    this.players = [null, null, null, null]; // {id, name, socketId, connected}
    this.phase = "lobby"; // lobby | trumpSelect | playing | roundEnd
    this.dealerSeat = 0;
    this.hands = [[], [], [], []];
    this.trumpSuit = null;
    this.trumpCallerSeat = null;
    this.currentTrick = []; // [{seat, card}]
    this.leadSuit = null;
    this.turnSeat = null;
    this.tricksWon = { A: 0, B: 0 };
    this.tricksTaken = []; // history: {winnerSeat, cards:[{seat,card}]}
    this.lastTrick = null;
    this.roundResult = null;
    // Rounds won across the whole session (not reset by startRound), so the
    // family can see who's ahead over the course of the night.
    this.sessionWins = { A: 0, B: 0 };
  }

  seatedCount() {
    return this.players.filter(Boolean).length;
  }

  addPlayer(id, name) {
    // rejoin?
    const existing = this.players.findIndex((p) => p && p.id === id);
    if (existing !== -1) {
      // Same player coming back (refresh / dropped phone): keep their seat and
      // hand, and mark them live again so the room is not stuck "waiting".
      this.players[existing].connected = true;
      if (name) this.players[existing].name = name;
      return existing;
    }
    const seat = this.players.findIndex((p) => p === null);
    if (seat === -1) return -1;
    this.players[seat] = { id, name, connected: true };
    return seat;
  }

  // Fills one empty seat with a bot so the table can be tested, or a real
  // game can start, without all 4 humans present. A bot is just a player
  // with no socket - the server's own auto-play timer moves for it.
  addBot(name) {
    const seat = this.players.findIndex((p) => p === null);
    if (seat === -1) return -1;
    const id = "bot_" + seat + "_" + Math.random().toString(36).slice(2, 8);
    this.players[seat] = { id, name, connected: true, isBot: true };
    return seat;
  }

  removeBySocketDisconnect(id) {
    const seat = this.players.findIndex((p) => p && p.id === id);
    if (seat !== -1) this.players[seat].connected = false;
  }

  allSeatedAndReady() {
    return this.players.every((p) => p && p.connected);
  }

  // callerSeat picks who calls trump this round. Omit it only for the very
  // first round of a room's life, where there is no previous result to base
  // it on - it then defaults to the seat left of the dealer, same as before.
  startRound(callerSeat) {
    const caller = typeof callerSeat === "number" ? callerSeat : (this.dealerSeat + 1) % 4;
    // The caller sits to the dealer's left, same relationship as always -
    // dealing order and "whose turn after trump is chosen" both key off this.
    this.dealerSeat = (caller + 3) % 4;

    const deck = shuffle(makeDeck());
    this.hands = [[], [], [], []];
    for (let i = 0; i < 4; i++) {
      const seat = (caller + i) % 4;
      this.hands[seat] = deck.slice(i * 13, i * 13 + 5);
    }
    this._pendingRest = {};
    for (let i = 0; i < 4; i++) {
      const seat = (caller + i) % 4;
      this._pendingRest[seat] = deck.slice(i * 13 + 5, i * 13 + 13);
    }
    this.trumpSuit = null;
    this.trumpCallerSeat = caller;
    this.currentTrick = [];
    this.leadSuit = null;
    this.tricksWon = { A: 0, B: 0 };
    this.tricksTaken = [];
    this.lastTrick = null;
    this.roundResult = null;
    this.phase = "trumpSelect";
    this.turnSeat = this.trumpCallerSeat;
    for (const seat of Object.keys(this.hands)) {
      this.hands[seat].sort(sortHand);
    }
  }

  chooseTrump(seat, suit) {
    if (this.phase !== "trumpSelect" || seat !== this.trumpCallerSeat) return false;
    if (!SUITS.includes(suit)) return false;
    this.trumpSuit = suit;
    for (let i = 0; i < 4; i++) {
      this.hands[i] = this.hands[i].concat(this._pendingRest[i]).sort(sortHand);
    }
    this._pendingRest = null;
    this.phase = "playing";
    this.turnSeat = (this.dealerSeat + 1) % 4;
    return true;
  }

  legalMoves(seat) {
    const hand = this.hands[seat];
    if (!this.leadSuit) return hand;
    const followers = hand.filter((c) => c.suit === this.leadSuit);
    return followers.length > 0 ? followers : hand;
  }

  playCard(seat, cardId) {
    if (this.phase !== "playing" || seat !== this.turnSeat) return { ok: false, error: "Not your turn" };
    const hand = this.hands[seat];
    const idx = hand.findIndex((c) => c.id === cardId);
    if (idx === -1) return { ok: false, error: "Card not in hand" };
    const card = hand[idx];
    const legal = this.legalMoves(seat);
    if (!legal.some((c) => c.id === cardId)) return { ok: false, error: "Must follow suit" };

    hand.splice(idx, 1);
    this.currentTrick.push({ seat, card });
    if (!this.leadSuit) this.leadSuit = card.suit;

    if (this.currentTrick.length < 4) {
      this.turnSeat = (seat + 1) % 4;
      return { ok: true, trickComplete: false };
    }

    // trick complete
    const winnerSeat = this._resolveTrick(this.currentTrick, this.leadSuit, this.trumpSuit);
    const team = teamOf(winnerSeat);
    this.tricksWon[team]++;
    this.lastTrick = { cards: this.currentTrick, winnerSeat };
    this.tricksTaken.push(this.lastTrick);
    this.currentTrick = [];
    this.leadSuit = null;
    this.turnSeat = winnerSeat;

    const totalPlayed = this.tricksTaken.length;
    let roundOver = false;
    if (this.tricksWon.A >= 7 || this.tricksWon.B >= 7 || totalPlayed === 13) {
      roundOver = true;
      const winningTeam = this.tricksWon.A > this.tricksWon.B ? "A" : this.tricksWon.B > this.tricksWon.A ? "B" : null;
      const callerTeam = teamOf(this.trumpCallerSeat);
      const callerSucceeded = winningTeam === callerTeam;
      // A "court" is the caller's team winning without their opponents
      // taking a single trick - the round can only end this early (before
      // all 13 are played) once one side reaches 7, so the opponents being
      // held to 0 at that moment is the sweep condition, not literally 13-0.
      const opponentTeam = callerTeam === "A" ? "B" : "A";
      const isCourt = callerSucceeded && this.tricksWon[opponentTeam] === 0;
      if (winningTeam) this.sessionWins[winningTeam]++;
      this.roundResult = {
        winningTeam,
        callerTeam,
        callerSucceeded,
        isCourt,
        tricksWon: { ...this.tricksWon },
      };
      this.phase = "roundEnd";
    }

    return { ok: true, trickComplete: true, winnerSeat, roundOver };
  }

  _resolveTrick(trick, leadSuit, trumpSuit) {
    let best = trick[0];
    for (const play of trick.slice(1)) {
      if (isHigher(play.card, best.card, leadSuit, trumpSuit)) best = play;
    }
    return best.seat;
  }

  // Who calls trump next round depends on how this one ended:
  //  - caller's team won outright (a "court", sweeping the opponents 7-0) ->
  //    trump passes to the caller's own PARTNER, as a reward for the sweep.
  //  - caller's team won normally -> the same person calls again.
  //  - caller's team lost -> trump passes to the next seat in turn order,
  //    which (with partners seated opposite each other) is always someone
  //    on the OTHER team.
  nextDealerAndContinue() {
    const prev = this.roundResult;
    const caller = this.trumpCallerSeat;
    let nextCaller;
    if (prev && prev.callerSucceeded) {
      nextCaller = prev.isCourt ? (caller + 2) % 4 : caller;
    } else {
      nextCaller = (caller + 1) % 4;
    }
    this.startRound(nextCaller);
  }

  publicState() {
    return {
      code: this.code,
      players: this.players.map((p) => (p ? { name: p.name, connected: p.connected } : null)),
      phase: this.phase,
      dealerSeat: this.dealerSeat,
      trumpSuit: this.trumpSuit,
      trumpCallerSeat: this.trumpCallerSeat,
      currentTrick: this.currentTrick,
      leadSuit: this.leadSuit,
      turnSeat: this.turnSeat,
      tricksWon: this.tricksWon,
      sessionWins: this.sessionWins,
      handCounts: this.hands.map((h) => h.length),
      lastTrick: this.lastTrick,
      roundResult: this.roundResult,
    };
  }

  stateFor(seat) {
    const base = this.publicState();
    base.yourSeat = seat;
    base.yourHand = this.hands[seat] || [];
    base.legalMoves = this.phase === "playing" && this.turnSeat === seat ? this.legalMoves(seat).map((c) => c.id) : [];
    return base;
  }
}

function isHigher(cardA, cardB, leadSuit, trumpSuit) {
  const aTrump = cardA.suit === trumpSuit;
  const bTrump = cardB.suit === trumpSuit;
  if (aTrump && !bTrump) return true;
  if (!aTrump && bTrump) return false;
  if (aTrump && bTrump) return RANK_VALUE[cardA.rank] > RANK_VALUE[cardB.rank];
  // neither is trump
  if (cardA.suit === leadSuit && cardB.suit !== leadSuit) return true;
  if (cardA.suit !== leadSuit && cardB.suit === leadSuit) return false;
  if (cardA.suit === cardB.suit) return RANK_VALUE[cardA.rank] > RANK_VALUE[cardB.rank];
  return false;
}

function sortHand(a, b) {
  const suitOrder = { S: 0, H: 1, C: 2, D: 3 };
  if (a.suit !== b.suit) return suitOrder[a.suit] - suitOrder[b.suit];
  return RANK_VALUE[a.rank] - RANK_VALUE[b.rank];
}

module.exports = { Room, SUITS, SUIT_NAMES, svgSymbolId, teamOf };
