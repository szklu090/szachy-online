/* ============================================================
 * Silnik szachowy (ESM) - uzywany przez serwer (Node) i przez
 * przegladarke. Implementuje pelne zasady:
 *  - poprawne ruchy wszystkich figur
 *  - szach, mat, pat
 *  - bicie w przelocie (en passant)
 *  - promocja piona
 *  - roszada (z kontrola szachu i wolnych pol)
 *  - brak materialu do mata, 50 posuniec, trzykrotne powtorzenie
 *  - notacja SAN oraz FEN
 * ============================================================ */

export const START_FEN =
  'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

const FILES = 'abcdefgh';

const idx = (file, rank) => rank * 8 + file;
const fileOf = (s) => s % 8;
const rankOf = (s) => (s / 8) | 0;
const sqName = (s) => FILES[fileOf(s)] + (8 - rankOf(s));
function nameToSq(name) {
  return idx(FILES.indexOf(name[0]), 8 - Number(name[1]));
}
const colorOf = (p) => (p === p.toUpperCase() ? 'w' : 'b');
const typeOf = (p) => p.toLowerCase();

const KNIGHT_DELTAS = [
  [1, 2], [2, 1], [2, -1], [1, -2],
  [-1, -2], [-2, -1], [-2, 1], [-1, 2],
];
const DIAG = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
const ORTH = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const KING_DIRS = [...DIAG, ...ORTH];

export function cloneState(st) {
  return {
    board: st.board.slice(),
    turn: st.turn,
    castling: { ...st.castling },
    ep: st.ep,
    halfmove: st.halfmove,
    fullmove: st.fullmove,
  };
}

function findKing(st, color) {
  const k = color === 'w' ? 'K' : 'k';
  for (let s = 0; s < 64; s++) if (st.board[s] === k) return s;
  return -1;
}

/** Czy pole `sq` jest atakowane przez figure koloru `by`. */
export function isAttacked(st, sq, by) {
  const f = fileOf(sq);
  const r = rankOf(sq);
  const b = st.board;

  // piony (pion atakuje o jeden rank "w tyl" od pola docelowego)
  const pawn = by === 'w' ? 'P' : 'p';
  const pawnRank = by === 'w' ? r + 1 : r - 1;
  if (pawnRank >= 0 && pawnRank < 8) {
    if (f - 1 >= 0 && b[idx(f - 1, pawnRank)] === pawn) return true;
    if (f + 1 < 8 && b[idx(f + 1, pawnRank)] === pawn) return true;
  }

  // skoczki
  const knight = by === 'w' ? 'N' : 'n';
  for (const [df, dr] of KNIGHT_DELTAS) {
    const f2 = f + df;
    const r2 = r + dr;
    if (f2 >= 0 && f2 < 8 && r2 >= 0 && r2 < 8 && b[idx(f2, r2)] === knight) return true;
  }

  // krol
  const king = by === 'w' ? 'K' : 'k';
  for (const [df, dr] of KING_DIRS) {
    const f2 = f + df;
    const r2 = r + dr;
    if (f2 >= 0 && f2 < 8 && r2 >= 0 && r2 < 8 && b[idx(f2, r2)] === king) return true;
  }

  // wieze / hetmany
  const rookSet = by === 'w' ? 'RQ' : 'rq';
  for (const [df, dr] of ORTH) {
    let f2 = f + df;
    let r2 = r + dr;
    while (f2 >= 0 && f2 < 8 && r2 >= 0 && r2 < 8) {
      const p = b[idx(f2, r2)];
      if (p) {
        if (rookSet.includes(p)) return true;
        break;
      }
      f2 += df;
      r2 += dr;
    }
  }

  // goncy / hetmany
  const bishopSet = by === 'w' ? 'BQ' : 'bq';
  for (const [df, dr] of DIAG) {
    let f2 = f + df;
    let r2 = r + dr;
    while (f2 >= 0 && f2 < 8 && r2 >= 0 && r2 < 8) {
      const p = b[idx(f2, r2)];
      if (p) {
        if (bishopSet.includes(p)) return true;
        break;
      }
      f2 += df;
      r2 += dr;
    }
  }

  return false;
}

function mkMove(from, to, piece, captured, promotion = null, flag = null) {
  return { from, to, piece, captured, promotion, flag };
}

function addPawnMove(list, from, to, piece, captured, isPromo) {
  if (isPromo) {
    for (const pr of ['q', 'r', 'b', 'n']) {
      list.push(mkMove(from, to, piece, captured, pr, 'p'));
    }
  } else {
    list.push(mkMove(from, to, piece, captured, null, captured ? 'c' : null));
  }
}

