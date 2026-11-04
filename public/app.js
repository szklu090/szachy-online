/* ============================================================
 * Klient szachow online
 * ============================================================ */
import { Chess } from './chess.js';

// Zeby bledy ladowania nie konczyly sie cicha, pusta strona - pokaz je w statusie.
window.addEventListener('error', (e) => {
  try {
    const t = document.getElementById('connText');
    const box = document.getElementById('connStatus');
    if (t) t.textContent = 'Błąd aplikacji: ' + (e.message || 'nieznany');
    if (box) box.classList.add('err');
  } catch {}
});

const GLYPH = { p: '♟', n: '♞', b: '♝', r: '♜', q: '♛', k: '♚' };
const FILES = 'abcdefgh';

const el = (id) => document.getElementById(id);
const colorOf = (p) => (p === p.toUpperCase() ? 'w' : 'b');

/* ---------- stan ---------- */
const S = {
  ws: null,
  connected: false,
  queue: [],
  room: null,
  color: null,
  chess: null,
  state: null,
  clock: { w: null, b: null },
  sel: null,
  legal: [],
  orientation: 'w',
  clientId: null,
  name: '',
  reconnectTimer: null,
  shouldReconnect: false,
  shownReq: { undo: null, draw: null, rematch: null },
  closedOverlayKey: null,
};

/* ---------- pamiec lokalna ---------- */
function loadLocal() {
  S.name = localStorage.getItem('szachy.name') || '';
  S.clientId = localStorage.getItem('szachy.clientId');
  if (!S.clientId) {
    S.clientId = 'c' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem('szachy.clientId', S.clientId);
  }
  el('nameInput').value = S.name;
}

/* ---------- websocket ---------- */
let retryDelay = 1000;

function setLobbyStatus(state, text) {
  const box = el('connStatus');
  if (!box) return;
  box.classList.toggle('ok', state === 'ok');
  box.classList.toggle('err', state === 'err');
  if (text) el('connText').textContent = text;
  const off = state !== 'ok';
  if (el('createBtn')) el('createBtn').disabled = off;
  if (el('joinBtn')) el('joinBtn').disabled = off;
}

function scheduleReconnect() {
  clearTimeout(S.reconnectTimer);
  S.reconnectTimer = setTimeout(connect, retryDelay);
  retryDelay = Math.min(retryDelay * 2, 10000);
}

function connect() {
  clearTimeout(S.reconnectTimer);
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${proto}//${location.host}`;

  let ws;
  try {
    ws = new WebSocket(url);
  } catch (e) {
    setLobbyStatus('err', 'Nie udało się otworzyć połączenia: ' + e.message);
    scheduleReconnect();
    return;
  }
  S.ws = ws;

  ws.addEventListener('open', () => {
    S.connected = true;
    retryDelay = 1000;
    el('connBanner').hidden = true;
    setLobbyStatus('ok', 'Połączono z serwerem');
    flushQueue();
    if (S.shouldReconnect && S.room) {
      send({ t: 'join', room: S.room, name: S.name, clientId: S.clientId });
    }
  });

  ws.addEventListener('message', (ev) => {
    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }
    handle(msg);
  });

  ws.addEventListener('close', () => {
    S.connected = false;
    if (S.room) {
      el('connBanner').hidden = false;
    } else {
      setLobbyStatus('err', 'Brak połączenia z serwerem — ponawiam próbę…');
    }
    scheduleReconnect();
  });

  ws.addEventListener('error', () => {
    try { ws.close(); } catch {}
  });
}

function send(obj) {
  if (S.ws && S.ws.readyState === WebSocket.OPEN) {
    S.ws.send(JSON.stringify(obj));
  } else {
    S.queue.push(obj);
  }
}

function flushQueue() {
  const q = S.queue.splice(0);
  for (const m of q) send(m);
}

/* ---------- obsluga wiadomosci z serwera ---------- */
function handle(msg) {
  switch (msg.t) {
    case 'joined':
      S.room = msg.room;
      S.color = msg.color;
      sessionStorage.setItem('szachy.room', msg.room);
      sessionStorage.setItem('szachy.color', msg.color);
      history.replaceState(null, '', `?room=${msg.room}`);
      el('lobby').hidden = true;
      el('game').hidden = false;
      el('roomCode').textContent = msg.room;
      appendChat({ system: true, text: `Pokój ${msg.room}. Grasz ${colorName(msg.color)}.` });
      break;

    case 'state':
      applyState(msg);
      break;

    case 'clock':
      S.clock.w = msg.w;
      S.clock.b = msg.b;
      paintClocks();
      break;

    case 'chat':
      appendChat(msg);
      break;

    case 'saved':
      onSaved(msg.data);
      break;

    case 'error':
      toast(msg.message, { err: true });
      break;

    case 'pong':
      break;
  }
}

