import { useEffect, useState } from "react";
import { db } from "../firebaseConfig";
import { collection, onSnapshot, doc, updateDoc } from "firebase/firestore";

export default function StockManager({ slug, addToast, alCerrar }) {
  const [productos, setProductos] = useState([]);
  const [filtro, setFiltro]       = useState("todos");
  const [busqueda, setBusqueda]   = useState("");

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "comercios", slug, "productos"), snap => {
      setProductos(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    return () => unsub();
  }, [slug]);

  const updateStock = async (id, val) => {
    const n = parseInt(val, 10);
    if (isNaN(n) || n < 0) return;
    try { await updateDoc(doc(db, "comercios", slug, "productos", id), { stock: n }); }
    catch { addToast("Error al actualizar stock.", "error"); }
  };

  const updateStockMinimo = async (id, val) => {
    const n = parseInt(val, 10);
    if (isNaN(n) || n < 0) return;
    try { await updateDoc(doc(db, "comercios", slug, "productos", id), { stockMinimo: n }); }
    catch { addToast("Error al actualizar.", "error"); }
  };

  const getEstado = p =>
    p.stock === undefined || p.stock === null ? "sin-datos"
    : p.stock <= 0 ? "agotado"
    : p.stock <= (p.stockMinimo || 5) ? "bajo"
    : "normal";

  const filtrados = productos
    .filter(p => filtro === "bajo" ? getEstado(p) === "bajo" : filtro === "agotado" ? getEstado(p) === "agotado" : true)
    .filter(p => p.nombre?.toLowerCase().includes(busqueda.toLowerCase()));

  const countBajo    = productos.filter(p => getEstado(p) === "bajo").length;
  const countAgotado = productos.filter(p => getEstado(p) === "agotado").length;

  return (
    <div className="stock-container">
      <div className="stock-header">
        <h1>📦 Inventario</h1>
        <button className="btn-cerrar-vista" onClick={alCerrar}>✕ VOLVER</button>
      </div>
      <div className="stock-alertas">
        {countBajo    > 0 && <div className="stock-alerta alerta-bajo">⚠️ {countBajo} producto{countBajo > 1 ? "s" : ""} con stock bajo</div>}
        {countAgotado > 0 && <div className="stock-alerta alerta-agotado">🚫 {countAgotado} producto{countAgotado > 1 ? "s" : ""} agotado{countAgotado > 1 ? "s" : ""}</div>}
      </div>
      <div className="stock-filtros">
        <input className="input-base" placeholder="🔍 Buscar producto..." value={busqueda} onChange={e => setBusqueda(e.target.value)} />
        <div className="stock-filtro-btns">
          {["todos", "bajo", "agotado"].map(f => (
            <button key={f} className={`stock-filtro-btn ${filtro === f ? "activo" : ""}`} onClick={() => setFiltro(f)}>
              {f === "todos" ? "Todos" : f === "bajo" ? "⚠️ Bajo" : "🚫 Agotado"}
            </button>
          ))}
        </div>
      </div>
      <div className="stock-lista">
        {filtrados.map(p => {
          const estado = getEstado(p);
          return (
            <div key={p.id} className={`stock-item stock-${estado}`}>
              <div className="stock-item-info">
                <span className="stock-item-nombre">{p.nombre}</span>
                <span className={`stock-badge stock-badge-${estado}`}>
                  {estado === "agotado" ? "AGOTADO" : estado === "bajo" ? "STOCK BAJO" : estado === "sin-datos" ? "SIN DATOS" : "OK"}
                </span>
              </div>
              <div className="stock-item-controles">
                <div className="stock-campo">
                  <label>Stock</label>
                  <input type="number" min="0" value={p.stock ?? ""} placeholder="0" onChange={e => updateStock(p.id, e.target.value)} className="input-stock" />
                </div>
                <div className="stock-campo">
                  <label>Mínimo</label>
                  <input type="number" min="0" value={p.stockMinimo ?? ""} placeholder="5" onChange={e => updateStockMinimo(p.id, e.target.value)} className="input-stock" />
                </div>
              </div>
            </div>
          );
        })}
        {filtrados.length === 0 && <p className="stock-vacio">No se encontraron productos.</p>}
      </div>
    </div>
  );
}
