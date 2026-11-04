# Connettori eventi — formato e stato

Ogni connettore è un `EventSource` in `server/src/adapters/outbound/fetchers/` e produce `EventDraft`
(core), poi persistito via `EventRepository` (SQLite + FTS5). Vedi `application/ports.ts` per i contratti.

## DB venues — fase PRIMA degli eventi (venue sync)

`runSync` esegue prima `runVenueSync` (`application/services/venue-sync.ts`), che popola la tabella
`venues` da sorgenti dedicate (`VenueSource` in `adapters/outbound/fetchers/venues.ts`), poi le sorgenti
evento riutilizzano le coordinate già in DB (`venues.coordsFor`) e consumano il budget Nominatim solo
per i venue ancora senza coordinate. Risultato: **1 chiamata di geolocalizzazione per venue, non per evento**.

Sorgenti venue attive (`venueSources(env)`):

| Sorgente | Endpoint | Stato | Note |
| --- | --- | --- | --- |
| **Ticketmaster Discovery — search venues** | `GET https://app.ticketmaster.com/discovery/v2/venues.json?apikey=..&latLong=45.4642,9.19&radius=100&unit=km&size=100&page=N` | attivo con `TICKETMASTER_API_KEY` | centro Milano (Duomo), **radius 100 km**, paginata (`page.totalPages`, max `limits["tmVenuesPages"]` default 5). Verificato live: senza chiave risponde `{"fault":{"faultstring":"Invalid ApiKey"}}` → endpoint e parametri validi. Risposta `_embedded.venues[]` con `name, address.line1, city.name, postalCode, location.latitude/longitude, url`. Filtro client: coordinate dentro provincia MI (bbox) oppure, se assenti, `city ~ Milano`. Le coordinate dell'API entrano dritte in `venues` (zero Nominatim) |
| **ARCI — directory circoli** | `https://portale.arci.it/cerca/circolo/` (filtro comitato "ARCI MILANO - LO - MB" letto dal form) → schede `/dettaglio/circolo/{id}/{slug}/` | **attivo senza chiave** | il filtro per comitato si ricava parsando le `<select>` della pagina (`findComitatoParam`); dalle schede si estrae "Sede legale VIA…, N - CAP CITTÀ PR" e si tengono solo le sedi con **provincia MI**. Nessuna coordinata (verranno geocodificate una sola volta quando un evento le referenzia, oppure ereditate dai pin). Limiti: `limits["arciPages"]` (default 4), `limits["arciDetails"]` (default 60), delay 700 ms tra le schede |

Merge/cross-check (`mergeVenueDraft`): match per **nome case-insensitive** (`venues.findByName`) contro i venue
già registrati; se la riga esiste si riempiono solo i campi mancanti (coordinate se assenti, address/city se
vuoti, `source`); se non esiste si crea la riga. **I pin curati di `core/venue-pins.ts` vincono sempre** sulle
coordinate delle API: un venue TM/ARCI con nome corrispondente a un pin viene riallineato al pin corretto.
`coordsFor` ora fa match anche per contenimento del nome (≥ 6 caratteri, entrambi i versi), così
"Magazzini Generali Milano" (TM) trova la riga "Magazzini Generali".

Disattivazione: `SYNC_VENUES=0` (env) oppure `syncVenues: false` nelle `SyncOptions`; la summary di sync
espone `venuesSynced` e `sync_state["last_venues"]`. `GET /api/venues` ora include anche `source`.

## Connettori ATTIVI (senza chiave)