function colorName(c) {
  return c === 'w' ? 'białymi' : 'czarnymi';
}

function applyState(state) {
  S.state = state;
  S.room = state.room;
  S.color = state.you;
  S.chess = new Chess(state.fen);
  S.clock.w = state.clock ? state.clock.w : null;
  S.clock.b = state.clock ? state.clock.b : null;
  S.sel = null;
  S.legal = [];
  renderAll();
  handleRequests();
}

/* ---------- render ---------- */
function displayOrder() {
  const files = S.orientation === 'w' ? [0, 1, 2, 3, 4, 5, 6, 7] : [7, 6, 5, 4, 3, 2, 1, 0];
  const ranks = S.orientation === 'w' ? [0, 1, 2, 3, 4, 5, 6, 7] : [7, 6, 5, 4, 3, 2, 1, 0];
  const out = [];
  for (const r of ranks) for (const f of files) out.push(FILES[f] + (8 - r));
  return out;
}

function lastMove() {
  const h = S.state && S.state.history;
  return h && h.length ? h[h.length - 1] : null;
}

function checkedKingSquare() {
  if (!S.state || !S.state.check || !S.chess) return null;
  const king = S.chess.turn === 'w' ? 'K' : 'k';
  for (const name of allSquares()) {
    if (S.chess.pieceAt(name) === king) return name;
  }
  return null;
}

function allSquares() {
  const out = [];
  for (let r = 8; r >= 1; r--) for (let f = 0; f < 8; f++) out.push(FILES[f] + r);
  return out;
}

function canMove() {
  return !!(
    S.state &&
    S.connected &&
    !S.state.result &&
    S.state.started &&
    S.color &&
    S.state.turn === S.color
  );
}

function baseClasses(name, checkSq) {
  const f = name.charCodeAt(0) - 97;
  const r = 8 - Number(name[1]);
  let cls = 'sq ' + ((f + r) % 2 === 0 ? 'light' : 'dark');
  const last = lastMove();
  if (last && (last.from === name || last.to === name)) cls += ' last';
  if (S.sel === name) cls += ' sel';
  else if (S.legal.some((m) => m.to === name)) {
    const m = S.legal.find((x) => x.to === name);
    cls += m.captured ? ' capture' : ' hint';
  }
  if (checkSq === name) cls += ' check';
  return cls;
}

function renderBoard() {
  const board = el('board');
  board.innerHTML = '';
  if (!S.chess) return;

  const order = displayOrder();
  const checkSq = checkedKingSquare();
  order.forEach((name, i) => {
    const col = i % 8;
    const row = Math.floor(i / 8);

    const div = document.createElement('div');
    div.className = baseClasses(name, checkSq);
    div.dataset.sq = name;

    // wspolrzedne
    if (col === 0) {
      const c = document.createElement('span');
      c.className = 'coord r';
      c.textContent = name[1];
      div.appendChild(c);
    }
    if (row === 7) {
      const c = document.createElement('span');
      c.className = 'coord f';
      c.textContent = name[0];
      div.appendChild(c);
    }

    const p = S.chess.pieceAt(name);
    if (p) {
      const white = colorOf(p) === 'w';
      const span = document.createElement('span');
      span.className = 'piece ' + (white ? 'white' : 'black');
      span.textContent = GLYPH[p.toLowerCase()];
      const mine = white === (S.color === 'w');
      span.draggable = canMove() && mine;
      span.addEventListener('dragstart', (e) => onDragStart(e, name, span));
      span.addEventListener('dragend', () => span.classList.remove('dragging'));
      div.appendChild(span);
    }

    div.addEventListener('dragover', (e) => {
      if (S.sel) e.preventDefault();
    });
    div.addEventListener('drop', (e) => {
      e.preventDefault();
      if (S.sel) onSquareClick(name);
    });

    board.appendChild(div);
  });
}

