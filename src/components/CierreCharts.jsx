import { useMemo } from "react";

// ─── Ventas por hora — bar chart SVG ─────────────────────────────────────────
export function VentasPorHora({ pedidos }) {
  const data = useMemo(() => {
    const horas = Array(24).fill(0);
    pedidos.forEach(p => {
      const fecha = p.creadoEn?.toDate ? p.creadoEn.toDate() : (p.creadoEn ? new Date(p.creadoEn) : null);
      if (!fecha) return;
      const h = fecha.getHours();
      horas[h] += p.total || 0;
    });
    // Encontrar rango de horas con datos para no mostrar 24 columnas vacías
    let primera = horas.findIndex(v => v > 0);
    let ultima  = 23 - [...horas].reverse().findIndex(v => v > 0);
    if (primera === -1) return null; // no hay datos
    primera = Math.max(0, primera - 1);
    ultima  = Math.min(23, ultima + 1);
    const slice = horas.slice(primera, ultima + 1).map((v, i) => ({ hora: primera + i, monto: v }));
    return { slice, max: Math.max(...slice.map(s => s.monto)) };
  }, [pedidos]);

  if (!data) return null;

  const { slice, max } = data;
  const W       = 100; // viewBox %
  const H       = 100;
  const barW    = W / slice.length;
  const padding = 14;
  const chartH  = H - padding * 2;

  return (
    <div className="chart-card">
      <div className="chart-header">
        <h4>📈 Ventas por hora</h4>
        <span className="chart-meta">{slice.filter(s => s.monto > 0).length} hs activas</span>
      </div>
      <svg className="chart-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        {/* Líneas guía horizontales */}
        {[0.25, 0.5, 0.75].map(p => (
          <line key={p} x1="0" x2={W} y1={padding + chartH * (1 - p)} y2={padding + chartH * (1 - p)}
            stroke="currentColor" strokeOpacity="0.06" strokeWidth="0.3" />
        ))}
        {/* Barras */}
        {slice.map((s, i) => {
          const h = max > 0 ? (s.monto / max) * chartH : 0;
          const x = i * barW + barW * 0.15;
          const y = padding + (chartH - h);
          const w = barW * 0.7;
          return (
            <g key={s.hora}>
              <rect x={x} y={y} width={w} height={h}
                fill="currentColor" className="chart-bar"
                rx="0.6" ry="0.6">
                <title>{s.hora}:00 — ${s.monto.toLocaleString("es-AR")}</title>
              </rect>
            </g>
          );
        })}
      </svg>
      {/* Etiquetas X (cada 2 horas para no saturar) */}
      <div className="chart-x-labels">
        {slice.map((s, i) => (
          <span key={s.hora} className="chart-x-label" style={{ flex: 1 }}>
            {(slice.length <= 8 || i % 2 === 0) ? `${s.hora}h` : ""}
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── Top productos del día — horizontal bars ─────────────────────────────────
export function TopProductos({ pedidos, topN = 5 }) {
  const data = useMemo(() => {
    const map = {};
    pedidos.forEach(p => {
      p.items?.forEach(it => {
        const key = it.nombre || "—";
        if (!map[key]) map[key] = { nombre: key, cantidad: 0, total: 0 };
        map[key].cantidad += it.cantidad || 0;
        map[key].total    += it.total || 0;
      });
    });
    const arr = Object.values(map).sort((a, b) => b.cantidad - a.cantidad).slice(0, topN);
    if (arr.length === 0) return null;
    return { arr, maxCantidad: arr[0].cantidad };
  }, [pedidos, topN]);

  if (!data) return null;

  return (
    <div className="chart-card">
      <div className="chart-header">
        <h4>🏆 Top {Math.min(topN, data.arr.length)} productos del día</h4>
        <span className="chart-meta">por cantidad</span>
      </div>
      <div className="topprod-list">
        {data.arr.map((p, i) => {
          const pct = data.maxCantidad > 0 ? (p.cantidad / data.maxCantidad) * 100 : 0;
          return (
            <div key={p.nombre} className="topprod-row">
              <span className="topprod-rank">#{i + 1}</span>
              <div className="topprod-content">
                <div className="topprod-line">
                  <span className="topprod-nombre">{p.nombre}</span>
                  <span className="topprod-stats">
                    <strong>{p.cantidad}</strong> · ${p.total.toLocaleString("es-AR")}
                  </span>
                </div>
                <div className="topprod-bar-wrap">
                  <div className="topprod-bar" style={{ width: `${pct}%` }} />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
