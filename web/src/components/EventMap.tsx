import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MiEvent } from "@mievents/shared";
import { categoryLabel, formatDateRange } from "../format.js";

const MILAN = { lat: 45.4642, lon: 9.19 };
const MIN_ZOOM = 7;
const MAX_ZOOM = 17;
const NORD_ITALIA = { north: 47.1, south: 43.5, west: 6.6, east: 13.7 };

function clampView(v: View, w = 0, h = 0): View {
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.zoom));
  let lat = v.lat;
  let lon = v.lon;
  if (w > 0 && h > 0) {
    const c = project(lat, lon, zoom);
    const nw = unproject(c.x - w / 2, c.y - h / 2, zoom);
    const se = unproject(c.x + w / 2, c.y + h / 2, zoom);
    const latSpan = nw.lat - se.lat;
    const lonSpan = se.lon - nw.lon;
    const maxLatSpan = NORD_ITALIA.north - NORD_ITALIA.south;
    const maxLonSpan = NORD_ITALIA.east - NORD_ITALIA.west;
    if (latSpan >= maxLatSpan) lat = (NORD_ITALIA.north + NORD_ITALIA.south) / 2;
    else lat = Math.min(NORD_ITALIA.north - latSpan / 2, Math.max(NORD_ITALIA.south + latSpan / 2, lat));
    if (lonSpan >= maxLonSpan) lon = (NORD_ITALIA.east + NORD_ITALIA.west) / 2;
    else lon = Math.min(NORD_ITALIA.east - lonSpan / 2, Math.max(NORD_ITALIA.west + lonSpan / 2, lon));
  }
  return { lat, lon, zoom };
}

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
  if (zoom >= 13 || geo.length < 2) return geo.map((e) => ({ single: e }));
  const cell = zoom <= 10 ? 0.12 : 0.04;
  const map = new Map<string, Cluster>();
  for (const e of geo) {
    const key = `${Math.floor((e.lat as number) / cell)},${Math.floor((e.lon as number) / cell)}`;
    const c = map.get(key);
    if (c) c.events.push(e);
    else map.set(key, { lat: e.lat as number, lon: e.lon as number, events: [e] });
  }
  return [...map.values()].map((c) => (c.events.length === 1 ? { single: c.events[0] } : c));
}

const tileCache = new Map<string, HTMLImageElement>();