function paintBoardClasses() {
  const checkSq = checkedKingSquare();
  for (const div of el('board').querySelectorAll('.sq')) {
    div.className = baseClasses(div.dataset.sq, checkSq);
  }
}

function renderPlayers() {
  const st = S.state;
  if (!st) return;
  const w = st.players.w;
  const b = st.players.b;

  setPlayer(el('playerW'), w, 'w');
  setPlayer(el('playerB'), b, 'b');

  el('playerW').classList.toggle('me', S.color === 'w');
  el('playerB').classList.toggle('me', S.color === 'b');
  el('playerW').classList.toggle('active', !!st.started && !st.result && st.turn === 'w');
  el('playerB').classList.toggle('active', !!st.started && !st.result && st.turn === 'b');

  document.querySelector('.players').style.flexDirection =
    S.orientation === 'w' ? 'column' : 'column-reverse';
}

function setPlayer(node, info, color) {
  node.querySelector('.pname').textContent = info ? info.name : 'Czekam…';
  node.classList.toggle('offline', !info || !info.connected);
}

function paintClocks() {
  el('clockW').textContent = S.clock.w == null ? '∞' : fmt(S.clock.w);
  el('clockB').textContent = S.clock.b == null ? '∞' : fmt(S.clock.b);
  el('clockW').classList.toggle('low', S.clock.w != null && S.clock.w < 20000);
  el('clockB').classList.toggle('low', S.clock.b != null && S.clock.b < 20000);
}

function fmt(ms) {
  ms = Math.max(0, ms);
  const total = ms / 1000;
  const m = Math.floor(total / 60);
  const s = Math.floor(total % 60);
  let str = `${m}:${String(s).padStart(2, '0')}`;
  if (ms < 20000) str += '.' + Math.floor((ms % 1000) / 100);
  return str;
}

function renderStatus() {
  const st = S.state;
  const status = el('status');
  status.classList.remove('check');
  if (!st) return;

  if (st.result) {
    status.textContent = resultHeadline(st.result);
    return;
  }
  if (!st.players.w || !st.players.b) {
    status.textContent = `Czekam na drugiego gracza — kod: ${st.room}`;
    return;
  }
  if (!st.started) {
    status.textContent = 'Gracze gotowi — start…';
    return;
  }
  if (!S.connected) {
    status.textContent = 'Rozłączono…';
    return;
  }
  const mine = st.turn === S.color;
  status.textContent = mine ? 'Twoja kolej' : 'Ruch przeciwnika';
  if (st.check) {
    status.textContent += ' — szach!';
    status.classList.add('check');
  }
}

function resultText(result) {
  const reasons = {
    checkmate: 'mat',
    resign: 'poddanie się',
    timeout: 'koniec czasu',
    stalemate: 'pat',
    insufficient: 'zbyt mało materiału do mata',
    threefold: 'trzykrotne powtórzenie pozycji',
    fiftymove: 'reguła 50 posunięć',
    agreement: 'zgoda obu graczy',
    'timeout-insufficient': 'koniec czasu, ale brak materiału do mata',
  };
  return reasons[result.reason] || result.reason;
}

function resultHeadline(result) {
  if (result.result === '1/2-1/2') return `Remis (${resultText(result)})`;
  const win = result.result === '1-0' ? 'w' : 'b';
  const who = win === S.color ? 'Wygrywasz!' : 'Przegrywasz';
  return `${who} (${resultText(result)})`;
}

function renderMoves() {
  const list = el('moveList');
  list.innerHTML = '';
  const h = (S.state && S.state.history) || [];
  const lastIdx = h.length - 1;
  for (let i = 0; i < h.length; i += 2) {
    const num = document.createElement('li');
    num.className = 'num';
    num.textContent = `${i / 2 + 1}.`;
    list.appendChild(num);

    for (const j of [i, i + 1]) {
      const li = document.createElement('li');
      li.className = 'san';
      if (h[j]) {
        li.textContent = h[j].san;
        if (j === lastIdx) li.classList.add('current');
      }
      list.appendChild(li);
    }
  }
  list.scrollTop = list.scrollHeight;
}

function renderButtons() {
  const st = S.state || {};
  const playing = st.started && !st.result;
  el('undoBtn').disabled = !(playing && st.turn === S.color && st.history.length > 0);
  el('drawBtn').disabled = !playing;
  el('resignBtn').disabled = !playing;
  el('rematchBtn').hidden = !st.result;
}

