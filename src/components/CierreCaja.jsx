import { useEffect, useState } from "react";
import { db } from "../firebaseConfig";
import { collection, onSnapshot, addDoc, query, orderBy, limit, getDocs, serverTimestamp } from "firebase/firestore";
import { filtrarPorTurno } from "../lib/utils";
import { VentasPorHora, TopProductos } from "./CierreCharts.jsx";
import { exportCierreCSV, printCierre } from "../lib/exportCierre.js";
import { etiquetaPedido } from "../lib/pedidos";

export default function CierreCaja({ addToast, alCerrar }) {
  const [pedidos,  setPedidos]  = useState([]);
  const [cierres,  setCierres]  = useState([]);
  const [turno,    setTurno]    = useState(() => {
    const h = new Date().getHours();
    return h >= 6 && h < 12 ? "mañana" : h >= 12 && h < 18 ? "tarde" : h >= 18 ? "noche" : "completo";
  });
  const [fechaSeleccionada, setFechaSeleccionada] = useState(new Date());
  const [loading,   setLoading]   = useState(true);
  const [expandido, setExpandido] = useState(null);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "pedidos"), snap => {
      setPedidos(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setLoading(false);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const q = query(collection(db, "cierresCaja"), orderBy("creadoEn", "desc"), limit(100));
        const snap = await getDocs(q);
        setCierres(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      } catch (e) { console.error(e); }
    })();
  }, []);

  const fechaStr      = fechaSeleccionada.toLocaleDateString("es-AR");
  const pedidosHoy    = pedidos.filter(p =>
    p.creadoEn
      ? (p.creadoEn.toDate ? p.creadoEn.toDate() : new Date(p.creadoEn)).toLocaleDateString("es-AR") === fechaStr
      : false
  );
  const pedidosFiltrados = filtrarPorTurno(pedidosHoy, turno);
  const finalizados   = pedidosFiltrados.filter(p => p.estado === "finalizado");
  const anulados      = pedidosFiltrados.filter(p => p.estado === "anulado");
  const totalVentas   = finalizados.reduce((a, p) => a + (p.total || 0), 0);
  const tickets       = finalizados.length;
  const promedio      = tickets > 0 ? totalVentas / tickets : 0;
  const desglose      = {
    efectivo:       finalizados.filter(p => p.metodoPago === "efectivo").reduce((a, p) => a + (p.total || 0), 0),
    tarjeta:        finalizados.filter(p => p.metodoPago === "tarjeta").reduce((a, p) => a + (p.total || 0), 0),
    mercadoPago:    finalizados.filter(p => p.metodoPago === "mercadoPago").reduce((a, p) => a + (p.total || 0), 0),
    sinEspecificar: finalizados.filter(p => !p.metodoPago).reduce((a, p) => a + (p.total || 0), 0),
  };
  const montoAnulaciones = anulados.reduce((a, p) => a + (p.total || 0), 0);
  const cierreAnterior   = cierres[0];
  const diferencia       = cierreAnterior ? totalVentas - (cierreAnterior.totalVentas || 0) : null;
  const diferenciaPct    = cierreAnterior?.totalVentas ? (diferencia / cierreAnterior.totalVentas * 100).toFixed(1) : null;
  const cierresHoy       = cierres.filter(c => c.fecha === fechaStr);
  const fechaISO         = fechaSeleccionada.toISOString().split("T")[0];
  const fechaLabel       = fechaSeleccionada.toLocaleDateString("es-AR", { weekday: "long", year: "numeric", month: "long", day: "numeric" });

  const guardarCierre = async () => {
    if (finalizados.length === 0) return addToast("No hay ventas finalizadas.", "warning");
    if (!window.confirm(`¿Confirmar cierre por $${totalVentas.toLocaleString("es-AR")}?`)) return;
    try {
      await addDoc(collection(db, "cierresCaja"), {
        fecha: fechaStr, turno, totalVentas, desglose,
        ticketsEmitidos: tickets, ticketPromedio: Math.round(promedio),
        anulaciones: anulados.length, montoAnulaciones,
        pedidos: finalizados.map(p => ({
          id: p.id, tipo: p.tipo || null,
          clienteInfo: p.clienteInfo || null,
          mesa: p.mesa ?? null,  // legacy fallback
          numeroOrden: p.numeroOrden,
          items: p.items, total: p.total, metodoPago: p.metodoPago, hora: p.hora,
        })),
        creadoEn: serverTimestamp(),
      });
      addToast("✅ Cierre guardado.", "success");
    } catch (err) {
      console.error("[CierreCaja:guardarCierre]", err);
      addToast(err?.message || "❌ Error al guardar.", "error");
    }
  };

  return (
    <div className="cierre-caja-container">
      <div className="cierre-header">
        <h1>💰 Cierre de Caja</h1>
        <button className="btn-cerrar-vista" onClick={alCerrar}>✕ VOLVER</button>
      </div>

      <div className="cierre-fecha">
        <div className="cierre-selector-fecha">
          <label>Fecha:</label>
          <input type="date" value={fechaISO} onChange={e => setFechaSeleccionada(new Date(e.target.value + "T00:00:00"))} className="input-date" />
          <span className="cierre-fecha-texto">{fechaLabel}</span>
        </div>
        <div className="cierre-turno">
          <label>Turno:</label>
          <select value={turno} onChange={e => setTurno(e.target.value)} className="input-select">
            <option value="mañana">Mañana</option>
            <option value="tarde">Tarde</option>
            <option value="noche">Noche</option>
            <option value="completo">Día Completo</option>
          </select>
        </div>
      </div>

      {loading ? <p className="cierre-loading">Cargando datos...</p> : (
        <>
          <div className="cierre-total-card">
            <span className="cierre-total-label">Total Ventas</span>
            <span className="cierre-total-monto">${totalVentas.toLocaleString("es-AR")}</span>
            {diferencia !== null && (
              <span className={`cierre-comparativa ${diferencia >= 0 ? "positiva" : "negativa"}`}>
                {diferencia >= 0 ? "▲" : "▼"} ${Math.abs(diferencia).toLocaleString("es-AR")}
                {diferenciaPct && ` (${diferencia >= 0 ? "+" : ""}${diferenciaPct}%)`}
                <small> vs cierre anterior</small>
              </span>
            )}
          </div>

          <div className="cierre-desglose">
            <h3>Desglose por Método de Pago</h3>
            <div className="desglose-grid">
              {[
                { icon: "💵", nombre: "Efectivo",     monto: desglose.efectivo },
                { icon: "💳", nombre: "Tarjeta",      monto: desglose.tarjeta },
                { icon: "📱", nombre: "Mercado Pago", monto: desglose.mercadoPago },
                ...(desglose.sinEspecificar > 0 ? [{ icon: "❓", nombre: "Sin especificar", monto: desglose.sinEspecificar }] : []),
              ].map((item, i) => (
                <div key={i} className="desglose-item">
                  <span className="desglose-icon">{item.icon}</span>
                  <span className="desglose-nombre">{item.nombre}</span>
                  <span className="desglose-monto">${item.monto.toLocaleString("es-AR")}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="cierre-metricas">
            <h3>Métricas</h3>
            <div className="metricas-grid">
              <div className="metrica-item"><span className="metrica-valor">{tickets}</span><span className="metrica-label">Tickets</span></div>
              <div className="metrica-item"><span className="metrica-valor">${Math.round(promedio).toLocaleString("es-AR")}</span><span className="metrica-label">Promedio</span></div>
              <div className="metrica-item anulaciones"><span className="metrica-valor">{anulados.length}</span><span className="metrica-label">Anulaciones</span></div>
              {montoAnulaciones > 0 && <div className="metrica-item anulaciones"><span className="metrica-valor">${montoAnulaciones.toLocaleString("es-AR")}</span><span className="metrica-label">$ Anulados</span></div>}
            </div>
          </div>

          {/* ── Charts ── */}
          {finalizados.length > 0 && (
            <div className="cierre-charts">
              <VentasPorHora pedidos={finalizados} />
              <TopProductos pedidos={finalizados} />
            </div>
          )}

          {/* ── Acciones de exportación ── */}
          <div className="cierre-acciones-export">
            <button
              className="btn-export-csv"
              onClick={() => exportCierreCSV({
                fecha: fechaStr, turno, totalVentas, desglose,
                tickets, promedio, anulaciones: anulados.length, montoAnulaciones,
                finalizados,
              })}
              disabled={finalizados.length === 0}
            >
              📄 Exportar CSV
            </button>
            <button
              className="btn-export-pdf"
              onClick={printCierre}
              disabled={finalizados.length === 0}
            >
              🖨️ Imprimir / PDF
            </button>
          </div>

          {cierresHoy.length > 0 && (
            <div className="cierre-historial">
              <h3>📂 Historial de Cierres - {fechaStr}</h3>
              <div className="cierre-historial-lista">
                {cierresHoy.map(c => (
                  <div key={c.id} className="cierre-historial-item">
                    <button className="cierre-historial-header" onClick={() => setExpandido(expandido === c.id ? null : c.id)}>
                      <div className="cierre-historial-info">
                        <span className="cierre-historial-turno">{c.turno}</span>
                        <span className="cierre-historial-tickets">{c.ticketsEmitidos} tickets</span>
                        <span className="cierre-historial-hora">{c.creadoEn?.toDate?.().toLocaleTimeString("es-AR") || "—"}</span>
                      </div>
                      <span className="cierre-historial-monto">${c.totalVentas?.toLocaleString("es-AR")}</span>
                      <span className="cierre-historial-toggle">{expandido === c.id ? "▼" : "▶"}</span>
                    </button>
                    {expandido === c.id && (
                      <div className="cierre-historial-detalles">
                        <div className="detalles-desglose">
                          <h4>Desglose</h4>
                          <div className="desglose-items">
                            {c.desglose?.efectivo    > 0 && <p>💵 Efectivo: ${c.desglose.efectivo.toLocaleString("es-AR")}</p>}
                            {c.desglose?.tarjeta     > 0 && <p>💳 Tarjeta: ${c.desglose.tarjeta.toLocaleString("es-AR")}</p>}
                            {c.desglose?.mercadoPago > 0 && <p>📱 Mercado Pago: ${c.desglose.mercadoPago.toLocaleString("es-AR")}</p>}
                            {c.desglose?.sinEspecificar > 0 && <p>❓ Sin especificar: ${c.desglose.sinEspecificar.toLocaleString("es-AR")}</p>}
                          </div>
                        </div>
                        {c.pedidos?.length > 0 && (
                          <div className="detalles-comandas">
                            <h4>Comandas ({c.pedidos.length})</h4>
                            <div className="comandas-list">
                              {c.pedidos.map((p, i) => (
                                <div key={i} className="comanda-item">
                                  <div className="comanda-header">
                                    <span>{etiquetaPedido(p)}</span>
                                    <span className="comanda-orden">#{p.numeroOrden}</span>
                                    <span className="comanda-hora">{p.hora}</span>
                                  </div>
                                  <ul className="comanda-items">{p.items?.map((it, j) => <li key={j}>{it.cantidad}x {it.nombre}</li>)}</ul>
                                  <div className="comanda-footer">
                                    <span>{p.metodoPago === "efectivo" ? "💵" : p.metodoPago === "tarjeta" ? "💳" : "📱"}</span>
                                    <span className="comanda-total">${p.total?.toLocaleString("es-AR")}</span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <button className="btn-guardar-cierre" onClick={guardarCierre}>📋 GUARDAR CIERRE DE CAJA</button>
        </>
      )}
    </div>
  );
}