function loadTile(z: number, x: number, y: number): HTMLImageElement {
  const key = `${z}/${x}/${y}`;
  let img = tileCache.get(key);
  if (img) return img;
  if (tileCache.size > 500) tileCache.clear();
  img = new Image();
  img.crossOrigin = "anonymous";
  img.src = `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
  tileCache.set(key, img);
  return img;
}

interface View {
  lat: number;
  lon: number;
  zoom: number;
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
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [view, setViewRaw] = useState<View>({ lat: MILAN.lat, lon: MILAN.lon, zoom: 10 });
  const setView = (u: View | ((v: View) => View)) =>
    setViewRaw((v) => {
      const wrap = wrapRef.current;
      return clampView(typeof u === "function" ? u(v) : u, wrap?.clientWidth ?? 0, wrap?.clientHeight ?? 0);
    });
  const viewRef = useRef(view);
  viewRef.current = view;
  const [popup, setPopup] = useState<{ lat: number; lon: number; event?: MiEvent; cluster?: Cluster } | null>(null);
  const [tilesVersion, setTilesVersion] = useState(0);

  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const gestureRef = useRef<
    | { kind: "pan"; startX: number; startY: number; lat0: number; lon0: number; zoom0: number; moved: boolean }
    | { kind: "pinch"; d0: number; zoom0: number; lat0: number; lon0: number; mid0: { x: number; y: number } }
    | null
  >(null);

  const selected = events.find((e) => e.id === selectedId);
  useEffect(() => {
    if (selected?.lat != null && selected.lon != null) {
      setView((v) => ({ lat: selected.lat as number, lon: selected.lon as number, zoom: Math.max(v.zoom, 13) }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id]);

  const clusters = useMemo(() => cluster(events, view.zoom), [events, view.zoom]);

  const reportBbox = useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    const v = viewRef.current;
    const w = el.clientWidth;
    const h = el.clientHeight;
    const c = project(v.lat, v.lon, v.zoom);
    const nw = unproject(c.x - w / 2, c.y - h / 2, v.zoom);
    const se = unproject(c.x + w / 2, c.y + h / 2, v.zoom);
    onBbox(`${se.lat.toFixed(5)},${nw.lon.toFixed(5)},${nw.lat.toFixed(5)},${se.lon.toFixed(5)}`);
  }, [onBbox]);

  useEffect(() => {
    reportBbox();
  }, [view, reportBbox]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = wrap.clientWidth;
    const h = wrap.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    const v = viewRef.current;

    ctx.fillStyle = "#f2f0ea";
    ctx.fillRect(0, 0, w, h);

    if (showStreets) {
      const z = Math.round(v.zoom);
      const scale = 256 * 2 ** z;
      const cx = ((v.lon + 180) / 360) * scale;
      const cy = project(v.lat, v.lon, v.zoom).y;
      const x0 = Math.max(0, Math.floor((cx - w / 2) / 256));
      const x1 = Math.floor((cx + w / 2) / 256);
      const y0 = Math.max(0, Math.floor((cy - h / 2) / 256));
      const y1 = Math.min(2 ** z - 1, Math.floor((cy + h / 2) / 256));
      const tileSize = 256 * 2 ** (v.zoom - z);
      for (let tx = x0; tx <= x1; tx++) {
        for (let ty = y0; ty <= y1; ty++) {
          const img = loadTile(z, tx, ty);
          const dx = tx * 256 - cx + w / 2;
          const dy = ty * 256 - cy + h / 2;
          if (img.complete && img.naturalWidth > 0) {
            ctx.save();
            ctx.globalAlpha = 0.92;
            ctx.filter = "grayscale(1) contrast(1.05) brightness(1.02)";
            ctx.drawImage(img, dx, dy, tileSize, tileSize);
            ctx.restore();
          } else if (!img.complete) {
            img.onload = () => setTilesVersion((n) => n + 1);
            img.onerror = () => setTilesVersion((n) => n + 1);
          }
        }
      }
    }

    const grid = 64;
    ctx.strokeStyle = showStreets ? "rgba(17,17,17,0.06)" : "#e3e0d8";
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

    const center = project(v.lat, v.lon, v.zoom);
    for (const c of clusters) {
      const lat = "single" in c ? (c.single.lat as number) : c.lat;
      const lon = "single" in c ? (c.single.lon as number) : c.lon;
      const p = project(lat, lon, v.zoom);
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
  }, [clusters, selectedId, showStreets, tilesVersion]);

  useEffect(() => {
    draw();
  }, [draw]);

  useEffect(() => {
    const onResize = () => draw();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [draw]);

  const pick = useCallback(
    (mx: number, my: number) => {
      const wrap = wrapRef.current;
      if (!wrap) return null;
      const v = viewRef.current;
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      const center = project(v.lat, v.lon, v.zoom);
      for (const c of clusters) {
        const lat = "single" in c ? (c.single.lat as number) : c.lat;
        const lon = "single" in c ? (c.single.lon as number) : c.lon;
        const p = project(lat, lon, v.zoom);
        const x = p.x - center.x + w / 2;
        const y = p.y - center.y + h / 2;
        const size = "single" in c ? 24 : 38;
        if (Math.abs(mx - x) <= size / 2 && Math.abs(my - y) <= size / 2) return c;
      }
      return null;
    },
    [clusters],
  );

  const applyZoomAt = useCallback((newZoom: number, px: number, py: number) => {
    setView((v) => {
      const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, newZoom));
      if (zoom === v.zoom) return v;
      const wrap = wrapRef.current;
      const w = wrap?.clientWidth ?? 0;
      const h = wrap?.clientHeight ?? 0;
      const center = project(v.lat, v.lon, v.zoom);
      const scale = 2 ** (zoom - v.zoom);
      const nx = center.x + (px - w / 2) * (1 - 1 / scale);
      const ny = center.y + (py - h / 2) * (1 - 1 / scale);
      const geo = unproject(nx, ny, zoom);
      return { lat: geo.lat, lon: geo.lon, zoom };
    });
  }, []);

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    pointersRef.current.set(e.pointerId, p);
    if (pointersRef.current.size === 2) {
      const [a, b] = [...pointersRef.current.values()];
      const v = viewRef.current;
      gestureRef.current = {
        kind: "pinch",
        d0: Math.max(10, Math.hypot(a.x - b.x, a.y - b.y)),
        zoom0: v.zoom,
        lat0: v.lat,
        lon0: v.lon,
        mid0: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      };
      return;
    }
    if (pointersRef.current.size === 1) {
      const v = viewRef.current;
      gestureRef.current = { kind: "pan", startX: p.x, startY: p.y, lat0: v.lat, lon0: v.lon, zoom0: v.zoom, moved: false };
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const p = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    if (!pointersRef.current.has(e.pointerId)) return;
    pointersRef.current.set(e.pointerId, p);
    const g = gestureRef.current;
    if (!g) return;

    if (g.kind === "pinch" && pointersRef.current.size >= 2) {
      const [a, b] = [...pointersRef.current.values()];
      const d = Math.max(10, Math.hypot(a.x - b.x, a.y - b.y));
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const newZoom = g.zoom0 + Math.log2(d / g.d0);
      applyZoomAt(newZoom, mid.x, mid.y);
      return;
    }

    if (g.kind === "pan" && pointersRef.current.size === 1) {
      const dx = p.x - g.startX;
      const dy = p.y - g.startY;
      if (Math.abs(dx) + Math.abs(dy) > 4) g.moved = true;
      if (!g.moved) return;
      const wrap = wrapRef.current;
      const w = wrap?.clientWidth ?? 0;
      const h = wrap?.clientHeight ?? 0;
      const center = project(g.lat0, g.lon0, g.zoom0);
      const nw = unproject(center.x - dx, center.y - dy, g.zoom0);
      setView((v) => ({ ...v, lat: nw.lat, lon: nw.lon }));
    }
  };

  const endPointer = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const hadPinch = gestureRef.current?.kind === "pinch";
    const wasTap = gestureRef.current?.kind === "pan" && !gestureRef.current.moved;
    pointersRef.current.delete(e.pointerId);
    if (pointersRef.current.size < 2 && gestureRef.current?.kind === "pinch") gestureRef.current = null;
    if (pointersRef.current.size === 0) {
      const g = gestureRef.current;
      gestureRef.current = null;
      if (hadPinch || !wasTap || !g) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const hit = pick(e.clientX - rect.left, e.clientY - rect.top);
      if (!hit) {
        setPopup(null);
        return;
      }
      if ("single" in hit) {
        setPopup({ lat: hit.single.lat as number, lon: hit.single.lon as number, event: hit.single });
        onSelect(hit.single);
      } else {
        setPopup({ lat: hit.lat, lon: hit.lon, cluster: hit });
      }
    }
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const v = viewRef.current;
      applyZoomAt(v.zoom + (e.deltaY < 0 ? 0.25 : -0.25), px, py);
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, [applyZoomAt]);

  const zoomBy = (delta: number) => {
    const wrap = wrapRef.current;
    applyZoomAt(viewRef.current.zoom + delta, (wrap?.clientWidth ?? 0) / 2, (wrap?.clientHeight ?? 0) / 2);
  };

  const popupScreen = useMemo(() => {
    if (!popup) return null;
    const wrap = wrapRef.current;
    if (!wrap) return null;
    const v = view;
    const w = wrap.clientWidth;
    const h = wrap.clientHeight;
    const c = project(v.lat, v.lon, v.zoom);
    const p = project(popup.lat, popup.lon, v.zoom);
    return { x: p.x - c.x + w / 2, y: p.y - c.y + h / 2 };
  }, [popup, view]);

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
        <button
          type="button"
          className={`map-toggle ${showStreets ? "on" : ""}`}
          aria-pressed={showStreets}
          onClick={onToggleStreets}
        >
          {showStreets ? "■ strade: on" : "□ strade: off"}
        </button>
      </div>
      <canvas
        ref={canvasRef}
        className="map-canvas"
        role="application"
        aria-label="Mappa eventi"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        style={{ touchAction: "none", cursor: "grab" }}
      />
      {popup && popupScreen && (
        <div
          className="map-popup"
          style={{
            left: Math.max(8, Math.min(popupScreen.x + 14, (wrapRef.current?.clientWidth ?? 320) - 258)),
            top: Math.max(8, popupScreen.y - 12),
          }}
        >
          {popup.event ? (
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
              <strong>{popup.cluster?.events.length} EVENTI QUI</strong>
              {popup.cluster?.events.slice(0, 8).map((e) => (
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
