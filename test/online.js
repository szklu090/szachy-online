/* Test integracyjny serwera: dwoch klientow rozgrywa partie przez WebSocket.
 * Uruchom:  node test/online.js
 * Test sam startuje serwer na wolnym porcie.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 3999;

let pass = 0;
let fail = 0;
const problems = [];
function check(label, cond, extra = '') {
  if (cond) {
    pass++;
    console.log(`OK    ${label}`);
  } else {
    fail++;
    problems.push(label);
    console.log(`BLAD  ${label}${extra ? '  -> ' + extra : ''}`);
  }
}

function startServer() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
      env: { ...process.env, PORT: String(PORT) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    const onData = (d) => {
      out += d.toString();
      if (out.includes('serwer uruchomiony')) resolve(child);
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', (d) => process.stderr.write(d));
    child.on('exit', (code) => reject(new Error('serwer zakonczyl sie: ' + code)));
    setTimeout(() => reject(new Error('serwer nie wystartowal w czasie')), 8000);
  });
}

class Client {
  constructor(name) {
    this.name = name;
    this.inbox = [];
    this.waiters = [];
    this.errors = [];
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
      this.ws.on('open', resolve);
      this.ws.on('error', reject);
      this.ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        const idx = this.inbox.push(msg) - 1;
        if (msg.t === 'error') this.errors.push(msg.message);
        this.waiters = this.waiters.filter((w) => {
          if (w.type === msg.t && (!w.pred || w.pred(msg, idx))) {
            clearTimeout(w.timer);
            w.resolve(msg);
            return false;
          }
          return true;
        });
      });
    });
  }

  send(obj) {
    this.ws.send(JSON.stringify(obj));
  }

  mark() {
    return this.inbox.length;
  }

  wait(type, pred = null, timeout = 6000) {
    const found = this.inbox.find((m, i) => m.t === type && (!pred || pred(m, i)));
    if (found) return Promise.resolve(found);
    return new Promise((resolve, reject) => {
      const w = { type, pred, resolve };
      w.timer = setTimeout(() => {
        this.waiters = this.waiters.filter((x) => x !== w);
        reject(new Error(`${this.name}: nie doczekano sie "${type}"`));
      }, timeout);
      this.waiters.push(w);
    });
  }

  /** Nowy stan spelniajacy predykat, ktory przyszedl po znaczniku `base`. */
  stateAfter(base, pred, timeout = 6000) {
    return this.wait('state', (m, i) => i >= base && pred(m), timeout);
  }

  /** Wysyla ruch i czeka na stan z dokladnie `len` ruchami w historii. */
  play(from, to, len, promo) {
    const base = this.mark();
    this.send({ t: 'move', from, to, promotion: promo });
    return this.stateAfter(base, (m) => m.history.length === len);
  }
}

