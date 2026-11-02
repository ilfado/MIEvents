import { Component, type ReactNode } from "react";

export class ErrorBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    console.error("UI crash:", error);
  }
  render() {
    if (this.state.error) return this.props.fallback;
    return this.props.children;
  }
}
