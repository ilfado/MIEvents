# Connettori eventi — formato e stato

Ogni connettore è un `EventSource` in `server/src/adapters/outbound/fetchers/` e produce `EventDraft`
(core), poi persistito via `EventRepository` (SQLite + FTS5). Vedi `application/ports.ts` per i contratti.

## Connettori ATTIVI (senza chiave)

| Fonte | Endpoint | Formato | Verifica live |
| --- | --- | --- | --- |
| Regione Lombardia sagre/fiere | `dati.lombardia.it/resource/f2tm-32s5.json` (SoQL) | JSON Socrata | 140 eventi |
| **Regione Lombardia sagre/fiere area pubblica (tutta la prov.)** | `dati.lombardia.it/resource/hs8z-dcey.json` (SoQL, CC0, agg. settimanale) | JSON Socrata con `location` GeoJSON Point → lat/lon diretti | 14 eventi futurs in prov. MI, 14/14 con geo (live) |
| MilanoToday Eventi | `milanotoday.it/eventi/dal/{from}/al/{to}/` → `/eventi/*.html` | JSON-LD `Event` | 7 futurs |
| **The Events Calendar (TEC) — BASE Milano, Magazzini Generali, Eventi@Milano** | `{base}/wp-json/tribe/events/v1/events?per_page=100&start_date={from}&end_date={to}&page=N` | WP REST JSON: `title,start_date,end_date,venue{venue,address,city,zip,province},url,categories` | 26 eventi (BASE 11 + Magazzini 7 + Eventi@Milano 8, live) |
| **Cheventi.it** | `cheventi.it/regioni/lombardia[/milano]/` (pagine `page/N/`) | **JSON-LD `ItemList` di `Event` nel listing**, con `location.geo` già incluso | 15 eventi, tutti in provincia MI (filtro bbox 44.9–46.1 / 8.4–10.6) |
| **Wikidata via QLever** | `qlever.dev/api/wikidata?query=SPARQL` | SPARQL JSON (`P31/P279* Q1656682`, `P625`, `P131* Q490`, `P585` >= oggi) | eventi noti con coordinate |
| **Santeria Milano** | `santeria.milano.it/wp-json/wp/v2/eventi` | WP REST JSON (data estratta dal testo) | eventi club |
| **RSS testate** (ViviMilano spettacoli, MilanoEvents, Eventi@Milano concerti) | feed RSS pubblici | RSS → filtro keyword evento + area MI + data da testo/pubDate | normalizzati in `events` |

## Connettori con API key gratuita (attivabili via env, MAI in chat/codice)

| Servizio | Env var | Come obtenirla |
| --- | --- | --- |
| Ticketmaster Discovery | `TICKETMASTER_API_KEY` | developer.ticketmaster.com → New App → "Discovery API" key istantanea |
| Eventbrite | `EVENTBRITE_TOKEN` | eventbrite.com → Account → App Keys → crea app → token personale |
| Bandsintown | `BANDSINTWN_APP_ID` + opz. `BANDSINTWN_ARTISTS` | artist.bandsintown.com → Settings → General → **Get API Key** |

### Bandsintown — nota importante (API artist-only)
L'API pubblica ufficiale espone **solo** `/artists/{nome}/events` (e `/artists/{nome}`): **non esiste un endpoint per eventi per città/area** (confermato dalla doc ufficiale e da anni di segnalazioni: `/v4/events?location=...` risponde 403). Quindi il connettore interroga una **lista di artisti** e filtra gli eventi per coordinate dentro la provincia di Milano:
- default: lista preimpostata di ~50 artisti italiani noti (`DEFAULT_BIT_ARTISTS`);
- personalizzabile con env `BANDSINTWN_ARTISTS=Coez, Mahmood, ...` (max 25 per sync).
La pagina che hai trovato (apis.io "artist events API") è proprio questo endpoint artist-based — la chiave che hai preso va bene.

Le chiavi si impostano come **Environment Variables** nel deploy (es. Render: Settings → Environment), non nel codice né in chat. Il server le legge con `apiKeysFromEnv()` e attiva i connettori solo se presenti.

