// ─── Pedido manual (admin) ───────────────────────────────────────────────────
// Modal full-screen para que el admin cargue un pedido recibido por teléfono
// u otro canal. Usa la misma transacción Firestore que los pedidos del cliente
// (contador secuencial + verificación de stock + decremento atómico).

import { useState, useMemo } from "react";
import { db } from "../firebaseConfig";
import { collection, doc, runTransaction, serverTimestamp } from "firebase/firestore";
import { notificarPedidoNuevo } from "../lib/telegram";

const CAT_ICONS = { todos: "🍽️", hamburguesas: "🍔", pizzas: "🍕", pastas: "🍝", milanesas: "🥩", asado: "🥓", cafe: "☕", bebidas: "🥤", postres: "🍰" };

const METODOS = [
  { id: "efectivo",    label: "💵 Efectivo" },
  { id: "tarjeta",     label: "💳 Tarjeta" },
  { id: "mercadoPago", label: "📱 Mercado Pago" },
];

function sanitize(s, max = 80) {
  return String(s ?? "").trim().replace(/[<>"'`\\]/g, "").replace(/javascript:/gi, "").slice(0, max);
}

export default function PedidoManual({ productos, addToast, user, alCerrar }) {
  const [cliente, setCliente]    = useState({ nombre: "", telefono: "" });
  const [items, setItems]        = useState([]); // [{id, nombre, precio, cantidad, total, categoria}]
  const [busqueda, setBusqueda]  = useState("");
  const [categoria, setCategoria] = useState("todos");
  const [metodoPago, setMetodoPago] = useState("efectivo");
  const [enviando, setEnviando]  = useState(false);

  const categorias = useMemo(() => {
    const set = new Set(productos.map(p => p.categoria).filter(Boolean));
    return ["todos", ...Array.from(set).sort()];
  }, [productos]);

  const productosFiltrados = useMemo(() => {
    const q = busqueda.toLowerCase();
    return productos
      .filter(p => p.disponible !== false)
      .filter(p => categoria === "todos" || p.categoria === categoria)
      .filter(p => p.nombre?.toLowerCase().includes(q));
  }, [productos, busqueda, categoria]);

  const agregar = (p) => {
    if (p.stock != null && p.stock <= 0) return addToast(`Sin stock: ${p.nombre}`, "warning");
    setItems(prev => {
      const idx = prev.findIndex(i => i.id === p.id);
      if (idx >= 0) {
        const enCarrito = prev[idx].cantidad;
        if (p.stock != null && enCarrito + 1 > p.stock) {
          addToast(`Solo quedan ${p.stock} de ${p.nombre}.`, "warning");
          return prev;
        }
        const u = [...prev];
        u[idx] = { ...u[idx], cantidad: enCarrito + 1, total: (enCarrito + 1) * p.precio };
        return u;
      }
      return [...prev, { id: p.id, nombre: p.nombre, precio: p.precio, categoria: p.categoria || null, cantidad: 1, total: p.precio }];
    });
  };

  const quitar = (id) => {
    setItems(prev => {
      const idx = prev.findIndex(i => i.id === id);
      if (idx < 0) return prev;
      const item = prev[idx];
      if (item.cantidad <= 1) return prev.filter(i => i.id !== id);
      const u = [...prev];
      u[idx] = { ...item, cantidad: item.cantidad - 1, total: (item.cantidad - 1) * item.precio };
      return u;
    });
  };

  const removerItem = (id) => setItems(prev => prev.filter(i => i.id !== id));

  const total = useMemo(() => items.reduce((a, i) => a + i.total, 0), [items]);

  const confirmar = async () => {
    if (!cliente.nombre.trim()) return addToast("Ingresá el nombre del cliente.", "warning");
    if (!cliente.telefono.trim()) return addToast("Ingresá el teléfono.", "warning");
    if (items.length === 0) return addToast("Agregá al menos un producto.", "warning");

    setEnviando(true);
    try {
      const counterRef = doc(db, "config", "contadores");
      const fechaHoy   = new Date().toLocaleDateString("es-AR");
      const pedidoRef  = doc(collection(db, "pedidos"));

      const { numeroFormateado } = await runTransaction(db, async tx => {
        // 1. Contador secuencial diario
        const counterSnap = await tx.get(counterRef);
        const data        = counterSnap.exists() ? counterSnap.data() : {};
        const numero      = data.fecha === fechaHoy ? (data.ultimaOrden || 0) + 1 : 1;
        const numFmt      = `W-${String(numero).padStart(4, "0")}`;

        // 2. Verificar stock
        const refs  = items.map(it => doc(db, "productos", it.id));
        const snaps = await Promise.all(refs.map(r => tx.get(r)));
        for (let i = 0; i < items.length; i++) {
          if (!snaps[i].exists()) throw new Error(`Producto "${items[i].nombre}" ya no existe.`);
          const d = snaps[i].data();
          if (d.disponible === false) throw new Error(`"${items[i].nombre}" no está disponible.`);
          if (d.stock != null && d.stock < items[i].cantidad) {
            throw new Error(`Sin stock: ${items[i].nombre} (quedan ${d.stock}).`);
          }
        }

        // 3. Crear pedido
        const pedidoData = {
          tipo: "manual",
          clienteInfo: {
            nombre:    sanitize(cliente.nombre, 80),
            telefono:  sanitize(cliente.telefono, 30),
            direccion: null,
          },
          items: items.map(({ id, nombre, cantidad, total, categoria }) => ({ id, nombre, cantidad, total, categoria: categoria || null })),
          notas: "",
          total, subtotal: total, descuentoAplicado: 0,
          estado: "pendiente",
          hora: new Date().toLocaleTimeString("es-AR"),
          metodoPago,
          numeroOrden: numFmt,
          creadoEn: serverTimestamp(),
          email: user?.email || null, uid: user?.uid || null,
          cargadoPorAdmin: true,
        };
        tx.set(pedidoRef, pedidoData);

        // 4. Decrementar stock + actualizar contador
        for (let i = 0; i < items.length; i++) {
          const d = snaps[i].data();
          if (d.stock != null) tx.update(refs[i], { stock: d.stock - items[i].cantidad });
        }
        tx.set(counterRef, { ultimaOrden: numero, fecha: fechaHoy }, { merge: true });

        return { numeroFormateado: numFmt };
      });

      // Notificar al admin (al mismo Telegram — útil de confirmación visual)
      notificarPedidoNuevo({
        tipo: "manual",
        numeroOrden: numeroFormateado,
        total,
        metodoPago,
        clienteInfo: cliente,
        items,
      });

      addToast(`✅ Pedido ${numeroFormateado} creado.`, "success");
      alCerrar();
    } catch (err) {
      console.error("[PedidoManual]", err);
      addToast(err?.message || "No se pudo crear el pedido.", "error");
    } finally { setEnviando(false); }
  };

  return (
    <div className="pedido-manual-overlay" role="dialog" aria-modal="true" aria-labelledby="pm-title">
      <div className="pedido-manual-card">
        <div className="pedido-manual-header">
          <h2 id="pm-title">✍️ Nuevo pedido manual</h2>
          <button className="btn-cerrar-vista" onClick={alCerrar}>✕ Cerrar</button>
        </div>

        <div className="pedido-manual-body">
          {/* Datos cliente */}
          <div className="pedido-manual-section">
            <h3>👤 Datos del cliente</h3>
            <input
              className="input-base"
              placeholder="Nombre del cliente"
              value={cliente.nombre}
              onChange={e => setCliente(c => ({ ...c, nombre: e.target.value }))}
              maxLength={80}
            />
            <input
              className="input-base"
              type="tel"
              placeholder="Teléfono"
              value={cliente.telefono}
              onChange={e => setCliente(c => ({ ...c, telefono: e.target.value }))}
              maxLength={30}
            />
          </div>

          {/* Productos */}
          <div className="pedido-manual-section">
            <h3>🛒 Productos</h3>
            <input
              className="input-base"
              placeholder="🔍 Buscar producto..."
              value={busqueda}
              onChange={e => setBusqueda(e.target.value)}
            />
            <div className="pedido-manual-cat-tabs">
              {categorias.map(c => (
                <button
                  key={c}
                  className={`pedido-manual-cat-tab ${categoria === c ? "activo" : ""}`}
                  onClick={() => setCategoria(c)}
                >
                  {CAT_ICONS[c] || "🍽️"} {c.charAt(0).toUpperCase() + c.slice(1)}
                </button>
              ))}
            </div>
            <div className="pedido-manual-productos">
              {productosFiltrados.map(p => {
                const enCarrito = items.find(i => i.id === p.id)?.cantidad || 0;
                return (
                  <div key={p.id} className="pedido-manual-producto">
                    <div className="pedido-manual-producto-info">
                      <span className="pedido-manual-producto-nombre">{p.nombre}</span>
                      <span className="pedido-manual-producto-precio">${p.precio?.toLocaleString("es-AR")}</span>
                    </div>
                    <div className="pedido-manual-producto-controls">
                      {enCarrito > 0 && (
                        <>
                          <button className="card-qty-btn" onClick={() => quitar(p.id)}>−</button>
                          <span className="card-qty-num">{enCarrito}</span>
                        </>
                      )}
                      <button className="card-qty-btn pedido-manual-add" onClick={() => agregar(p)}>+</button>
                    </div>
                  </div>
                );
              })}
              {productosFiltrados.length === 0 && (
                <p style={{ textAlign: "center", color: "var(--text-dim)", padding: "20px 0" }}>
                  No hay productos.
                </p>
              )}
            </div>
          </div>

          {/* Carrito */}
          {items.length > 0 && (
            <div className="pedido-manual-section">
              <h3>📝 Resumen ({items.length} {items.length === 1 ? "item" : "items"})</h3>
              <ul className="carrito-lista">
                {items.map(it => (
                  <li key={it.id} className="carrito-item">
                    <span><strong>{it.cantidad}×</strong> {it.nombre}</span>
                    <span>
                      <strong>${it.total.toLocaleString("es-AR")}</strong>
                      <button
                        className="btn-quitar-item"
                        onClick={() => removerItem(it.id)}
                        aria-label={`Quitar ${it.nombre}`}
                      >✕</button>
                    </span>
                  </li>
                ))}
              </ul>
              <h3 className="pedido-total" style={{ marginTop: 12 }}>
                Total: ${total.toLocaleString("es-AR")}
              </h3>
            </div>
          )}

          {/* Método de pago */}
          <div className="pedido-manual-section">
            <h3>💳 Método de pago</h3>
            <div className="config-metodos-grid">
              {METODOS.map(m => (
                <button
                  key={m.id}
                  className={`config-metodo-btn ${metodoPago === m.id ? "activo" : ""}`}
                  onClick={() => setMetodoPago(m.id)}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="pedido-manual-footer">
          <button
            className="btn-enviar-cocina"
            onClick={confirmar}
            disabled={enviando || items.length === 0}
          >
            {enviando ? "Creando..." : `✓ CONFIRMAR PEDIDO ($${total.toLocaleString("es-AR")})`}
          </button>
        </div>
      </div>
    </div>
  );
}