/** Ruchy pseudolegalne (bez sprawdzania wlasnego krola). */
function pseudoMoves(st, color) {
  const moves = [];
  const b = st.board;

  for (let s = 0; s < 64; s++) {
    const p = b[s];
    if (!p || colorOf(p) !== color) continue;
    const t = typeOf(p);
    const f = fileOf(s);
    const r = rankOf(s);

    if (t === 'p') {
      const dr = color === 'w' ? -1 : 1;
      const startRank = color === 'w' ? 6 : 1;
      const promoRank = color === 'w' ? 0 : 7;
      const r1 = r + dr;
      if (r1 < 0 || r1 > 7) continue;

      // ruch do przodu
      const s1 = idx(f, r1);
      if (!b[s1]) {
        addPawnMove(moves, s, s1, p, null, r1 === promoRank);
        if (r === startRank) {
          const s2 = idx(f, r + 2 * dr);
          if (!b[s2]) moves.push(mkMove(s, s2, p, null, null, 'b'));
        }
      }
      // bicia
      for (const df of [-1, 1]) {
        const f2 = f + df;
        if (f2 < 0 || f2 > 7) continue;
        const s1c = idx(f2, r1);
        const target = b[s1c];
        if (target && colorOf(target) !== color) {
          addPawnMove(moves, s, s1c, p, target, r1 === promoRank);
        } else if (!target && st.ep === s1c) {
          const capSq = idx(f2, r);
          moves.push(mkMove(s, s1c, p, b[capSq], null, 'ep'));
        }
      }
      continue;
    }

    if (t === 'n') {
      for (const [df, dr] of KNIGHT_DELTAS) {
        const f2 = f + df;
        const r2 = r + dr;
        if (f2 < 0 || f2 > 7 || r2 < 0 || r2 > 7) continue;
        const s2 = idx(f2, r2);
        const target = b[s2];
        if (target && colorOf(target) === color) continue;
        moves.push(mkMove(s, s2, p, target || null, null, target ? 'c' : null));
      }
      continue;
    }

    if (t === 'k') {
      for (const [df, dr] of KING_DIRS) {
        const f2 = f + df;
        const r2 = r + dr;
        if (f2 < 0 || f2 > 7 || r2 < 0 || r2 > 7) continue;
        const s2 = idx(f2, r2);
        const target = b[s2];
        if (target && colorOf(target) === color) continue;
        moves.push(mkMove(s, s2, p, target || null, null, target ? 'c' : null));
      }
      addCastling(st, color, moves, s);
      continue;
    }

    // figury slizgowe
    const dirs = t === 'b' ? DIAG : t === 'r' ? ORTH : KING_DIRS;
    for (const [df, dr] of dirs) {
      let f2 = f + df;
      let r2 = r + dr;
      while (f2 >= 0 && f2 < 8 && r2 >= 0 && r2 < 8) {
        const s2 = idx(f2, r2);
        const target = b[s2];
        if (!target) {
          moves.push(mkMove(s, s2, p, null, null, null));
        } else {
          if (colorOf(target) !== color) {
            moves.push(mkMove(s, s2, p, target, null, 'c'));
          }
          break;
        }
        f2 += df;
        r2 += dr;
      }
    }
  }

  return moves;
}

function addCastling(st, color, moves, kingSq) {
  const rank = color === 'w' ? 7 : 0;
  const kingStart = idx(4, rank);
  if (kingSq !== kingStart) return;
  const enemy = color === 'w' ? 'b' : 'w';
  if (isAttacked(st, kingStart, enemy)) return;

  const canK = color === 'w' ? st.castling.wK : st.castling.bK;
  const canQ = color === 'w' ? st.castling.wQ : st.castling.bQ;
  const rook = color === 'w' ? 'R' : 'r';

  if (canK && !st.board[idx(5, rank)] && !st.board[idx(6, rank)]) {
    if (st.board[idx(7, rank)] === rook &&
        !isAttacked(st, idx(5, rank), enemy) &&
        !isAttacked(st, idx(6, rank), enemy)) {
      moves.push(mkMove(kingStart, idx(6, rank), st.board[kingStart], null, null, 'k'));
    }
  }
  if (canQ && !st.board[idx(3, rank)] && !st.board[idx(2, rank)] && !st.board[idx(1, rank)]) {
    if (st.board[idx(0, rank)] === rook &&
        !isAttacked(st, idx(3, rank), enemy) &&
        !isAttacked(st, idx(2, rank), enemy)) {
      moves.push(mkMove(kingStart, idx(2, rank), st.board[kingStart], null, null, 'q'));
    }
  }
}

