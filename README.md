# ♟ Szachy online

Gra w szachy dla dwóch osób przez internet. Serwer w Node.js, klient w przeglądarce,
komunikacja przez WebSocket. Serwer jest autorytatywny — to on waliduje każdy ruch,
prowadzi zegar i rozstrzyga wyniki, więc nie da się oszukiwać modyfikując klienta.

## Funkcje

**Zasady szachów (pełne):**
- wszystkie ruchy figur, szach, mat, pat
- bicie w przelocie (en passant) i promocja piona (z wyborem figury)
- roszada z kontrolą szacha i wolnych pól
- remisy: brak materiału do mata, reguła 50 posunięć, trzykrotne powtórzenie
- notacja SAN i FEN

**Tryb online:**
- pokoje z 6-znakowym kodem i linkiem do udostępnienia
- zegar szachowy (bullet / blitz / rapid / klasyczny + przyrost czasu, albo bez zegara)
- lista posunięć, czat, obrót planszy
- cofanie ruchu (za zgodą przeciwnika), propozycja remisu, poddanie się, rewanż z zamianą kolorów
- automatyczne ponowne łączenie po zerwaniu (zegar jest wtedy wstrzymany)
- zapis partii do pliku i wczytanie (JSON + eksport PGN do schowka)

## Wymagania

- Node.js 18 lub nowszy

## Instalacja i uruchomienie

```bash
npm install
npm start
```

Serwer wypisze adresy, np.:

```
Lokalnie:   http://localhost:3000
W sieci LAN: http://192.168.0.10:3000
```

Otwórz `http://localhost:3000` w przeglądarce, wpisz imię, wybierz tempo i kliknij
**Utwórz nowy pokój**. Skopiuj link (przycisk „Link”) i wyślij go drugiemu graczowi.

Port można zmienić zmienną środowiskową, np. `PORT=8080 npm start`.

## Publikacja na GitHubie

### Najpierw ważne: sam GitHub Pages tu nie zadziała

GitHub Pages umie hostować **tylko pliki statyczne**. Te szachy potrzebują działającego
serwera Node.js, który trzyma pokoje i przesyła ruchy przez WebSocket — a tego Pages nie
uruchomi. Sam `index.html` wrzucony na Pages połączyłby się z niczym.

Dlatego są dwa sensowne podejścia: **Codespaces** (szybko zacząć grać) albo
**hosting z Node.js** (stały własny adres).

### Krok 0 — wrzuć kod na GitHuba

Repozytorium git jest już zainicjowane lokalnie. Wystarczy je wypchnąć:

```bash
cd C:\Users\Szymon\szachy-online
git remote add origin https://github.com/TWOJ-LOGIN/szachy-online.git
git branch -M main
git push -u origin main
```

(Repozytorium utwórz najpierw na GitHubie — puste, bez README ani .gitignore.)

### Opcja A — GitHub Codespaces (najszybciej zacząć grać)

1. Wejdź na stronę repozytorium na GitHubie.
2. **Code ▾ → Codespaces → Create codespace on main**.
3. W terminalu Codespaces:
   ```bash
   npm install
   npm start
   ```
4. Otwórz zakładkę **Ports**, znajdź port **3000**, kliknij prawym → **Port Visibility → Public**.
5. Skopiuj adres `https://….app.github.dev` i wyślij go drugiemu graczowi.

Darmowy limit to ok. 120 godzin miesięcznie. Codespace usypia po kilku minutach
bezczynności — wystarczy go wtedy obudzić.

### Opcja B — prawdziwy hosting (stały adres)

Te serwisy podłączają się do Twojego repozytorium na GitHubie i same wdrażają zmiany po
każdym `git push`. Pliki konfiguracyjne są już w projekcie:

