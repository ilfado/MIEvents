import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MiEvent } from "@mievents/shared";
import { categoryLabel, formatDateRange } from "../format.js";

const MILAN = { lat: 45.4642, lon: 9.19 };
const MIN_ZOOM = 9;
const MAX_ZOOM = 16;

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

function project(lat: number, lon: number, zoom: number): { x: number; y: number } {
  const scale = 256 * 2 ** zoom;
  const x = ((lon + 180) / 360) * scale;
  const sin = Math.sin((lat * Math.PI) / 180);
  const y = (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale;
  return { x, y };
}

function unproject(x: number, y: number, zoom: number): { lat: number; lon: number } {
  const scale = 256 * 2 ** zoom;
  const lon = (x / scale) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * y) / scale;
  const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  return { lat, lon };
}

interface Cluster {
  lat: number;
  lon: number;
  events: MiEvent[];
}

function cluster(events: MiEvent[], zoom: number): Array<Cluster | { single: MiEvent }> {
  const geo = events.filter((e) => e.lat != null && e.lon != null);
  if (zoom >= 14 || geo.length < 2) return geo.map((e) => ({ single: e }));
  const cell = zoom <= 10 ? 0.25 : 0.08;
  const map = new Map<string, Cluster>();
  for (const e of geo) {
    const key = `${Math.floor((e.lat as number) / cell)},${Math.floor((e.lon as number) / cell)}`;
    const c = map.get(key);
    if (c) c.events.push(e);
    else map.set(key, { lat: e.lat as number, lon: e.lon as number, events: [e] });
  }
  return [...map.values()].map((c) => (c.events.length === 1 ? { single: c.events[0] } : c));
}