| Fonte | Endpoint | Formato | Verifica live |
| --- | --- | --- | --- |
| Regione Lombardia sagre/fiere | `dati.lombardia.it/resource/f2tm-32s5.json` (SoQL) | JSON Socrata | 140 eventi |
| **Regione Lombardia sagre/fiere area pubblica (tutta la prov.)** | `dati.lombardia.it/resource/hs8z-dcey.json` (SoQL, CC0, agg. settimanale) | JSON Socrata con `location` GeoJSON Point → lat/lon diretti | 14 eventi futurs in prov. MI, 14/14 con geo (live) |
| MilanoToday Eventi | `milanotoday.it/eventi/dal/{from}/al/{to}/` → `/eventi/*.html` | JSON-LD `Event` | 7 futurs |
| **The Events Calendar (TEC) — BASE Milano, Magazzini Generali, Eventi@Milano** | `{base}/wp-json/tribe/events/v1/events?per_page=100&start_date={from}&end_date={to}&page=N` | WP REST JSON: `title,start_date,end_date,venue{venue,address,city,zip,province},url,categories` | 26 eventi (BASE 11 + Magazzini 7 + Eventi@Milano 8, live) |
| **Cheventi.it** | `cheventi.it/regioni/lombardia[/milano]/` (pagine `page/N/`) | **JSON-LD `ItemList` di `Event` nel listing**, con `location.geo` già incluso | 15 eventi, tutti in provincia MI (filtro bbox 44.9–46.1 / 8.4–10.6) |
| **Wikidata via QLever** | `qlever.dev/api/wikidata?query=SPARQL` | SPARQL JSON: `P31/P279* Q1656682` + `P625` + `P585` **obbligatoria** con `FILTER` finestra server-side `[from, to+1g)`, opzionale `P131/P17 Q38` (Italia); client filtra bbox provincia MI | eventi noti con coordinate in finestra; verificato live 2026-11-03: 0 eventi in prov. MI nella finestra 3–18 nov (2 in tutta Italia) |
| **Santeria Milano** | `santeria.milano.it/wp-json/wp/v2/eventi` | WP REST JSON (data estratta dal testo) | eventi club |
| **RSS testate** (ViviMilano spettacoli, MilanoEvents, Eventi@Milano concerti) | feed RSS pubblici | RSS → filtro keyword evento + area MI + data da testo/pubDate | normalizzati in `events` |

## Ticketmaster — formato date richiesto + geo
`startDateTime`/`endDateTime` devono essere `YYYY-MM-DDTHH:mm:ssZ` (no millisecondi, con Z), `sort` solo `date,asc` etc. (no `date,asc` con virgola+spazio).
La search eventi usa `latLong=45.4642,9.19&radius=100&unit=km` (Milano + provincia; filtro client addizionale `inMilanoProvince` sul venue). La search **venues** (per il DB venues) usa gli stessi `latLong/radius/unit` su `/discovery/v2/venues.json` — vedi sezione "DB venues" sopra. Verifica live: senza `apikey` valida l'endpoint risponde `Invalid ApiKey` (oauth.v2.InvalidApiKey), quindi URL e parametri sono corretti; con chiave valida tornano `_embedded.events` / `_embedded.venues`.

## Connettori con API key gratuite (attivabili via env, MAI in chat/codice)

| Servizio | Env var | Come obtenirla |
| --- | --- | --- |
| Ticketmaster Discovery | `TICKETMASTER_API_KEY` | developer.ticketmaster.com → New App → "Discovery API" key istantanea |
| Eventbrite | `EVENTBRITE_USER_TOKEN` + `EVENTBRITE_SEARCH=1` | user OAuth token (flusso code+consenso, scope public) — NON la private/api key |
| Bandsintown | `BANDSINTWN_APP_ID` + opz. `BANDSINTWN_ARTISTS` | artist.bandsintown.com → Settings → General → **Get API Key** |

