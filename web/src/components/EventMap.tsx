import { useEffect, useMemo, useRef, useState } from "react";
import { Map as MaplibreMap, Marker, Popup } from "maplibre-gl";
import type { LngLatBoundsLike } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { MiEvent } from "@mievents/shared";
import { categoryLabel, formatDateRange } from "../format.js";

const MILAN: [number, number] = [9.19, 45.4642];
const NORD_ITALIA: LngLatBoundsLike = [
  [6.6, 43.5],
  [13.7, 47.1],
];
const MIN_ZOOM = 7;
const MAX_ZOOM = 17;

function categoryColor(category: string): string {
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

export function EventMap({
  events,
  selectedId,
  onSelect,
  onBbox,
  filterByArea,
  onToggleArea,
  showStreets,
  onToggleStreets,
}: {
  events: MiEvent[];
  selectedId: string | null;
  onSelect: (e: MiEvent) => void;
  onBbox: (bbox: string) => void;
  filterByArea: boolean;
  onToggleArea: () => void;
  showStreets: boolean;
  onToggleStreets: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MaplibreMap | null>(null);
  const markersRef = useRef<Map<string, { marker: Marker; sig: string }>>(new Map());
  const [ready, setReady] = useState(false);

  const geoEvents = useMemo(() => events.filter((e) => e.lat != null && e.lon != null), [events]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new MaplibreMap({
      container: containerRef.current,
      style: {
        version: 8,
        sources: {
          osm: {
            type: "raster",
            tiles: ["/tiles/{z}/{x}/{y}{r}.png"],
            tileSize: 256,
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &middot; tile &copy; <a href="https://maps.wikimedia.org/">Wikimedia Maps</a> (via proxy)',
          },
        },
        layers: [
          { id: "bg", type: "background", paint: { "background-color": "#f2f0ea" } },
          {
            id: "osm",
            type: "raster",
            source: "osm",
            paint: { "raster-opacity": 1 },
            layout: { visibility: showStreets ? "visible" : "none" },
          },
        ],
      },
      center: MILAN,
      zoom: 10,
      minZoom: MIN_ZOOM,
      maxZoom: MAX_ZOOM,
      maxBounds: NORD_ITALIA,
      dragRotate: false,
      pitchWithRotate: false,
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    map.on("load", () => {
      setReady(true);
      map.resize();
      map.setLayoutProperty("osm", "visibility", showStreets ? "visible" : "none");
    });
    requestAnimationFrame(() => map.resize());
    const ro = new ResizeObserver(() => map.resize());
    if (containerRef.current) ro.observe(containerRef.current);
    map.on("moveend", () => {
      const b = map.getBounds();
      onBbox(`${b.getSouth()},${b.getWest()},${b.getNorth()},${b.getEast()}`);
    });
    const b = map.getBounds();
    onBbox(`${b.getSouth()},${b.getWest()},${b.getNorth()},${b.getEast()}`);
    return () => {
      ro.disconnect();
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !map.isStyleLoaded()) return;
    map.setLayoutProperty("osm", "visibility", showStreets ? "visible" : "none");
  }, [showStreets, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    for (const [id, entry] of markersRef.current) {
      if (!geoEvents.some((e) => e.id === id)) {
        entry.marker.remove();
        markersRef.current.delete(id);
      }
    }
    for (const e of geoEvents) {
      const sig = `${e.title}|${e.category}|${e.start}|${e.end ?? ""}|${e.venue ?? ""}|${e.city}|${e.saved}`;
      const existing = markersRef.current.get(e.id);
      if (existing) {
        if (existing.sig !== sig) {
          existing.marker.remove();
          markersRef.current.delete(e.id);
        } else {
          continue;
        }
      }
      const markerEl = document.createElement("div");
      markerEl.className = "mi-marker";
      markerEl.style.background = e.saved ? "#111111" : categoryColor(e.category);
      markerEl.title = e.title;
      const marker = new Marker({ element: markerEl, anchor: "center" })
        .setLngLat([e.lon as number, e.lat as number])
        .setPopup(
          new Popup({ offset: 14, className: "mi-popup" }).setHTML(
            `<strong>${escapeHtml(e.title)}</strong><br/>${categoryLabel(e.category)} · ${formatDateRange(e)}<br/>${escapeHtml(
              (e.venue ? `${e.venue} — ` : "") + e.city,
            )}`,
          ),
        )
        .addTo(map);
      markerEl.addEventListener("click", () => onSelect(e));
      markersRef.current.set(e.id, { marker, sig });
    }
  }, [geoEvents, ready, onSelect]);

  useEffect(() => {
    const map = mapRef.current;
    const sel = events.find((e) => e.id === selectedId);
    if (map && sel?.lat != null && sel.lon != null) {
      map.flyTo({ center: [sel.lon, sel.lat], zoom: Math.max(map.getZoom(), 13), duration: 350 });
    }
  }, [selectedId, events]);

  return (
    <div className="map-wrap">
      <div className="map-controls">
        <button type="button" className="map-toggle" onClick={() => mapRef.current?.zoomIn()} aria-label="Zoom in">+</button>
        <button type="button" className="map-toggle" onClick={() => mapRef.current?.zoomOut()} aria-label="Zoom out">−</button>
        <button
          type="button"
          className={`map-toggle ${filterByArea ? "on" : ""}`}
          aria-pressed={filterByArea}
          onClick={onToggleArea}
        >
          {filterByArea ? "■ area: on" : "□ area: off"}
        </button>
        <button
          type="button"
          className={`map-toggle ${showStreets ? "on" : ""}`}
          aria-pressed={showStreets}
          onClick={onToggleStreets}
        >
          {showStreets ? "■ strade: on" : "□ strade: off"}
        </button>
      </div>
      <div ref={containerRef} className="map-canvas" role="application" aria-label="Mappa eventi" />
    </div>
  );
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
