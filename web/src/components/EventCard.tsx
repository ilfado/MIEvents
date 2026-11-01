import type { MiEvent } from "@mievents/shared";
import { categoryLabel, formatDateRange, formatTime } from "../format.js";

export function EventCard({
  event,
  selected,
  onSelect,
  onToggleSaved,
}: {
  event: MiEvent;
  selected: boolean;
  onSelect: (e: MiEvent) => void;
  onToggleSaved: (e: MiEvent) => void;
}) {
  return (
    <article className={`card ${selected ? "card-selected" : ""} ${event.saved ? "card-saved" : ""}`}>
      <button className="card-main" onClick={() => onSelect(event)} type="button">
        <div className="card-top">
          <span className={`badge badge-${event.category}`}>{categoryLabel(event.category)}</span>
          <span className="card-date">
            {formatDateRange(event)}
            {formatTime(event) ? ` · ${formatTime(event)}` : ""}
          </span>
        </div>
        <h3 className="card-title">{event.title}</h3>
        <p className="card-place">
          {event.venue ? `${event.venue} — ` : ""}
          {event.city}
          {event.lat == null ? " (posizione non disponibile)" : ""}
        </p>
        {event.description && <p className="card-desc">{event.description}</p>}
      </button>
      <div className="card-actions">
        <button
          type="button"
          className={`btn-save ${event.saved ? "btn-saved" : ""}`}
          aria-pressed={event.saved}
          onClick={() => onToggleSaved(event)}
        >
          {event.saved ? "★ Salvato" : "☆ Salva"}
        </button>
        {event.programUrl && (
          <a className="btn-link" href={event.programUrl} target="_blank" rel="noreferrer">
            Programma ↗
          </a>
        )}
        {event.website && (
          <a className="btn-link" href={event.website} target="_blank" rel="noreferrer">
            Sito ↗
          </a>
        )}
      </div>
    </article>
  );
}
