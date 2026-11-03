# MIEvents v1.3

> v1.3.0 — focus **eventi medio-piccoli a basso costo**: fasce di prezzo (Gratis / fino a 10€ / fino a 20€ / Cari) con filtro API, chip e badge; esclusione di stadi/palazzetti/arene grandi; sorgenti ticketing (Ticketmaster/Eventbrite/Bandsintown) **off di default** (`TICKETING_SOURCES=1` per riattivarle); eventiatmilano con lookback 180gg (recupera anche mostre lunghe già in corso) e paginazione tollerante ai 404; MilanoToday con estrazione link più robusta e prezzo dal testo della pagina evento.

---
> v1.2.0 — hardening & data quality: sicurezza (maplibre 6.16.0, audit 0 vulns), geo rigorosa (solo provincia MI con coordinate), Santeria doppia sede, sorgenti 0-eventi fixate (ACF/RSS venue-hint), debug API (DEBUG_SOURCES=1).

## Changelog v1.2.0 (da v1.1.0)
- Security: maplibre-gl 6.16.0 (GHSA-jrc7-96c5-q579), `npm audit` 0; review XSS/SQL/path/secrets.
- Geo strict: Ticketmaster/Eventbrite/Bandsintown richiedono coordinate in box MI; venue-pins con match per token (Santeria Toscana 31 + Paladini 8, Unipol Dome fix).
- Data yield: Santeria da ACF `all_meta`; RSS con venue-hint e pubDate fallback; Wikidata senza filtro data server-side.
- Debug: `GET /api/debug/source?source=...` con `DEBUG_SOURCES=1`; log `[sync]` per sorgente; retry backoff su 429.

---
> v1.1.0 — focus **data quality**: finestra 15gg allineata fra sync e vista, date range dal testo ("dal X al Y"), dizionario venue-pins prima del geocoder, rate-limit free-tier (sync 12h, geocode 15/sync), fix API Ticketmaster/Eventbrite, mappa MapLibre con limiti Nord Italia.

## Changelog v1.1.0 (rispetto a v1.0.0)
- Data quality: `dal X al Y mese` riconosciuto nei testi RSS; sorgenti Socrata filtrano anche `data_in <= +15gg` (sync = vista).
- Geo: dizionario `venue-pins` consultato prima di Nominatim (match nome+indirizzo), coordinate persistite in `venues`.
- Costi: sync ogni 12h, geocoding max 15/sync @1 req/s, delay sorgenti web, API key solo tier free.
- API fix: Ticketmaster date `YYYY-MM-DDTHH:mm:ssZ`; Eventbrite search gated (`EVENTBRITE_USER_TOKEN` + `EVENTBRITE_SEARCH=1`).
- Mappa: MapLibre GL `maxBounds` Nord Italia, zoom 7–17; chunk vendor-map lazy (210 kB gzip).

--- lista + mappa MapLibre (limiti Nord Italia), filtri rapidi, salvataggio, multi-fonte (open data + JSON-LD + RSS + API key opzionali).

App per cercare, salvare e visualizzare su **lista e mappa** gli eventi a Milano e in provincia.

## Connettori eventi (formato normalizzato → tabella `events` + FTS5)

Vedi `server/src/connectors.md` per il dettaglio campo-per-campo di ogni sito.

| Fonte | Stato | Formato | Note |
| --- | --- | --- | --- |
| Regione Lombardia — sagre/fiere provincia MI | **attivo** | JSON Socrata/SoQL (CC0) | 140+ eventi/anno verificati live |
| MilanoToday `/eventi/` | **attivo** | listing HTML `dal/{from}/al/{to}/` → dettaglio `/eventi/*.html` con **JSON-LD schema.org Event** | ~31 eventi/mese, venue+indirizzo da `location.address` |
| Eventbrite | predisposto, **off** | API v3 `events/search` (richiede user token in `EVENTBRITE_USER_TOKEN`) | senza token la API è 404 e le pagine sono anti-bot (405): no scraping |
| ArciBellezza `/eventi/` | **non raggiungibile** | — | protetto da challenge anti-bot SG Captcha (202) |
| teatro.it, concerti-italia.it | **non accessibili** | — | 403 (teatro.it) / 202 SG Captcha (concerti-italia.it) su HTML, RSS e sitemap |
| RSS notizie (MilanoToday/Il Giorno/Arci) | **rimossi** | — | contenevano cronaca, non eventi strutturati |