export function EventMap({
  events,
  selectedId,
  onSelect,
  onBbox,
  filterByArea,
  onToggleArea,
}: {
  events: MiEvent[];
  selectedId: string | null;
  onSelect: (e: MiEvent) => void;
  onBbox: (bbox: string) => void;
  filterByArea: boolean;
  onToggleArea: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ lat: MILAN.lat, lon: MILAN.lon, zoom: 11 });
  const [popup, setPopup] = useState<{ x: number; y: number; event: MiEvent } | { x: number; y: number; cluster: Cluster } | null>(null);
  const dragRef = useRef<{ sx: number; sy: number; cx: number; cy: number; clat: number; clon: number; moved: boolean } | null>(null);

  const selected = events.find((e) => e.id === selectedId);
  useEffect(() => {
    if (selected?.lat != null && selected.lon != null) {
      setView((v) => ({ ...v, lat: selected.lat as number, lon: selected.lon as number, zoom: Math.max(v.zoom, 13) }));
    }
  }, [selected?.id]);

  const clusters = useMemo(() => cluster(events, view.zoom), [events, view.zoom]);

  const reportBbox = useCallback(
    (v: { lat: number; lon: number; zoom: number }) => {
      const el = wrapRef.current;
      if (!el) return;
      const w = el.clientWidth;
      const h = el.clientHeight;
      const c = project(v.lat, v.lon, v.zoom);
      const nw = unproject(c.x - w / 2, c.y - h / 2, v.zoom);
      const se = unproject(c.x + w / 2, c.y + h / 2, v.zoom);
      onBbox(`${se.lat.toFixed(5)},${nw.lon.toFixed(5)},${nw.lat.toFixed(5)},${se.lon.toFixed(5)}`);
    },
    [onBbox],
  );

  useEffect(() => {
    reportBbox(view);
  }, [view, reportBbox]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = wrap.clientWidth;
    const h = wrap.clientHeight;
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = "#f2f0ea";
    ctx.fillRect(0, 0, w, h);

    const grid = 64;
    ctx.strokeStyle = "#e3e0d8";
    ctx.lineWidth = 1;
    for (let x = (w / 2) % grid; x < w; x += grid) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let y = (h / 2) % grid; y < h; y += grid) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    const center = project(view.lat, view.lon, view.zoom);
    for (const c of clusters) {
      const lat = "single" in c ? (c.single.lat as number) : c.lat;
      const lon = "single" in c ? (c.single.lon as number) : c.lon;
      const p = project(lat, lon, view.zoom);
      const x = p.x - center.x + w / 2;
      const y = p.y - center.y + h / 2;
      if (x < -40 || x > w + 40 || y < -40 || y > h + 40) continue;
      if ("single" in c) {
        const e = c.single;
        const size = 16;
        ctx.fillStyle = e.saved ? "#111111" : categoryColor(e.category);
        ctx.fillRect(x - size / 2, y - size / 2, size, size);
        ctx.strokeStyle = "#111111";
        ctx.lineWidth = 2;
        ctx.strokeRect(x - size / 2, y - size / 2, size, size);
        if (e.id === selectedId) {
          ctx.strokeStyle = "#f5c518";
          ctx.lineWidth = 3;
          ctx.strokeRect(x - size / 2 - 4, y - size / 2 - 4, size + 8, size + 8);
        }
      } else {
        const size = 30;
        ctx.fillStyle = "#f5c518";
        ctx.fillRect(x - size / 2, y - size / 2, size, size);
        ctx.strokeStyle = "#111111";
        ctx.lineWidth = 2;
        ctx.strokeRect(x - size / 2, y - size / 2, size, size);
        ctx.fillStyle = "#111111";
        ctx.font = "bold 13px 'Courier New', monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(c.events.length), x, y + 1);
      }
    }
  }, [clusters, view, selectedId]);

  useEffect(() => {
    draw();
    const onResize = () => draw();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [draw]);

  const pick = useCallback(
    (mx: number, my: number) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      const center = project(view.lat, view.lon, view.zoom);
      for (const c of clusters) {
        const lat = "single" in c ? (c.single.lat as number) : c.lat;
        const lon = "single" in c ? (c.single.lon as number) : c.lon;
        const p = project(lat, lon, view.zoom);
        const x = p.x - center.x + w / 2;
        const y = p.y - center.y + h / 2;
        const size = "single" in c ? 22 : 36;
        if (Math.abs(mx - x) <= size / 2 && Math.abs(my - y) <= size / 2) {
          return { x, y, cluster: c } as const;
        }
      }
      return null;
    },
    [clusters, view],
  );

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    dragRef.current = {
      sx: e.clientX,
      sy: e.clientY,
      cx: rect.width / 2,
      cy: rect.height / 2,
      clat: view.lat,
      clon: view.lon,
      moved: false,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const dx = e.clientX - drag.sx;
    const dy = e.clientY - drag.sy;
    if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
    if (!drag.moved) return;
    const center = project(drag.clat, drag.clon, view.zoom);
    const nw = unproject(center.x - dx, center.y - dy, view.zoom);
    setView((v) => ({ ...v, lat: nw.lat, lon: nw.lon }));
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag || drag.moved) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const hit = pick(mx, my);
    if (!hit) {
      setPopup(null);
      return;
    }
    if ("single" in hit.cluster) {
      const ev = hit.cluster.single;
      setPopup({ x: hit.x, y: hit.y, event: ev });
      onSelect(ev);
    } else {
      setPopup({ x: hit.x, y: hit.y, cluster: hit.cluster });
    }
  };

  const onWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    setView((v) => {
      const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.zoom + (e.deltaY < 0 ? 1 : -1)));
      if (zoom === v.zoom) return v;
      const before = project(v.lat, v.lon, v.zoom);
      const scale = 2 ** (zoom - v.zoom);
      const p = { x: before.x + (mx - rect.width / 2) * (1 - 1 / scale) * 1, y: before.y + (my - rect.height / 2) * (1 - 1 / scale) };
      const geo = unproject(p.x, p.y, zoom);
      return { lat: geo.lat, lon: geo.lon, zoom };
    });
  };

  const zoomBy = (delta: number) =>
    setView((v) => ({ ...v, zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.zoom + delta)) }));

  return (
    <div className="map-wrap" ref={wrapRef}>
      <div className="map-controls">
        <button type="button" className="map-toggle" onClick={() => zoomBy(1)} aria-label="Zoom in">+</button>
        <button type="button" className="map-toggle" onClick={() => zoomBy(-1)} aria-label="Zoom out">−</button>
        <button
          type="button"
          className={`map-toggle ${filterByArea ? "on" : ""}`}
          aria-pressed={filterByArea}
          onClick={onToggleArea}
        >
          {filterByArea ? "■ area: on" : "□ area: off"}
        </button>
      </div>
      <canvas
        ref={canvasRef}
        className="map-canvas"
        role="application"
        aria-label="Mappa eventi"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onWheel={onWheel}
        style={{ touchAction: "none", cursor: "grab" }}
      />
      {popup && (
        <div
          className="map-popup"
          style={{
            left: Math.min(popup.x + 12, (wrapRef.current?.clientWidth ?? 300) - 260),
            top: Math.max(popup.y - 10, 8),
          }}
        >
          {"event" in popup ? (
            <>
              <strong>{popup.event.title}</strong>
              <br />
              {categoryLabel(popup.event.category)} · {formatDateRange(popup.event)}
              <br />
              {popup.event.venue ? `${popup.event.venue} — ` : ""}
              {popup.event.city}
              <br />
              <button type="button" className="map-popup-btn" onClick={() => onSelect(popup.event as MiEvent)}>
                VEDI IN LISTA
              </button>
            </>
          ) : (
            <>
              <strong>{popup.cluster.events.length} EVENTI QUI</strong>
              {popup.cluster.events.slice(0, 8).map((e) => (
                <div key={e.id}>
                  <button type="button" className="map-popup-btn" onClick={() => onSelect(e)}>
                    {e.title}
                  </button>
                </div>
              ))}
              <button type="button" className="map-popup-btn" onClick={() => setPopup(null)}>CHIUDI ✕</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
