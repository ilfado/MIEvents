# MIEvents

App per cercare, salvare e visualizzare su **lista e mappa** gli eventi a Milano e in provincia.

## Funzionalità

- **Aggregazione da fonti pubbliche**: il server interroga il portale open data di Regione Lombardia
  ([Sagre e fiere su area pubblica in provincia di Milano](https://www.dati.lombardia.it/Commercio/Sagre-e-fiere-su-area-pubblica-in-provincia-di-Mil/f2tm-32s5), licenza CC0)
  tramite la sua API Socrata (SoQL), con paginazione automatica.
- **Indicizzazione** in un database SQLite locale per **luogo (comune + indirizzo), data e tipologia**
  (categoria dedotta dal testo: sagra, fiera, concerto, teatro, mostra, sport, famiglia, altro).
- **Geocoding** degli indirizzi via [Nominatim/OpenStreetMap](https://nominatim.openstreetmap.org/) (rispettando il rate limit di 1 req/s) per la vista mappa.
- **Filtri**: testo libero, comune, tipologia, intervallo di date, bounding box della mappa, solo salvati.
- **Salvataggio**: ogni evento può essere marcato come salvato (★) e filtrato con "Solo salvati"; lo stato persiste nel DB.
- **Vista mappa** con Leaflet/OpenStreetMap: marker colorati per categoria, popup con dettagli, filtro per area visibile.
- **Installabile** come PWA (manifest + icone), layout responsive mobile-first.

## Stack

- **Server**: Node.js ≥ 22 (zero dipendenze runtime: `node:http` + `node:sqlite` + `fetch`), TypeScript.
- **Web**: React 19 + Vite + react-leaflet, servita in produzione dallo stesso server (SPA fallback).
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

## Struttura

```
shared/   tipi TypeScript condivisi (MiEvent, filtri, formato riga Socrata)
server/   API HTTP, DB SQLite, sync dalla fonte pubblica, geocoding, query con filtri
web/      React + Vite + Leaflet (lista, mappa, filtri, salvataggio, PWA)
```

## Licenza

[Unlicense](LICENSE) (public domain). I dati degli eventi sono di Regione Lombardia (CC0); la mappa è © OpenStreetMap contributors (ODbL).
