/* Testy klasy Chess (stan, FEN, SAN, undo, mat, pat, promocja, roszada, e.p.).
 * Uruchom:  node test/engine.js
 */
import { Chess, START_FEN } from '../public/chess.js';

let pass = 0;
let fail = 0;
function check(label, cond, extra = '') {
  if (cond) {
    pass++;
    console.log(`OK    ${label}`);
  } else {
    fail++;
    console.log(`BLAD  ${label}${extra ? '  -> ' + extra : ''}`);
  }
}

/* --- start i FEN --- */
{
  const c = new Chess();
  check('start: 20 legalnych ruchow', c.moves().length === 20, String(c.moves().length));
  check('start: FEN zgodny z START_FEN', c.fen() === START_FEN, c.fen());
  check('start: tura bialego', c.turn === 'w');
}

/* --- zmiana tury po ruchu --- */
{
  const c = new Chess();
  const rec = c.move({ from: 'e2', to: 'e4' });
  check('e4: ruch przyjety', !!rec);
  check('e4: tura przechodzi na czarnego', c.turn === 'b', c.turn);
  check(
    'e4: FEN z pionem na e4 i polem e.p.',
    c.fen() === 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1',
    c.fen(),
  );
  check('e4: SAN = e4', rec.san === 'e4', rec.san);
  check('e4: czarny ma 20 ruchow', c.moves().length === 20, String(c.moves().length));
}

/* --- undo przywraca dokladny stan --- */
{
  const c = new Chess();
  const seq = [
    ['e2', 'e4'], ['e7', 'e5'], ['g1', 'f3'], ['b8', 'c6'],
    ['f1', 'b5'], ['a7', 'a6'], ['b5', 'a4'], ['g8', 'f6'],
  ];
  for (const [f, t] of seq) c.move({ from: f, to: t });
  check('undo: 8 ruchow w historii', c.history.length === 8, String(c.history.length));
  check('undo: historia zamknieta podwojna roszada? nie (kontynuacja)', c.history.length === 8);
  for (let i = 0; i < 8; i++) c.undo();
  check('undo: powrot do pozycji startowej', c.fen() === START_FEN, c.fen());
  check('undo: historia pusta', c.history.length === 0);
  c.move({ from: 'd2', to: 'd4' });
  check('undo: silnik dziala dalej po cofnieciu', c.turn === 'b' && c.fen().includes('3P4'));
}

/* --- bicie w przelocie --- */
{
  const c = new Chess();
  c.move({ from: 'e2', to: 'e4' });
  c.move({ from: 'g8', to: 'f6' });
  c.move({ from: 'e4', to: 'e5' });
  c.move({ from: 'd7', to: 'd5' });
  const ep = c.moves({ square: 'e5' }).find((m) => m.to === 'd6');
  check('e.p.: ruch e5-d6 istnieje', !!ep);
  check('e.p.: oznaczony jako bicie', !!ep && !!ep.captured);
  c.move({ from: 'e5', to: 'd6' });
  check('e.p.: pion bialego na d6', c.pieceAt('d6') === 'P', String(c.pieceAt('d6')));
  check('e.p.: czarny pion z d5 zniknal', c.pieceAt('d5') === null, String(c.pieceAt('d5')));
  check('e.p.: pole e5 puste', c.pieceAt('e5') === null, String(c.pieceAt('e5')));
}