/** Wykonuje ruch na stanie (mutuje st). */
export function applyMove(st, m) {
  const b = st.board;
  const moving = m.piece;
  const color = colorOf(moving);

  b[m.from] = null;

  if (m.flag === 'ep') {
    const capSq = idx(fileOf(m.to), rankOf(m.from));
    b[capSq] = null;
  }

  if (m.promotion) {
    const pr = color === 'w' ? m.promotion.toUpperCase() : m.promotion.toLowerCase();
    b[m.to] = pr;
  } else {
    b[m.to] = moving;
  }

  if (m.flag === 'k') {
    const r = rankOf(m.from);
    b[idx(5, r)] = b[idx(7, r)];
    b[idx(7, r)] = null;
  } else if (m.flag === 'q') {
    const r = rankOf(m.from);
    b[idx(3, r)] = b[idx(0, r)];
    b[idx(0, r)] = null;
  }

  // utrata praw do roszady
  const t = typeOf(moving);
  if (t === 'k') {
    if (color === 'w') { st.castling.wK = false; st.castling.wQ = false; }
    else { st.castling.bK = false; st.castling.bQ = false; }
  }
  const a1 = nameToSq('a1'), h1 = nameToSq('h1'), a8 = nameToSq('a8'), h8 = nameToSq('h8');
  if (m.from === a1 || m.to === a1) st.castling.wQ = false;
  if (m.from === h1 || m.to === h1) st.castling.wK = false;
  if (m.from === a8 || m.to === a8) st.castling.bQ = false;
  if (m.from === h8 || m.to === h8) st.castling.bK = false;

  // en passant target
  st.ep = null;
  if (t === 'p' && Math.abs(rankOf(m.to) - rankOf(m.from)) === 2) {
    st.ep = idx(fileOf(m.from), (rankOf(m.from) + rankOf(m.to)) / 2);
  }

  // zegary
  if (t === 'p' || m.captured) st.halfmove = 0;
  else st.halfmove += 1;

  if (st.turn === 'b') st.fullmove += 1;
  st.turn = st.turn === 'w' ? 'b' : 'w';
}

/** Wszystkie legalne ruchy dla strony na posunieciu. */
export function generateMoves(st) {
  const color = st.turn;
  const result = [];
  for (const m of pseudoMoves(st, color)) {
    const next = cloneState(st);
    applyMove(next, m);
    const king = findKing(next, color);
    if (king === -1 || !isAttacked(next, king, color === 'w' ? 'b' : 'w')) {
      result.push(m);
    }
  }
  return result;
}

function sanFor(st, m, allMoves) {
  const t = typeOf(m.piece);
  let san;

  if (m.flag === 'k') {
    san = 'O-O';
  } else if (m.flag === 'q') {
    san = 'O-O-O';
  } else if (t === 'p') {
    let s = '';
    if (m.captured) s += FILES[fileOf(m.from)] + 'x';
    s += sqName(m.to);
    if (m.promotion) s += '=' + m.promotion.toUpperCase();
    san = s;
  } else {
    let s = t.toUpperCase();
    const rivals = allMoves.filter(
      (o) =>
        o !== m &&
        typeOf(o.piece) === t &&
        o.to === m.to &&
        colorOf(o.piece) === colorOf(m.piece),
    );
    if (rivals.length) {
      const sameFile = rivals.some((o) => fileOf(o.from) === fileOf(m.from));
      const sameRank = rivals.some((o) => rankOf(o.from) === rankOf(m.from));
      if (!sameFile) s += FILES[fileOf(m.from)];
      else if (!sameRank) s += 8 - rankOf(m.from);
      else s += sqName(m.from);
    }
    if (m.captured) s += 'x';
    s += sqName(m.to);
    san = s;
  }

  // dopisz + lub #
  const after = cloneState(st);
  applyMove(after, m);
  const opp = after.turn;
  if (isAttacked(after, findKing(after, opp), opp === 'w' ? 'b' : 'w')) {
    san += generateMoves(after).length === 0 ? '#' : '+';
  }
  return san;
}

/* ---------------------- FEN ---------------------- */