## NON accessibili (anti-bot) — esclusi
teatro.it (403), concerti-italia.it (202 SG Captcha), arcibellezza.it (202 SG Captcha), eventbrite.com HTML (405), yesmilano.it (403), zero.eu (no feed), Teatro alla Scala/Piccolo/HangarBicocca (no API pubblica).

Ogni connettore produce `ConnectorEvent` normalizzato, poi convertito in `MiEvent` e indicizzato
nel DB (tabella `events`) con indice full-text FTS5. Filtri supportati: testo (FTS5), comune,
categoria, intervallo date, bounding box, salvati.

## 1. Regione Lombardia — open data (ATTIVO)
- **Endpoint**: `https://www.dati.lombardia.it/resource/f2tm-32s5.json` (Socrata/SoQL, CC0)
- **Formato**: JSON, paginato con `$query` SoQL (`WHERE upper(prov)='MI' AND data_in >= ...`)
- **Campi mappati**: `denom`→title, `descriz`→description, `data_in`/`data_fine`→start/end,
  `comune`/`prov`/`indirizzo`/`toponimo`/`cap`→luogo, `tipo`→type, `nome_org`→organizer,
  `sito_web`/`url_programma`→link
- **Stato**: stabile, verificato live (140+ eventi/anno in provincia MI)

## 1b. Regione Lombardia — sagre/fiere su area pubblica, geo incluso (ATTIVO)
- **Endpoint**: `https://www.dati.lombardia.it/resource/hs8z-dcey.json` (Socrata/SoQL, CC0, agg. settimanale)
- **Formato**: JSON; filtro `WHERE upper(prov)='MI' AND data_in >= '{from}' AND denom IS NOT NULL`, paginato LIMIT/OFFSET 500
- **Geo**: campo `location` GeoJSON `{"type":"Point","coordinates":[lon,lat]}` (fallback `geo_x`/`geo_y`) → lat/lon senza Nominatim; guard client-side `prov='MI'` + bbox provincia
- **Campi mappati**: come 1. (`denom, descriz, data_in/data_fine, ora_in/ora_fine, toponimo, indirizzo, civico, cap, comune, prov, url_programma, nome_org`)
- **Stato**: verificato live — 14 sagre/fiere futurs in prov. MI, 14/14 georeferenziate (Inveruno, Paderno Dugnano, Gorgonzola…)

## 1c. The Events Calendar (TEC) — venue WP (ATTIVO)
- **Endpoint** (per sito): `{base}/wp-json/tribe/events/v1/events?per_page=100&start_date={from}&end_date={to}&page=N`
- **Siti attivi**: `base.milano.it` (BASE Milano), `www.magazzinigenerali.org`, `www.eventiatmilano.it` (aggregatore editoriale)
- **Formato**: WP REST JSON; campi `title, description, start_date/end_date ("YYYY-MM-DD HH:mm:ss", Europe/Rome), all_day, url, website, venue{venue,address,city,province,zip}, organizer, categories`
- **Mappatura**: `start_date`→start + timeStart (null se all_day), `venue.venue`→venue, `venue.address/zip/city/province`→address, city default MILANO; filtro finestra `fromDate..toDate`, dedup per `url`, max pagine via `limits["<sourceId>Pages"]` (default 3)
- **Nota**: l'export `.ics` (`/events.ics`) non è esposto via REST su questi siti (404): si usa solo il JSON
- **Pin location BASE Milano**: BASE è uno spazio singolo → gli eventi `tribe-base` convergono tutti sul venue `BASE Milano` (Via Tortona 40, 20144 Milano, 45.4509 / 9.1587) con coordinate fisse nel fetcher: 0 chiamate geocoder, 1 sola riga `venues`, marker unico in mappa. Verificato live: 12 eventi, `geocoded: 0`, `venues` = 1 riga.
- **Stato**: verificato live — 26 eventi (BASE 11, Magazzini 7, Eventi@Milano 8), 0 errori; geo via tabella `venues` (venue name → coords riutilizzate)

