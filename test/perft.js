/* Test poprawnosci silnika - perft na standardowych pozycjach.
 * Uruchom:  npm test
 * Kazda pozycja ma znana, poprawna liczbe wezlow na danej glebokosci.
 */
import { parseFen, generateMoves, applyMove, cloneState } from '../public/chess.js';

function perft(st, depth) {
  if (depth === 0) return 1;
  const moves = generateMoves(st);
  if (depth === 1) return moves.length;
  let nodes = 0;
  for (const m of moves) {
    const next = cloneState(st);
    applyMove(next, m);
    nodes += perft(next, depth - 1);
  }
  return nodes;
}

const TESTS = [
  {
    name: 'Pozycja startowa',
    fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    expected: [20, 400, 8902, 197281],
  },
  {
    name: 'Kiwipete (roszady, en passant)',
    fen: 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
    expected: [48, 2039, 97862],
  },
  {
    name: 'Pozycja 3 (piony)',
    fen: '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1',
    expected: [14, 191, 2812, 43238, 674624],
  },
  {
    name: 'Pozycja 4 (promocje)',
    fen: 'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1',
    expected: [6, 264, 9467, 422333],
  },
  {
    name: 'Pozycja 5',
    fen: 'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8',
    expected: [44, 1486, 62379],
  },
  {
    name: 'Pozycja 6',
    fen: 'r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10',
    expected: [46, 2079, 89890],
  },
];

let total = 0;
let failed = 0;

for (const t of TESTS) {
  for (let d = 1; d <= t.expected.length; d++) {
    const st = parseFen(t.fen);
    const got = perft(st, d);
    const want = t.expected[d - 1];
    total++;
    const ok = got === want;
    if (!ok) failed++;
    console.log(
      `${ok ? 'OK  ' : 'BLAD'}  perft(${d})  ${got}${ok ? '' : ' != ' + want}   [${t.name}]`,
    );
  }
}

console.log(`\n${total - failed}/${total} testow przeszlo`);
if (failed) process.exit(1);