export function parseFen(fen) {
  const parts = fen.trim().split(/\s+/);
  if (parts.length < 4) throw new Error('Nieprawidlowy FEN');
  const board = new Array(64).fill(null);
  const rows = parts[0].split('/');
  if (rows.length !== 8) throw new Error('Nieprawidlowy FEN (plansza)');

  for (let r = 0; r < 8; r++) {
    let f = 0;
    for (const ch of rows[r]) {
      if (/[1-8]/.test(ch)) {
        f += Number(ch);
      } else if (/[prnbqkPRNBQK]/.test(ch)) {
        if (f > 7) throw new Error('Nieprawidlowy FEN (rzad)');
        board[idx(f, r)] = ch;
        f += 1;
      } else {
        throw new Error('Nieprawidlowy FEN (znak: ' + ch + ')');
      }
    }
    if (f !== 8) throw new Error('Nieprawidlowy FEN (dlugosc rzedu)');
  }

  const turn = parts[1] === 'b' ? 'b' : 'w';
  const cast = parts[2] || '-';
  const epStr = parts[3] || '-';
  const halfmove = parts[4] !== undefined ? Number(parts[4]) : 0;
  const fullmove = parts[5] !== undefined ? Number(parts[5]) : 1;

  return {
    board,
    turn,
    castling: {
      wK: cast.includes('K'),
      wQ: cast.includes('Q'),
      bK: cast.includes('k'),
      bQ: cast.includes('q'),
    },
    ep: epStr && epStr !== '-' ? nameToSq(epStr) : null,
    halfmove: Number.isFinite(halfmove) ? halfmove : 0,
    fullmove: Number.isFinite(fullmove) ? fullmove : 1,
  };
}

export function toFen(st) {
  let placement = '';
  for (let r = 0; r < 8; r++) {
    let empty = 0;
    for (let f = 0; f < 8; f++) {
      const p = st.board[idx(f, r)];
      if (!p) {
        empty += 1;
      } else {
        if (empty) {
          placement += empty;
          empty = 0;
        }
        placement += p;
      }
    }
    if (empty) placement += empty;
    if (r < 7) placement += '/';
  }

  let cast = '';
  if (st.castling.wK) cast += 'K';
  if (st.castling.wQ) cast += 'Q';
  if (st.castling.bK) cast += 'k';
  if (st.castling.bQ) cast += 'q';
  if (!cast) cast = '-';

  return [
    placement,
    st.turn,
    cast,
    st.ep === null ? '-' : sqName(st.ep),
    st.halfmove,
    st.fullmove,
  ].join(' ');
}

/* ---------------------- Klasa Chess ---------------------- */

export class Chess {
  constructor(fen = START_FEN) {
    this.startFen = fen;
    this.reset(fen);
  }

  reset(fen = START_FEN) {
    const parsed = parseFen(fen);
    this.board = parsed.board;
    this.turn = parsed.turn;
    this.castling = parsed.castling;
    this.ep = parsed.ep;
    this.halfmove = parsed.halfmove;
    this.fullmove = parsed.fullmove;
    this.history = []; // { san, from, to, promotion, color, fen }
    this.startFen = fen;
    this._repetition = {};
    this._bumpRepetition();
  }

  _state() {
    return {
      board: this.board,
      turn: this.turn,
      castling: this.castling,
      ep: this.ep,
      halfmove: this.halfmove,
      fullmove: this.fullmove,
    };
  }

  _syncFrom(st) {
    this.board = st.board;
    this.turn = st.turn;
    this.castling = st.castling;
    this.ep = st.ep;
    this.halfmove = st.halfmove;
    this.fullmove = st.fullmove;
  }

  _repetitionKey() {
    const st = this._state();
    return toFen({
      board: st.board,
      turn: st.turn,
      castling: st.castling,
      ep: st.ep,
      halfmove: 0,
      fullmove: 1,
    }).split(' ').slice(0, 4).join(' ');
  }

  _bumpRepetition() {
    const key = this._repetitionKey();
    this._repetition[key] = (this._repetition[key] || 0) + 1;
  }

  fen() {
    return toFen(this._state());
  }

  /**
   * Legalne ruchy. Bez argumentow - wszystkie dla strony na posunieciu.
   * Z { square } - ruchy z danego pola.
   */
  moves({ square } = {}) {
    const st = this._state();
    const all = generateMoves(st);
    const filtered = square
      ? all.filter((m) => sqName(m.from) === square)
      : all;
    return filtered.map((m) => ({
      from: sqName(m.from),
      to: sqName(m.to),
      promotion: m.promotion,
      flags: m.flag || '',
      piece: m.piece,
      captured: m.captured,
      san: sanFor(st, m, all),
    }));
  }

