import { useEffect, useState, useRef } from "react";
import { db } from "../firebaseConfig";
import { collection, onSnapshot, doc, updateDoc } from "firebase/firestore";

function SeccionVentas({ pedidos, slug }) {
  const finalizados = pedidos.filter(p => p.estado === "finalizado");
  const total = finalizados.reduce((a, p) => a + (p.total || 0), 0);
  if (finalizados.length === 0) return null;
  return (
    <div className="ventas-caja">
      <div className="ventas-header"><h2>💰 Caja del Día</h2></div>
      <p className="ventas-total">${total.toLocaleString("es-AR")}</p>
      <div className="ventas-scroll">
        {finalizados.map(p => (
          <div key={p.id} className="venta-row">
            <span>Mesa {p.mesa}</span>
            <span>${p.total?.toLocaleString("es-AR")} <small style={{ color: "var(--text-dim)" }}>({p.entregadoHora})</small></span>
          </div>
        ))}
      </div>
      <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginTop: "12px", textAlign: "center" }}>
        📋 Usa la opción "Cierre de Caja" del menú para registrar el cierre
      </p>
    </div>
  );
}

export default function CocinaAdmin({ slug, addToast, alCerrar }) {
  const [pedidos, setPedidos]   = useState([]);
  const [llamadas, setLlamadas] = useState([]);
  const [interactuado, setInteractuado] = useState(false);
  const audioRef          = useRef(null);
  const pedidosAnteriores = useRef(0);

  useEffect(() => {
    audioRef.current = new Audio("https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3");
    audioRef.current.preload = "auto";
  }, []);

  useEffect(() => {
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "comercios", slug, "pedidos"), snap => {
      const todos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      const activos = todos.filter(p => p.estado === "pendiente" || p.estado === "preparando");
      if (activos.length > pedidosAnteriores.current && pedidosAnteriores.current !== 0 && interactuado) {
        audioRef.current?.play().catch(() => {});
        if (!document.hasFocus() && "Notification" in window && Notification.permission === "granted") {
          const nuevos = activos.filter(p => p.estado === "pendiente");
          const ultimo = nuevos[nuevos.length - 1];
          if (ultimo) new Notification("🔔 Nuevo pedido — Waves", {
            body: `Mesa ${ultimo.mesa} — ${ultimo.items?.length || 0} items`,
            icon: "/logo-waves.png",
          });
        }
      }
      pedidosAnteriores.current = activos.length;
      setPedidos(todos);
    });
    return () => unsub();
  }, [slug, interactuado]);

  useEffect(() => {
    const e = pedidos.filter(p => p.estado === "pendiente").length;
    document.title = e > 0 ? `(${e} nuevo${e > 1 ? "s" : ""}) Waves Cocina` : "Waves — Cocina";
    return () => { document.title = "Waves"; };
  }, [pedidos]);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "comercios", slug, "llamadasMozo"), snap => {
      setLlamadas(snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(l => !l.atendida));
    });
    return () => unsub();
  }, [slug]);

  const cambiarEstado = async (id, estado) => {
    try {
      await updateDoc(doc(db, "comercios", slug, "pedidos", id), {
        estado,
        entregadoHora: estado === "finalizado"
          ? new Date().toLocaleTimeString("es-AR", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })
          : null,
      });
    } catch { addToast("Error.", "error"); }
  };

  const anularPedido = async (id) => {
    if (!window.confirm("¿Anular este pedido?")) return;
    try { await updateDoc(doc(db, "comercios", slug, "pedidos", id), { estado: "anulado" }); addToast("Pedido anulado.", "info"); }
    catch (err) { console.error("[CocinaAdmin]", err); addToast(err?.message || "Error.", "error"); }
  };

  const atenderLlamada = async (id) => {
    try { await updateDoc(doc(db, "comercios", slug, "llamadasMozo", id), { atendida: true }); }
    catch (err) { console.error("[CocinaAdmin]", err); addToast(err?.message || "Error.", "error"); }
  };

  const activos = pedidos.filter(p => p.estado === "pendiente" || p.estado === "preparando");

  return (
    <div className="cocina-container" onClick={() => setInteractuado(true)}>
      <div className="cocina-top-bar">
        <button className="btn-cerrar-vista" onClick={e => { e.stopPropagation(); alCerrar(); }}>← Menú</button>
      </div>
      <h1 className="cocina-title">👨‍🍳 COMANDAS</h1>

      {llamadas.length > 0 && (
        <div className="llamadas-mozo-panel">
          <h3>🔔 Llamadas de Mozo</h3>
          {llamadas.map(l => (
            <div key={l.id} className="llamada-item">
              <span>🖐️ Mesa {l.mesa}</span>
              <button className="btn-atender" onClick={() => atenderLlamada(l.id)}>Atender ✓</button>
            </div>
          ))}
        </div>
      )}

      <div className="cocina-grid">
        {activos.length === 0 && <p style={{ color: "var(--text-dim)", textAlign: "center", gridColumn: "1/-1", padding: "40px 0" }}>Sin pedidos activos. 🎉</p>}
        {activos.map(p => (
          <div key={p.id} className={`comanda-card ${p.estado} ${p.tipo === "delivery" ? "comanda-delivery" : ""}`}>
            <div className="comanda-header">
              <h2>{p.tipo === "delivery" ? "🛵 DELIVERY" : `MESA ${p.mesa}`}</h2>
              <span className={`badge-${p.estado}`}>{p.estado.toUpperCase()}</span>
            </div>
            {p.numeroOrden && <div className="comanda-orden">Orden: {p.numeroOrden}</div>}
            {p.tipo === "delivery" && p.deliveryInfo && (
              <div className="comanda-delivery-info">
                <p>👤 {p.deliveryInfo.nombre}</p>
                <p>📍 {p.deliveryInfo.direccion}</p>
                <p>📞 {p.deliveryInfo.telefono}</p>
              </div>
            )}
            {p.metodoPago  && <div className="comanda-metodo-pago">💳 {p.metodoPago}</div>}
            {p.notas       && <div className="nota-cocina">⚠️ {p.notas}</div>}
            <ul className="comanda-lista">{p.items?.map((it, i) => <li key={i}>• {it.cantidad}x {it.nombre}</li>)}</ul>
            <div className="comanda-btns">
              {p.estado === "pendiente" && <button className="btn-preparar" onClick={() => cambiarEstado(p.id, "preparando")}>EMPEZAR</button>}
              <button className="btn-listo"  onClick={() => cambiarEstado(p.id, "finalizado")}>LISTO ✓</button>
              <button className="btn-anular" onClick={() => anularPedido(p.id)}>✕</button>
            </div>
          </div>
        ))}
      </div>
      <SeccionVentas pedidos={pedidos} slug={slug} />
    </div>
  );
}
