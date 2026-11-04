# MIEvents v2.0

App per **cercare, salvare e visualizzare su lista e mappa** gli eventi a Milano e in provincia.

PWA leggera (installabile, offline app shell): server Node.js **zero dipendenze runtime**, web React 19 + Vite con **mappa canvas custom** (niente librerie di mappa). Peso totale ~**250 kB raw / ~67 kB br**, tutto eager.

---

## Obiettivo

Selezionare **eventi low-cost in locali piccoli** nelle **prossime 2 settimane (15 giorni)**:

- **Fasce di prezzo** Gratis / fino a 10€ / fino a 20€ / Cari, con filtri API, chip e badge. Prezzo da JSON-LD `offers`, campo `cost` di The Events Calendar, `priceRanges` ticketing o testo ("gratis / € 12 / da 5 a 15 euro"). Outlier tipo 1€ di prevendita scartati quando il max ≥ 10€; "gratis" conta solo per ingresso/evento gratis, non per omaggi (birra/rinfresco).
- **Esclusione automatica di stadi, palazzetti, arene e grandi forum** (San Siro, Unipol/Mediolanum Forum, Arena Civica…) in fase di sync (`big=1`, mostrati solo con `?includeBig=1`).
- **Finestra temporale 15 giorni** allineata fra sync e vista; gli eventi passati sono nascosti di default (`includePast=1`/`all=1` li mostra).
- **Dedup** per titolo normalizzato + data (la stessa sagra su due location/comuni conta una volta).
- **Filtro prezzo globale**: `priceMax ≥ 35€` → evento scartato in sync (tutte le fonti), low-cost garantito.
- **Geolocalizzazione** via dizionario `venue-pins` (prima di Nominatim) + DB `venues` + geocoding Nominatim (cache, max 1 req/s, max 15/sync).

## Feature

- **Lista eventi**: ricerca full-text FTS5 (SQLite, case/accent-insensitive, query sanificate), filtri per testo, comune, categoria, date (validate `YYYY-MM-DD`), fascia prezzo, solo salvati, solo con geo, bounding box mappa.
- **Mappa `LightMap`** (canvas 2D custom, zero librerie): pan/pinch/wheel/zoom-to-point con Pointer Events, overzoom tile, marker quadrati per categoria + clustering (solo zoom < 11), popup ancorato, filtro per area visibile, clamp automatico al Nord Italia (zoom minimo dinamico). Tile raster servite dal **proxy proprio** `GET /tiles/{z}/{x}/{y}.png` (cache server 2000 tile + cache browser 1 giorno).
- **Salvataggio** ★ persistente in SQLite (`POST /api/events/:id {saved}`), filtro "solo salvati".
- **PWA**: manifest + icone, service worker (cache `v9`, app shell, esclude `/api/` e `/tiles/`), installabile.
- **Performance**: compressione gzip/br on-the-fly (con `Vary: Accept-Encoding` e cache per encoding), `Cache-Control: immutable` su `/assets/*`, `no-store` sulle API.

## Architettura

Monorepo npm workspaces, architettura esagonale (porte & adapter), flusso unidirezionale:

```
fetchers (outbound) -> core (normalizzazione pura) -> application/sync -> repositories/sqlite -> HTTP inbound -> web
```

```
server/src/
  core/               dominio puro: types, text, jsonld, rss, categorize, price, big-events, venue-pins
  application/        ports.ts + services/sync.ts (orchestrazione sorgenti -> DB -> geocoding) + venue-sync.ts
  adapters/
    inbound/http/     server.ts (API REST + static SPA + proxy /tiles/ + compressione)
    outbound/         fetchers/ (sorgenti), repositories/sqlite.ts (events+FTS5+venues+sync_state), geo/nominatim.ts
  config/             env
shared/               tipi TS condivisi (MiEvent, filtri, righe Socrata)
web/                  React 19 + Vite; src/components/LightMap.tsx (mappa canvas), App, EventCard, FiltersBar
```

- **Server**: Node ≥ 22, zero dipendenze runtime (`node:http` + `node:sqlite` + `fetch`), ~300 kB di `dist`, avvio < 100 ms.
- **Web**: React 19 + Vite, target `es2022`. Chunk: `index` ~22 kB (app + LightMap, eager) + `vendor` ~219 kB (React). Niente chunk lazy.
- **DB**: SQLite WAL (`busy_timeout`, migrazioni via `PRAGMA user_version`), tabella `events` + FTS5 + `venues` + `sync_state`.

### Avvio

```bash
npm install
npm run build     # shared + server + web
npm start         # server su http://localhost:3001 (sync iniziale + ogni 12h)
npm run dev       # server :3001 + vite :5173 (proxy /api)
npm test          # 54 test (node:test, DB in-memory, fetch mockato)
```

### API

| Metodo | Endpoint | Descrizione |
| --- | --- | --- |
| GET | `/api/health` | health check |
| GET | `/api/events?q=&city=&category=&from=&to=&bbox=&saved=1&priceBand=&includeBig=1&limit=&offset=` | lista filtrata (`category=saved` = solo salvati; default: grandi eventi esclusi, solo finestra 15gg) |
| GET | `/api/events/:id` | dettaglio evento |
| POST | `/api/events/:id` body `{"saved": bool}` | salva/desalva |
| GET | `/api/events/cities` · `/api/events/categories` | elenchi |
| GET | `/api/venues` | venue con coordinate |
| GET | `/api/sync/state` | ultima sync (incl. `last_sync_result`) |
| POST | `/api/sync?from=YYYY-MM-DD` | avvia sync in background: `202`, `409` se in corso, `400` data invalida, `401` se `SYNC_TOKEN` impostato e mancante |
| GET | `/tiles/{z}/{x}/{y}{@2x}.png` | proxy tile (Wikimedia → OSM fallback, validazione PNG, cache) |

