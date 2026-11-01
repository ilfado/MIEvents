# MIEvents

App per cercare, salvare e visualizzare su **lista e mappa** gli eventi a Milano e in provincia.

## Connettori eventi (formato normalizzato → tabella `events` + FTS5)

Vedi `server/src/connectors.md` per il dettaglio campo-per-campo di ogni sito.

| Fonte | Stato | Formato | Note |
| --- | --- | --- | --- |
| Regione Lombardia — sagre/fiere provincia MI | **attivo** | JSON Socrata/SoQL (CC0) | 140+ eventi/anno verificati live |
| MilanoToday `/eventi/` | **attivo** | listing HTML `dal/{from}/al/{to}/` → dettaglio `/eventi/*.html` con **JSON-LD schema.org Event** | ~31 eventi/mese, venue+indirizzo da `location.address` |
| Eventbrite | predisposto, **off** | API v3 `events/search` (richiede `EVENTBRITE_TOKEN`) | senza token la API è 404 e le pagine sono anti-bot (405): no scraping |
| ArciBellezza `/eventi/` | **non raggiungibile** | — | protetto da challenge anti-bot SG Captcha (202) |
| teatro.it, concerti-italia.it | **non accessibili** | — | 403 (teatro.it) / 202 SG Captcha (concerti-italia.it) su HTML, RSS e sitemap |
| RSS notizie (MilanoToday/Il Giorno/Arci) | **rimossi** | — | contenevano cronaca, non eventi strutturati |

- **Ricerca full-text** su titolo, descrizione, comune, luogo e organizzatore via **FTS5** di SQLite (case-insensitive e senza distinzione accenti, token unicode61), con query MATCH sanificate.
- **Indicizzazione** in un database SQLite locale per **luogo (comune + indirizzo), data e tipologia**
  (categoria dedotta dal testo: sagra, fiera, concerto, teatro, mostra, sport, famiglia, altro).