  /** Wykonuje ruch, zwraca obiekt ruchu z SAN lub null gdy nielegalny. */
  move({ from, to, promotion }) {
    const st = this._state();
    const all = generateMoves(st);
    const fromSq = nameToSq(from);
    const toSq = nameToSq(to);

    let candidates = all.filter((m) => m.from === fromSq && m.to === toSq);
    if (!candidates.length) return null;

    if (candidates.length > 1) {
      const pr = (promotion || 'q').toLowerCase();
      const chosen = candidates.find((m) => m.promotion === pr);
      if (!chosen) return null;
      candidates = [chosen];
    }

    const m = candidates[0];
    const san = sanFor(st, m, all);
    const color = colorOf(m.piece);
    const undo = {
      state: cloneState(st),
      repetitionKey: this._repetitionKey(),
    };

    const live = this._state();
    applyMove(live, m);
    this._syncFrom(live);
    this._bumpRepetition();

    const record = {
      san,
      from,
      to,
      promotion: m.promotion,
      flags: m.flag || '',
      piece: m.piece,
      captured: m.captured,
      color,
      fen: this.fen(),
      undo,
    };
    this.history.push(record);
    return record;
  }

  /** Cofa ostatni ruch. Zwraca numer cofnietego ruchu lub null. */
  undo() {
    if (!this.history.length) return null;
    const last = this.history.pop();
    const st = last.undo.state;

    // usun powtorzenie biezacej pozycji
    this._repetition[this._repetitionKey()] -= 1;

    this.board = st.board;
    this.turn = st.turn;
    this.castling = st.castling;
    this.ep = st.ep;
    this.halfmove = st.halfmove;
    this.fullmove = st.fullmove;
    return this.history.length + 1;
  }

  /** Ustawia pozycje z FEN (bez historii). */
  load(fen) {
    this.reset(fen);
    return true;
  }

  colorAt(square) {
    const p = this.board[nameToSq(square)];
    return p ? colorOf(p) : null;
  }

  pieceAt(square) {
    return this.board[nameToSq(square)] || null;
  }

  inCheck(color = this.turn) {
    const st = this._state();
    const k = findKing(st, color);
    if (k === -1) return false;
    return isAttacked(st, k, color === 'w' ? 'b' : 'w');
  }

  isCheckmate() {
    return this.inCheck() && this.moves().length === 0;
  }

  isStalemate() {
    return !this.inCheck() && this.moves().length === 0;
  }

  isInsufficientMaterial() {
    const pieces = [];
    for (let s = 0; s < 64; s++) {
      const p = this.board[s];
      if (!p) continue;
      const t = typeOf(p);
      if (t === 'k') continue;
      pieces.push({ t, color: colorOf(p), square: s });
    }
    if (pieces.length === 0) return true;
    if (pieces.length === 1) {
      return pieces[0].t === 'b' || pieces[0].t === 'n';
    }
    if (pieces.length === 2 && pieces[0].t === 'b' && pieces[1].t === 'b') {
      const c0 = (fileOf(pieces[0].square) + rankOf(pieces[0].square)) % 2;
      const c1 = (fileOf(pieces[1].square) + rankOf(pieces[1].square)) % 2;
      return c0 === c1;
    }
    return false;
  }

  isThreefold() {
    return (this._repetition[this._repetitionKey()] || 0) >= 3;
  }

  isFiftyMove() {
    return this.halfmove >= 100;
  }

  isDraw() {
    return (
      this.isStalemate() ||
      this.isInsufficientMaterial() ||
      this.isThreefold() ||
      this.isFiftyMove()
    );
  }

  /** Zwraca null albo { result: '1-0'|'0-1'|'1/2-1/2', reason }. */
  gameOver() {
    if (this.isCheckmate()) {
      return {
        result: this.turn === 'w' ? '0-1' : '1-0',
        reason: 'checkmate',
      };
    }
    if (this.isStalemate()) return { result: '1/2-1/2', reason: 'stalemate' };
    if (this.isInsufficientMaterial()) return { result: '1/2-1/2', reason: 'insufficient' };
    if (this.isThreefold()) return { result: '1/2-1/2', reason: 'threefold' };
    if (this.isFiftyMove()) return { result: '1/2-1/2', reason: 'fiftymove' };
    return null;
  }

  pgn(result = '*') {
    const headers = [
      '[Event "Partia online"]',
      '[Site "Szachy Online"]',
      `[Date "${new Date().toISOString().slice(0, 10).replace(/-/g, '.')}"]`,
      '[White "?"]',
      '[Black "?"]',
      `[Result "${result}"]`,
      `[SetUp "1"]`,
      `[FEN "${this.startFen}"]`,
      '',
    ];
    let body = '';
    this.history.forEach((h, i) => {
      if (i % 2 === 0) body += `${i / 2 + 1}. `;
      body += `${h.san} `;
    });
    body += result;
    return headers.join('\n') + '\n' + body + '\n';
  }
}

export const SQUARES = (() => {
  const arr = [];
  for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) arr.push(sqName(idx(f, r)));
  return arr;
})();