function renderResultBanner() {
  const st = S.state;
  const banner = el('resultBanner');
  if (st && st.result) {
    banner.hidden = false;
    banner.innerHTML = `<h3>${resultHeadline(st.result)}</h3><p>Kliknij „Rewanż”, aby zagrać ponownie.</p>`;
  } else {
    banner.hidden = true;
  }
}
function renderAll() {
  renderBoard();
  renderPlayers();
  paintClocks();
  renderStatus();
  renderMoves();
  renderButtons();
  renderResultBanner();
}

/* ---------- interakcja z plansza ---------- */
function onDragStart(e, name, span) {
  if (!canMove()) {
    e.preventDefault();
    return;
  }
  const piece = S.chess.pieceAt(name);
  if (!piece || colorOf(piece) !== S.color) {
    e.preventDefault();
    return;
  }
  S.sel = name;
  S.legal = S.chess.moves({ square: name });
  paintBoardClasses();
  e.dataTransfer.setData('text/plain', name);
  e.dataTransfer.effectAllowed = 'move';
  setTimeout(() => span.classList.add('dragging'), 0);
}

function onSquareClick(name) {
  if (!S.chess) return;
  if (!canMove()) {
    if (S.sel) {
      S.sel = null;
      S.legal = [];
      paintBoardClasses();
    }
    return;
  }

  const targets = S.legal.filter((m) => m.to === name);
  if (S.sel && targets.length) {
    const from = S.sel;
    if (targets.some((m) => m.promotion)) {
      askPromotion(from, name);
      S.sel = null;
      S.legal = [];
      paintBoardClasses();
      return;
    }
    send({ t: 'move', from, to: name });
    S.sel = null;
    S.legal = [];
    paintBoardClasses();
    return;
  }

  const piece = S.chess.pieceAt(name);
  if (piece && colorOf(piece) === S.color && S.chess.turn === S.color) {
    S.sel = name;
    S.legal = S.chess.moves({ square: name });
  } else {
    S.sel = null;
    S.legal = [];
  }
  paintBoardClasses();
}

/* ---------- promocja ---------- */
function askPromotion(from, to) {
  const box = el('promo');
  const choices = el('promoChoices');
  choices.innerHTML = '';
  const white = S.color === 'w';
  for (const pr of ['q', 'r', 'b', 'n']) {
    const btn = document.createElement('button');
    btn.className = white ? 'w' : '';
    btn.textContent = GLYPH[pr];
    btn.addEventListener('click', () => {
      box.hidden = true;
      send({ t: 'move', from, to, promotion: pr });
    });
    choices.appendChild(btn);
  }
  box.hidden = false;
}

el('promo').addEventListener('click', (e) => {
  if (e.target === el('promo')) el('promo').hidden = true;
});

el('resultBanner').addEventListener('click', () => {
  el('resultBanner').hidden = true;
});

/* ---------- czat ---------- */
function appendChat(msg) {
  const log = el('chatLog');
  const div = document.createElement('div');
  if (msg.system) {
    div.className = 'chat-msg sys';
    div.textContent = msg.text;
  } else {
    div.className = 'chat-msg' + (msg.from === S.color ? ' mine' : '');
    const who = document.createElement('span');
    who.className = 'who';
    who.textContent = (msg.name || '?') + ': ';
    div.appendChild(who);
    div.appendChild(document.createTextNode(msg.text));
  }
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
}