async function main() {
  const server = await startServer();
  const A = new Client('A');
  const B = new Client('B');
  let B2 = null;

  try {
    await A.connect();
    await B.connect();

    // --- utworzenie pokoju ---
    A.send({ t: 'create', name: 'Ala', clientId: 'id-a', tc: null });
    const joinedA = await A.wait('joined');
    const room = joinedA.room;
    check('A tworzy pokoj i dostaje kolor bialy', joinedA.color === 'w');
    check('kod pokoju ma 6 znakow', /^[A-Z0-9]{6}$/.test(room), room);

    // --- dolaczenie B ---
    const a0 = A.mark();
    B.send({ t: 'join', room, name: 'Bob', clientId: 'id-b' });
    const joinedB = await B.wait('joined');
    check('B dolacza jako czarny', joinedB.color === 'b');

    const st0 = await A.stateAfter(a0, (m) => m.started === true);
    check('partia wystartowala po dolaczeniu obu graczy', st0.started === true);
    check('na starcie jest 20 legalnych ruchow', st0.legalCount === 20, String(st0.legalCount));

    // --- nielegalny ruch jest odrzucany ---
    B.send({ t: 'move', from: 'e7', to: 'e5' });
    const err = await B.wait('error');
    check('ruch poza koleja jest odrzucany', /kolej/i.test(err.message), err.message);

    // --- czat ---
    B.send({ t: 'chat', text: 'Czesc!' });
    const chat = await A.wait('chat', (m) => m.text === 'Czesc!' && m.name === 'Bob');
    check('czat dziala', chat.text === 'Czesc!');

    // --- cofniecie ruchu ---
    await A.play('e2', 'e4', 1);
    await B.play('e7', 'e5', 2);
    const b1 = B.mark();
    A.send({ t: 'undo', action: 'request' });
    const req = await B.stateAfter(b1, (m) => m.undoRequest === 'w');
    check('przeciwnik widzi prosbe o cofniecie', req.undoRequest === 'w');
    const a1 = A.mark();
    B.send({ t: 'undo', action: 'accept' });
    const stU = await A.stateAfter(a1, (m) => m.history.length === 0 && m.undoRequest === null);
    check('cofniecie ruchu przywraca pozycje startowa', stU.history.length === 0);

    // --- mat (scholar's mate) ---
    await A.play('e2', 'e4', 1);
    await B.play('e7', 'e5', 2);
    await A.play('f1', 'c4', 3);
    await B.play('b8', 'c6', 4);
    await A.play('d1', 'h5', 5);
    await B.play('g8', 'f6', 6);
    const mate = await A.play('h5', 'f7', 7);

    check('wykryto mata', !!mate.result && mate.result.reason === 'checkmate', JSON.stringify(mate.result));
    check('wynik to 1-0', !!mate.result && mate.result.result === '1-0');
    check('serwer sygnalizuje szacha przy macie', mate.check === true);
    const lastSan = mate.history[mate.history.length - 1].san;
    check('ostatni ruch ma SAN z #', lastSan.includes('#'), lastSan);

    // --- zapis ---
    A.send({ t: 'save' });
    const saved = await A.wait('saved');
    check('zapis zwraca 7 ruchow', saved.data.moves.length === 7, String(saved.data.moves.length));
    check('zapis zawiera PGN z matem', /#/.test(saved.data.pgn));
    check('PGN ma naglowek z wynikiem', /\[Result "1-0"\]/.test(saved.data.pgn));

    // --- odczyt (pozycja z 4 ruchami) ---
    const a2 = A.mark();
    B.send({
      t: 'load',
      data: { version: 1, startFen: saved.data.startFen, moves: saved.data.moves.slice(0, 4), timeControl: null },
    });
    const stL = await A.stateAfter(a2, (m) => m.history.length === 4 && !m.result);
    check('odczyt zapisu ustawia pozycje z 4 ruchami', stL.history.length === 4);

    // --- nielegalny zapis jest odrzucany ---
    B.errors.length = 0;
    B.send({ t: 'load', data: { startFen: saved.data.startFen, moves: [{ from: 'e2', to: 'e5' }] } });
    const err2 = await B.wait('error', (m) => /nielegalny/i.test(m.message));
    check('nielegalny zapis jest odrzucany', !!err2, err2 && err2.message);

    // --- brak materialu = remis (K vs K) ---
    const a3 = A.mark();
    B.send({ t: 'load', data: { startFen: '8/8/8/4k3/8/8/4K3/8 w - - 0 1', moves: [] } });
    const stK = await A.stateAfter(a3, (m) => m.result && m.result.reason === 'insufficient');
    check('K vs K to remis (brak materialu)', stK.result.result === '1/2-1/2');

    // wroc do pozycji startowej
    const a4 = A.mark();
    B.send({ t: 'load', data: { version: 1, startFen: saved.data.startFen, moves: [], timeControl: null } });
    await A.stateAfter(a4, (m) => m.history.length === 0 && m.result === null && m.legalCount === 20);

    // --- remis za zgoda ---
    const b3 = B.mark();
    A.send({ t: 'draw', action: 'offer' });
    const offer = await B.stateAfter(b3, (m) => m.drawOffer === 'w');
    check('przeciwnik widzi propozycje remisu', offer.drawOffer === 'w');
    const a5 = A.mark();
    B.send({ t: 'draw', action: 'accept' });
    const stD = await A.stateAfter(a5, (m) => m.result && m.result.reason === 'agreement');
    check('remis za zgoda konczy partie', stD.result.result === '1/2-1/2');

    // --- rewanz zamienia kolory ---
    const b4 = B.mark();
    A.send({ t: 'rematch', action: 'offer' });
    await B.stateAfter(b4, (m) => m.rematchOffer === 'w');
    const a6 = A.mark();
    B.send({ t: 'rematch', action: 'accept' });
    const reA = await A.stateAfter(a6, (m) => m.result === null && m.history.length === 0 && m.you === 'b');
    check('rewanz zamienia kolory (A gra teraz czarnymi)', reA.you === 'b');

    // --- reconnect: B (bialy po rewanzu) rozlacza sie i wraca ---
    const a7 = A.mark();
    B.ws.close();
    await A.stateAfter(a7, (m) => m.players.w && m.players.w.connected === false, 8000);
    B2 = new Client('B2');
    await B2.connect();
    B2.send({ t: 'join', room, name: 'Bob', clientId: 'id-b' });
    const j2 = await B2.wait('joined');
    check('reconnect przywraca miejsce bialych', j2.color === 'w', j2.color);
    const a8 = A.mark();
    await A.stateAfter(a8, (m) => m.players.w && m.players.w.connected === true);
    check('serwer widzi ponowne polaczenie', true);

    // --- nowa partia z zegarem ---
    const aNew = A.mark();
    A.send({ t: 'create', name: 'Ala', clientId: 'id-a', tc: { initial: 60000, increment: 0 } });
    const jc = await A.wait('joined', (m, i) => i >= aNew);
    check('A tworzy nowy pokoj z zegarem', jc.color === 'w' && jc.room !== room);
    const a9 = A.mark();
    B2.send({ t: 'join', room: jc.room, name: 'Bob', clientId: 'id-b2' });
    await B2.wait('joined');
    const started = await A.stateAfter(a9, (m) => m.started === true && m.clock && m.clock.w === 60000);
    check('zegar startuje na 1:00', started.clock.w === 60000 && started.clock.b === 60000);

    const clk = await A.wait('clock', (m) => m.running === 'w' && m.w < 60000, 4000);
    check('zegar bialego odlicza w dol', clk.w < 60000, String(clk.w));
    const stE4 = await A.play('e2', 'e4', 1);
    check('po ruchu zegar przechodzi na czarnego', stE4.clockRunning === 'b', String(stE4.clockRunning));

    // --- szach (1.e4 f5 2.Qh5+) ---
    await B2.play('f7', 'f5', 2);
    const stChk = await A.play('d1', 'h5', 3);
    check('serwer sygnalizuje szacha', stChk.check === true);
    check('SAN szacha ma +', stChk.history[2].san.includes('+'), stChk.history[2].san);

    // --- poddanie sie ---
    const a11 = A.mark();
    B2.send({ t: 'resign' });
    const stR = await A.stateAfter(a11, (m) => m.result && m.result.reason === 'resign');
    check('poddanie konczy partie wygrana bialego', stR.result.result === '1-0');

    // --- brak nieoczekiwanych bledow poza sprawdzonymi ---
    const unexpected = [...A.errors, ...B2.errors].filter((e) => !/kolej/i.test(e));
    check('brak nieoczekiwanych bledow serwera', unexpected.length === 0, unexpected.join(' | '));
  } catch (e) {
    fail++;
    problems.push('wyjatek');
    console.log('WYJATEK: ' + e.message);
    console.log('  ostatnie A: ' + A.inbox.slice(-3).map((m) => m.t).join(','));
    console.log('  bledy A: ' + (A.errors.join(' | ') || '(brak)'));
    console.log('  bledy B: ' + (B.errors.join(' | ') || '(brak)'));
    console.log('  bledy B2: ' + (B2 ? B2.errors.join(' | ') || '(brak)' : 'brak klienta'));
    const lastA = [...A.inbox].reverse().find((m) => m.t === 'state');
    if (lastA) console.log(`  ostatni stan A: hist=${lastA.history.length} turn=${lastA.turn} started=${lastA.started} result=${JSON.stringify(lastA.result)}`);
  } finally {
    A.ws && A.ws.close();
    B.ws && B.ws.close();
    B2 && B2.ws && B2.ws.close();
    server.kill();
  }

  console.log(`\n${pass}/${pass + fail} testow przeszlo`);
  if (problems.length) console.log('Nieudane: ' + problems.join(', '));
  process.exit(fail ? 1 : 0);
}

main();
