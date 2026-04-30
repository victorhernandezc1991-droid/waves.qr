import { useEffect, useState, useRef, useMemo } from "react";
import { db, auth } from "../firebaseConfig";
import { collection, onSnapshot, doc, updateDoc } from "firebase/firestore";
import { registrarFCMToken, suscribirMensajesForeground } from "../lib/fcm.js";

// ─── Helper: tiempo transcurrido desde un timestamp ──────────────────────────
function useTickPerSecond() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 30000); // re-render cada 30s
    return () => clearInterval(id);
  }, []);
}

function formatTranscurrido(creadoEn) {
  if (!creadoEn) return null;
  const fecha = creadoEn.toDate ? creadoEn.toDate() : new Date(creadoEn);
  const diffMs = Date.now() - fecha.getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return { texto: "ahora", urgencia: "low" };
  if (min < 60) return { texto: `${min}m`, urgencia: min >= 15 ? "high" : min >= 8 ? "med" : "low" };
  const h = Math.floor(min / 60);
  const m = min % 60;
  return { texto: `${h}h ${m}m`, urgencia: "high" };
}

// ─── Stats KPIs ──────────────────────────────────────────────────────────────
function StatsBar({ pedidos }) {
  const stats = useMemo(() => {
    const pendientes  = pedidos.filter(p => p.estado === "pendiente").length;
    const preparando  = pedidos.filter(p => p.estado === "preparando").length;
    const finalizados = pedidos.filter(p => p.estado === "finalizado");
    const totalDia    = finalizados.reduce((a, p) => a + (p.total || 0), 0);
    const promedio    = finalizados.length ? Math.round(totalDia / finalizados.length) : 0;
    return { pendientes, preparando, finalizadosCount: finalizados.length, totalDia, promedio };
  }, [pedidos]);

  return (
    <div className="cocina-stats">
      <div className="cocina-stat cocina-stat-pendientes">
        <span className="cocina-stat-num">{stats.pendientes}</span>
        <span className="cocina-stat-label">⏳ Pendientes</span>
      </div>
      <div className="cocina-stat cocina-stat-preparando">
        <span className="cocina-stat-num">{stats.preparando}</span>
        <span className="cocina-stat-label">👨‍🍳 Preparando</span>
      </div>
      <div className="cocina-stat cocina-stat-listos">
        <span className="cocina-stat-num">{stats.finalizadosCount}</span>
        <span className="cocina-stat-label">✅ Listos hoy</span>
      </div>
      <div className="cocina-stat cocina-stat-ventas">
        <span className="cocina-stat-num">${stats.totalDia.toLocaleString("es-AR")}</span>
        <span className="cocina-stat-label">💰 Ventas día</span>
      </div>
      <div className="cocina-stat cocina-stat-promedio">
        <span className="cocina-stat-num">${stats.promedio.toLocaleString("es-AR")}</span>
        <span className="cocina-stat-label">📊 Promedio</span>
      </div>
    </div>
  );
}

// ─── Card de Comanda ─────────────────────────────────────────────────────────
function ComandaCard({ p, onCambiar, onAnular }) {
  const tiempo = formatTranscurrido(p.creadoEn);
  const esDelivery = p.tipo === "delivery";

  return (
    <div
      className={`comanda-card comanda-${p.estado} ${esDelivery ? "comanda-delivery" : ""} ${tiempo?.urgencia ? `comanda-urgencia-${tiempo.urgencia}` : ""}`}
    >
      <div className="comanda-header">
        <div className="comanda-header-left">
          <h2 className="comanda-mesa">
            {esDelivery ? "🛵 DELIVERY" : `MESA ${p.mesa}`}
          </h2>
          {p.numeroOrden && <span className="comanda-orden">{p.numeroOrden}</span>}
        </div>
        <span className={`comanda-badge comanda-badge-${p.estado}`}>
          {p.estado === "pendiente" && "⏳ NUEVA"}
          {p.estado === "preparando" && "👨‍🍳 EN PREP."}
          {p.estado === "finalizado" && "✅ LISTO"}
        </span>
      </div>

      <div className="comanda-meta">
        {tiempo && (
          <span className={`comanda-tiempo comanda-tiempo-${tiempo.urgencia}`}>
            ⏱ {tiempo.texto}
          </span>
        )}
        {p.metodoPago && (
          <span className="comanda-pago">
            {p.metodoPago === "efectivo" ? "💵" : p.metodoPago === "tarjeta" ? "💳" : "📱"} {p.metodoPago}
          </span>
        )}
        {p.total != null && (
          <span className="comanda-total-mini">${p.total.toLocaleString("es-AR")}</span>
        )}
      </div>

      {esDelivery && p.deliveryInfo && (
        <div className="comanda-delivery-info">
          <p>👤 <strong>{p.deliveryInfo.nombre}</strong></p>
          <p>📍 {p.deliveryInfo.direccion}</p>
          <p>📞 {p.deliveryInfo.telefono}</p>
        </div>
      )}

      {p.notas && <div className="nota-cocina">⚠️ {p.notas}</div>}

      <ul className="comanda-lista">
        {p.items?.map((it, i) => (
          <li key={i}>
            <span className="comanda-item-cantidad">{it.cantidad}×</span>
            <span className="comanda-item-nombre">{it.nombre}</span>
          </li>
        ))}
      </ul>

      <div className="comanda-btns">
        {p.estado === "pendiente" && (
          <button className="btn-preparar" onClick={() => onCambiar(p.id, "preparando")}>
            ▶ EMPEZAR
          </button>
        )}
        {p.estado === "preparando" && (
          <button className="btn-listo" onClick={() => onCambiar(p.id, "finalizado")}>
            ✓ LISTO
          </button>
        )}
        <button className="btn-anular" onClick={() => onAnular(p.id)} title="Anular pedido">
          ✕
        </button>
      </div>
    </div>
  );
}