- **Ricerca full-text** su titolo, descrizione, comune, luogo e organizzatore via **FTS5** di SQLite (case-insensitive e senza distinzione accenti, token unicode61), con query MATCH sanificate.
- **Indicizzazione** in un database SQLite locale per **luogo (comune + indirizzo), data e tipologia**
  (categoria dedotta dal testo: sagra, fiera, concerto, teatro, mostra, sport, famiglia, altro).
- **Geocoding** degli indirizzi via [Nominatim/OpenStreetMap](https://nominatim.openstreetmap.org/) (rispettando il rate limit di 1 req/s) per la vista mappa.
- **Filtri**: testo libero (FTS5), comune, tipologia, intervallo di date (validato: `YYYY-MM-DD` reali, altrimenti errore 400), bounding box della mappa, solo salvati. La ricerca vuota ripristina l'elenco completo. **Di default gli eventi passati sono nascosti** (`end < oggi`); `includePast=1` li mostra tutti; un filtro data esplicito mostra anche il passato nel range. La sync dei connettori web prende solo eventi futuri.
- **Filtri rapidi**: chip **Oggi** e **Questo weekend** (ven–dom in arrivo) per la data, chip **Concerti / Mostre / Spettacoli** per la tipologia; filtri per luogo e date personalizzate nascosti dietro il menu **▼ Filtri**. Input date con font 16px: su mobile si apre il date picker nativo senza zoom automatico.
- **Fasce di prezzo**: ogni evento porta `priceMin`/`priceMax` (da JSON-LD `offers`, campo `cost` di The Events Calendar, `priceRanges` Ticketmaster o testo tipo "gratis / € 12 / da 5 a 15 euro") e una `priceBand`: `gratis`, `fino10`, `fino20`, `cari` (> 20 €, tag "Cari"). Filtro via API (`?priceBand=cari`), chip dedicate e badge sulla card (GRATIS / prezzo / CARI). Prezzo non pubblicato → banda nulla, evento comunque visibile.
- **Grandi eventi esclusi**: stadi, palazzetti, arene e grandi forum (San Siro, Unipol/Mediolanum Forum di Assago, Arena Civica…) vengono scartati in fase di sync e nascosti di default (`big=1` nel DB; `?includeBig=1` li mostra). Restano club, teatri, circoli, sagre, mostre e happening a basso costo.
- **Salvataggio**: ogni evento può essere marcato come salvato (★) e filtrato con "Solo salvati"; lo stato persiste nel DB.
- **Vista mappa** con Leaflet/OpenStreetMap: marker colorati per categoria, popup con dettagli, filtro per area visibile.
- **Installabile** come PWA (manifest + icone; service worker con cache versionata e strategia network-first su HTML/asset, così gli aggiornamenti arrivano al primo reload), layout responsive mobile-first.

### Geolocalizzazione via DB `venues` (costruito PRIMA degli eventi)

I locali sono indicizzati in `venues(id, name, address, city, lat, lon, source)`. Ogni sync esegue prima una
**fase venue** (`runVenueSync`) che popola il DB da fonti autorevoli: **Ticketmaster search venues**
(`venues.json?latLong=45.4642,9.19&radius=100&unit=km`, coordinate già pronte, zero Nominatim) e la
**directory circoli ARCI** (`portale.arci.it`, sedi provincia MI). Le venue vengono cross-checkate con quelle
già registrate (match per nome case-insensitive) e i **pin curati** (`core/venue-pins.ts`) vincono sempre sulle
coordinate delle API. Poi gli eventi riutilizzano le coordinate del venue (`coordsFor`, match anche per
contenimento nome): **una sola chiamata Nominatim per venue, non per evento**. API: `GET /api/venues`.
Disabilitare la fase venue con `SYNC_VENUES=0`.

## Stack

- **Server**: Node.js ≥ 22 (zero dipendenze runtime: `node:http` + `node:sqlite` + `fetch`), TypeScript.
- **Web**: React 19 + Vite, **zero librerie di mappa** (canvas custom pixel con pan/zoom liberi, marker quadrati, clustering, popup — niente lock di Leaflet), mappa in lazy chunk (~2.6 kB gzip), servita in produzione dallo stesso server. Bundle iniziale ~73 kB gzip.
- **Finestra temporale default**: la vista principale mostra solo eventi **da oggi a +15 giorni e con geolocalizzazione**; `?all=1` (o `includePast=1`) mostra tutto lo storico. Le sorgenti sincronizzano solo la finestra 15 giorni. Paginazione `limit`/`offset` con pulsante "carica altri".
- **Dati**: [dati.lombardia.it](https://www.dati.lombardia.it) (CC0), geocoding Nominatim (ODbL), tiles © OpenStreetMap.

## Limiti e costi (free tier)

L'app è pensata per restare **gratis**: sync ogni 12h, geocoding Nominatim max 15/sync a 1 req/s (policy OSM), sorgenti web con delay 600–800ms e limiti per pagina; le API key (Ticketmaster/Eventbrite/Bandsintown) usano i tier free. La mappa usa tile OSM raster (cache lato browser).

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
| GET | `/api/events?q=&city=&category=&from=&to=&bbox=&saved=1&priceBand=&includeBig=1` | Lista eventi filtrata (`category=saved` = solo salvati; `priceBand=gratis|fino10|fino20|cari`; di default i grandi eventi sono esclusi, `includeBig=1` li include) |
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
| `SYNC_MAX_GEOCODE` | `15` | Massimo indirizzi geocodificati per sync (Nominatim 1 req/s → 15/sync = ~0 costo) |
| `SYNC_VENUES` | `1` | Fase di sync dei venue (Ticketmaster venues 100 km + circoli ARCI) prima degli eventi (`0` per disabilitare) |
| `SYNC_INTERVAL_MS` | `43200000` | Intervallo sync periodica (12h — per stare nei limiti gratuiti) |
| `TICKETMASTER_API_KEY` | — | API key gratuita Ticketmaster Discovery (opzionale) |
| `EVENTBRITE_USER_TOKEN` | — | **User OAuth token** Eventbrite (flusso authorization-code + consenso, scope `public`) — diverso dalla api/private key |
| `EVENTBRITE_SEARCH` | `0` | `1` solo se hai user token valido: abilita il connettore search (di default spento) |
| `BANDSINTWN_APP_ID` | — | API key Bandsintown (da artist.bandsintown.com → Settings → Get API Key). L'API è **artist-only**: il connettore interroga `/artists/{nome}/events` |
| `BANDSINTWN_ARTISTS` | lista default di ~50 artisti italiani | Elenco artisti separati da virgola per Bandsintown (max 25/sync); gli eventi vengono filtrati per provincia di Milano via coordinate |
| `TICKETING_SOURCES` | `0` | `1` riattiva le sorgenti ticketing (Ticketmaster/Eventbrite/Bandsintown, servono anche le rispettive chiavi): di default **off** perché producono quasi solo grandi concerti in stadi/palazzetti |

Le API key si impostano **solo come variabili d'ambiente nel deploy** (mai in chat o nel codice): su Render → Settings → Environment → Add Environment Variable. Senza chiavi i connettori restano spenti e gli altri continuano a funzionare.

## Struttura (architettura esagonale / ports & adapters)

```
server/src/
  core/                 dominio puro, zero dipendenze I/O: types, text utils, jsonld, rss, categorize
  application/          ports.ts (EventRepository, VenueRepository, Geocoder, EventSource, SyncService)
                        services/sync.ts (orchestrazione sorgenti → persistenza → geocoding)
  adapters/
    inbound/http/       server.ts (API REST + static SPA), main.ts (bootstrap, config, scheduler)
    outbound/
      fetchers/         sorgenti eventi: lombardia (Socrata), milanotoday, cheventi, wikidata (QLever),
                        wp-venues (Santeria), news-rss, ticketing (Ticketmaster/Eventbrite/Bandsintown)
      repositories/     sqlite.ts (events + FTS5 + venues + sync_state)
      geo/              nominatim.ts (geocoding con cache in-memory, 1 req/s)
  config/               variabili d'ambiente
shared/   tipi TypeScript condivisi (MiEvent, filtri, formato riga Socrata)
web/      React + Vite + Leaflet (lista, mappa lazy, filtri, salvataggio, PWA)
```

Il flusso è unidirezionale: `fetchers` (outbound) → `core` (normalizzazione) → `application/sync`
→ `repositories` (outbound). L'HTTP inbound chiama solo porte dell'application layer.

## Perché non Rust/Go (ora, su free tier)

Il server resta **zero dipendenze runtime** su Node 22 (`node:http` + `node:sqlite` + `fetch`): un solo
processo, ~300 kB di `dist`, nessun `node_modules` a runtime, avvio <100 ms — ideale sul free tier
(che premia memoria/CPU basse, non la dimensione del binario). Go/Rust darebbero un binario statico
~10 MB, ma richiederebbero di riscrivere HTTP, SQLite (CGO o modernc), parsing e test: costo alto,
beneficio scarso finché il free tier regge. Se in futuro stanca, il candidato è **Go + modernc.org/sqlite**;
l'architettura a porte lo rende un porting meccanico per adapters, non un rewrite.

## Licenza

[Unlicense](LICENSE) (public domain). I dati degli eventi sono di Regione Lombardia (CC0); la mappa è © OpenStreetMap contributors (ODbL).