/* ---------- propozycje / proszenia ---------- */
function handleRequests() {
  const st = S.state;
  if (!st) return;
  const opp = S.color === 'w' ? 'b' : 'w';

  // cofniecie ruchu
  if (st.undoRequest && st.undoRequest !== S.color && S.shownReq.undo !== st.undoRequest) {
    S.shownReq.undo = st.undoRequest;
    showOverlay('Prośba o cofnięcie ruchu', 'Przeciwnik chce cofnąć ostatnie posunięcie.', [
      { label: 'Zgadzam się', cls: 'primary', fn: () => { hideOverlay(); send({ t: 'undo', action: 'accept' }); } },
      { label: 'Nie', fn: () => { hideOverlay(); send({ t: 'undo', action: 'decline' }); } },
    ]);
  }
  if (!st.undoRequest) S.shownReq.undo = null;

  // remis
  if (st.drawOffer && st.drawOffer !== S.color && S.shownReq.draw !== st.drawOffer) {
    S.shownReq.draw = st.drawOffer;
    showOverlay('Propozycja remisu', 'Przeciwnik proponuje remis.', [
      { label: 'Zgadzam się', cls: 'primary', fn: () => { hideOverlay(); send({ t: 'draw', action: 'accept' }); } },
      { label: 'Nie', fn: () => { hideOverlay(); send({ t: 'draw', action: 'decline' }); } },
    ]);
  }
  if (!st.drawOffer) S.shownReq.draw = null;

  // rewanz
  if (st.rematchOffer && st.rematchOffer !== S.color && S.shownReq.rematch !== st.rematchOffer) {
    S.shownReq.rematch = st.rematchOffer;
    showOverlay('Propozycja rewanżu', 'Przeciwnik chce zagrać jeszcze raz (kolory się zamienią).', [
      { label: 'Gramy!', cls: 'primary', fn: () => { hideOverlay(); send({ t: 'rematch', action: 'accept' }); } },
      { label: 'Nie teraz', fn: () => { hideOverlay(); send({ t: 'rematch', action: 'decline' }); } },
    ]);
  }
  if (!st.rematchOffer) S.shownReq.rematch = null;
}

/* ---------- overlay ---------- */
function showOverlay(title, text, buttons) {
  el('ovTitle').textContent = title;
  el('ovText').textContent = text;
  const box = el('ovButtons');
  box.innerHTML = '';
  for (const b of buttons) {
    const btn = document.createElement('button');
    btn.textContent = b.label;
    if (b.cls) btn.className = b.cls;
    btn.addEventListener('click', b.fn);
    box.appendChild(btn);
  }
  el('overlay').hidden = false;
}

function hideOverlay() {
  el('overlay').hidden = true;
}

/* ---------- toast ---------- */
let toastTimer = null;
function toast(text, opts = {}) {
  const t = el('toast');
  t.innerHTML = '';
  t.className = 'toast' + (opts.err ? ' err' : '');
  const span = document.createElement('span');
  span.textContent = text;
  t.appendChild(span);
  if (opts.actionLabel && opts.onAction) {
    const b = document.createElement('button');
    b.className = 'ghost small';
    b.style.marginLeft = '10px';
    b.textContent = opts.actionLabel;
    b.addEventListener('click', () => {
      opts.onAction();
      t.hidden = true;
    });
    t.appendChild(b);
  }
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), opts.err ? 5000 : 3500);
}

/* ---------- zapis / odczyt ---------- */
function onSaved(data) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const fname = `szachy-${data.room}-${stamp}.json`;
  download(fname, JSON.stringify(data, null, 2));
  try {
    localStorage.setItem('szachy.lastSave', JSON.stringify(data));
  } catch {}
  toast('Zapisano partię do pliku.', {
    actionLabel: 'Kopiuj PGN',
    onAction: () => {
      navigator.clipboard?.writeText(data.pgn || '');
      toast('PGN skopiowany do schowka.');
    },
  });
}

function download(name, text) {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function loadFromData(data) {
  send({ t: 'load', data });
  toast('Wczytano zapis.');
}

el('loadBtn').addEventListener('click', () => {
  const last = localStorage.getItem('szachy.lastSave');
  const buttons = [{ label: 'Z pliku…', cls: 'primary', fn: () => { hideOverlay(); el('loadInput').click(); } }];
  if (last) {
    buttons.unshift({
      label: 'Ostatni zapis lokalny',
      cls: 'primary',
      fn: () => {
        hideOverlay();
        try {
          loadFromData(JSON.parse(last));
        } catch {
          toast('Nie udało się odczytać lokalnego zapisu.', { err: true });
        }
      },
    });
  }
  buttons.push({ label: 'Anuluj', fn: hideOverlay });
  showOverlay('Wczytać partię?', 'Wybierz źródło zapisu. Spowoduje to zastąpienie bieżącej partii (dla obu graczy).', buttons);
});

el('loadInput').addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const text = await file.text();
    loadFromData(JSON.parse(text));
  } catch {
    toast('Nieprawidłowy plik zapisu.', { err: true });
  }
});

/* ---------- przyciski ---------- */
el('board').addEventListener('click', (e) => {
  const sq = e.target.closest('.sq');
  if (sq) onSquareClick(sq.dataset.sq);
});

