import { EVENT_CATEGORIES, type EventCategory } from "@mievents/shared";
import { EMPTY_FILTERS, type Filters } from "../api.js";
import { categoryLabel } from "../format.js";

export function FiltersBar({
  filters,
  cities,
  onChange,
  resultCount,
}: {
  filters: Filters;
  cities: string[];
  onChange: (f: Filters) => void;
  resultCount: number;
}) {
  const set = (patch: Partial<Filters>) => onChange({ ...filters, ...patch });
  return (
    <div className="filters">
      <div className="filters-row">
        <input
          type="search"
          placeholder="Cerca per titolo, luogo, organizzatore…"
          value={filters.q}
          onChange={(e) => set({ q: e.target.value })}
          aria-label="Cerca eventi"
        />
        <select value={filters.city} onChange={(e) => set({ city: e.target.value })} aria-label="Comune">
          <option value="">Tutti i comuni</option>
          {cities.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>
      <div className="filters-row">
        <select
          value={filters.category}
          onChange={(e) => set({ category: e.target.value as EventCategory | "saved" | "" })}
          aria-label="Tipologia"
        >
          <option value="">Tutte le tipologie</option>
          <option value="saved">★ Solo salvati</option>
          {EVENT_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {categoryLabel(c)}
            </option>
          ))}
        </select>
        <label className="date-field">
          Dal
          <input type="date" value={filters.from} onChange={(e) => set({ from: e.target.value })} />
        </label>
        <label className="date-field">
          Al
          <input type="date" value={filters.to} onChange={(e) => set({ to: e.target.value })} />
        </label>
        <button type="button" className="btn-reset" onClick={() => onChange({ ...EMPTY_FILTERS })}>
          Azzera
        </button>
        <span className="result-count">{resultCount} eventi</span>
      </div>
    </div>
  );
}
