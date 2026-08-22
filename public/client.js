(function () {
  const SUIT_SYMBOL = { S: "♠", H: "♥", D: "♦", C: "♣" };
  const SUIT_NAME = { S: "Spades", H: "Hearts", D: "Diamonds", C: "Clubs" };
  const RED_SUITS = { H: true, D: true };
  // Bridge-size deck (RevK, CC0) drawn with large top-only indices.
  // The deck's own viewBox is centre-origin; each <symbol> carries that, so the
  // outer <svg> just needs a plain 212x329 viewport for the symbol to map into.
  // (Reusing the centre-origin box here puts the artwork half a card off.)
  const CARD_VIEWBOX = "0 0 212 329";
  const ASPECT = 329 / 212; // card height / card width

  // One distinct character per SEAT INDEX, so every phone shows the same
  // animal for the same person. Players who cannot read still know who is who.
  const SEAT_AVATARS = ["🐯", "🦊", "🐼", "🦁"];
  function avatarFor(seat) {
    const i = ((Number(seat) % 4) + 4) % 4;
    return SEAT_AVATARS[i] || "🙂";
  }

  function svgSymbolId(card) {
    return "c" + card.suit + card.rank;
  }

  function byId(id) {
    return document.getElementById(id);
  }
  function setText(id, txt) {
    const el = byId(id);
    if (el) el.textContent = txt;
  }
  function measuredH(id, fallback) {
    const el = byId(id);
    const h = el ? el.offsetHeight : 0;
    return h > 4 ? h : fallback;
  }

  function getPlayerId() {
    let id = null;
    try { id = localStorage.getItem("cp_playerId"); } catch (e) { /* private mode */ }
    if (!id) {
      id = "p_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
      try { localStorage.setItem("cp_playerId", id); } catch (e) { /* ignore */ }
    }
    return id;
  }

  const playerId = getPlayerId();
  const socket = io();

  // load sprite sheet into hidden container so <use> works locally (avoids
  // cross-file <use> issues on mobile Safari)
  fetch("assets/cards.svg")
    .then((r) => r.text())
    .then((text) => {
      const container = byId("cardDefs");
      if (!container) return;
      container.innerHTML = text;
      const svg = container.querySelector("svg");
      if (svg) {
        svg.setAttribute("width", "0");
        svg.setAttribute("height", "0");
      }
    })
    .catch(() => { /* cards still show white + the printed corner index */ });

  function cardEl(card) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", CARD_VIEWBOX);
    svg.setAttribute("preserveAspectRatio", "none");
    svg.classList.add("card");
    const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttribute("href", "#" + svgSymbolId(card));
    svg.appendChild(use);
    return svg;
  }

  // The deck is drawn with an oversized top-left index of its own, so no badge
  // is painted over the artwork any more.
  function cardTile(card, className) {
    const tile = document.createElement("div");
    tile.className = "card-tile" + (className ? " " + className : "");
    tile.dataset.cardId = card.id;
    tile.appendChild(cardEl(card));
    return tile;
  }

  // ---------- Screens ----------
  const screens = {
    home: byId("screen-home"),
    waiting: byId("screen-waiting"),
    game: byId("screen-game"),
  };
  function showScreen(name) {
    Object.values(screens).forEach((s) => s && s.classList.add("hidden"));
    if (screens[name]) screens[name].classList.remove("hidden");
    if (name !== "game") document.body.classList.remove("my-turn");
  }

  const nameInput = byId("nameInput");
  const codeInput = byId("codeInput");
  const homeError = byId("homeError");

  // Nobody should have to fill in a form to play. A name is picked for you and
  // only shown so you can change it if you care.
  const AUTO_NAMES = [
    "Tiger", "Fox", "Panda", "Lion", "Falcon", "Otter", "Heron", "Bison",
    "Koel", "Mynah", "Peacock", "Sparrow",
  ];
  function autoName() {
    return AUTO_NAMES[Math.floor(Math.random() * AUTO_NAMES.length)] + " " + (1 + Math.floor(Math.random() * 99));
  }
  function storedName() {
    try { return localStorage.getItem("cp_name") || ""; } catch (e) { return ""; }
  }
  function rememberName(name) {
    try { localStorage.setItem("cp_name", name); } catch (e) { /* ignore */ }
  }
  // Whatever is typed, else whatever was used last time, else a fresh auto name.
  function resolveName() {
    const typed = ((nameInput && nameInput.value) || "").trim();
    const name = typed || storedName() || autoName();
    rememberName(name);
    setText("nameEcho", name);
    return name;
  }

  if (nameInput) {
    const saved = storedName();
    if (saved) nameInput.value = saved;
    nameInput.addEventListener("input", () => {
      const v = nameInput.value.trim();
      setText("nameEcho", v || storedName() || "…");
    });
  }
  setText("nameEcho", storedName() || autoName());

  byId("createBtn").addEventListener("click", () => {
    socket.emit("createRoom", { playerId, name: resolveName() }, handleJoinResult);
  });

  function doJoin(code) {
    if (!code) {
      homeError.textContent = "Enter the 4-letter code your friend sent you";
      if (codeInput) codeInput.focus();
      return;
    }
    homeError.textContent = "Joining…";
    socket.emit("joinRoom", { playerId, name: resolveName(), code }, handleJoinResult);
  }

  byId("joinBtn").addEventListener("click", () => {
    doJoin(((codeInput && codeInput.value) || "").trim().toUpperCase());
  });
  if (codeInput) {
    // Typing the 4th letter is intent enough - no need to hunt for the button.
    codeInput.addEventListener("input", () => {
      codeInput.value = codeInput.value.toUpperCase();
      if (codeInput.value.trim().length === 4) doJoin(codeInput.value.trim());
    });
    codeInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") doJoin(codeInput.value.trim().toUpperCase());
    });
  }

  let currentCode = null;

  function handleJoinResult(res) {
    if (!res || !res.ok) {
      homeError.textContent = (res && res.error) || "Could not join room";
      return;
    }
    homeError.textContent = "";
    currentCode = res.code;
    setText("roomCodeLabel", res.code);
    setText("roomBadgeGame", "Room " + res.code);
    history.replaceState(null, "", "?room=" + res.code);
  }

  // ---------- Share ----------
  function inviteUrl() {
    return location.origin + "/?room=" + (currentCode || "");
  }
  const shareBtn = byId("shareBtn");
  if (shareBtn) {
    shareBtn.addEventListener("click", async () => {
      const url = inviteUrl();
      const text = "Join my Court Piece game";
      try {
        if (navigator.share) {
          await navigator.share({ title: "Court Piece", text, url });
          return;
        }
      } catch (e) {
        if (e && e.name === "AbortError") return; // they dismissed the sheet
      }
      try {
        await navigator.clipboard.writeText(url);
        setText("shareHint", "Link copied — paste it to your family.");
      } catch (e) {
        setText("shareHint", url);
      }
    });
  }

  byId("startBtn").addEventListener("click", () => {
    socket.emit("startGame", { playerId });
  });

  const fillBotsBtn = byId("fillBotsBtn");
  if (fillBotsBtn) {
    fillBotsBtn.addEventListener("click", () => {
      // One bot per click server-side; fire up to 3 - the server ignores any
      // that land after the room is already full.
      for (let i = 0; i < 3; i++) socket.emit("addBot", { playerId });
    });
  }

  // Opening a shared invite link drops you straight into the room - no code to
  // type, no name to pick.
  const urlParams = new URLSearchParams(location.search);
  const urlRoom = (urlParams.get("room") || "").trim().toUpperCase();
  if (urlRoom) {
    if (codeInput) codeInput.value = urlRoom;
    socket.on("connect", function joinFromLink() {
      socket.off("connect", joinFromLink);
      doJoin(urlRoom);
    });
    if (socket.connected) doJoin(urlRoom);
  }

  // ---------- Overlays ----------
  const trumpOverlay = byId("trumpOverlay");
  const miniHand = byId("miniHand");
  document.querySelectorAll(".suit-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      socket.emit("chooseTrump", { playerId, suit: btn.dataset.suit });
    });
  });

  const roundEndOverlay = byId("roundEndOverlay");
  byId("nextRoundBtn").addEventListener("click", () => {
    socket.emit("nextRound", { playerId });
  });

  // ---------- Toast ----------
  let toastTimer = null;
  function showToast(text) {
    const el = byId("toast");
    if (!el) return;
    el.textContent = text;
    el.classList.remove("hidden");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add("hidden"), 3200);
  }

  // ---------- Emoji reactions ----------
  const reactionBtn = byId("reactionBtn");
  const reactionPanel = byId("reactionPanel");
  const reactionLayer = byId("reactionLayer");
  let lastState = null;

  reactionBtn.addEventListener("click", () => {
    reactionPanel.classList.toggle("hidden");
  });
  document.querySelectorAll(".emoji-opt").forEach((btn) => {
    btn.addEventListener("click", () => {
      socket.emit("reaction", { playerId, emoji: btn.textContent });
      reactionPanel.classList.add("hidden");
    });
  });

  function seatPosKey(seat) {
    if (!lastState || typeof lastState.yourSeat !== "number") return "bottom";
    const my = lastState.yourSeat;
    if (seat === my) return "bottom";
    if (seat === (my + 1) % 4) return "left";
    if (seat === (my + 2) % 4) return "top";
    return "right";
  }

  socket.on("reaction", ({ seat, emoji }) => {
    const anchor = byId("seat-" + seatPosKey(seat));
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const el = document.createElement("div");
    el.className = "floating-emoji";
    el.textContent = emoji;
    el.style.left = rect.left + rect.width / 2 - 18 + "px";
    el.style.top = rect.top - 10 + "px";
    reactionLayer.appendChild(el);
    setTimeout(() => el.remove(), 1800);
  });

  socket.on("autoPlayed", (info) => {
    if (!info) return;
    const seat = info.seat;
    const name = lastState ? seatLabel(lastState, seat) : "Player";
    let what = "";
    if (info.kind === "trump" && info.suit) what = " — trump " + (SUIT_SYMBOL[info.suit] || info.suit);
    else if (info.card) what = " — played " + info.card.rank + (SUIT_SYMBOL[info.card.suit] || "");
    showToast(`⏱ ${avatarFor(seat)} ${name} ran out of time${what}`);
  });

  // ---------- Countdown ring around the active player's avatar ----------
  const RING_R = 45;
  const RING_C = 2 * Math.PI * RING_R;
  const RING_POS = ["top", "left", "right", "bottom"];

  function updateTimerRings() {
    const st = lastState;
    let activePos = null;
    let frac = 0;
    let secs = 0;

    if (st && (st.phase === "playing" || st.phase === "trumpSelect") && st.turnDeadline) {
      const seat = st.phase === "trumpSelect" ? st.trumpCallerSeat : st.turnSeat;
      const total = (Number(st.turnSeconds) || 30) * 1000;
      if (typeof seat === "number" && total > 0) {
        const remain = Math.max(0, Number(st.turnDeadline) - Date.now());
        frac = Math.max(0, Math.min(1, remain / total));
        secs = remain / 1000;
        activePos = seatPosKey(seat);
      }
    }

    RING_POS.forEach((pos) => {
      const seatEl = byId("seat-" + pos);
      if (!seatEl) return;
      const ring = seatEl.querySelector(".timer-ring");
      if (!ring) return;
      const on = activePos === pos;
      ring.classList.toggle("on", on);
      if (!on) { ring.classList.remove("urgent"); return; }
      const arc = ring.querySelector(".tr-arc");
      if (!arc) return;
      arc.style.strokeDasharray = RING_C.toFixed(2);
      arc.style.strokeDashoffset = (RING_C * (1 - frac)).toFixed(2);
      arc.style.stroke = secs <= 8 ? "#ff2d20" : secs <= 15 ? "#ffb703" : "#3ddc84";
      ring.classList.toggle("urgent", secs <= 8);
    });
  }
  setInterval(() => {
    try { updateTimerRings(); } catch (e) { /* never let the clock break the UI */ }
  }, 120);

  // ---------- Layout: the hand must always fit, in any orientation ----------
  const MIN_VISIBLE_FRACTION = 0.34; // smallest readable left strip of a card
  const MAX_CARD_W = 118;
  const HEADROOM = 20;   // space above the top row for a raised card
  const ROWGAP = 6;
  const BOTTOM_PAD = 6;

  function computeLayout(n) {
    const table = byId("tableEl");
    const vw = (table && table.clientWidth) || window.innerWidth || 375;
    const vh = (table && table.clientHeight) || window.innerHeight || 667;
    const squat = vh <= 520;
    // The squat class shrinks the hud/top-row/self-avatar chrome in CSS - it
    // has to land BEFORE we measure them below, or this pass reads their
    // taller portrait-mode heights and hand/trick cards come out smaller
    // than the space actually available.
    if (table) table.classList.toggle("squat", squat);
    const W = Math.max(180, vw - 16); // usable hand width

    const hudH = measuredH("hudBar", 34);
    const topH = measuredH("topRow", 78);
    const banH = measuredH("bannerRow", 58);

    // Reserve enough of the middle that the played cards stay big enough to
    // read from across the room - seeing who played what matters as much as
    // seeing your own hand.
    const minMiddle = squat ? Math.max(145, vh * 0.40) : 168;
    let avail = vh - hudH - topH - banH - minMiddle - BOTTOM_PAD;
    avail = Math.min(avail, vh * (squat ? 0.44 : 0.43));
    avail = Math.max(avail, 56);

    function option(rows) {
      const perRow = Math.ceil(n / rows);
      let cardH = (avail - HEADROOM - (rows - 1) * ROWGAP) / rows;
      cardH = Math.min(cardH, MAX_CARD_W * ASPECT);
      if (cardH < 34) return null;
      let cardW = cardH / ASPECT;
      let strip = perRow > 1 ? (W - cardW) / (perRow - 1) : cardW;
      if (strip > cardW) strip = cardW;
      if (strip < cardW * MIN_VISIBLE_FRACTION) {
        // Cards would hide each other's badge: shrink them until the minimum
        // readable strip fits across the row.
        cardW = W / (1 + (perRow - 1) * MIN_VISIBLE_FRACTION);
        strip = cardW * MIN_VISIBLE_FRACTION;
        cardH = cardW * ASPECT;
      }
      if (cardW < 28) return null;
      return { rows, perRow, cardW, cardH, strip };
    }

    // Prefer whichever row count leaves the widest readable strip - that is
    // one row in landscape, two rows on a tall phone.
    let best = null;
    for (let rows = 1; rows <= 2; rows++) {
      if (rows > n) break;
      const o = option(rows);
      if (!o) continue;
      if (!best || o.strip > best.strip + 0.5) best = o;
    }
    if (!best) best = { rows: 1, perRow: Math.max(1, n), cardW: 40, cardH: 40 * ASPECT, strip: 14 };

    const handH = HEADROOM + best.rows * best.cardH + (best.rows - 1) * ROWGAP + BOTTOM_PAD;
    const middleH = Math.max(60, vh - hudH - topH - banH - handH);

    // Trick cards are sized from whatever vertical room is left in the middle.
    const seatEl = byId("seat-left");
    const seatW = (seatEl && seatEl.offsetWidth) || 76;
    const midW = Math.max(110, vw - 2 * seatW - 14);
    // The four played cards sit in a tight overlapping cross, the way they land
    // on a real table. Keeping it compact is what lets each card be BIG: the
    // cross spans ~1.8 card heights vertically and ~2.85 card widths across.
    const crossV = 1.9;
    const crossH = 3.03;
    let tW = (middleH - 6) / crossV / ASPECT;
    tW = Math.min(tW, midW / crossH, 168);
    tW = Math.max(tW, 30);

    // Large-print corner index: sized off the card, but never wider than the
    // strip of card that stays visible when the hand overlaps.
    const idx = Math.max(11, Math.min(best.cardW * 0.27, (best.strip - 4) * 0.62));

    if (table) {
      table.style.setProperty("--card-w", best.cardW.toFixed(1) + "px");
      table.style.setProperty("--card-strip", best.strip.toFixed(1) + "px");
      table.style.setProperty("--hand-idx", idx.toFixed(1) + "px");
      table.style.setProperty("--tcard-w", tW.toFixed(1) + "px");
      table.style.setProperty("--headroom", HEADROOM + "px");
      table.style.setProperty("--rowgap", ROWGAP + "px");
    }
    return best;
  }

  // Belt and braces: if anything about the measurement was off, shrink the
  // hand until it is provably inside the table. The hand is never clipped.
  function ensureHandFits() {
    const table = byId("tableEl");
    const wrap = byId("handWrap");
    if (!table || !wrap) return;
    for (let pass = 0; pass < 4; pass++) {
      const t = table.getBoundingClientRect();
      const w = wrap.getBoundingClientRect();
      if (w.height <= 0) return;
      const overflow = w.bottom - (t.bottom - 2);
      if (overflow <= 1) return;
      const scale = Math.max(0.6, 1 - (overflow + 4) / w.height);
      ["--card-w", "--card-strip", "--hand-idx"].forEach((name) => {
        const cur = parseFloat(table.style.getPropertyValue(name));
        if (!isFinite(cur) || cur <= 0) return;
        table.style.setProperty(name, (cur * scale).toFixed(1) + "px");
      });
    }
  }

  // ---------- Playing a card: tap-to-select then tap-again, or drag ----------
  let selectedCardId = null;
  let drag = null; // { tile, cardId, pointerId, startX, startY, moved }

  function sendPlay(cardId) {
    if (!cardId) return;
    selectedCardId = null;
    socket.emit("playCard", { playerId, cardId });
  }

  function clearSelection() {
    selectedCardId = null;
    document.querySelectorAll(".hand .card-tile.selected").forEach((t) => t.classList.remove("selected"));
  }

  function selectCard(tile, cardId) {
    document.querySelectorAll(".hand .card-tile.selected").forEach((t) => t.classList.remove("selected"));
    selectedCardId = cardId;
    tile.classList.add("selected");
  }

  function pointOverTrick(x, y) {
    const el = byId("trickArea");
    if (!el) return false;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    const pad = 30; // forgiving target for shaky hands
    return x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad;
  }

  function setDropActive(on) {
    const el = byId("trickArea");
    if (el) el.classList.toggle("drop-active", !!on);
  }

  function endDrag(snapBack) {
    if (!drag) return;
    const tile = drag.tile;
    drag = null;
    document.body.classList.remove("dragging-card");
    setDropActive(false);
    if (!tile) return;
    tile.classList.remove("dragging");
    if (snapBack) {
      tile.style.transition = "transform 0.16s ease";
      tile.style.transform = "";
      setTimeout(() => { tile.style.transition = ""; }, 200);
    } else {
      tile.style.transform = "";
      tile.style.transition = "";
    }
  }

  function attachCardHandlers(tile, cardId) {
    tile.addEventListener("pointerdown", (e) => {
      if (drag) return;
      if (!tile.classList.contains("playable")) return;
      drag = { tile, cardId, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, moved: false };
      try { tile.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    });

    tile.addEventListener("pointermove", (e) => {
      if (!drag || drag.tile !== tile || e.pointerId !== drag.pointerId) return;
      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      if (!drag.moved) {
        if (Math.abs(dx) < 12 && Math.abs(dy) < 12) return;
        drag.moved = true;
        clearSelection();
        tile.classList.add("dragging");
        document.body.classList.add("dragging-card");
      }
      tile.style.transform = `translate(${dx}px, ${dy}px) scale(1.08)`;
      setDropActive(pointOverTrick(e.clientX, e.clientY));
    });

    tile.addEventListener("pointerup", (e) => {
      if (!drag || drag.tile !== tile || e.pointerId !== drag.pointerId) return;
      const wasDrag = drag.moved;
      const cid = drag.cardId;
      const overTrick = pointOverTrick(e.clientX, e.clientY);
      try { tile.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }

      if (wasDrag) {
        endDrag(!overTrick);
        if (overTrick) sendPlay(cid);
        return;
      }
      endDrag(false);
      // Plain tap: first tap raises the card, a second tap on it plays it.
      if (selectedCardId === cid) sendPlay(cid);
      else selectCard(tile, cid);
    });

    tile.addEventListener("pointercancel", (e) => {
      if (!drag || drag.tile !== tile) return;
      if (e && e.pointerId !== undefined && e.pointerId !== drag.pointerId) return;
      endDrag(true);
    });
    tile.addEventListener("lostpointercapture", () => {
      if (drag && drag.tile === tile && drag.moved) endDrag(true);
    });
  }

  // Tapping the middle of the table plays the raised card; tapping anywhere
  // else on the table puts it back down.
  const tableEl = byId("tableEl");
  if (tableEl) {
    tableEl.addEventListener("pointerdown", (e) => {
      const target = e.target;
      if (target && typeof target.closest === "function" && target.closest(".card-tile")) return;
      if (!selectedCardId) return;
      if (pointOverTrick(e.clientX, e.clientY)) sendPlay(selectedCardId);
      else clearSelection();
    });
  }

  // ---------- Main state render ----------
  socket.on("state", (state) => {
    lastState = state;
    try {
      if (state.phase === "lobby") {
        showScreen("waiting");
        renderWaiting(state);
      } else {
        showScreen("game");
        renderGame(state);
      }
      updateTimerRings();
    } catch (err) {
      console.error("render failed", err);
    }
  });

  socket.on("errorMsg", (msg) => {
    console.warn(msg);
  });

  // Rotating the phone changes how many rows the hand needs.
  let resizeTimer = null;
  function scheduleRelayout() {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (!lastState || lastState.phase === "lobby" || drag) return;
      try { renderGame(lastState); } catch (err) { console.error(err); }
    }, 160);
  }
  window.addEventListener("resize", scheduleRelayout);
  window.addEventListener("orientationchange", scheduleRelayout);

  function renderWaiting(state) {
    if (state.code) currentCode = state.code; // keeps the share link right
    setText("roomCodeLabel", state.code);
    const list = byId("seatList");
    if (list) {
      list.innerHTML = "";
      (state.players || []).forEach((p, i) => {
        const row = document.createElement("div");
        row.className = "row" + (p ? " filled" : "");
        const who = document.createElement("span");
        who.className = "who";
        const av = document.createElement("span");
        av.className = "av";
        av.textContent = avatarFor(i);
        const label = document.createElement("span");
        label.textContent = "Seat " + (i + 1);
        who.appendChild(av);
        who.appendChild(label);
        if (p) {
          const right = document.createElement("span");
          right.textContent = p.name + (p.isBot ? " 🤖" : "");
          row.appendChild(who);
          row.appendChild(right);
        } else {
          row.appendChild(who);
          const botBtn = document.createElement("button");
          botBtn.className = "bot-add-btn";
          botBtn.textContent = "+ Add Bot";
          botBtn.addEventListener("click", () => socket.emit("addBot", { playerId }));
          row.appendChild(botBtn);
        }
        list.appendChild(row);
      });
    }
    const filled = (state.players || []).filter(Boolean).length;
    const startBtn = byId("startBtn");
    if (startBtn) {
      startBtn.disabled = filled < 4;
      startBtn.textContent = filled < 4 ? `Waiting for ${4 - filled} more…` : "Start Game";
    }
  }

  function seatLabel(state, seat) {
    const p = state && state.players && state.players[seat];
    return p ? p.name : "—";
  }

  function renderGame(state) {
    const my = state.yourSeat;
    const order = { bottom: my, left: (my + 1) % 4, top: (my + 2) % 4, right: (my + 3) % 4 };

    ["top", "left", "right", "bottom"].forEach((pos) => {
      const seatEl = byId("seat-" + pos);
      if (!seatEl) return;
      const seat = order[pos];
      const p = state.players && state.players[seat];
      const activeSeat = state.phase === "trumpSelect" ? state.trumpCallerSeat : state.turnSeat;
      const isTurn = state.phase !== "roundEnd" && activeSeat === seat;
      seatEl.classList.toggle("active", isTurn);
      seatEl.classList.toggle("disconnected", !!(p && p.connected === false));
      for (let i = 0; i < 4; i++) seatEl.classList.toggle("av" + i, i === seat);
      setText("avatar-" + pos, avatarFor(seat));
      if (pos !== "bottom") setText("name-" + pos, seatLabel(state, seat));
    });

    const myTeam = my % 2 === 0 ? "A" : "B";
    const tricks = state.tricksWon || { A: 0, B: 0 };
    setText("scoreA", (myTeam === "A" ? "Us " : "Them ") + tricks.A);
    setText("scoreB", (myTeam === "B" ? "Us " : "Them ") + tricks.B);

    // Trump suit is drawn in its true colour (red hearts/diamonds, black
    // spades/clubs) on a white chip, so the suit reads without reading words.
    const trumpBadge = byId("trumpBadge");
    if (trumpBadge) {
      trumpBadge.innerHTML = "";
      if (state.trumpSuit) {
        trumpBadge.classList.add("has-trump");
        const label = document.createElement("span");
        label.className = "tb-label";
        label.textContent = "Trump";
        const pip = document.createElement("span");
        pip.className = "tb-pip" + (RED_SUITS[state.trumpSuit] ? " red" : " black");
        pip.textContent = SUIT_SYMBOL[state.trumpSuit] || "";
        trumpBadge.appendChild(label);
        trumpBadge.appendChild(pip);
      } else {
        trumpBadge.classList.remove("has-trump");
        trumpBadge.textContent = "Trump: choosing…";
      }
    }

    // ----- trick area (keep the drop-zone element, replace only the cards) -----
    const trickArea = byId("trickArea");
    if (trickArea) {
      trickArea.querySelectorAll(".tcard").forEach((el) => el.remove());
      const posOf = {};
      posOf[order.bottom] = "bottom";
      posOf[order.left] = "left";
      posOf[order.top] = "top";
      posOf[order.right] = "right";
      const trick = state.currentTrick && state.currentTrick.length
        ? state.currentTrick
        : (state.lastTrick && state.lastTrick.cards) || [];
      trick.forEach((entry) => {
        if (!entry || !entry.card) return;
        trickArea.appendChild(cardTile(entry.card, "tcard pos-" + (posOf[entry.seat] || "bottom")));
      });
    }

    // Whose turn it is reads off the pulsing avatar + countdown ring alone -
    // the text banner was eating the vertical room the cards need in landscape.
    const isMyTurn = state.phase === "playing" && state.turnSeat === my;
    document.body.classList.toggle("my-turn", isMyTurn);

    // ----- hand -----
    if (drag) endDrag(true); // a fresh state invalidates any in-flight drag
    const handArea = byId("handArea");
    const hand = state.yourHand || [];
    const legal = new Set(state.legalMoves || []);

    // Keep a raised card raised across re-renders, but only while it is
    // still a legal move.
    if (selectedCardId && !(isMyTurn && legal.has(selectedCardId))) selectedCardId = null;

    const layout = computeLayout(hand.length || 1);

    if (handArea) {
      handArea.innerHTML = "";
      let z = 1;
      for (let i = 0; i < hand.length; i += layout.perRow) {
        const rowCards = hand.slice(i, i + layout.perRow);
        const row = document.createElement("div");
        row.className = "hand-row";
        rowCards.forEach((card) => {
          // Never dim with opacity - illegal cards are darkened but stay
          // solid and fully readable.
          let cls;
          if (isMyTurn && legal.has(card.id)) cls = "playable";
          else if (isMyTurn) cls = "illegal";
          else cls = "idle";

          const tile = cardTile(card, cls);
          tile.style.zIndex = String(z++);
          if (cls === "playable") {
            const hint = document.createElement("div");
            hint.className = "tile-hint";
            hint.textContent = "TAP TO PLAY";
            tile.appendChild(hint);
            attachCardHandlers(tile, card.id);
            if (card.id === selectedCardId) tile.classList.add("selected");
          }
          row.appendChild(tile);
        });
        handArea.appendChild(row);
      }
      ensureHandFits();
    }

    // ----- trump overlay -----
    if (state.phase === "trumpSelect" && state.trumpCallerSeat === my) {
      if (trumpOverlay) trumpOverlay.classList.remove("hidden");
      if (miniHand) {
        miniHand.innerHTML = "";
        hand.forEach((card) => miniHand.appendChild(cardTile(card)));
      }
    } else if (trumpOverlay) {
      trumpOverlay.classList.add("hidden");
    }

    // ----- round end overlay -----
    if (state.phase === "roundEnd" && state.roundResult) {
      if (roundEndOverlay) roundEndOverlay.classList.remove("hidden");
      const r = state.roundResult;
      const won = r.winningTeam === myTeam;
      setText("roundEndTitle", r.winningTeam ? (won ? "🎉 Your team won!" : "Your team lost") : "Round tied");
      const rt = r.tricksWon || { A: 0, B: 0 };
      setText(
        "roundEndDetail",
        `Tricks — Us: ${myTeam === "A" ? rt.A : rt.B}, Them: ${myTeam === "A" ? rt.B : rt.A}. ` +
          `Trump caller ${r.callerSucceeded ? "made" : "failed"} the bid.`
      );
    } else if (roundEndOverlay) {
      roundEndOverlay.classList.add("hidden");
    }
  }
})();
