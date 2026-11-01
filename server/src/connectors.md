# Connettori eventi — formato e stato

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

## 5. RSS notizie (RIMOSSI dall'indice)
- I feed generali di MilanoToday / Il Giorno / Arci contengono **cronaca**, non eventi strutturati:
  rimossi dai connettori attivi. Restano validi solo per āeventiā citati dentro articoli, ma senza
  data/luogo affidabili: producono rumore (es. "Sorpresi a spacciare droga durante il festival musicale").
