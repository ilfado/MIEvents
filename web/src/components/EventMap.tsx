import { useEffect, useMemo, useState } from "react";
import { MapContainer, Marker, Popup, TileLayer, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import type { MiEvent } from "@mievents/shared";
import { categoryLabel, formatDateRange } from "../format.js";

const MILAN: [number, number] = [45.4642, 9.19];

export function categoryColor(category: string): string {
  const colors: Record<string, string> = {
    sagra: "#d92b2b",
    fiera: "#e07b00",
    concerto: "#7b2ff7",
    teatro: "#0e7c7b",
    mostra: "#2b5fd9",
    sport: "#1f9d55",
    famiglia: "#d6336c",
    altro: "#5c6670",
  };
  return colors[category] ?? colors.altro;
}

function squareIcon(color: string, saved: boolean): L.DivIcon {
  return L.divIcon({
    className: "mievents-pin",
    html: `<span style="background:${saved ? "#111111" : color}"></span>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
    popupAnchor: [0, -10],
  });
}

function clusterIcon(count: number): L.DivIcon {
  return L.divIcon({
    className: "mievents-cluster",
    html: `<span>${count}</span>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });
}

interface Cluster {
  lat: number;
  lon: number;
  events: MiEvent[];
}

function clusterEvents(events: MiEvent[], zoom: number): Array<Cluster | { single: MiEvent }> {
  const geocoded = events.filter((e) => e.lat != null && e.lon != null);
  if (zoom >= 14 || geocoded.length < 2) {
    return geocoded.map((e) => ({ single: e }));
  }
  const cell = zoom <= 10 ? 0.25 : 0.08;
  const map = new Map<string, Cluster>();
  for (const e of geocoded) {
    const key = `${Math.floor((e.lat as number) / cell)},${Math.floor((e.lon as number) / cell)}`;
    const c = map.get(key);
    if (c) c.events.push(e);
    else map.set(key, { lat: e.lat as number, lon: e.lon as number, events: [e] });
  }
  const out: Array<Cluster | { single: MiEvent }> = [];
  for (const c of map.values()) {
    if (c.events.length === 1) out.push({ single: c.events[0] });
    else out.push(c);
  }
  return out;
}

function Recenter({ center }: { center: [number, number] }) {
  const map = useMap();
  useEffect(() => {
    map.setView(center, Math.max(map.getZoom(), 12));
  }, [center, map]);
  return null;
}

function MapEvents({
  onBbox,
  onZoom,
}: {
  onBbox: (bbox: string) => void;
  onZoom: (zoom: number) => void;
}) {
  const map = useMapEvents({
    moveend: () => {
      const b = map.getBounds();
      onBbox(`${b.getSouth()},${b.getWest()},${b.getNorth()},${b.getEast()}`);
      onZoom(map.getZoom());
    },
    zoomend: () => onZoom(map.getZoom()),
  });
  useEffect(() => {
    const b = map.getBounds();
    onBbox(`${b.getSouth()},${b.getWest()},${b.getNorth()},${b.getEast()}`);
    onZoom(map.getZoom());
  }, [map, onBbox, onZoom]);
  return null;
}

export function EventMap({
  events,
  selectedId,
  onSelect,
  onBbox,
  recenterKey,
  filterByArea,
  onToggleArea,
  showStreets,
  onToggleStreets,
}: {
  events: MiEvent[];
  selectedId: string | null;
  onSelect: (e: MiEvent) => void;
  onBbox: (bbox: string) => void;
  recenterKey: number;
  filterByArea: boolean;
  onToggleArea: () => void;
  showStreets: boolean;
  onToggleStreets: () => void;
}) {
  const [zoom, setZoom] = useState(11);
  const clusters = useMemo(() => clusterEvents(events, zoom), [events, zoom]);

  const selected = events.find((e) => e.id === selectedId);
  const center: [number, number] =
    selected?.lat != null && selected.lon != null ? [selected.lat, selected.lon] : MILAN;

  return (
    <div className="map-wrap">
      <div className="map-controls">
        <button
          type="button"
          className={`map-toggle ${filterByArea ? "on" : ""}`}
          aria-pressed={filterByArea}
          onClick={onToggleArea}
          title="Filtra gli eventi per l'area visibile"
        >
          {filterByArea ? "■ area: on" : "□ area: off"}
        </button>
        <button
          type="button"
          className={`map-toggle ${showStreets ? "on" : ""}`}
          aria-pressed={showStreets}
          onClick={onToggleStreets}
          title="Mostra/nascondi le strade"
        >
          {showStreets ? "■ strade: on" : "□ strade: off"}
        </button>
      </div>
      <MapContainer center={center} zoom={11} className="map" scrollWheelZoom key={`map-${recenterKey}`} zoomControl={false}>
        {showStreets && (
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
            opacity={0.55}
            className="pixel-tiles"
          />
        )}
        <Recenter center={center} />
        <MapEvents onBbox={onBbox} onZoom={setZoom} />
        {clusters.map((c, i) =>
          "single" in c ? (
            <Marker
              key={c.single.id}
              position={[c.single.lat as number, c.single.lon as number]}
              icon={squareIcon(categoryColor(c.single.category), c.single.saved)}
              eventHandlers={{ click: () => onSelect(c.single) }}
              riseOnHover
            >
              <Popup>
                <strong>{c.single.title}</strong>
                <br />
                {categoryLabel(c.single.category)} · {formatDateRange(c.single)}
                <br />
                {c.single.venue ? `${c.single.venue} — ` : ""}
                {c.single.city}
              </Popup>
            </Marker>
          ) : (
            <Marker
              key={`cl-${i}`}
              position={[c.lat, c.lon]}
              icon={clusterIcon(c.events.length)}
              eventHandlers={{
                click: () => {
                  const first = c.events[0];
                  onSelect(first);
                },
              }}
            >
              <Popup>
                <strong>{c.events.length} eventi qui</strong>
                <br />
                {c.events.slice(0, 8).map((e) => (
                  <div key={e.id}>
                    <button
                      type="button"
                      style={{ font: "inherit", background: "none", border: 0, padding: 0, cursor: "pointer", textDecoration: "underline" }}
                      onClick={() => onSelect(e)}
                    >
                      {e.title}
                    </button>
                  </div>
                ))}
                {c.events.length > 8 && <div>…e altri {c.events.length - 8}</div>}
              </Popup>
            </Marker>
          ),
        )}
      </MapContainer>
    </div>
  );
}