| Serwis | Jak zacząć | Plik w repo |
|---|---|---|
| **Render** | New + → Blueprint → wskaż repozytorium | `render.yaml` |
| **Railway** | New Project → Deploy from GitHub repo | `railway.json` |
| **Fly.io** | `fly launch` (zmień nazwę `app` w pliku) | `fly.toml` |
| **Koyeb / Cloud Run / VPS** | wdróż obraz z Dockerfile | `Dockerfile` |

Po wdrożeniu dostaniesz adres w rodzaju `https://szachy-online.onrender.com`. Klient sam
przełączy się na `wss://`, bo strona działa po HTTPS. Darmowe plany potrafią „usypiać”
aplikację — pierwsze połączenie może wtedy potrwać kilka sekund.

### Opcja C — testy automatyczne na GitHubie

Plik `.github/workflows/test.yml` uruchamia `npm test` przy każdym pushu i pull requeście.
Wynik zobaczysz w zakładce **Actions**. Zielony znaczek przy commicie oznacza, że silnik
szachowy i serwer przechodzą wszystkie 98 testów.

## Szybki tunel bez GitHuba

Jeśli chcesz tylko pokazać grę komuś raz, nie potrzebujesz wdrożenia — wystarczy tunel:

```bash
npx localtunnel --port 3000
# albo
cloudflared tunnel --url http://localhost:3000
```

Otrzymany publiczny adres przekaż drugiemu graczowi. Wystarczy, że Twój komputer jest
włączony i działa na nim `npm start`.

## Jak grać

- kliknij figurę i pole docelowe (albo przeciągnij figurę) — podświetlą się legalne ruchy
- punkty oznaczają ruch, pierścień oznacza bicie
- w menu bocznym znajdziesz czat, listę posunięć i akcje (cofnięcie, remis, poddanie, rewanż)
- klawisz `Esc` anuluje zaznaczenie lub zamyka okno dialogowe

## Zapis i odczyt partii

Przycisk **💾 Zapisz** pobiera plik `szachy-<kod>-<data>.json` zawierający pozycję startową,
listę ruchów i ustawienia zegara. Ten sam plik (albo ostatni zapis trzymany w przeglądarce)
możesz wczytać przyciskiem **📂 Wczytaj** — pozycja zostanie odtworzona u obu graczy.
Do schowka można też skopiować PGN (przycisk w powiadomieniu po zapisie).

## Testy

```bash
npm test              # wszystko
npm run test:perft    # poprawność silnika (standardowe pozycje perft)
npm run test:engine   # reguły, FEN, SAN, undo, mat/pat, roszada, promocja, e.p.
npm run test:online   # pełna partia dwóch klientów przez WebSocket + zegar + zapis/odczyt
```

Testy perft porównują liczbę węzłów z wartościami uznanymi za wzorcowe
(m.in. „Kiwipete” perft(3) = 97862), co bardzo skutecznie wykrywa błędy w roszadzie,
biciu w przelocie i promocji.

## Struktura projektu

```
szachy-online/
├─ server.js            serwer HTTP + WebSocket (autorytatywna logika, pokoje, zegar)
├─ public/
│  ├─ chess.js          silnik szachowy (wspólny dla serwera i przeglądarki)
│  ├─ index.html        interfejs
│  ├─ style.css         wygląd
│  └─ app.js            logika klienta (plansza, WebSocket, UI)
├─ test/
│  ├─ perft.js          testy poprawności silnika
│  ├─ engine.js         testy klasy Chess
│  └─ online.js         test integracyjny serwera
├─ .github/workflows/
│  └─ test.yml          testy automatyczne na GitHubie (Actions)
├─ Dockerfile           obraz produkcyjny
├─ render.yaml          wdrożenie na Render
├─ railway.json         wdrożenie na Railway
├─ fly.toml             wdrożenie na Fly.io
└─ package.json
```

## Bezpieczeństwo i prywatność

- Serwer waliduje każdy ruch — nielegalne ruchy są odrzucane.
- Imiona są czyszczone z znaków HTML, czat ma limit długości.
- Serwer trzyma partie wyłącznie w pamięci; po rozłączeniu obu graczy pokój jest usuwany.