## 2. MilanoToday Eventi (ATTIVO)
- **Endpoint listing**: `https://www.milanotoday.it/eventi/dal/{from}/al/{to}/` (pagine `?page=N`)
- **Endpoint dettaglio**: pagine `/eventi/*.html` linkate dal listing
- **Formato**: HTML; evento strutturato in `application/ld+json` schema.org `{"@type":"Event"}`
  con `name`, `startDate`, `endDate`, `url`, `location{name,address}`, `description`
- **Campi mappati**: vedi sopra; `location.address` "Via X, N, Milano" → address + city estratta
- **Rate limit**: 1 dettaglio ogni ~700 ms, max ~60 pagine dettaglio per sync
- **Stato**: verificato live (JSON-LD Event presente su pagine evento; listing dal/al restituisce ~39 link/mese)

## 3. Eventbrite (NON ATTIVO — documentato)
- **API pubblica**: `GET https://www.eventbriteapi.com/v3/events/search/` richiede **token OAuth personale**;
  senza token risponde 404. La ricerca pubblica è stata ritirata da Eventbrite.
- **Pagine HTML** (`eventbrite.com/d/italy--milano/...`) répondent 405 a fetch non-browser (anti-bot).
- **Decisione**: non scraping di pagine anti-bot (viola ToS e fragile). Da attivare solo con `EVENTBRITE_TOKEN` in env:
  il connettore è predisposto (`location.address=Milano, location.within=50km, start_date.range_start`).
- Per abilitarlo: imposta `EVENTBRITE_TOKEN` e aggiungi il connettore in `connectors.ts`.

## 4. ArciBellezza (NON RAGGIUNGIBILE — documentato)
- `https://arcibellezza.it/eventi/` e `/feed/` e `/wp-json/...` rispondono **202 con challenge
  anti-bot SG Captcha** (SiteGround): nessun contenuto accessibile senza browser reale.
- **Decisione**: non aggirabile in modo stabile/legale da server. Alternativa: feed RSS nazionale
  `https://www.arci.it/feed/` (notizie, non eventi strutturati — escluso dall'indice eventi).
- Se ArciBellezza espone in futuro un feed iCal/RSS pubblico o una REST API aperta, basta aggiungere
  un `Connector` in `connectors.ts`.

## Geolocalizzazione: tabella `venues`

I locali/location sono indicizzati in una tabella dedicata `venues(id, name, address, city, lat, lon)`:
- ogni evento con venue/indirizzo fa upsert del venue e riusa le coordinate già geocodificate
  (1 sola chiamata Nominatim per venue, non per evento);
- `GET /api/venues` elenca i locali noti;
- gli eventi ereditano lat/lon dal venue (`attachVenueCoords`).
- `https://arcibellezza.it/eventi/` e `/feed/` e `/wp-json/...` rispondono **202 con challenge
  anti-bot SG Captcha** (SiteGround): nessun contenuto accessibile senza browser reale.
- **Decisione**: non aggirabile in modo stabile/legale da server. Alternativa: feed RSS nazionale
  `https://www.arci.it/feed/` (notizie, non eventi strutturati — escluso dall'indice eventi).
- Se ArciBellezza espone in futuro un feed iCal/RSS pubblico o una REST API aperta, basta aggiungere
  un `Connector` in `connectors.ts`.

## 5. teatro.it e concerti-italia.it (NON ACCESSIBILI — documentato)
- `https://www.teatro.it/spettacoli/milano/` (e feed/sitemap): **403** con pagina anti-bot (Cloudflare-like).
- `https://www.concerti-italia.it/concerti/lombardia/milano/` (e feed/sitemap): **202** con challenge SG Captcha.
- Nessuna rotta pubblica (HTML, RSS, sitemap, wp-json) è accessibile senza browser reale:
  connettori **non implementati** (no scraping di pagine anti-bot, viola ToS e fragile).

## 6. RSS notizie (RIMOSSI dall'indice)
- I feed generali di MilanoToday / Il Giorno / Arci contengono **cronaca**, non eventi strutturati:
  rimossi dai connettori attivi. Restano validi solo per āeventiā citati dentro articoli, ma senza
  data/luogo affidabili: producono rumore (es. "Sorpresi a spacciare droga durante il festival musicale").
