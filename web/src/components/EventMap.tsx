import { useEffect } from "react";
import { MapContainer, Marker, Popup, TileLayer, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import type { MiEvent } from "@mievents/shared";
import { categoryLabel, formatDateRange } from "../format.js";

const MILAN: [number, number] = [45.4642, 9.19];

function categoryColor(category: string): string {
  const colors: Record<string, string> = {
    sagra: "#c8102e",
    fiera: "#e07b00",
    concerto: "#7b2ff7",
    teatro: "#0e7c7b",
    mostra: "#2f6df7",
    sport: "#1a9e3f",
    famiglia: "#d6336c",
    altro: "#5c6670",
  };
  return colors[category] ?? colors.altro;
}

function pinIcon(category: string, saved: boolean): L.DivIcon {
  const color = saved ? "#111111" : categoryColor(category);
  return L.divIcon({
    className: "mievents-pin",
    html: `<span style="background:${color}"></span>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
    popupAnchor: [0, -12],
  });
}

function Recenter({ center }: { center: [number, number] }) {
  const map = useMap();
  useEffect(() => {
    map.setView(center, Math.max(map.getZoom(), 12));
  }, [center, map]);
  return null;
}

function BboxWatcher({ onBbox }: { onBbox: (bbox: string) => void }) {
  const map = useMapEvents({
    moveend: () => {
      const b = map.getBounds();
      onBbox(`${b.getSouth()},${b.getWest()},${b.getNorth()},${b.getEast()}`);
    },
  });
  useEffect(() => {
    const b = map.getBounds();
    onBbox(`${b.getSouth()},${b.getWest()},${b.getNorth()},${b.getEast()}`);
  }, [map, onBbox]);
  return null;
}

export function EventMap({
  events,
  selectedId,
  onSelect,
  onBbox,
  recenterKey,
}: {
  events: MiEvent[];
  selectedId: string | null;
  onSelect: (e: MiEvent) => void;
  onBbox: (bbox: string) => void;
  recenterKey: number;
}) {
  const geocoded = events.filter((e) => e.lat != null && e.lon != null);
  const center: [number, number] =
    selectedId != null
      ? (() => {
          const sel = events.find((e) => e.id === selectedId);
          return sel?.lat != null && sel.lon != null ? [sel.lat, sel.lon] : MILAN;
        })()
      : geocoded.length > 0
        ? [geocoded.reduce((s, e) => s + (e.lat ?? 0), 0) / geocoded.length, geocoded.reduce((s, e) => s + (e.lon ?? 0), 0) / geocoded.length]
        : MILAN;

  return (
    <MapContainer center={center} zoom={11} className="map" scrollWheelZoom key={`map-${recenterKey}`}>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <Recenter center={center} />
      <BboxWatcher onBbox={onBbox} />
      {geocoded.map((e) => (
        <Marker
          key={e.id}
          position={[e.lat as number, e.lon as number]}
          icon={pinIcon(e.category, e.saved)}
          eventHandlers={{ click: () => onSelect(e) }}
          riseOnHover
        >
          <Popup>
            <strong>{e.title}</strong>
            <br />
            {categoryLabel(e.category)} · {formatDateRange(e)}
            <br />
            {e.venue ? `${e.venue} — ` : ""}
            {e.city}
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