// ─── Componente principal ────────────────────────────────────────────────────
export default function CocinaAdmin({ slug, addToast, alCerrar }) {
  const [pedidos, setPedidos]   = useState([]);
  const [llamadas, setLlamadas] = useState([]);
  const [interactuado, setInteractuado] = useState(false);
  const [filtro, setFiltro] = useState("activos"); // activos | pendientes | preparando | todos
  const [soundOn, setSoundOn] = useState(() => localStorage.getItem("cocinaSound") !== "off");
  const audioRef          = useRef(null);
  const pedidosAnteriores = useRef(0);

  useTickPerSecond(); // re-renderiza cada 30s para actualizar el tiempo transcurrido

  useEffect(() => {
    audioRef.current = new Audio("https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3");
    audioRef.current.preload = "auto";
  }, []);

  // Registrar token FCM cuando el admin entra a Cocina, así el backend
  // puede mandarle push cuando haya un nuevo pedido aunque la app esté cerrada.
  useEffect(() => {
    const user = auth.currentUser;
    if (!user) return;
    registrarFCMToken({ slug, user, addToast });
    let unsub = () => {};
    suscribirMensajesForeground(payload => {
      // Cuando llega un mensaje en foreground reproducimos el sonido
      if (soundOn) audioRef.current?.play().catch(() => {});
    }).then(fn => { unsub = fn; });
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "comercios", slug, "pedidos"), snap => {
      const todos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      const activos = todos.filter(p => p.estado === "pendiente" || p.estado === "preparando");
      if (activos.length > pedidosAnteriores.current && pedidosAnteriores.current !== 0 && interactuado) {
        if (soundOn) audioRef.current?.play().catch(() => {});
        if (!document.hasFocus() && "Notification" in window && Notification.permission === "granted") {
          const nuevos = activos.filter(p => p.estado === "pendiente");
          const ultimo = nuevos[nuevos.length - 1];
          if (ultimo) new Notification("🔔 Nuevo pedido — Waves", {
            body: ultimo.tipo === "delivery"
              ? `Delivery — ${ultimo.items?.length || 0} items`
              : `Mesa ${ultimo.mesa} — ${ultimo.items?.length || 0} items`,
            icon: "/logo-waves.png",
          });
        }
      }
      pedidosAnteriores.current = activos.length;
      setPedidos(todos);
    });
    return () => unsub();
  }, [slug, interactuado, soundOn]);

  useEffect(() => {
    const e = pedidos.filter(p => p.estado === "pendiente").length;
    document.title = e > 0 ? `(${e}) Waves Cocina` : "Waves — Cocina";
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
    } catch (err) {
      console.error("[CocinaAdmin]", err);
      addToast(err?.message || "Error al cambiar estado.", "error");
    }
  };

  const anularPedido = async (id) => {
    if (!window.confirm("¿Anular este pedido?")) return;
    try {
      await updateDoc(doc(db, "comercios", slug, "pedidos", id), { estado: "anulado" });
      addToast("Pedido anulado.", "info");
    } catch (err) {
      console.error("[CocinaAdmin]", err);
      addToast(err?.message || "Error.", "error");
    }
  };

  const atenderLlamada = async (id) => {
    try { await updateDoc(doc(db, "comercios", slug, "llamadasMozo", id), { atendida: true }); }
    catch (err) { console.error("[CocinaAdmin]", err); addToast(err?.message || "Error.", "error"); }
  };

  const toggleSound = () => {
    setSoundOn(s => {
      const nuevo = !s;
      localStorage.setItem("cocinaSound", nuevo ? "on" : "off");
      return nuevo;
    });
  };

  // Filtrado y ordenamiento
  const pedidosFiltrados = useMemo(() => {
    let lista;
    if (filtro === "activos")          lista = pedidos.filter(p => p.estado === "pendiente" || p.estado === "preparando");
    else if (filtro === "pendientes")  lista = pedidos.filter(p => p.estado === "pendiente");
    else if (filtro === "preparando")  lista = pedidos.filter(p => p.estado === "preparando");
    else                                lista = pedidos.filter(p => p.estado !== "anulado"); // todos = sin anulados
    // Ordenar: pendientes primero, luego preparando, después por fecha asc (más viejo primero)
    const orden = { pendiente: 0, preparando: 1, finalizado: 2 };
    return [...lista].sort((a, b) => {
      const ordA = orden[a.estado] ?? 9;
      const ordB = orden[b.estado] ?? 9;
      if (ordA !== ordB) return ordA - ordB;
      const ta = a.creadoEn?.toMillis?.() || 0;
      const tb = b.creadoEn?.toMillis?.() || 0;
      return ta - tb; // más viejo primero (más urgente)
    });
  }, [pedidos, filtro]);

  return (
    <div className="cocina-container" onClick={() => setInteractuado(true)}>
      {/* ── Top bar ── */}
      <div className="cocina-top-bar">
        <button className="btn-cerrar-vista" onClick={e => { e.stopPropagation(); alCerrar(); }}>← Menú</button>
        <h1 className="cocina-title">👨‍🍳 Comandas</h1>
        <button
          className={`btn-sound-toggle ${soundOn ? "on" : "off"}`}
          onClick={e => { e.stopPropagation(); toggleSound(); }}
          aria-label={soundOn ? "Silenciar sonido de pedidos" : "Activar sonido de pedidos"}
          title={soundOn ? "Sonido activado" : "Sonido silenciado"}
        >
          {soundOn ? "🔔" : "🔕"}
        </button>
      </div>

      {/* ── Stats dashboard ── */}
      <StatsBar pedidos={pedidos} />

      {/* ── Llamadas mozo ── */}
      {llamadas.length > 0 && (
        <div className="llamadas-mozo-panel">
          <h3>🖐️ Llamadas de Mozo</h3>
          <div className="llamadas-grid">
            {llamadas.map(l => (
              <div key={l.id} className="llamada-item">
                <span className="llamada-mesa">Mesa {l.mesa}</span>
                <span className="llamada-hora">{l.hora}</span>
                <button className="btn-atender" onClick={() => atenderLlamada(l.id)}>Atender ✓</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Filtros ── */}
      <div className="cocina-filtros">
        {[
          { key: "activos",    label: "Activos",    icon: "🔥" },
          { key: "pendientes", label: "Pendientes", icon: "⏳" },
          { key: "preparando", label: "Preparando", icon: "👨‍🍳" },
          { key: "todos",      label: "Todos",      icon: "📋" },
        ].map(f => (
          <button
            key={f.key}
            className={`cocina-filtro-btn ${filtro === f.key ? "activo" : ""}`}
            onClick={e => { e.stopPropagation(); setFiltro(f.key); }}
          >
            {f.icon} {f.label}
          </button>
        ))}
      </div>

      {/* ── Grid de comandas ── */}
      <div className="cocina-grid">
        {pedidosFiltrados.length === 0 && (
          <div className="cocina-empty">
            <span className="cocina-empty-icon">🍽️</span>
            <p className="cocina-empty-text">
              {filtro === "activos" ? "Sin pedidos activos. ¡Cocina al día!" : "Sin pedidos para mostrar."}
            </p>
          </div>
        )}
        {pedidosFiltrados.map(p => (
          <ComandaCard key={p.id} p={p} onCambiar={cambiarEstado} onAnular={anularPedido} />
        ))}
      </div>
    </div>
  );
}