- **Geocoding** degli indirizzi via [Nominatim/OpenStreetMap](https://nominatim.openstreetmap.org/) (rispettando il rate limit di 1 req/s) per la vista mappa.
- **Filtri**: testo libero (FTS5), comune, tipologia, intervallo di date (validato: `YYYY-MM-DD` reali, altrimenti errore 400), bounding box della mappa, solo salvati. La ricerca vuota ripristina l'elenco completo. **Di default gli eventi passati sono nascosti** (`end < oggi`); `includePast=1` li mostra tutti; un filtro data esplicito mostra anche il passato nel range. La sync dei connettori web prende solo eventi futuri.
- **Filtri rapidi**: chip **Oggi** e **Questo weekend** (ven–dom in arrivo) per la data, chip **Concerti / Mostre / Spettacoli** per la tipologia; filtri per luogo e date personalizzate nascosti dietro il menu **▼ Filtri**. Input date con font 16px: su mobile si apre il date picker nativo senza zoom automatico.
- **Salvataggio**: ogni evento può essere marcato come salvato (★) e filtrato con "Solo salvati"; lo stato persiste nel DB.
- **Vista mappa** con Leaflet/OpenStreetMap: marker colorati per categoria, popup con dettagli, filtro per area visibile.
- **Installabile** come PWA (manifest + icone; service worker con cache versionata e strategia network-first su HTML/asset, così gli aggiornamenti arrivano al primo reload), layout responsive mobile-first.

### Geolocalizzazione via tabella `venues`

I locali sono indicizzati in `venues(id, name, address, city, lat, lon)`: ogni evento con venue/indirizzo fa upsert del locale e **riusa le coordinate già geocodificate** (una sola chiamata Nominatim per venue, non per evento). API: `GET /api/venues`.

## Stack

- **Server**: Node.js ≥ 22 (zero dipendenze runtime: `node:http` + `node:sqlite` + `fetch`), TypeScript.
- **Web**: React 19 + Vite + react-leaflet con mappa caricata in **lazy-loading** (chunk separato, ~46 kB gzip), servita in produzione dallo stesso server (SPA fallback). Bundle iniziale ~72 kB gzip.
- **Dati**: [dati.lombardia.it](https://www.dati.lombardia.it) (CC0), geocoding Nominatim (ODbL), tiles © OpenStreetMap.

## Avvio

```bash
npm install
npm run build          # build di shared + server + web
npm start              # server su http://localhost:3001 (sync iniziale + ogni 6h)
```

In sviluppo, con hot reload separati:

```bash
npm run dev            # server :3001 + vite :5173 (proxy /api -> :3001)
```

La prima sync popola il DB interrogando la fonte pubblica e geocodifica i primi indirizzi. Per forzare una
sincronizzazione manuale: `POST /api/sync?from=YYYY-MM-DD`.

## API

| Metodo | Endpoint | Descrizione |
| --- | --- | --- |
| GET | `/api/events?q=&city=&category=&from=&to=&bbox=&saved=1` | Lista eventi filtrata (`category=saved` = solo salvati) |
| GET | `/api/events/:id` | Dettaglio evento |
| POST | `/api/events/:id` body `{"saved": bool}` | Salva / desalva |
| GET | `/api/events/cities` | Elenco comuni presenti |
| GET | `/api/events/categories` | Categorie disponibili |
| POST | `/api/sync?from=YYYY-MM-DD` | Sincronizza dalla fonte pubblica |
| GET | `/api/sync/state` | Ultima sincronizzazione |
| GET | `/api/health` | Health check |

`bbox` è `sud,ovest,nord,est` in gradi decimali.

## Test

```bash
npm test               # test unitari e API (node:test, DB in-memory, fetch mockato)
```

## Variabili d'ambiente (server)

| Variabile | Default | Significato |
| --- | --- | --- |
| `PORT` | `3001` | Porta HTTP |
| `DB_PATH` | `server/data/mievents.db` | Percorso DB SQLite |
| `WEB_DIST` | `web/dist` | Cartella della build web |
| `SYNC_ON_START` | `1` | Sync all'avvio (`0` per disabilitare) |
| `SYNC_GEOCODE` | `1` | Geocoding durante la sync (`0` per disabilitare) |
| `SYNC_MAX_GEOCODE` | `200` | Massimo indirizzi geocodificati per sync |
| `SYNC_INTERVAL_MS` | `21600000` | Intervallo sync periodica (6h) |
| `TICKETMASTER_API_KEY` | — | API key gratuita Ticketmaster Discovery (opzionale) |
| `EVENTBRITE_TOKEN` | — | Token personale Eventbrite (opzionale) |
| `BANDSINTWN_APP_ID` | — | App ID Bandsintown (opzionale) |

Le API key si impostano **solo come variabili d'ambiente nel deploy** (mai in chat o nel codice): su Render → Settings → Environment → Add Environment Variable. Senza chiavi i connettori restano spenti e gli altri continuano a funzionare.

## Struttura

```
shared/   tipi TypeScript condivisi (MiEvent, filtri, formato riga Socrata)
server/   API HTTP, DB SQLite + FTS5, sync multi-fonte (Socrata + RSS + JSON-LD),
          geocoding, query con filtri
web/      React + Vite + Leaflet (lista, mappa lazy, filtri, salvataggio, PWA)
```

## Perché non Rust/Go (per ora)

Il server attuale è **zero dipendenze runtime** su Node 22 (`node:http` + `node:sqlite` + `fetch` nativo): un singolo processo, nessun `node_modules` di runtime, binario di fatto il runtime stesso. Un rewrite in Go/Rust darebbe un binario statico più piccolo (~10-15 MB vs ~90 MB di Node) e avvii più rapidi, ma a fronte di riscrivere HTTP, SQLite (via CGO), parsing RSS/XML e test — un costo alto ora che la base dati sta crescendo. La struttura a moduli (`sync.ts`, `feeds.ts`, `query.ts`, `geocode.ts`) è già pronta per un porting: se il piano free stanca (memoria/CPU), il candidato ideale è **Go con modernc.org/sqlite** (SQLite embedded senza CGO), che mantiene l'approccio zero-C.

## Licenza

[Unlicense](LICENSE) (public domain). I dati degli eventi sono di Regione Lombardia (CC0); la mappa è © OpenStreetMap contributors (ODbL).
