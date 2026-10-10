import { Component, type ErrorInfo, type ReactNode } from 'react';
import { reloadOnChunkError, reportError } from '../lib/errorReporter';

/** Fängt Abstürze beim Rendern ab, meldet sie dem Admin und zeigt eine Neu-laden-Seite statt eines weißen Bildschirms. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // veraltete App-Version: still neu laden statt Fehlerseite
    if (reloadOnChunkError(error)) return;
    reportError('crash', error, { component: info.componentStack?.split('\n').slice(0, 6).join('\n') ?? null });
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="stack center" style={{ minHeight: '60vh', justifyContent: 'center', padding: 24, textAlign: 'center' }}>
        <h1>Da ist etwas schiefgelaufen</h1>
        <p className="subtle">Der Fehler wurde automatisch an den Admin gemeldet. Deine Credits sind sicher.</p>
        <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
          Neu laden
        </button>
      </div>
    );
  }
}
