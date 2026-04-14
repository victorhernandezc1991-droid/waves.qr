import { useEffect, useState } from "react";
import { db } from "../firebaseConfig";
import { doc, onSnapshot, setDoc, serverTimestamp } from "firebase/firestore";

const DIAS = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];
const METODOS = [
  { id: "efectivo", nombre: "💵 Efectivo" },
  { id: "tarjeta", nombre: "💳 Tarjeta" },
  { id: "mercadoPago", nombre: "📱 Mercado Pago" },
];

const DEFAULTS = {
  nombre: "Waves", direccion: "", telefono: "", email: "",
  estado: "ABIERTO",
  horarios: DIAS.reduce((a, d) => ({ ...a, [d]: { apertura: "09:00", cierre: "23:00", cerrado: false } }), {}),
  metodosPago: ["efectivo", "tarjeta", "mercadoPago"],
  notificaciones: true,
};

export default function ConfigLocal({ addToast, alCerrar }) {
  const [config, setConfig]       = useState(DEFAULTS);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    const unsub = onSnapshot(doc(db, "configuracion", "local"), (snap) => {
      if (snap.exists()) setConfig({ ...DEFAULTS, ...snap.data() });
    });
    return () => unsub();
  }, []);

  const guardar = async () => {
    setGuardando(true);
    try {
      await setDoc(doc(db, "configuracion", "local"), { ...config, actualizadoEn: serverTimestamp() });
      addToast("✅ Configuración guardada.", "success");
    } catch { addToast("❌ Error al guardar.", "error"); }
    finally { setGuardando(false); }
  };

  const toggleMetodo = (id) =>
    setConfig((p) => ({
      ...p,
      metodosPago: p.metodosPago.includes(id) ? p.metodosPago.filter((m) => m !== id) : [...p.metodosPago, id],
    }));

  const updateHorario = (dia, campo, valor) =>
    setConfig((p) => ({ ...p, horarios: { ...p.horarios, [dia]: { ...p.horarios[dia], [campo]: valor } } }));

  const u = (campo) => (e) => setConfig((p) => ({ ...p, [campo]: e.target.value }));

  return (
    <div className="config-container">
      <div className="config-header">
        <h1>⚙️ Configuración</h1>
        <button className="btn-cerrar-vista" onClick={alCerrar}>✕ VOLVER</button>
      </div>

      <div className="config-estado-card">
        <span className="config-estado-label">Estado del Local</span>
        <button
          className={`btn-estado ${config.estado === "ABIERTO" ? "abierto" : "cerrado"}`}
          onClick={() => setConfig((p) => ({ ...p, estado: p.estado === "ABIERTO" ? "CERRADO" : "ABIERTO" }))}
        >
          {config.estado === "ABIERTO" ? "🟢 ABIERTO" : "🔴 CERRADO"}
        </button>
      </div>

      <div className="config-seccion">
        <h3>📍 Información del Local</h3>
        <input className="input-base" placeholder="Nombre" value={config.nombre} onChange={u("nombre")} />
        <input className="input-base" placeholder="Dirección" value={config.direccion} onChange={u("direccion")} />
        <input className="input-base" placeholder="Teléfono" value={config.telefono} onChange={u("telefono")} />
        <input className="input-base" placeholder="Email" type="email" value={config.email} onChange={u("email")} />
      </div>

      <div className="config-seccion">
        <h3>🔔 Notificaciones</h3>
        <label className="config-toggle-label">
          <input type="checkbox" checked={config.notificaciones} onChange={(e) => setConfig((p) => ({ ...p, notificaciones: e.target.checked }))} />
          Sonidos de nuevos pedidos
        </label>
      </div>

      <div className="config-seccion">
        <h3>💳 Métodos de Pago</h3>
        <div className="config-metodos-grid">
          {METODOS.map((m) => (
            <button key={m.id} className={`config-metodo-btn ${config.metodosPago.includes(m.id) ? "activo" : ""}`} onClick={() => toggleMetodo(m.id)}>
              {m.nombre}
            </button>
          ))}
        </div>
      </div>

      <div className="config-seccion">
        <h3>🕐 Horarios</h3>
        <div className="config-horarios">
          {DIAS.map((dia) => (
            <div key={dia} className="config-horario-row">
              <span className="config-dia">{dia.charAt(0).toUpperCase() + dia.slice(1)}</span>
              <label className="config-cerrado-check">
                <input type="checkbox" checked={config.horarios[dia]?.cerrado || false} onChange={(e) => updateHorario(dia, "cerrado", e.target.checked)} />
                Cerrado
              </label>
              {!config.horarios[dia]?.cerrado && (
                <>
                  <input type="time" value={config.horarios[dia]?.apertura || "09:00"} onChange={(e) => updateHorario(dia, "apertura", e.target.value)} className="input-time" />
                  <span style={{ color: "var(--text-dim)" }}>—</span>
                  <input type="time" value={config.horarios[dia]?.cierre || "23:00"} onChange={(e) => updateHorario(dia, "cierre", e.target.value)} className="input-time" />
                </>
              )}
            </div>
          ))}
        </div>
      </div>

      <button className="btn-guardar-config" onClick={guardar} disabled={guardando}>
        {guardando ? "Guardando..." : "💾 GUARDAR CONFIGURACIÓN"}
      </button>
    </div>
  );
}
