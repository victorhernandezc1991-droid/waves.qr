import { Component } from "react";

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("[ErrorBoundary]", error, info?.componentStack);
  }

  reset = () => this.setState({ error: null });

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div
        role="alert"
        style={{
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "32px 24px",
          background: "var(--bg-body, #08080c)",
          color: "var(--text-main, #f5f5f7)",
          textAlign: "center",
          fontFamily: "Inter, system-ui, sans-serif",
        }}
      >
        <h1 style={{ fontSize: "2.4rem", marginBottom: "12px" }}>😔 Algo salió mal</h1>
        <p style={{ color: "var(--text-muted, #8e8e93)", maxWidth: "480px", marginBottom: "20px" }}>
          La app encontró un error inesperado. Probá recargar — si el problema persiste, contactá al soporte.
        </p>
        <details style={{ maxWidth: "560px", marginBottom: "20px", textAlign: "left" }}>
          <summary style={{ cursor: "pointer", color: "var(--text-dim, #636366)", fontSize: ".9rem" }}>
            Detalles técnicos
          </summary>
          <pre style={{
            marginTop: "10px",
            padding: "12px",
            background: "var(--bg-surface, #1c1c2b)",
            borderRadius: "8px",
            fontSize: ".75rem",
            overflow: "auto",
            color: "var(--accent-red, #ff3b3b)",
          }}>
            {String(this.state.error?.message || this.state.error)}
          </pre>
        </details>
        <div style={{ display: "flex", gap: "10px" }}>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: "12px 24px",
              border: "none",
              borderRadius: "12px",
              background: "var(--accent-blue, #2b7fff)",
              color: "white",
              fontWeight: 700,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            🔄 Recargar
          </button>
          <button
            onClick={this.reset}
            style={{
              padding: "12px 24px",
              border: "1px solid var(--border-subtle, rgba(255,255,255,.1))",
              borderRadius: "12px",
              background: "transparent",
              color: "var(--text-main, #f5f5f7)",
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            Reintentar
          </button>
        </div>
      </div>
    );
  }
}