/* --- roszada --- */
{
  const c = new Chess('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
  const moves = c.moves({ square: 'e1' });
  check('roszada: krol ma O-O i O-O-O', moves.some((m) => m.san === 'O-O') && moves.some((m) => m.san === 'O-O-O'));
  c.move({ from: 'e1', to: 'g1' });
  check('roszada: krol na g1', c.pieceAt('g1') === 'K', String(c.pieceAt('g1')));
  check('roszada: wieza na f1', c.pieceAt('f1') === 'R', String(c.pieceAt('f1')));
  check('roszada: pole h1 puste', c.pieceAt('h1') === null);
  check('roszada: prawa bialego odebrane', !c.castling.wK && !c.castling.wQ);
  check('roszada: prawa czarnego nadal sa', c.castling.bK && c.castling.bQ);
}

/* --- roszada zablokowana szachem --- */
{
  const c = new Chess('4k3/8/8/8/8/8/8/4K2R w K - 0 1');
  check('roszada: dostepna gdy nic nie blokuje', c.moves({ square: 'e1' }).some((m) => m.san === 'O-O'));
  const c2 = new Chess('4k3/8/8/8/8/8/6r1/4K2R w K - 0 1');
  check('roszada: zablokowana gdy f1 atakowane', !c2.moves({ square: 'e1' }).some((m) => m.san === 'O-O'));
}

/* --- promocja --- */
{
  const c = new Chess('8/P7/8/8/8/8/7p/4K2k w - - 0 1');
  const promo = c.moves({ square: 'a7' }).filter((m) => m.to === 'a8');
  check('promocja: 4 warianty', promo.length === 4, String(promo.length));
  const rec = c.move({ from: 'a7', to: 'a8', promotion: 'q' });
  check('promocja: hetman na a8', c.pieceAt('a8') === 'Q', String(c.pieceAt('a8')));
  check('promocja: SAN zaczyna sie od a8=Q', rec.san.startsWith('a8=Q'), rec.san);
  check('promocja: kolej na czarnego', c.turn === 'b');
}

/* --- dwuznacznosc w notacji SAN --- */
{
  const c = new Chess('8/2k5/8/8/8/8/4K3/R6R w - - 0 1');
  const a = c.moves({ square: 'a1' }).find((m) => m.to === 'd1');
  const h = c.moves({ square: 'h1' }).find((m) => m.to === 'd1');
  check('SAN: wieza z a1 = Rad1', !!a && a.san === 'Rad1', a && a.san);
  check('SAN: wieza z h1 = Rhd1', !!h && h.san === 'Rhd1', h && h.san);
}

/* --- mat i pat --- */
{
  const mate = new Chess('rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3');
  check('mat: wykryty', mate.isCheckmate());
  check('mat: gameOver = 0-1', mate.gameOver() && mate.gameOver().result === '0-1');
  check('mat: brak legalnych ruchow', mate.moves().length === 0);

  const stale = new Chess('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
  check('pat: wykryty', stale.isStalemate());
  check('pat: to remis', stale.gameOver() && stale.gameOver().result === '1/2-1/2');
  check('pat: nie ma szacha', !stale.inCheck());
}

/* --- reguly remisowe --- */
{
  const bare = new Chess('8/8/8/4k3/8/8/4K3/8 w - - 0 1');
  check('remis: K vs K', bare.isInsufficientMaterial());
  const bn = new Chess('8/8/8/4k3/8/8/4KB2/8 w - - 0 1');
  check('remis: K+B vs K', bn.isInsufficientMaterial());

  const rep = new Chess();
  const cycle = [
    ['g1', 'f3'], ['g8', 'f6'], ['f3', 'g1'], ['f6', 'g8'],
    ['g1', 'f3'], ['g8', 'f6'], ['f3', 'g1'], ['f6', 'g8'],
  ];
  for (const [f, t] of cycle) rep.move({ from: f, to: t });
  check('remis: trzykrotne powtorzenie', rep.isThreefold());
}

/* --- PGN --- */
{
  const c = new Chess();
  c.move({ from: 'e2', to: 'e4' });
  c.move({ from: 'e7', to: 'e5' });
  c.move({ from: 'g1', to: 'f3' });
  const pgn = c.pgn('*');
  check('PGN: zawiera numeracje', /\n1\. e4 e5 2\. Nf3 \*/.test(pgn), JSON.stringify(pgn.slice(-40)));
}

/* --- FEN w obie strony --- */
{
  const fen = 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3';
  const c = new Chess(fen);
  check('FEN: odczyt i zapis identyczne', c.fen() === fen, c.fen());
  check('FEN: bierze pod uwage ture i prawa', c.turn === 'w' && c.castling.wK && c.castling.bQ);
}

console.log(`\n${pass}/${pass + fail} testow przeszlo`);
process.exit(fail ? 1 : 0);
