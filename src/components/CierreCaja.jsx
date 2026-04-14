import { useEffect, useState } from "react";
import { db } from "../firebaseConfig";
import {
  collection, onSnapshot, addDoc, query,
  orderBy, limit, getDocs, serverTimestamp,
} from "firebase/firestore";

export default function CierreCaja({ addToast, alCerrar }) {
  const [pedidos, setPedidos]                   = useState([]);
  const [cierresAnteriores, setCierresAnteriores] = useState([]);
  const [turno, setTurno]                       = useState("completo");
  const [loading, setLoading]                   = useState(true);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "pedidos"), (snap) => {
      setPedidos(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setLoading(false);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const q = query(collection(db, "cierresCaja"), orderBy("creadoEn", "desc"), limit(7));
        const snap = await getDocs(q);
        setCierresAnteriores(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      } catch (e) { console.error(e); }
    })();
  }, []);

  const finalizados = pedidos.filter((p) => p.estado === "finalizado");
  const anulados    = pedidos.filter((p) => p.estado === "anulado");

  const totalVentas     = finalizados.reduce((a, p) => a + (p.total || 0), 0);
  const ticketsEmitidos = finalizados.length;
  const ticketPromedio  = ticketsEmitidos > 0 ? totalVentas / ticketsEmitidos : 0;

  const desglose = {
    efectivo:       finalizados.filter((p) => p.metodoPago === "efectivo").reduce((a, p) => a + (p.total || 0), 0),
    tarjeta:        finalizados.filter((p) => p.metodoPago === "tarjeta").reduce((a, p) => a + (p.total || 0), 0),
    mercadoPago:    finalizados.filter((p) => p.metodoPago === "mercadoPago").reduce((a, p) => a + (p.total || 0), 0),
    sinEspecificar: finalizados.filter((p) => !p.metodoPago).reduce((a, p) => a + (p.total || 0), 0),
  };

  const montoAnulaciones = anulados.reduce((a, p) => a + (p.total || 0), 0);
  const ultimoCierre     = cierresAnteriores[0];
  const diferencia       = ultimoCierre ? totalVentas - (ultimoCierre.totalVentas || 0) : null;
  const porcentajeDif    = ultimoCierre?.totalVentas
    ? ((diferencia / ultimoCierre.totalVentas) * 100).toFixed(1) : null;

  const guardarCierre = async () => {
    if (finalizados.length === 0) return addToast("No hay ventas finalizadas.", "warning");
    if (!window.confirm(`¿Confirmar cierre por $${totalVentas.toLocaleString("es-AR")}?`)) return;
    try {
      await addDoc(collection(db, "cierresCaja"), {
        fecha: new Date().toLocaleDateString("es-AR"),
        turno, totalVentas, desglose, ticketsEmitidos,
        ticketPromedio: Math.round(ticketPromedio),
        anulaciones: anulados.length, montoAnulaciones,
        creadoEn: serverTimestamp(),
      });
      addToast("✅ Cierre guardado.", "success");
    } catch { addToast("❌ Error al guardar.", "error"); }
  };

  const hoy = new Date().toLocaleDateString("es-AR", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });

  return (
    <div className="cierre-caja-container">
      <div className="cierre-header">
        <h1>💰 Cierre de Caja</h1>
        <button className="btn-cerrar-vista" onClick={alCerrar}>✕ VOLVER</button>
      </div>

      <div className="cierre-fecha">
        <p className="cierre-fecha-texto">{hoy}</p>
        <div className="cierre-turno">
          <label>Turno:</label>
          <select value={turno} onChange={(e) => setTurno(e.target.value)} className="input-select">
            <option value="mañana">Mañana</option>
            <option value="tarde">Tarde</option>
            <option value="noche">Noche</option>
            <option value="completo">Día Completo</option>
          </select>
        </div>
      </div>

      {loading ? (
        <p className="cierre-loading">Cargando datos...</p>
      ) : (
        <>
          <div className="cierre-total-card">
            <span className="cierre-total-label">Total Ventas</span>
            <span className="cierre-total-monto">${totalVentas.toLocaleString("es-AR")}</span>
            {diferencia !== null && (
              <span className={`cierre-comparativa ${diferencia >= 0 ? "positiva" : "negativa"}`}>
                {diferencia >= 0 ? "▲" : "▼"} ${Math.abs(diferencia).toLocaleString("es-AR")}
                {porcentajeDif && ` (${diferencia >= 0 ? "+" : ""}${porcentajeDif}%)`}
                <small> vs cierre anterior</small>
              </span>
            )}
          </div>

          <div className="cierre-desglose">
            <h3>Desglose por Método de Pago</h3>
            <div className="desglose-grid">
              {[
                { icon: "💵", nombre: "Efectivo", monto: desglose.efectivo },
                { icon: "💳", nombre: "Tarjeta", monto: desglose.tarjeta },
                { icon: "📱", nombre: "Mercado Pago", monto: desglose.mercadoPago },
                ...(desglose.sinEspecificar > 0 ? [{ icon: "❓", nombre: "Sin especificar", monto: desglose.sinEspecificar }] : []),
              ].map((d, i) => (
                <div key={i} className="desglose-item">
                  <span className="desglose-icon">{d.icon}</span>
                  <span className="desglose-nombre">{d.nombre}</span>
                  <span className="desglose-monto">${d.monto.toLocaleString("es-AR")}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="cierre-metricas">
            <h3>Métricas</h3>
            <div className="metricas-grid">
              <div className="metrica-item">
                <span className="metrica-valor">{ticketsEmitidos}</span>
                <span className="metrica-label">Tickets</span>
              </div>
              <div className="metrica-item">
                <span className="metrica-valor">${Math.round(ticketPromedio).toLocaleString("es-AR")}</span>
                <span className="metrica-label">Promedio</span>
              </div>
              <div className="metrica-item anulaciones">
                <span className="metrica-valor">{anulados.length}</span>
                <span className="metrica-label">Anulaciones</span>
              </div>
              {montoAnulaciones > 0 && (
                <div className="metrica-item anulaciones">
                  <span className="metrica-valor">${montoAnulaciones.toLocaleString("es-AR")}</span>
                  <span className="metrica-label">$ Anulados</span>
                </div>
              )}
            </div>
          </div>

          {cierresAnteriores.length > 0 && (
            <div className="cierre-historial">
              <h3>Cierres Anteriores</h3>
              <div className="cierre-historial-lista">
                {cierresAnteriores.map((c) => (
                  <div key={c.id} className="cierre-historial-item">
                    <span>{c.fecha} — {c.turno}</span>
                    <span className="cierre-historial-monto">${c.totalVentas?.toLocaleString("es-AR")}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <button className="btn-guardar-cierre" onClick={guardarCierre}>
            📋 GUARDAR CIERRE DE CAJA
          </button>
        </>
      )}
    </div>
  );
}
