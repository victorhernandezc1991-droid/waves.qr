import { useEffect, useState } from "react";
import { db } from "../firebaseConfig";
import { collection, onSnapshot, doc, updateDoc } from "firebase/firestore";

export default function StockManager({ addToast, alCerrar }) {
  const [productos, setProductos] = useState([]);
  const [filtro, setFiltro]       = useState("todos");
  const [busqueda, setBusqueda]   = useState("");

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "productos"), (snap) => {
      setProductos(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return () => unsub();
  }, []);

  const actualizarStock = async (id, valor) => {
    const stock = parseInt(valor, 10);
    if (isNaN(stock) || stock < 0) return;
    try { await updateDoc(doc(db, "productos", id), { stock }); }
    catch { addToast("Error al actualizar stock.", "error"); }
  };

  const actualizarMinimo = async (id, valor) => {
    const stockMinimo = parseInt(valor, 10);
    if (isNaN(stockMinimo) || stockMinimo < 0) return;
    try { await updateDoc(doc(db, "productos", id), { stockMinimo }); }
    catch { addToast("Error al actualizar.", "error"); }
  };

  const getNivel = (p) => {
    if (p.stock === undefined || p.stock === null) return "sin-datos";
    if (p.stock <= 0) return "agotado";
    if (p.stock <= (p.stockMinimo || 5)) return "bajo";
    return "normal";
  };

  const lista = productos
    .filter((p) => {
      if (filtro === "bajo") return getNivel(p) === "bajo";
      if (filtro === "agotado") return getNivel(p) === "agotado";
      return true;
    })
    .filter((p) => p.nombre?.toLowerCase().includes(busqueda.toLowerCase()));

  const stockBajo = productos.filter((p) => getNivel(p) === "bajo").length;
  const agotados  = productos.filter((p) => getNivel(p) === "agotado").length;

  return (
    <div className="stock-container">
      <div className="stock-header">
        <h1>📦 Inventario</h1>
        <button className="btn-cerrar-vista" onClick={alCerrar}>✕ VOLVER</button>
      </div>

      <div className="stock-alertas">
        {stockBajo > 0 && (
          <div className="stock-alerta alerta-bajo">⚠️ {stockBajo} producto{stockBajo > 1 ? "s" : ""} con stock bajo</div>
        )}
        {agotados > 0 && (
          <div className="stock-alerta alerta-agotado">🚫 {agotados} producto{agotados > 1 ? "s" : ""} agotado{agotados > 1 ? "s" : ""}</div>
        )}
      </div>

      <div className="stock-filtros">
        <input className="input-base" placeholder="🔍 Buscar producto..." value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
        <div className="stock-filtro-btns">
          {["todos", "bajo", "agotado"].map((f) => (
            <button key={f} className={`stock-filtro-btn ${filtro === f ? "activo" : ""}`} onClick={() => setFiltro(f)}>
              {f === "todos" ? "Todos" : f === "bajo" ? "⚠️ Bajo" : "🚫 Agotado"}
            </button>
          ))}
        </div>
      </div>

      <div className="stock-lista">
        {lista.map((p) => {
          const nivel = getNivel(p);
          return (
            <div key={p.id} className={`stock-item stock-${nivel}`}>
              <div className="stock-item-info">
                <span className="stock-item-nombre">{p.nombre}</span>
                <span className={`stock-badge stock-badge-${nivel}`}>
                  {nivel === "agotado" ? "AGOTADO" : nivel === "bajo" ? "STOCK BAJO" : nivel === "sin-datos" ? "SIN DATOS" : "OK"}
                </span>
              </div>
              <div className="stock-item-controles">
                <div className="stock-campo">
                  <label>Stock</label>
                  <input type="number" min="0" value={p.stock ?? ""} placeholder="0" onChange={(e) => actualizarStock(p.id, e.target.value)} className="input-stock" />
                </div>
                <div className="stock-campo">
                  <label>Mínimo</label>
                  <input type="number" min="0" value={p.stockMinimo ?? ""} placeholder="5" onChange={(e) => actualizarMinimo(p.id, e.target.value)} className="input-stock" />
                </div>
              </div>
            </div>
          );
        })}
        {lista.length === 0 && <p className="stock-vacio">No se encontraron productos.</p>}
      </div>
    </div>
  );
}