el('createBtn').addEventListener('click', () => {
  const name = getName();
  if (!name) return;
  S.name = name;
  const tc = tcFromSelect();
  S.shouldReconnect = true;
  send({ t: 'create', name, clientId: S.clientId, tc });
});

el('joinBtn').addEventListener('click', () => {
  const name = getName();
  if (!name) return;
  const code = el('roomInput').value.trim().toUpperCase();
  if (code.length < 4) return lobbyMsg('Podaj kod pokoju.', true);
  S.name = name;
  S.shouldReconnect = true;
  send({ t: 'join', room: code, name, clientId: S.clientId });
});

el('chatForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = el('chatInput');
  const text = input.value.trim();
  if (!text) return;
  send({ t: 'chat', text });
  input.value = '';
});

el('undoBtn').addEventListener('click', () => {
  if (S.state.undoRequest === S.color) return toast('Prośba już wysłana — czekam na zgodę.');
  send({ t: 'undo', action: 'request' });
  toast('Wysłano prośbę o cofnięcie ruchu.');
});

el('drawBtn').addEventListener('click', () => {
  if (S.state.drawOffer === S.color) return toast('Propozycja już wysłana.');
  send({ t: 'draw', action: 'offer' });
  toast('Zaproponowano remis.');
});

el('resignBtn').addEventListener('click', () => {
  showOverlay('Poddajesz się?', 'Ta decyzja kończy partię przegraną.', [
    { label: 'Tak, poddaję', cls: 'danger', fn: () => { hideOverlay(); send({ t: 'resign' }); } },
    { label: 'Nie', fn: hideOverlay },
  ]);
});

el('rematchBtn').addEventListener('click', () => {
  if (S.state.rematchOffer === S.color) return toast('Czekam na odpowiedź przeciwnika.');
  send({ t: 'rematch', action: 'offer' });
  toast('Zaproponowano rewanż.');
});

el('saveBtn').addEventListener('click', () => send({ t: 'save' }));

el('flipBtn').addEventListener('click', () => {
  S.orientation = S.orientation === 'w' ? 'b' : 'w';
  renderAll();
});

el('copyBtn').addEventListener('click', async () => {
  const link = `${location.origin}${location.pathname}?room=${S.room}`;
  try {
    await navigator.clipboard.writeText(link);
    toast('Link skopiowany: ' + link);
  } catch {
    toast(link);
  }
});

el('leaveBtn').addEventListener('click', () => {
  S.shouldReconnect = false;
  sessionStorage.removeItem('szachy.room');
  history.replaceState(null, '', location.pathname);
  location.reload();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (!el('overlay').hidden) hideOverlay();
    else if (S.sel) {
      S.sel = null;
      S.legal = [];
      paintBoardClasses();
    }
  }
});

el('roomInput').addEventListener('input', (e) => {
  e.target.value = e.target.value.toUpperCase();
});
el('roomInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') el('joinBtn').click();
});

/* ---------- pomocnicze ---------- */
function getName() {
  const n = el('nameInput').value.trim();
  if (!n) {
    lobbyMsg('Wpisz swoje imię.', true);
    el('nameInput').focus();
    return null;
  }
  localStorage.setItem('szachy.name', n);
  return n;
}

function tcFromSelect() {
  const v = el('tcSelect').value;
  if (v === 'unlimited') return null;
  const [initial, increment] = v.split(',').map(Number);
  return { initial: initial * 1000, increment: increment * 1000 };
}

function lobbyMsg(text, err) {
  const m = el('lobbyMsg');
  m.textContent = text;
  m.className = 'msg' + (err ? '' : ' ok');
  if (!err) setTimeout(() => (m.textContent = ''), 2000);
}

/* ---------- start ---------- */
loadLocal();
el('connText').textContent = 'Łączenie z serwerem…';
el('createBtn').disabled = true;
el('joinBtn').disabled = true;
connect();

const params = new URLSearchParams(location.search);
const roomFromUrl = params.get('room');
if (roomFromUrl) {
  el('roomInput').value = roomFromUrl.toUpperCase();
  if (S.name) {
    S.shouldReconnect = true;
    send({ t: 'join', room: roomFromUrl.toUpperCase(), name: S.name, clientId: S.clientId });
  }
}

setInterval(() => {
  if (S.connected) send({ t: 'ping' });
}, 25000);
