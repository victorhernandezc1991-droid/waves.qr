import { useState, useEffect } from "react";
import { db } from "../firebaseConfig";
import { doc, setDoc } from "firebase/firestore";

const CAT_ICONS = { todos: "🍽️", hamburguesas: "🍔", pizzas: "🍕", pastas: "🍝", milanesas: "🥩", asado: "🥓", cafe: "☕", bebidas: "🥤", postres: "🍰" };
const MAX_ITEMS = 8;

export default function MenuDelDia({ slug, productos, menuDiaIds, addToast, alCerrar }) {
  const [seleccionados, setSeleccionados] = useState(new Set(menuDiaIds));
  const [guardando, setGuardando]         = useState(false);

  useEffect(() => { setSeleccionados(new Set(menuDiaIds)); }, [menuDiaIds]);

  const toggleItem = (id) => {
    setSeleccionados(prev => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); }
      else if (next.size < MAX_ITEMS) { next.add(id); }
      else { addToast(`Máximo ${MAX_ITEMS} items en el menú del día.`, "warning"); }
      return next;
    });
  };

  const guardar = async () => {
    setGuardando(true);
    try {
      await setDoc(doc(db, "comercios", slug, "config", "menuDelDia"), {
        ids: [...seleccionados],
        actualizadoEn: new Date().toISOString(),
      });
      addToast("✅ Menú del Día actualizado.", "success");
      alCerrar();
    } catch { addToast("❌ Error al guardar.", "error"); }
    finally { setGuardando(false); }
  };

  const disponibles = productos.filter(p => p.disponible !== false);

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-body)", padding: "24px" }}>
      <div className="menu-dia-header">
        <h2 className="menu-dia-title">🔥 Menú del Día</h2>
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <span className="menu-dia-counter">{seleccionados.size}/{MAX_ITEMS}</span>
          <button className="btn-cerrar-vista" onClick={alCerrar}>← Volver</button>
        </div>
      </div>
      <p className="menu-dia-hint">Tocá los platos que querés destacar hoy. Se mostrarán en el carrusel principal.</p>
      <div className="menu-dia-grid">
        {disponibles.map(p => {
          const activo = seleccionados.has(p.id);
          return (
            <div key={p.id} className={`menu-dia-card ${activo ? "activo" : ""}`} onClick={() => toggleItem(p.id)}>
              <div className="menu-dia-img-wrap">
                {p.foto ? <img src={p.foto} alt={p.nombre} className="menu-dia-img" /> : <div className="menu-dia-img-placeholder">{CAT_ICONS[p.categoria] || "🍽️"}</div>}
                {activo && <div className="menu-dia-check">✓</div>}
              </div>
              <div className="menu-dia-info">
                <span className="menu-dia-nombre">{p.nombre}</span>
                <span className="menu-dia-precio">${p.precio?.toLocaleString("es-AR")}</span>
              </div>
            </div>
          );
        })}
      </div>
      <div className="menu-dia-footer">
        <button className="btn-guardar-menu-dia" onClick={guardar} disabled={guardando}>
          {guardando ? "Guardando..." : `💾 Guardar Menú (${seleccionados.size} items)`}
        </button>
        <button className="btn-limpiar-menu-dia" onClick={() => setSeleccionados(new Set())}>🗑️ Limpiar selección</button>
      </div>
    </div>
  );
}
