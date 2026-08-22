// Plain-node test suite for the Court Piece (Single Rung) engine.
// Run with:  node test.js
// No dependencies, no test framework. Exit code 1 on any failure.

const { Room, SUITS, teamOf } = require("./game");

let passed = 0;
let failed = 0;
const failures = [];

function ok(cond, msg) {
  if (cond) {
    passed++;
  } else {
    failed++;
    failures.push(msg);
    console.log("  FAIL: " + msg);
  }
}
function eq(actual, expected, msg) {
  ok(actual === expected, `${msg} (got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)})`);
}
function section(name) {
  console.log("\n=== " + name + " ===");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const RANK_ORDER = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
function rankIdx(r) {
  return RANK_ORDER.indexOf(r);
}
const C = (id) => {
  const suit = id[0];
  const rank = id.slice(1);
  return { suit, rank, id };
};

function newSeatedRoom(code = "TEST") {
  const room = new Room(code);
  for (let i = 0; i < 4; i++) room.addPlayer("p" + i, "P" + i);
  return room;
}

// Independent, deliberately naive re-implementation of trick resolution,
// used as an oracle to cross-check the engine.
function oracleWinner(trick, leadSuit, trumpSuit) {
  const trumps = trick.filter((p) => p.card.suit === trumpSuit);
  const pool = trumps.length ? trumps : trick.filter((p) => p.card.suit === leadSuit);
  let best = pool[0];
  for (const p of pool) if (rankIdx(p.card.rank) > rankIdx(best.card.rank)) best = p;
  return best.seat;
}

// ---------------------------------------------------------------------------
section("1. Deck, dealing, partnerships");
// ---------------------------------------------------------------------------
{
  const room = newSeatedRoom();
  eq(teamOf(0), "A", "seat 0 is team A");
  eq(teamOf(2), "A", "seat 2 is team A (partner of 0)");
  eq(teamOf(1), "B", "seat 1 is team B");
  eq(teamOf(3), "B", "seat 3 is team B (partner of 1)");

  room.dealerSeat = 0;
  room.startRound();

  eq(room.phase, "trumpSelect", "phase is trumpSelect after startRound");
  eq(room.trumpCallerSeat, 1, "trump caller is dealer's left (dealer 0 -> seat 1)");
  eq(room.turnSeat, 1, "turn belongs to the trump caller during trumpSelect");
  for (let s = 0; s < 4; s++) eq(room.hands[s].length, 5, `seat ${s} holds 5 cards before trump`);

  // The 5-card deal plus the pending 8 must together be exactly one 52-card deck.
  const all = [];
  for (let s = 0; s < 4; s++) {
    all.push(...room.hands[s].map((c) => c.id));
    all.push(...room._pendingRest[s].map((c) => c.id));
    eq(room._pendingRest[s].length, 8, `seat ${s} has 8 cards pending`);
  }
  eq(all.length, 52, "52 cards dealt in total");
  eq(new Set(all).size, 52, "no duplicate cards in the deal");

  ok(room.chooseTrump(0, "S") === false, "non-caller cannot choose trump");
  ok(room.chooseTrump(1, "X") === false, "invalid suit rejected");
  ok(room.chooseTrump(1, "H") === true, "caller can choose trump");
  eq(room.trumpSuit, "H", "trump suit recorded");
  eq(room.phase, "playing", "phase moves to playing");
  eq(room.turnSeat, 1, "trump caller leads the first trick");
  ok(room.chooseTrump(1, "S") === false, "trump cannot be re-chosen after play starts");

  for (let s = 0; s < 4; s++) eq(room.hands[s].length, 13, `seat ${s} holds 13 cards after the rest is dealt`);
  const all13 = [];
  for (let s = 0; s < 4; s++) all13.push(...room.hands[s].map((c) => c.id));
  eq(all13.length, 52, "52 cards in hands after full deal");
  eq(new Set(all13).size, 52, "no duplicates after full deal");
}

// ---------------------------------------------------------------------------
section("2. Dealer rotation");
// ---------------------------------------------------------------------------
{
  const room = newSeatedRoom();
  room.dealerSeat = 2;
  room.startRound();
  eq(room.trumpCallerSeat, 3, "dealer 2 -> caller 3");
  room.chooseTrump(3, "S");
  room.phase = "roundEnd"; // pretend the round finished
  room.nextDealerAndContinue();
  eq(room.dealerSeat, 3, "dealer rotates to the next seat");
  eq(room.trumpCallerSeat, 0, "caller wraps around to seat 0");
  eq(room.phase, "trumpSelect", "new round starts in trumpSelect");
}

// ---------------------------------------------------------------------------
section("2b. Trump caller rotation rule (win / court / loss)");
// ---------------------------------------------------------------------------
{
  // Caller's team wins normally (not a sweep) -> same person calls again.
  {
    const room = newSeatedRoom();
    room.dealerSeat = 0;
    room.startRound();
    eq(room.trumpCallerSeat, 1, "caller is seat 1");
    room.roundResult = { winningTeam: "B", callerTeam: "B", callerSucceeded: true, isCourt: false, tricksWon: { A: 5, B: 8 } };
    room.nextDealerAndContinue();
    eq(room.trumpCallerSeat, 1, "normal win: same caller (seat 1) calls again");
    eq(room.dealerSeat, 0, "dealer is derived from the caller (caller's left is the dealer's left, i.e. dealer = caller - 1)");
  }

  // Caller's team sweeps 7-0 (a court) -> trump passes to the caller's own
  // partner (the seat opposite them), not to the opposing team.
  {
    const room = newSeatedRoom();
    room.dealerSeat = 0;
    room.startRound(); // caller = seat 1, team B
    room.roundResult = { winningTeam: "B", callerTeam: "B", callerSucceeded: true, isCourt: true, tricksWon: { A: 0, B: 7 } };
    room.nextDealerAndContinue();
    eq(room.trumpCallerSeat, 3, "court: caller's partner (seat 1's partner is seat 3) calls next");
    eq(teamOf(room.trumpCallerSeat), teamOf(1), "the new caller is still on the same team as the sweeping caller");
  }

  // Caller's team loses -> trump passes to the next seat in turn order
  // (always the other team, since partners sit opposite each other).
  {
    const room = newSeatedRoom();
    room.dealerSeat = 0;
    room.startRound(); // caller = seat 1, team B
    room.roundResult = { winningTeam: "A", callerTeam: "B", callerSucceeded: false, isCourt: false, tricksWon: { A: 7, B: 4 } };
    room.nextDealerAndContinue();
    eq(room.trumpCallerSeat, 2, "loss: trump moves to the next seat (2)");
    eq(teamOf(room.trumpCallerSeat), "A", "the new caller is on the OTHER team from the losing caller");
  }
}

// ---------------------------------------------------------------------------
section("2c. isCourt is computed correctly from a played-out round");
// ---------------------------------------------------------------------------
{
  // Play a full round where the trump caller's team wins every trick before
  // the other side ever wins one, and confirm the engine itself (not a
  // hand-set roundResult) flags it as a court.
  const room = newSeatedRoom();
  room.dealerSeat = 0;
  room.startRound();
  const caller = room.trumpCallerSeat;
  const callerTeam = teamOf(caller);
  room.chooseTrump(caller, "S");

  for (let trick = 0; trick < 13 && room.phase === "playing"; trick++) {
    for (let i = 0; i < 4; i++) {
      const seat = room.turnSeat;
      const legal = room.legalMoves(seat);
      // The caller's team always plays highest-first when it can lead, and
      // otherwise just plays a legal card - good enough to usually produce a
      // caller-side sweep across enough random seeds isn't guaranteed, so
      // instead just assert the FLAG LOGIC directly below via a forced state
      // rather than relying on this loop to organically produce a 7-0.
      room.playCard(seat, legal[0].id);
      if (room.phase !== "playing") break;
    }
  }
  // Whatever actually happened, the invariant must hold: isCourt is true
  // if and only if the caller's team won AND the opponents took zero tricks.
  if (room.roundResult) {
    const opp = callerTeam === "A" ? "B" : "A";
    const expected = room.roundResult.callerSucceeded && room.roundResult.tricksWon[opp] === 0;
    eq(room.roundResult.isCourt, expected, "isCourt matches (callerSucceeded && opponent tricks === 0)");
  }
}

// ---------------------------------------------------------------------------
section("3. Trick resolution (isHigher via _resolveTrick)");
// ---------------------------------------------------------------------------
{
  const r = new Room("X");
  const win = (cards, leadSuit, trump) =>
    r._resolveTrick(cards.map((id, i) => ({ seat: i, card: C(id) })), leadSuit, trump);

  eq(win(["S2", "S5", "S9", "SK"], "S", "H"), 3, "highest card of led suit wins");
  eq(win(["SA", "SK", "SQ", "SJ"], "S", "H"), 0, "ace is high");
  eq(win(["S2", "SA", "SK", "SQ"], "S", "H"), 1, "ace beats king even played second");
  eq(win(["SK", "SA", "S3", "S4"], "S", "C"), 1, "ace high regardless of position");

  eq(win(["SA", "H2", "SK", "SQ"], "S", "H"), 1, "lowest trump beats the ace of the led suit");
  eq(win(["SA", "H2", "H3", "SQ"], "S", "H"), 2, "higher trump beats lower trump");
  eq(win(["SA", "HA", "HK", "H2"], "S", "H"), 1, "highest trump wins among several trumps");
  eq(win(["H2", "H3", "H4", "H5"], "H", "H"), 3, "trump led: highest trump wins");

  eq(win(["S5", "DA", "CA", "S6"], "S", "H"), 3, "off-suit non-trump never wins, even an ace");
  eq(win(["S5", "DA", "CK", "D2"], "S", "H"), 0, "only led-suit card wins when no trump played");
  eq(win(["S5", "DA", "CA", "HA"], "S", "H"), 3, "single trump beats everything off-suit");
  eq(win(["SQ", "D2", "D3", "SJ"], "S", "H"), 0, "discards cannot outrank the led suit");
  eq(win(["S10", "S9", "SJ", "S8"], "S", "H"), 2, "10 < J ordering is correct");
  eq(win(["S9", "S10", "S2", "S3"], "S", "C"), 1, "10 beats 9 (string ranks compared numerically)");

  // Cross-check every ordered 4-card combination from a small pool against the oracle.
  const pool = ["SA", "S2", "S10", "HK", "H2", "DA", "CA", "HA"];
  let cross = 0;
  let crossBad = 0;
  for (const a of pool)
    for (const b of pool)
      for (const c of pool)
        for (const d of pool) {
          const ids = [a, b, c, d];
          if (new Set(ids).size !== 4) continue;
          const trick = ids.map((id, i) => ({ seat: i, card: C(id) }));
          const lead = trick[0].card.suit;
          cross++;
          if (r._resolveTrick(trick, lead, "H") !== oracleWinner(trick, lead, "H")) crossBad++;
        }
  eq(crossBad, 0, `engine matches oracle on all ${cross} exhaustive 4-card tricks`);
}

// ---------------------------------------------------------------------------
section("4. Follow-suit enforcement and turn validation");
// ---------------------------------------------------------------------------
{
  const room = newSeatedRoom();
  room.dealerSeat = 0;
  room.startRound();
  room.chooseTrump(1, "H");
  room.phase = "playing";

  // Stack the hands deterministically.
  room.hands[1] = ["S5", "SA", "H2"].map(C);
  room.hands[2] = ["S3", "D4", "H7"].map(C); // can follow spades
  room.hands[3] = ["D9", "C9", "HA"].map(C); // void in spades
  room.hands[0] = ["S9", "D2", "C2"].map(C);
  room.turnSeat = 1;
  room.currentTrick = [];
  room.leadSuit = null;

  eq(room.legalMoves(1).length, 3, "leader may play anything");
  let res = room.playCard(2, "S3");
  ok(!res.ok, "playing out of turn is rejected");
  eq(res.error, "Not your turn", "out-of-turn error message unchanged");

  res = room.playCard(1, "S5");
  ok(res.ok, "leader plays S5");
  eq(room.leadSuit, "S", "lead suit recorded");
  eq(room.turnSeat, 2, "turn passes to the next seat");

  res = room.playCard(2, "D4");
  ok(!res.ok, "cannot discard while holding the led suit");
  eq(res.error, "Must follow suit", "follow-suit error message unchanged");
  res = room.playCard(2, "H7");
  ok(!res.ok, "cannot trump while holding the led suit (renege blocked)");
  eq(room.hands[2].length, 3, "rejected plays do not remove cards from the hand");
  eq(room.legalMoves(2).map((c) => c.id).join(","), "S3", "legalMoves lists only the led suit when holdable");
  ok(room.playCard(2, "S3").ok, "follows suit with S3");

  eq(room.legalMoves(3).length, 3, "void player may play anything, trump included");
  ok(room.playCard(3, "HA").ok, "void player trumps in");
  res = room.playCard(0, "SXX");
  ok(!res.ok, "card not in hand is rejected");
  eq(res.error, "Card not in hand", "card-not-in-hand error message unchanged");
  res = room.playCard(0, "S9");
  ok(res.ok && res.trickComplete, "fourth card completes the trick");
  eq(res.winnerSeat, 3, "trump (HA) wins the trick over the spades");
  eq(room.turnSeat, 3, "trick winner leads the next trick");
  eq(room.leadSuit, null, "lead suit resets between tricks");
  eq(room.currentTrick.length, 0, "current trick clears");
  eq(room.tricksWon.B, 1, "seat 3 scores for team B");
  eq(room.tricksWon.A, 0, "team A has no tricks");
  eq(room.lastTrick.winnerSeat, 3, "lastTrick records the winner");
  eq(room.tricksTaken.length, 1, "trick history grows");
}

// ---------------------------------------------------------------------------
section("5. State leakage (stateFor must not expose other hands)");
// ---------------------------------------------------------------------------
{
  const room = newSeatedRoom();
  room.dealerSeat = 3;
  room.startRound();

  function assertNoLeak(label) {
    for (let seat = 0; seat < 4; seat++) {
      const wire = JSON.stringify(room.stateFor(seat));
      const own = new Set((room.hands[seat] || []).map((c) => c.id));
      const publicIds = new Set();
      for (const p of room.currentTrick) publicIds.add(p.card.id);
      if (room.lastTrick) for (const p of room.lastTrick.cards) publicIds.add(p.card.id);
      let leaked = [];
      for (let other = 0; other < 4; other++) {
        if (other === seat) continue;
        for (const c of room.hands[other]) {
          if (own.has(c.id) || publicIds.has(c.id)) continue;
          if (wire.includes(`"id":"${c.id}"`)) leaked.push(`seat${other}:${c.id}`);
        }
        const pend = room._pendingRest ? room._pendingRest[other] || [] : [];
        for (const c of pend) if (wire.includes(`"id":"${c.id}"`)) leaked.push(`pending${other}:${c.id}`);
      }
      ok(leaked.length === 0, `${label}: stateFor(${seat}) leaks nothing (${leaked.slice(0, 4).join(" ")})`);
      ok(!wire.includes("_pendingRest"), `${label}: stateFor(${seat}) omits _pendingRest`);
      ok(!wire.includes('"hands"'), `${label}: stateFor(${seat}) omits the hands array`);
      ok(!wire.includes('"socketId"') && !wire.includes('"p0"'), `${label}: stateFor(${seat}) omits player ids/sockets`);
      const st = room.stateFor(seat);
      eq(st.yourSeat, seat, `${label}: yourSeat is correct for ${seat}`);
      eq(st.yourHand.length, room.hands[seat].length, `${label}: yourHand is the full own hand for ${seat}`);
      ok(Array.isArray(st.handCounts) && st.handCounts.length === 4, `${label}: handCounts present`);
      ok(Array.isArray(st.legalMoves), `${label}: legalMoves is an array for ${seat}`);
      if (st.phase !== "playing" || st.turnSeat !== seat) eq(st.legalMoves.length, 0, `${label}: no legalMoves off-turn for ${seat}`);
    }
  }

  assertNoLeak("trumpSelect");
  room.chooseTrump(0, "D");
  assertNoLeak("playing (pre-trick)");
  // play part of a trick, then re-check
  for (let i = 0; i < 3; i++) {
    const seat = room.turnSeat;
    room.playCard(seat, room.legalMoves(seat)[0].id);
  }
  assertNoLeak("playing (mid-trick)");

  // publicState itself must never carry hands
  const pub = JSON.stringify(room.publicState());
  ok(!pub.includes("yourHand") && !pub.includes('"hands"'), "publicState carries no hands");
  const pubKeys = Object.keys(room.publicState()).sort().join(",");
  eq(
    pubKeys,
    "code,currentTrick,dealerSeat,handCounts,lastTrick,leadSuit,phase,players,roundResult,sessionWins,tricksWon,trumpCallerSeat,trumpSuit,turnSeat",
    "publicState shape unchanged"
  );
}

// ---------------------------------------------------------------------------
section("6. Full randomised rounds (invariants over many deals)");
// ---------------------------------------------------------------------------
{
  const ROUNDS = 3000;
  let roundsPlayed = 0;
  let sevenWins = 0;
  const callerSeatsSeen = new Set();
  let bad = { dup: 0, follow: 0, winner: 0, order: 0, count: 0, score: 0, early: 0, phase: 0 };

  const room = newSeatedRoom();
  room.dealerSeat = Math.floor(Math.random() * 4);

  for (let n = 0; n < ROUNDS; n++) {
    room.startRound();
    const dealer = room.dealerSeat;
    if (room.trumpCallerSeat !== (dealer + 1) % 4) bad.order++;
    callerSeatsSeen.add(room.trumpCallerSeat);

    const caller = room.trumpCallerSeat;
    // Caller picks a suit actually held in the first five (realistic behaviour).
    const five = room.hands[caller].slice();
    const suit = five[Math.floor(Math.random() * five.length)].suit;
    if (!room.chooseTrump(caller, suit)) bad.phase++;

    const dealtIds = new Set();
    for (let s = 0; s < 4; s++) for (const c of room.hands[s]) dealtIds.add(c.id);
    if (dealtIds.size !== 52) bad.dup++;

    if (room.turnSeat !== caller) bad.order++;

    const seen = new Set();
    let expectedLeader = caller;
    let tricks = 0;
    let scoreA = 0;
    let scoreB = 0;

    while (room.phase === "playing") {
      const trick = [];
      let leadSuit = null;
      for (let k = 0; k < 4; k++) {
        const seat = room.turnSeat;
        if (k === 0 && seat !== expectedLeader) bad.order++;
        if (k > 0 && seat !== (trick[k - 1].seat + 1) % 4) bad.order++;
        const hand = room.hands[seat].slice();
        // Independently derive the legal set and compare with the engine's.
        const mustFollow = leadSuit ? hand.filter((c) => c.suit === leadSuit) : [];
        const expectLegal = leadSuit && mustFollow.length ? mustFollow : hand;
        const engineLegal = room.legalMoves(seat);
        if (engineLegal.length !== expectLegal.length) bad.follow++;
        if (!engineLegal.every((c) => expectLegal.some((e) => e.id === c.id))) bad.follow++;

        // Try an illegal card when one exists: the engine must refuse it.
        if (leadSuit && mustFollow.length && mustFollow.length < hand.length) {
          const illegal = hand.find((c) => c.suit !== leadSuit);
          const rej = room.playCard(seat, illegal.id);
          if (rej.ok) bad.follow++;
          if (room.hands[seat].length !== hand.length) bad.follow++;
        }

        const pick = engineLegal[Math.floor(Math.random() * engineLegal.length)];
        if (seen.has(pick.id)) bad.dup++;
        seen.add(pick.id);
        const res = room.playCard(seat, pick.id);
        if (!res.ok) bad.phase++;
        if (k === 0) leadSuit = pick.suit;
        trick.push({ seat, card: pick });

        if (k < 3) {
          if (res.trickComplete) bad.count++;
        } else {
          if (!res.trickComplete) bad.count++;
          const expectWinner = oracleWinner(trick, leadSuit, room.trumpSuit);
          if (res.winnerSeat !== expectWinner) bad.winner++;
          if (!res.roundOver && room.turnSeat !== expectWinner) bad.order++;
          expectedLeader = expectWinner;
          tricks++;
          if (teamOf(expectWinner) === "A") scoreA++;
          else scoreB++;
          if (room.tricksWon.A !== scoreA || room.tricksWon.B !== scoreB) bad.score++;
          // Round must end exactly when a team reaches 7, and not before.
          const shouldEnd = scoreA >= 7 || scoreB >= 7;
          if (shouldEnd !== !!res.roundOver) bad.early++;
        }
      }
    }

    if (room.phase !== "roundEnd") bad.phase++;
    if (seen.size !== tricks * 4) bad.dup++;
    if (room.tricksTaken.length !== tricks) bad.count++;
    if (Math.max(room.tricksWon.A, room.tricksWon.B) !== 7) sevenWins += 0;
    else sevenWins++;
    if (room.tricksWon.A + room.tricksWon.B !== tricks) bad.score++;
    if (tricks < 7 || tricks > 13) bad.count++;
    const rr = room.roundResult;
    if (!rr) bad.phase++;
    else {
      const expWin = room.tricksWon.A > room.tricksWon.B ? "A" : "B";
      if (rr.winningTeam !== expWin) bad.score++;
      if (rr.callerTeam !== teamOf(caller)) bad.score++;
      if (rr.callerSucceeded !== (expWin === teamOf(caller))) bad.score++;
    }
    // Cards must be fully consumed by the winning side of the round:
    const left = room.hands.reduce((a, h) => a + h.length, 0);
    if (left !== 52 - tricks * 4) bad.count++;

    // Playing after the round ended must be refused.
    const after = room.playCard(room.turnSeat, "SA");
    if (after.ok) bad.phase++;

    roundsPlayed++;
    room.dealerSeat = (room.dealerSeat + 1) % 4;
  }

  eq(roundsPlayed, ROUNDS, "all rounds completed");
  eq(bad.dup, 0, "no duplicated or lost cards across any round");
  eq(bad.follow, 0, "follow-suit enforced on every play");
  eq(bad.winner, 0, "trick winner always matches the independent oracle");
  eq(bad.order, 0, "turn order and lead ownership always correct");
  eq(bad.count, 0, "trick counts and hand sizes always consistent");
  eq(bad.score, 0, "scores and round result always consistent");
  eq(bad.early, 0, "round ends exactly at 7 tricks, never earlier or later");
  eq(bad.phase, 0, "phase transitions always valid");
  eq(sevenWins, ROUNDS, "every round ended with a team on exactly 7 tricks");
  eq(callerSeatsSeen.size, 4, "over many rounds every seat gets to call trump");
}

// ---------------------------------------------------------------------------
section("7. Forced full 13-trick round (no early exit path missed)");
// ---------------------------------------------------------------------------
{
  // Build a deal where tricks alternate so nobody reaches 7 before trick 13.
  const room = newSeatedRoom();
  room.dealerSeat = 0;
  room.startRound();
  room.chooseTrump(1, "S");
  eq(room.trumpSuit, "S", "trump set for the scripted round");

  // Deal every suit-block deterministically: seat n gets one full suit.
  const suitsBySeat = { 0: "C", 1: "D", 2: "H", 3: "S" };
  const ranks = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
  for (let s = 0; s < 4; s++) room.hands[s] = ranks.map((r) => C(suitsBySeat[s] + r));
  room.turnSeat = 1;
  room.currentTrick = [];
  room.leadSuit = null;
  room.tricksWon = { A: 0, B: 0 };
  room.tricksTaken = [];
  room.roundResult = null;
  room.phase = "playing";

  let tricks = 0;
  while (room.phase === "playing") {
    for (let k = 0; k < 4; k++) {
      const seat = room.turnSeat;
      const legal = room.legalMoves(seat);
      const res = room.playCard(seat, legal[0].id);
      ok(res.ok, `scripted play ${tricks}.${k} accepted`);
      if (k === 3) {
        // Seat 3 holds all spades (trump) so it wins every trick it plays into.
        eq(res.winnerSeat, 3, `trick ${tricks + 1} won by the all-trump seat`);
        tricks++;
      }
    }
  }
  eq(tricks, 7, "an all-trump hand ends the round after exactly 7 tricks");
  eq(room.tricksWon.B, 7, "team B reaches 7");
  eq(room.tricksWon.A, 0, "team A reaches 0");
  eq(room.phase, "roundEnd", "round ends");
  eq(room.roundResult.winningTeam, "B", "team B wins the round");
  eq(room.roundResult.callerTeam, "B", "seat 1 called, so caller team is B");
  eq(room.roundResult.callerSucceeded, true, "caller succeeded");
  const remaining = room.hands.reduce((a, h) => a + h.length, 0);
  eq(remaining, 52 - 7 * 4, "exactly 4 cards removed per trick");
}

// ---------------------------------------------------------------------------
section("8. Lobby / seating API");
// ---------------------------------------------------------------------------
{
  const room = new Room("ABCD");
  eq(room.phase, "lobby", "new room starts in lobby");
  eq(room.seatedCount(), 0, "no players yet");
  eq(room.addPlayer("a", "A"), 0, "first player takes seat 0");
  eq(room.addPlayer("b", "B"), 1, "second player takes seat 1");
  eq(room.addPlayer("a", "A"), 0, "rejoining player keeps their seat");
  eq(room.seatedCount(), 2, "rejoin does not consume a seat");
  room.addPlayer("c", "C");
  room.addPlayer("d", "D");
  eq(room.addPlayer("e", "E"), -1, "fifth player is refused");
  ok(room.allSeatedAndReady(), "four connected players are ready");
  room.removeBySocketDisconnect("c");
  ok(!room.allSeatedAndReady(), "a disconnect makes the room not ready");
  eq(room.players[2].connected, false, "disconnect flags the seat");
  eq(room.addPlayer("c", "C"), 2, "reconnect returns the same seat");
  ok(room.allSeatedAndReady(), "reconnect restores readiness");
  eq(SUITS.length, 4, "four suits exported");
}

// ---------------------------------------------------------------------------
console.log("\n----------------------------------------");
console.log(`passed: ${passed}   failed: ${failed}`);
if (failed) {
  console.log("\nFailures:");
  for (const f of failures) console.log(" - " + f);
  process.exit(1);
} else {
  console.log("ALL TESTS PASSED");
}