> **v1.3.0 — ticketing OFF di default**: le sorgenti ticketing producono quasi solo grandi concerti in stadi/palazzetti, quindi `ticketingSources(env)` restituisce `[]` a meno che `TICKETING_SOURCES=1` (oltre alle singole chiavi). Per riattivarle: `TICKETING_SOURCES=1` + la chiave del servizio.

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
- **Paginazione TEC corretta**: TEC limita le righe a 50/pagina anche con `per_page=100`, quindi il ciclo NON si ferma su `rows.length < per_page` ma solo su `page >= total_pages`, pagina vuota, pagina 404 (fuori range) o quando tutte le righe della pagina sono oltre `toDate`. Prima il break su `rows.length < per_page` fermava dopo la prima pagina e perdeva gli eventi di novembre (1 evento recuperato invece di 31).
- **eventiatmilano lookback 180gg**: `tribe-eventiatmilano` interroga con `start_date = from - 180gg` **senza** `end_date` e filtra client-side per sovrapposizione (`end >= from && start <= to`): recupera anche le mostre lunghe iniziate prima della finestra ma ancora in corso (es. "dal 29 settembre al 31 gennaio 2027" visibile a novembre). Paginazione fino a `tribe-eventiatmilanoPages` (default 10) o fine risultati; una pagina fuori range risponde **404** e interrompe il ciclo senza perdere gli eventi già raccolti. Verificato live: page=2 con `end_date=2026-11-18` → 404 `event-archive-page-not-found`.
- **Costo**: il campo TEC `cost` ("0", "10.00", "5 - 15", "€ 18,50", "Gratis") viene parsato in `priceMin`/`priceMax` (`core/price.ts` → `parseCostField`).
- **Pin location BASE Milano**: BASE è uno spazio singolo → gli eventi `tribe-base` convergono tutti sul venue `BASE Milano` (Via Tortona 40, 20144 Milano, 45.4509 / 9.1587) con coordinate fisse nel fetcher: 0 chiamate geocoder, 1 sola riga `venues`, marker unico in mappa. Verificato live: 12 eventi, `geocoded: 0`, `venues` = 1 riga.
- **Stato**: verificato live — 26 eventi (BASE 11, Magazzini 7, Eventi@Milano 8), 0 errori; geo via tabella `venues` (venue name → coords riutilizzate)

## 2. MilanoToday Eventi (ATTIVO)
- **Endpoint listing**: `https://www.milanotoday.it/eventi/dal/{from}/al/{to}/` (pagine `?page=N`)
- **Endpoint dettaglio**: pagine `/eventi/*.html` linkate dal listing
- **Formato**: HTML; evento strutturato in `application/ld+json` schema.org `{"@type":"Event"}`
  con `name`, `startDate`, `endDate`, `url`, `location{name,address}`, `description`
- **Campi mappati**: vedi sopra; `location.address` "Via X, N, Milano" → address + city estratta
- **Discovery doppia**: oltre al listing `dal/{from}/al/{to}/` (pagine `?page=N`), si legge anche il canale RSS `https://www.milanotoday.it/rss/channels/eventi/` (25 item con link `/eventi/*.html`) — robusto anche se il listing HTML serve il wall adblock/JS. Verificato live: listing 39 link + RSS 25 link → 31 eventi in finestra (3–18 nov 2026).
- Estrazione link robusta: `href` con apici singoli o doppi e qualsiasi path `/eventi/.../*.html` (il listing `dal/{from}/al/{to}/` non espone più solo link `href="..."` classici); default 3 pagine di listing (`milanotodayPages`) e 80 dettagli (`milanotodayDetails`).
- **Prezzo**: da JSON-LD `offers` se presente, altrimenti dal testo della pagina dettaglio ("Gratis", "Ingresso da 20 euro", "€ 12").
- **Rate limit**: 1 dettaglio ogni ~700 ms, max ~80 pagine dettaglio per sync
- **Stato**: verificato live (JSON-LD Event presente su pagine evento; listing dal/al restituisce ~39 link/mese)

## 3. Eventbrite (ATTIVABILE con token — verificato)
- **API pubblica**: `GET https://www.eventbriteapi.com/v3/events/search/` richiede **user OAuth token** in
  header `Authorization: Bearer <token>`; senza token risponde **404 NOT_FOUND** (verificato live), con token
  non valido 401. La ricerca pubblica web è stata ritirata da Eventbrite.
- Il connettore è attivo solo con `EVENTBRITE_USER_TOKEN` **e** `EVENTBRITE_SEARCH=1` (gate di sicurezza, default off):
  `location.address=Milano,Italy&location.within=100km`, `start_date.range_start/end`, `order_by=start_asc`,
  `page_size=100`, **`expand=venue,organizer`** (senza expand `venue`/`organizer` sono solo ID numerici).
  Filtro client: coordinate dentro provincia MI e `start <= toDate`. Mapping testato in `venues.test.ts`.
- **Pagine HTML** (`eventbrite.com/d/italy--milano/...`) rispondono 405 a fetch non-browser (anti-bot): no scraping.

## 4. ArciBellezza (NON RAGGIUNGIBILE — documentato)
- `https://arcibellezza.it/eventi/` e `/feed/` e `/wp-json/...` rispondono **202 con challenge
  anti-bot SG Captcha** (SiteGround): nessun contenuto accessibile senza browser reale.
