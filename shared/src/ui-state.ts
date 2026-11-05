import type { MiEvent } from "./index.js";

export interface EventsState {
  items: MiEvent[];
  total: number;
  loading: boolean;
  error: string | null;
  requestId: number;
}

export type EventsAction =
  | { type: "start"; id: number }
  | { type: "success"; id: number; events: MiEvent[]; total: number; append: boolean }
  | { type: "error"; id: number; message: string };

export const initialEventsState: EventsState = {
  items: [],
  total: 0,
  loading: false,
  error: null,
  requestId: 0,
};

export function nextRequestId(state: EventsState): number {
  return state.requestId + 1;
}

export function eventsReducer(state: EventsState, action: EventsAction): EventsState {
  switch (action.type) {
    case "start":
      return { ...state, loading: true, error: null, requestId: action.id };
    case "success": {
      if (action.id !== state.requestId) return state;
      return {
        ...state,
        loading: false,
        items: action.append ? [...state.items, ...action.events] : action.events,
        total: action.total,
      };
    }
    case "error": {
      if (action.id !== state.requestId) return state;
      return { ...state, loading: false, error: action.message };
    }
    default:
      return state;
  }
}