`bbox` = `sud,ovest,nord,est` in gradi decimali.

### Variabili d'ambiente

| Variabile | Default | Significato |
| --- | --- | --- |
| `PORT` | `3001` | porta HTTP |
| `DB_PATH` | `server/data/mievents.db` | DB SQLite |
| `WEB_DIST` | `web/dist` | build web |
| `SYNC_ON_START` | `1` | sync all'avvio |
| `SYNC_INTERVAL_MS` | `43200000` (12h) | sync periodica |
| `SYNC_GEOCODE` / `SYNC_MAX_GEOCODE` | `1` / `15` | geocoding durante sync (Nominatim 1 req/s) |
| `SYNC_VENUES` | `1` | fase venue prima degli eventi |
| `SYNC_TOKEN` | — | se impostato, `POST /api/sync` richiede `Authorization: Bearer <token>` (timing-safe) |
| `DEBUG_SOURCES` | `0` | `1` abilita `GET /api/debug/source?source=...` |
| `TICKETING_SOURCES` | `0` | `1` riattiva Ticketmaster/Eventbrite/Bandsintown (servono le chiavi, off di default: producono quasi solo grandi eventi) |
| `TICKETMASTER_API_KEY` / `EVENTBRITE_USER_TOKEN` (+`EVENTBRITE_SEARCH=1`) / `BANDSINTWN_APP_ID` (+`BANDSINTWN_ARTISTS`) | — | chiavi opzionali, solo da env (mai in codice/log) |

## Connettori eventi

Formato normalizzato → tabella `events` + FTS5. Dettaglio campo-per-campo in `server/src/connectors.md`.

| Fonte | Stato | Formato |
| --- | --- | --- |
| Regione Lombardia — sagre/fiere provincia MI (2 risorse Socrata) | **attivo** | JSON SoQL (CC0), geo da `location`/`geo_x/y` |
| MilanoToday `/eventi/` + RSS canale eventi | **attivo** | listing HTML `dal/{from}/al/{to}/` → dettaglio con JSON-LD Event |
| Eventi@Milano, BASE Milano, Magazzini Generali (Tribe/TEC) | **attivo** | API `wp-json/tribe/events/v1` (Santeria via WP `eventi` + ACF) |
| Cheventi.it | **attivo** | listing HTML con JSON-LD (esclusi i concerti `candlelight`) |
| Metalitalia (agenda metal) | **attivo** | listing `category/agenda` → dettaglio `/evento/` con JSON-LD `Event` |
| Radio Punk (date punk DIY) | **attivo** | listing → riga `DD/MM/YYYY TITOLO 📍 CITTÀ @VENUE` (categoria concerto) |
| Alcatraz / Magnolia (WP CPT) | **attivo** | `wp-json/wp/v2/events` / `event_listing` (ACF date, skip canceled/sold_out, venue da pin) |
| Wikidata (QLever) | **attivo** | SPARQL, filtro bbox MI + finestra server-side |
| ViviMilano / MilanoEvents.it / Eventi@Milano RSS | **attivo** | RSS con euristiche evento + venue-hint + area MI |
| Ticketmaster / Eventbrite / Bandsintown | off di default (`TICKETING_SOURCES=1`) | API discovery; richiedono coordinate in provincia MI |
| ArciBellezza, teatro.it, concerti-italia.it | non raggiungibili | anti-bot (SG Captcha / 403) |

## Sicurezza (stato attuale)

- **Dipendenze**: `npm audit` 0 vulnerabilità; nessuna libreria di mappa (maplibre rimossa → GHSA-jrc7-96c5-q579 non più rilevante); popup React (escape automatico).
- **Header**: CSP `default-src 'self'` (+ `style-src 'unsafe-inline'`), `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`; API `no-store`, asset hashati `immutable`.
- **Endpoint mutanti**: `POST /api/sync` con `SYNC_TOKEN` opzionale (timing-safe) + mutex anti-concorrenza + input validato; `POST /api/events/:id` body JSON ≤ 64 kB (413/400).
- **Input API**: `q` sanificato per FTS5 (token quotati, max 8), `limit`/`offset` interi (400), `from`/`to` date reali (400, niente injection SoQL/SPARQL), `bbox` validato, `category`/`priceBand` allowlist; errori 500 generici (no leak).
- **Segreti**: nessun segreto nel repo; URL esterni negli errori **redacted** (query string rimossa → niente API key in log/risposte).
- **Tile**: solo via proxy `/tiles/` con validazione magic PNG e path `z/x/y` validati (no SSRF); upstream con UA identificativo conforme alle tile policy.
- **Statici**: path traversal bloccato (`path.resolve` + prefisso), SPA fallback sicuro, MIME corretti.
- Server a processo singolo, zero dipendenze runtime.

## Limiti e costi (free tier)

Sync ogni 12h, geocoding Nominatim max 15/sync a 1 req/s, delay 600–800 ms sulle sorgenti web, API key solo tier free. L'app resta gratis.

## Licenza

[Unlicense](LICENSE) (public domain). Dati eventi: Regione Lombardia (CC0). Mappa: tile © OpenStreetMap contributors · © Wikimedia Maps (via proxy `/tiles/`).