- **Decisione**: non aggirabile in modo stabile/legale da server. Alternativa: feed RSS nazionale
  `https://www.arci.it/feed/` (notizie, non eventi strutturati — escluso dall'indice eventi).
- Se ArciBellezza espone in futuro un feed iCal/RSS pubblico o una REST API aperta, basta aggiungere
  un `Connector` in `connectors.ts`.

## 4b. ARCI — directory circoli (portale.arci.it) come DB venues (ATTIVO)
- La pagina pubblica `https://www.arci.it/trova-il-tuo-circolo/` è un form JS: il dato strutturato vive nel
  **portale.arci.it** (cerca/circolo, ~4.2k circoli filtrabili per Regione/Comitato/Attività/Nome, paginato `?p=N`),
  ogni scheda `/dettaglio/circolo/{id}/{slug}/` riporta "Sede legale VIA…, N - CAP CITTÀ PR".
- Il connettore `arci-circoli` (in `venues.ts`, zero chiavi) legge il filtro comitato "ARCI MILANO - LO - MB"
  direttamente dalle `<select>` della pagina, pagina la ricerca, scarica le schede (max `arciDetails`, delay 700 ms)
  e registra in `venues` solo le sedi con **provincia MI** (nome + indirizzo, coordinate nulle: poi pin o una
  sola geocoding Nominatim quando un evento le usa).
- `www.arci.it` espone anche via WP REST un CPT `appuntamento` (eventi nazionali) con tassonomie
  `provincia`/`tipologia-evento`, ma **senza campi data/luogo strutturati** (solo titolo + HTML) e il namespace
  custom `arci/v2` espone solo `/convenzioni`: non utilizzabile come sorgente eventi. ArciBellezza resta
  anti-bot (202 SG Captcha) — vedi sezione 4.

## 7. Ricerca altre basi eventi (audit 2026-11)
- **dati.lombardia.it `c2m5-htuw` "Cultura/Eventi"**: dataset Socrata ma **statico** (10 righe, periodo_rif 2018,
  solo `toponimo/indirizzo/denominazione/data_inizio`, niente geo né provincia) → escluso.
- **E015 "EDT – Eventi in Lombardia"** (api-detail e015.regione.lombardia.it): aggregatore ufficiale regionale,
  ma le API E015 sono **restricted** (accesso solo ad app registrate/autorizzate) → non usabile senza credenziali.
- **dati.comune.milano.it**: portale **CKAN** (`/api/3/action/package_search`, ~2.594 dataset); nessun dataset
  eventi georeferenziato e live individuato (portale temporaneamente down durante l'audit) → non integrato.
- **Songkick** (API dismessa), **dice.fm** (solo API non-ufficiali), **SeatGeek** (no metro Milano): esclusi.
- Già coperti e attivi: Regione Lombardia (sagre/fiere + area pubblica con geo), TEC/WP (BASE, Magazzini
  Generali, Eventi@Milano), MilanoToday JSON-LD, Cheventi JSON-LD, Santeria WP, Wikidata/QLever, RSS;
  con chiave: Ticketmaster (eventi + venues), Eventbrite (search), Bandsintown (artist-only).
- Anti-bot, esclusi: teatro.it (403), concerti-italia.it (202), arcibellezza.it (202), eventbrite.com HTML (405),
  yesmilano.it (403).

## Geolocalizzazione: pin costanti + tabella `venues`

Prima del geocoder, `sync.ts` applica `pinForVenue()` (`core/venue-pins.ts`): dizionario di venue noti di Milano/provincia con coordinate fisse (BASE, **Magazzini Generali — corretto a 45.4441, 9.1953 (Via Pietrasanta 16, 20141; prima puntava erroneamente in zona Darsena 9.1696)**, Alcatraz, Fabrique, Santeria, Magnolia/Idroscalo, Leoncavallo, Carroponte, Arcimboldi, Carcano, Franco Parenti, Elfo Puccini, Menotti, Out Off, Zona K, Fabbrica del Vapore, HangarBicocca, Blue Note, Unipol Forum/Dome, Duomo, Sant'Eustorgio, La Scala, Piccolo, Triennale, Castello Sforzesco…). I pin vincono sempre sulle coordinate delle sorgenti esterne (vedi merge in `venue-sync.ts`). Matching su nome normalizzato (accents/case-insensitive, exact + contenimento per chiavi ≥6 caratteri) e su indirizzo. I pin non consumano budget Nominatim e vengono persistiti in `venues`, così compaiono in `/api/venues` e unificano il marker in mappa. Verificato live: 41 eventi, venue pinnati corretti (Magazzini 7 eventi → 1 pin, Duomo, Sant'Eustorgio, Arcimboldi, Unipol Dome…), restano senza geo solo i venue minori non in dizionario (risolti poi da Nominatim).

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

## 8. Fasce di prezzo e grandi eventi (v1.3.0)

- **Prezzo evento**: `EventDraft.priceMin/priceMax` da JSON-LD `offers` (`ldPrice` in `core/jsonld.ts`, gestisce `Offer`, array e `AggregateOffer` low/high, `isAccessibleForFree`), campo `cost` TEC (`parseCostField`), `priceRanges` Ticketmaster, e fallback in sync dal testo `titolo + descrizione` (`parsePriceText`: "gratis/ingresso libero" → 0; "€ 12", "12 euro", "da 5 a 15 €", "da 20 euro").
- **Fasce** (`priceBandOf`): `gratis` (0), `fino10` (max ≤ 10 €), `fino20` (max ≤ 20 €), `cari` (max > 20 € → tag "Cari"); banda nulla se il prezzo non è pubblicato. Colonne `price_min/price_max/price_band` su `events`, filtro `?priceBand=` (validato, 400 se non valido), chip in app, badge sulla card.
- **Grandi eventi**: `core/big-events.ts` (`isBigEvent`) esclude stadi/palazzetti/arene/forum grandi (San Siro, Unipol/Mediolanum Forum, Arena Civica…) su venue+indirizzo+titolo: scartati in sync (contati in `SyncSummary.skipped`) e con flag `big=1` nel DB; la lista li esclude di default (`?includeBig=1` per vederli). Backfill automatico delle righe esistenti all'apertura del DB.

## 6. RSS notizie (RIMOSSI dall'indice)
- I feed generali di MilanoToday / Il Giorno / Arci contengono **cronaca**, non eventi strutturati:
  rimossi dai connettori attivi. Restano validi solo per āeventiā citati dentro articoli, ma senza
  data/luogo affidabili: producono rumore (es. "Sorpresi a spacciare droga durante il festival musicale").

## Metalitalia (agenda concerti metal)
- Listing: `https://metalitalia.com/category/agenda/` (+ `/page/N/`) → link `/evento/<slug>`
- Dettaglio: JSON-LD `Event` (startDate, name, location.address, offers) → `ldToDraft`
- Filtro: geo in provincia MI oppure indirizzo/venue/città match `MI_CITY_RE`; finestra 15gg; max 40 dettagli, delay 700ms

## Radio Punk (date concerti punk DIY)
- Listing: `https://radiopunk.it/evento/` → link `?event=<id>`
- Dettaglio: riga testo `DD/MM/YYYY TITOLO 📍 CITTÀ @VENUE` → start/city/venue; prezzo da `parsePriceText`
- Filtro: città match `MI_CITY_RE` (provincia MI), finestra 15gg; max 40 dettagli, delay 700ms; geo via venue-pins/Nominatim

## Cheventi.it
- ora esclude i concerti `candlelight` (titolo match `/candlelight/i`)

## Club WP (Alcatraz, Magnolia) — CPT via wp-json
- Alcatraz: `alcatrazmilano.it/wp-json/wp/v2/events` (ACF: date, starts_at, canceled, sold_out, tickets_online_url)
- Magnolia: `circolomagnolia.it/wp-json/wp/v2/event_listing` (REST dà titolo/link; data da acf/meta/testo, altrimenti skip)
- Venue fissa dal pin (Alcatraz / Circolo Magnolia) → coordinate pronte; prezzo da ACF `price` o testo; skip canceled/sold_out
- Filtro globale in sync: `priceMax >= 35€` → skip (tutte le fonti)
