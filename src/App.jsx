import { useEffect, useState, useRef, useCallback } from "react";
import { db, auth, provider, storage } from "./firebaseConfig";
import {
  signInWithPopup, signOut, onAuthStateChanged, getRedirectResult,
} from "firebase/auth";
import {
  collection, onSnapshot, addDoc, deleteDoc,
  doc, updateDoc, writeBatch, serverTimestamp,
  query, where
} from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import CierreCaja from "./components/CierreCaja";
import ConfigLocal from "./components/ConfigLocal";
import StockManager from "./components/StockManager";
import "./App.css";

// ─── CONSTANTES ───────────────────────────────────────────────────────────────
const ADMIN_EMAIL = import.meta.env.VITE_ADMIN_EMAIL;
const CATEGORIAS  = ["todos", "hamburguesas", "pizzas", "pastas", "milanesas", "asado", "cafe", "bebidas", "postres"];
const CAT_ICONS   = { todos: "🍽️", hamburguesas: "🍔", pizzas: "🍕", pastas: "🍝", milanesas: "🥩", asado: "🥓", cafe: "☕", bebidas: "🥤", postres: "🍰" };
const COOLDOWN_MS = 30_000;
const MAX_NOTAS   = 200;
const MAX_NOMBRE  = 80;
const METODOS_PAGO_OPCIONES = [
  { id: "efectivo", label: "💵 Efectivo", color: "#34c759" },
  { id: "tarjeta", label: "💳 Tarjeta", color: "#2b7fff" },
  { id: "mercadoPago", label: "📱 Mercado Pago", color: "#00b1ea" },
];

// ─── UTILIDADES ──────────────────────────────────────────────────────────────
const sanitize     = (s) => String(s ?? "").trim().replace(/[<>]/g, "").slice(0, MAX_NOMBRE);
const validarPrecio = (v) => { const n = parseFloat(v); return !isNaN(n) && n > 0 && n < 1_000_000; };
const validarMesa   = (v) => { const n = parseInt(v, 10); return !isNaN(n) && n > 0 && n <= 200; };
const esURLSegura   = (u) => typeof u === "string" && /^https?:\/\/.+/.test(u.trim());
const numOrden      = () => `W-${String(Math.floor(Math.random() * 9999)).padStart(4, "0")}`;

// ─── HOOK TOAST ──────────────────────────────────────────────────────────────
function useToast() {
  const [toasts, setToasts] = useState([]);
  const addToast = useCallback((msg, type = "info") => {
    const id = Date.now() + Math.random();
    setToasts((p) => [...p, { id, msg, type }]);
    setTimeout(() => setToasts((p) => p.filter((t) => t.id !== id)), 3500);
  }, []);
  return { toasts, addToast };
}
function ToastContainer({ toasts }) {
  if (!toasts.length) return null;
  return (<div className="toast-container">{toasts.map((t) => (<div key={t.id} className={`toast toast-${t.type}`}>{t.msg}</div>))}</div>);
}

// ─── IMAGE UPLOAD ────────────────────────────────────────────────────────────
function ImageUpload({ onUpload, addToast }) {
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview]     = useState(null);
  const fileRef                   = useRef(null);

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) return addToast("Solo imágenes.", "warning");
    if (file.size > 5 * 1024 * 1024) return addToast("Máximo 5 MB.", "warning");
    const reader = new FileReader();
    reader.onload = () => setPreview(reader.result);
    reader.readAsDataURL(file);
    setUploading(true);
    try {
      const sRef = ref(storage, `productos/${Date.now()}_${file.name}`);
      await uploadBytes(sRef, file);
      const url = await getDownloadURL(sRef);
      onUpload(url);
      addToast("✅ Imagen subida.", "success");
    } catch { addToast("❌ Error al subir. Usá una URL.", "error"); setPreview(null); }
    finally { setUploading(false); }
  };

  return (
    <div className="image-upload-container">
      {/* Input SIN capture para que abra galería/explorador, no la cámara */}
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        onChange={handleFile}
        style={{ display: "none" }}
      />
      <div className="image-upload-dropzone" onClick={() => fileRef.current?.click()}>
        {preview
          ? <img src={preview} alt="Preview" className="image-upload-preview" />
          : (
            <div className="image-upload-placeholder">
              <span className="image-upload-icon">🖼️</span>
              <span>{uploading ? "Subiendo..." : "Elegir imagen del dispositivo"}</span>
              <small style={{ opacity: .6, fontSize: ".72rem" }}>JPG, PNG, WebP · máx 5 MB</small>
            </div>
          )}
      </div>
      {uploading && <div className="upload-progress-bar"><div className="upload-progress-fill" /></div>}
    </div>
  );
}


// ─── PRODUCTO ────────────────────────────────────────────────────────────────
function ProductoItem({ p, eliminarProducto, agregarAlCarrito, esAdmin, addToast }) {
  const [imgError, setImgError] = useState(false);
  const [cantidad, setCantidad] = useState(1);

  const manejarAgregar = (e) => {
    e.stopPropagation();
    agregarAlCarrito(p, esAdmin ? 1 : cantidad);
    addToast(`✅ ${p.nombre}${!esAdmin && cantidad > 1 ? " x" + cantidad : ""} agregado`, "success");
    if (!esAdmin) setCantidad(1);
  };

  const toggleDisponible = async () => {
    try { await updateDoc(doc(db, "productos", p.id), { disponible: !p.disponible }); }
    catch { addToast("Error al actualizar.", "error"); }
  };

  const agotado    = p.disponible === false;
  const stockBajo  = p.stock != null && p.stock > 0 && p.stock <= (p.stockMinimo || 5);
  const tieneImagen = p.foto && esURLSegura(p.foto) && !imgError;
  const emojiCat   = CAT_ICONS[p.categoria] || "🍽️";

  return (
    <div className={`product-card ${agotado ? "agotado-card" : ""}`}>

      {/* ── Imagen ── */}
      <div className="product-img-wrapper">
        {tieneImagen ? (
          <img
            src={p.foto}
            alt={sanitize(p.nombre)}
            className="product-img"
            style={{ opacity: agotado ? 0.4 : 1 }}
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="product-img-placeholder">{emojiCat}</div>
        )}
        {/* Botón + sobre imagen SOLO en admin */}
        {esAdmin && !agotado && (
          <button className="btn-floating-add" onClick={manejarAgregar} title="Agregar 1 rápido">+</button>
        )}
      </div>

      {/* ── Info ── */}
      <div className="product-info-wrapper">
        <h2 className="product-name">
          {p.nombre}
          {agotado    && <span className="badge-agotado">AGOTADO</span>}
          {stockBajo && !agotado && <span className="badge-stock-bajo">ÚLTIMAS UNID.</span>}
        </h2>
        <p className="product-price-large">$ {p.precio?.toLocaleString("es-AR")}</p>
      </div>

      {/* ── Fila de pedido (solo usuarios normales) ── */}
      {!esAdmin && !agotado && (
        <div className="card-order-row">
          <div className="card-qty-group">
            <button className="card-qty-btn" onClick={(e) => { e.stopPropagation(); setCantidad(q => Math.max(1, q - 1)); }}>−</button>
            <span className="card-qty-num">{cantidad}</span>
            <button className="card-qty-btn" onClick={(e) => { e.stopPropagation(); setCantidad(q => Math.min(20, q + 1)); }}>+</button>
          </div>
          <button className="card-add-btn" onClick={manejarAgregar}>🛒 Pedir</button>
        </div>
      )}

      {/* ── Admin actions ── */}
      {esAdmin && (
        <div className="admin-card-actions">
          <button className="btn-admin-small" onClick={toggleDisponible}>
            {agotado ? "✅ Hab." : "⛔ Agotar"}
          </button>
          <button className="btn-delete-db" onClick={() => eliminarProducto(p.id)}>🗑️</button>
        </div>
      )}
    </div>
  );
}

// ─── CARRUSEL DESTACADOS ───────────────────────────────────────────────────────────
function FeaturedCarousel({ productos, menuDiaIds, addToast, agregarAlCarrito }) {
  // Si hay IDs guardados los usa; si no, fallback a primeros 4 con foto
  const destacados = menuDiaIds.length > 0
    ? menuDiaIds.map(id => productos.find(p => p.id === id)).filter(Boolean).filter(p => p.disponible !== false)
    : productos.filter(p => p.disponible !== false && p.foto).slice(0, 4);

  if (destacados.length === 0) return null;
  return (
    <div className="carousel-section">
      <h3 className="carousel-title">🔥 Menú del Día</h3>
      <div className="carousel-container">
        {destacados.map(p => (
          <div key={p.id} className="carousel-item">
            <img src={p.foto} className="carousel-img" alt={p.nombre} />
            <div className="carousel-overlay">
              <h4 className="carousel-item-name">{p.nombre}</h4>
              <p className="carousel-item-price">${p.precio?.toLocaleString("es-AR")}</p>
              <button className="btn-add-carousel" onClick={() => { agregarAlCarrito(p, 1); addToast(`✅ ${p.nombre} agregado`, "success"); }}>
                + Pedir
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── SECCIÓN VENTAS ──────────────────────────────────────────────────────────
function SeccionVentas({ pedidos, addToast }) {
  const ventasHoy = pedidos.filter((p) => p.estado === "finalizado");
  const totalCaja = ventasHoy.reduce((a, p) => a + (p.total || 0), 0);
  const cerrarCaja = async () => {
    if (ventasHoy.length === 0) return addToast("No hay ventas.", "warning");
    if (!window.confirm(`¿Cerrar caja? $${totalCaja.toLocaleString("es-AR")}`)) return;
    try {
      const batch = writeBatch(db);
      const fecha = new Date().toLocaleString("es-AR");
      ventasHoy.forEach((p) => { const h = doc(collection(db, "historial")); batch.set(h, { ...p, fechaCierre: fecha, idOriginal: p.id }); batch.delete(doc(db, "pedidos", p.id)); });
      await batch.commit();
      addToast("✅ Caja cerrada.", "success");
    } catch { addToast("❌ Error.", "error"); }
  };
  if (ventasHoy.length === 0) return null;
  return (
    <div className="ventas-caja">
      <div className="ventas-header"><h2>💰 Caja del Día</h2><button onClick={cerrarCaja} className="btn-cerrar-caja">CERRAR CAJA</button></div>
      <p className="ventas-total">${totalCaja.toLocaleString("es-AR")}</p>
      <div className="ventas-scroll">
        {ventasHoy.map((v) => (<div key={v.id} className="venta-row"><span>Mesa {v.mesa}</span><span>${v.total?.toLocaleString("es-AR")} <small style={{color:"var(--text-dim)"}}>({v.entregadoHora})</small></span></div>))}
      </div>
    </div>
  );
}

// ─── PANEL COCINA ────────────────────────────────────────────────────────────
function PanelCocina({ addToast, alCerrar }) {
  const [pedidos, setPedidos]           = useState([]);
  const [llamadas, setLlamadas]         = useState([]);
  const [interactuado, setInteractuado] = useState(false);
  const audioRef          = useRef(null);
  const pedidosAnteriores = useRef(0);

  useEffect(() => { audioRef.current = new Audio("https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3"); audioRef.current.preload = "auto"; }, []);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "pedidos"), (snap) => {
      const todos = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      const act   = todos.filter((p) => p.estado === "pendiente" || p.estado === "preparando");
      if (act.length > pedidosAnteriores.current && pedidosAnteriores.current !== 0 && interactuado) audioRef.current?.play().catch(() => {});
      pedidosAnteriores.current = act.length;
      setPedidos(todos);
    });
    return () => unsub();
  }, [interactuado]);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "llamadasMozo"), (snap) => {
      setLlamadas(snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((l) => !l.atendida));
    });
    return () => unsub();
  }, []);

  const cambiarEstado = async (id, est) => {
    try { await updateDoc(doc(db, "pedidos", id), { estado: est, entregadoHora: est === "finalizado" ? new Date().toLocaleTimeString("es-AR") : null }); }
    catch { addToast("Error.", "error"); }
  };
  const anularPedido = async (id) => {
    if (!window.confirm("¿Anular este pedido?")) return;
    try { await updateDoc(doc(db, "pedidos", id), { estado: "anulado" }); addToast("Pedido anulado.", "info"); }
    catch { addToast("Error.", "error"); }
  };
  const atenderLlamada = async (id) => {
    try { await updateDoc(doc(db, "llamadasMozo", id), { atendida: true }); }
    catch { addToast("Error.", "error"); }
  };

  const activos = pedidos.filter((p) => p.estado === "pendiente" || p.estado === "preparando");

  return (
    <div className="cocina-container" onClick={() => setInteractuado(true)}>
      <div className="cocina-top-bar"><button className="btn-cerrar-vista" onClick={(e) => { e.stopPropagation(); alCerrar(); }}>← Menú</button></div>
      <h1 className="cocina-title">👨‍🍳 COMANDAS</h1>

      {llamadas.length > 0 && (
        <div className="llamadas-mozo-panel">
          <h3>🔔 Llamadas de Mozo</h3>
          {llamadas.map((l) => (<div key={l.id} className="llamada-item"><span>🖐️ Mesa {l.mesa}</span><button className="btn-atender" onClick={() => atenderLlamada(l.id)}>Atender ✓</button></div>))}
        </div>
      )}

      <div className="cocina-grid">
        {activos.length === 0 && <p style={{ color: "var(--text-dim)", textAlign: "center", gridColumn: "1/-1", padding: "40px 0" }}>Sin pedidos activos. 🎉</p>}
        {activos.map((p) => (
          <div key={p.id} className={`comanda-card ${p.estado}`}>
            <div className="comanda-header"><h2>MESA {p.mesa}</h2><span className={`badge-${p.estado}`}>{p.estado.toUpperCase()}</span></div>
            {p.numeroOrden && <div className="comanda-orden">Orden: {p.numeroOrden}</div>}
            {p.metodoPago && <div className="comanda-metodo-pago">💳 {p.metodoPago}</div>}
            {p.notas && <div className="nota-cocina">⚠️ {p.notas}</div>}
            <ul className="comanda-lista">{p.items?.map((it, i) => <li key={i}>• {it.cantidad}x {it.nombre}</li>)}</ul>
            <div className="comanda-btns">
              {p.estado === "pendiente" && <button className="btn-preparar" onClick={() => cambiarEstado(p.id, "preparando")}>EMPEZAR</button>}
              <button className="btn-listo" onClick={() => cambiarEstado(p.id, "finalizado")}>LISTO ✓</button>
              <button className="btn-anular" onClick={() => anularPedido(p.id)}>✕</button>
            </div>
          </div>
        ))}
      </div>
      <SeccionVentas pedidos={pedidos} addToast={addToast} />
    </div>
  );
}

// ─── HISTORIAL ───────────────────────────────────────────────────────────────
function VistaHistorial({ alCerrar }) {
  const [registros, setRegistros] = useState([]);
  const [loading, setLoading]     = useState(true);
  useEffect(() => {
    const unsub = onSnapshot(collection(db, "historial"), (snap) => {
      setRegistros(snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => new Date(b.fechaCierre) - new Date(a.fechaCierre)));
      setLoading(false);
    });
    return () => unsub();
  }, []);
  return (
    <div className="historial-modal">
      <div className="historial-header"><h1>📁 Historial de Ventas</h1><button className="btn-cerrar-historial" onClick={alCerrar}>✕ VOLVER</button></div>
      {loading && <p style={{ textAlign: "center", color: "var(--text-dim)" }}>Cargando...</p>}
      {!loading && registros.length === 0 && <p style={{ textAlign: "center", color: "var(--text-dim)" }}>No hay registros.</p>}
      <div className="historial-lista">
        {registros.map((r) => (
          <div key={r.id} className="historial-card">
            <div className="historial-row-header"><span>📅 {r.fechaCierre}</span><span>Mesa {r.mesa}</span></div>
            <ul className="historial-items">{r.items?.map((it, i) => <li key={i}>• {it.cantidad}x {it.nombre} (${it.total?.toLocaleString("es-AR")})</li>)}</ul>
            <div className="historial-total">Total: ${r.total?.toLocaleString("es-AR")}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// APP PRINCIPAL
// ═════════════════════════════════════════════════════════════════════════════
export default function App() {
  const [productos, setProductos]       = useState([]);
  const [carrito, setCarrito]           = useState([]);
  const [notas, setNotas]               = useState("");
  const [verHistorial, setVerHistorial] = useState(false);
  const [vistaActiva, setVistaActiva]   = useState(() => localStorage.getItem("vista") || "menu");
  const [ultimoPedidoId, setUltimoPedidoId] = useState(() => localStorage.getItem("ultimoPedidoId"));
  const [estadoPedido, setEstadoPedido] = useState(null);
  const [user, setUser]                 = useState(null);
  const [busqueda, setBusqueda]         = useState("");
  const [categoriaSel, setCategoriaSel] = useState("todos");
  const [menuAbierto, setMenuAbierto]   = useState(false);
  const [enviando, setEnviando]         = useState(false);
  const [loginLoading, setLoginLoading] = useState(false);
  const [tema, setTema]                 = useState(() => localStorage.getItem("tema") || "dark");
  const [metodoPago, setMetodoPago]     = useState("");
  const [mostrarConfirmacion, setMostrarConfirmacion] = useState(false);
  const [datosConfirmacion, setDatosConfirmacion]     = useState(null);
  const [fotoProducto, setFotoProducto] = useState("");
  const [metricasUsuario, setMetricasUsuario] = useState({ ordersCount: null, favorite: null });

  const [menuDiaIds, setMenuDiaIds] = useState([]);
  const ultimaOrden = useRef(0);
  const { toasts, addToast } = useToast();
  const [mesa, setMesa] = useState(() => { const p = new URLSearchParams(window.location.search).get("mesa") || ""; return validarMesa(p) ? p : ""; });
  const esAdmin = user?.email === ADMIN_EMAIL;

  // ── Auth
  useEffect(() => { getRedirectResult(auth).catch(() => {}); const u = onAuthStateChanged(auth, setUser); return () => u(); }, []);
  // ── Vista
  useEffect(() => { localStorage.setItem("vista", vistaActiva); }, [vistaActiva]);
  // ── Tema
  useEffect(() => { document.documentElement.setAttribute("data-theme", tema); localStorage.setItem("tema", tema); }, [tema]);
  // ── Estado pedido
  useEffect(() => {
    if (!ultimoPedidoId) return;
    const unsub = onSnapshot(doc(db, "pedidos", ultimoPedidoId), (snap) => {
      if (snap.exists()) setEstadoPedido(snap.data().estado);
      else { setEstadoPedido(null); setUltimoPedidoId(null); localStorage.removeItem("ultimoPedidoId"); }
    });
    return () => unsub();
  }, [ultimoPedidoId]);
  // ── Productos
  useEffect(() => { const u = onSnapshot(collection(db, "productos"), (s) => setProductos(s.docs.map((d) => ({ id: d.id, ...d.data() })))); return () => u(); }, []);
  // ── Menú del Día
  useEffect(() => {
    const unsub = onSnapshot(doc(db, "config", "menuDelDia"), (snap) => {
      if (snap.exists()) setMenuDiaIds(snap.data().ids || []);
    });
    return () => unsub();
  }, []);
  // ── Metrics & Ads Logic
  useEffect(() => {
    if (!user || esAdmin) { setMetricasUsuario({ ordersCount: null, favorite: null }); return; }
    // En produccion real Supabase daría esto con 1 query HTTP RPC. Acá lo derivamos de Firebase historial.
    const unsub = onSnapshot(query(collection(db, "historial"), where("email", "==", user.email)), (snap) => {
       const docs = snap.docs.map(d => d.data());
       let count = {};
       docs.forEach(d => {
         d.items?.forEach(req => {
           const nom = req.nombre.toLowerCase();
           if(nom.includes("burger")||nom.includes("hamburguesa")) count["burger"] = (count["burger"]||0) + req.cantidad;
           else if(nom.includes("pizza")) count["pizza"] = (count["pizza"]||0) + req.cantidad;
           else count[req.nombre] = (count[req.nombre]||0) + req.cantidad;
         });
       });
       let fav = null; let max = 0;
       for(const [k, v] of Object.entries(count)) { if(v > max){ max = v; fav = k; } }
       setMetricasUsuario({ ordersCount: docs.length, favorite: fav });
    });
    return () => unsub();
  }, [user, esAdmin]);

  // ── Auth actions
  const login  = async () => { setLoginLoading(true); try { await signInWithPopup(auth, provider); } catch { addToast("No se pudo iniciar sesión.", "error"); } finally { setLoginLoading(false); } };
  const logout = async () => { try { await signOut(auth); addToast("Sesión cerrada.", "info"); } catch { addToast("Error.", "error"); } };

  // ── Carrito
  const agregarAlCarrito = (p, cant) => {
    setCarrito((prev) => {
      const idx = prev.findIndex((i) => i.id === p.id);
      if (idx >= 0) { const u = [...prev]; const nc = u[idx].cantidad + cant; u[idx] = { ...u[idx], cantidad: nc, total: nc * p.precio }; return u; }
      return [...prev, { ...p, cantidad: cant, total: p.precio * cant }];
    });
  };

  // ── CRUD Productos
  const eliminarProducto = async (id) => { if (!window.confirm("¿Eliminar permanentemente?")) return; try { await deleteDoc(doc(db, "productos", id)); addToast("Eliminado.", "success"); } catch { addToast("Error.", "error"); } };
  const agregarProducto = async (e) => {
    e.preventDefault();
    const { nombre, precio, foto, categoria } = e.target.elements;
    const nc = sanitize(nombre.value);
    if (!nc) return addToast("Nombre vacío.", "warning");
    if (!validarPrecio(precio.value)) return addToast("Precio inválido.", "warning");
    const fotoFinal = fotoProducto || foto.value.trim();
    try {
      await addDoc(collection(db, "productos"), { nombre: nc, precio: parseFloat(precio.value), foto: esURLSegura(fotoFinal) ? fotoFinal : "", categoria: categoria.value, disponible: true, stock: 50, stockMinimo: 5, creadoEn: serverTimestamp() });
      e.target.reset(); setFotoProducto(""); addToast("✅ Producto añadido.", "success");
    } catch { addToast("❌ Error.", "error"); }
  };

  // ── Enviar pedido
  const enviarPedido = async () => {
    if (carrito.length === 0) return addToast("Carrito vacío.", "warning");
    if (!mesa)              return addToast("Ingresá mesa.", "warning");
    if (!validarMesa(mesa)) return addToast("Mesa inválida (1–200).", "warning");
    if (!metodoPago)        return addToast("Seleccioná método de pago.", "warning");
    if (Date.now() - ultimaOrden.current < COOLDOWN_MS) return addToast("Esperá unos segundos.", "warning");
    setEnviando(true);
    const nOrden = numOrden();
    try {
      const sub = carrito.reduce((a, i) => a + i.total, 0);
      const descObj = carrito.length > 0 && user && metricasUsuario.ordersCount === 0 && !esAdmin ? 0.20 : 0;
      const total = sub * (1 - descObj);
      const docRef = await addDoc(collection(db, "pedidos"), {
        mesa: parseInt(mesa, 10),
        items: carrito.map(({ id, nombre, cantidad, total }) => ({ id, nombre, cantidad, total })),
        notas: sanitize(notas).slice(0, MAX_NOTAS), 
        total,
        subtotal: sub,
        descuentoAplicado: descObj * 100,
        estado: "pendiente", hora: new Date().toLocaleTimeString("es-AR"),
        metodoPago, numeroOrden: nOrden, creadoEn: serverTimestamp(),
        email: user?.email || null,
        uid: user?.uid || null,
      });
      ultimaOrden.current = Date.now();
      setUltimoPedidoId(docRef.id); localStorage.setItem("ultimoPedidoId", docRef.id);
      setDatosConfirmacion({ numeroOrden: nOrden, mesa: parseInt(mesa, 10), items: [...carrito], total, metodoPago });
      setMostrarConfirmacion(true);
      setCarrito([]); setNotas(""); setMetodoPago("");
      addToast("🔔 ¡Pedido enviado!", "success");
    } catch { addToast("❌ Error.", "error"); }
    finally { setEnviando(false); }
  };

  // ── Llamar mozo
  const llamarMozo = async () => {
    if (!mesa || !validarMesa(mesa)) return addToast("Ingresá mesa primero.", "warning");
    try { await addDoc(collection(db, "llamadasMozo"), { mesa: parseInt(mesa, 10), hora: new Date().toLocaleTimeString("es-AR"), atendida: false, creadoEn: serverTimestamp() }); addToast("🖐️ ¡Mozo notificado!", "success"); }
    catch { addToast("Error.", "error"); }
  };

  // ── Filtros
  // ── Valores Calculados
  const productosFiltrados = productos.filter((p) => {
    const nom = p.nombre?.toLowerCase().includes(busqueda.toLowerCase());
    const cat = categoriaSel === "todos" || p.categoria?.toLowerCase() === categoriaSel;
    return nom && cat;
  });
  const cambiarVista = (v) => { setVistaActiva(v); setMenuAbierto(false); };
  
  const esNuevoUsuario = user && metricasUsuario.ordersCount === 0 && !esAdmin;
  const descuentoVal = esNuevoUsuario ? 0.20 : 0;
  const subtotalCarrito = carrito.reduce((a, i) => a + i.total, 0);
  const montoDescuento = subtotalCarrito * descuentoVal;
  const totalCarrito = subtotalCarrito - montoDescuento;

  // ═════════════════════════════════════════════════════════════════════════
  return (
    <>
      <ToastContainer toasts={toasts} />
      <button className="btn-theme-toggle" onClick={() => setTema((p) => (p === "dark" ? "light" : "dark"))} title={tema === "dark" ? "Modo claro" : "Modo oscuro"}>
        {tema === "dark" ? "☀️" : "🌙"}
      </button>

      {/* ── Admin Views ── */}
      {vistaActiva === "cocina"     && esAdmin && <PanelCocina addToast={addToast} alCerrar={() => cambiarVista("menu")} />}
      {vistaActiva === "cierreCaja" && esAdmin && <CierreCaja addToast={addToast} alCerrar={() => cambiarVista("menu")} />}
      {vistaActiva === "config"     && esAdmin && <ConfigLocal addToast={addToast} alCerrar={() => cambiarVista("menu")} />}
      {vistaActiva === "stock"      && esAdmin && <StockManager addToast={addToast} alCerrar={() => cambiarVista("menu")} />}
      {vistaActiva === "menuDia"    && esAdmin && (
        <GestorMenuDia
          productos={productos}
          menuDiaIds={menuDiaIds}
          addToast={addToast}
          alCerrar={() => cambiarVista("menu")}
        />
      )}

      {/* ── Menu View ── */}
      {vistaActiva === "menu" && (
        <div className="menu-container">
          {/* Header */}
          <header className="header">
            <div onClick={loginLoading ? undefined : user ? logout : login} className="header-icon" style={{ cursor: "pointer", opacity: loginLoading ? 0.5 : 1 }}>
              <img src={user ? user.photoURL : "/logo-waves.png"} alt="Logo" style={{ borderRadius: user ? "50%" : "0" }} />
            </div>
            <h1 className="header-title">Waves</h1>
            {user && <p className="header-username">{user.displayName}</p>}
          </header>

          {/* Hamburger */}
          <button className="hamburger-btn" onClick={() => setMenuAbierto(true)}>
            <span className="hamburger-line" /><span className="hamburger-line" /><span className="hamburger-line" />
          </button>

          {/* Drawer */}
          <div className={`drawer-overlay ${menuAbierto ? "open" : ""}`} onClick={() => setMenuAbierto(false)} />
          <nav className={`drawer-menu ${menuAbierto ? "open" : ""}`}>
            <div className="drawer-header"><h2>Waves</h2><button className="drawer-close" onClick={() => setMenuAbierto(false)}>✕</button></div>
            <div className="drawer-section">
              <p className="drawer-section-title">Categorías</p>
              {CATEGORIAS.map((c) => (
                <button key={c} className={`drawer-item ${categoriaSel === c ? "active" : ""}`} onClick={() => { setCategoriaSel(c); setMenuAbierto(false); }}>
                  {CAT_ICONS[c]} {c.charAt(0).toUpperCase() + c.slice(1)}
                </button>
              ))}
            </div>
            {esAdmin && (
              <div className="drawer-section">
                <p className="drawer-section-title">Administración</p>
                <button className="drawer-item" onClick={() => cambiarVista("cocina")}>👨‍🍳 Cocina</button>
                <button className="drawer-item" onClick={() => cambiarVista("cierreCaja")}>💰 Cierre de Caja</button>
                <button className="drawer-item" onClick={() => cambiarVista("stock")}>📦 Inventario</button>
                <button className="drawer-item" onClick={() => cambiarVista("config")}>⚙️ Configuración</button>
                <button className="drawer-item" onClick={() => cambiarVista("menuDia")}>🔥 Menú del Día</button>
                <button className="drawer-item" onClick={() => { setVerHistorial(true); setMenuAbierto(false); }}>📂 Historial</button>
              </div>
            )}
            <div className="drawer-footer">
              <button className="drawer-item" onClick={() => { setTema((p) => (p === "dark" ? "light" : "dark")); setMenuAbierto(false); }}>
                {tema === "dark" ? "☀️ Modo Claro" : "🌙 Modo Oscuro"}
              </button>
            </div>
          </nav>

          {/* Search */}
          <div style={{ padding: "0 10px", marginBottom: "20px" }}>
            <input type="text" placeholder="🔍 Buscar plato, bebida, postre..." className="input-base search-bar" maxLength={80} onChange={(e) => setBusqueda(e.target.value)} />
          </div>

          {/* Admin Form */}
          {esAdmin && (
            <div className="admin-actions" style={{ padding: "0 12px" }}>
              <form onSubmit={agregarProducto} className="form-container">
                <h3 style={{ color: "var(--accent-yellow)", marginBottom: "4px" }}>+ Agregar Producto</h3>
                <input name="nombre" placeholder="Nombre" required maxLength={MAX_NOMBRE} className="input-base" />
                <input name="precio" type="number" min="1" max="999999" step="0.01" placeholder="Precio" required className="input-base" />
                <ImageUpload onUpload={(url) => setFotoProducto(url)} addToast={addToast} />
                <input name="foto" placeholder="O pegá URL de imagen" className="input-base" value={fotoProducto} onChange={(e) => setFotoProducto(e.target.value)} />
                <select name="categoria" className="input-base">
                  {CATEGORIAS.filter((c) => c !== "todos").map((c) => (<option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>))}
                </select>
                <button type="submit" className="btn-submit">+ Añadir Producto</button>
              </form>
            </div>
          )}

          {/* Status */}
          {estadoPedido && (
            <div className={`status-banner ${estadoPedido}`}>
              {estadoPedido === "pendiente" && "⏳ Pedido recibido, esperando cocina..."}
              {estadoPedido === "preparando" && "👨‍🍳 ¡Tu pedido está en preparación!"}
              {estadoPedido === "finalizado" && "✅ ¡Pedido listo! Te lo llevamos enseguida."}
            </div>
          )}

          {/* Propagandas y Recomendaciones Inteligentes */}
          {!busqueda && categoriaSel === "todos" && (
            <>
              {esNuevoUsuario && (
                <div className="promo-banner new-user-banner">
                  🎁 ¡Bienvenido! Tenés <strong>20% OFF</strong> en tu primer pedido.
                </div>
              )}
              {metricasUsuario.favorite?.includes("burger") && new Date().getDay() !== 4 && (
                <div className="promo-banner ad-banner">
                  🍔 ¡Día de Burger! Aprovechá para pedir tu favorita.
                </div>
              )}
              {metricasUsuario.favorite?.includes("pizza") && new Date().getDay() !== 2 && (
                <div className="promo-banner ad-banner">
                  🍕 Antojo de Pizza: Sabemos que te encanta, ¡pedila ahora!
                </div>
              )}
              <FeaturedCarousel productos={productos} menuDiaIds={menuDiaIds} addToast={addToast} agregarAlCarrito={agregarAlCarrito} />
            </>
          )}

          {/* Products */}
          <div className="product-list">
            {productosFiltrados.map((p) => (<ProductoItem key={p.id} p={p} esAdmin={esAdmin} eliminarProducto={eliminarProducto} agregarAlCarrito={agregarAlCarrito} addToast={addToast} />))}
            {productosFiltrados.length === 0 && <p style={{ textAlign: "center", width: "100%", color: "var(--text-dim)", padding: "40px 0" }}>No se encontraron productos.</p>}
          </div>

          {/* Call Waiter */}
          {mesa && <button className="btn-llamar-mozo" onClick={llamarMozo} style={{ margin: "20px 12px 0" }}>🖐️ Llamar al Mozo</button>}

          {/* Cart */}
          <div className="pedido-container" style={{ margin: "30px 12px 0" }}>
            <div className="pedido-header">
              <h2>📝 Tu Pedido</h2>
              {carrito.length > 0 && <button className="btn-vaciar" onClick={() => { if (window.confirm("¿Vaciar?")) setCarrito([]); }}>🗑️ Vaciar</button>}
            </div>
            {carrito.length === 0 ? (
              <p style={{ textAlign: "center", color: "var(--text-dim)" }}>No agregaste nada aún.</p>
            ) : (
              <>
                <ul className="carrito-lista">
                  {carrito.map((item, i) => (
                    <li key={i} className="carrito-item">
                      <span><strong>{item.cantidad}x</strong> {item.nombre}</span>
                      <span><strong>${item.total.toLocaleString("es-AR")}</strong><button className="btn-quitar-item" onClick={() => setCarrito(carrito.filter((_, j) => j !== i))}>✕</button></span>
                    </li>
                  ))}
                </ul>
                <div style={{ marginTop: "20px" }}>
                  {esNuevoUsuario ? (
                    <div style={{ padding: "12px", background: "var(--bg-surface)", border: "1px solid var(--border-subtle)", borderRadius: "12px", marginBottom: "15px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", color: "var(--text-muted)", marginBottom: "6px", fontSize: ".9rem" }}>
                        <span>Subtotal</span>
                        <span>${subtotalCarrito.toLocaleString("es-AR")}</span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", color: "var(--accent-yellow)", fontWeight: "700", marginBottom: "8px", fontSize: ".9rem" }}>
                        <span>🎁 Descuento Bienvenida (20%)</span>
                        <span>-${montoDescuento.toLocaleString("es-AR")}</span>
                      </div>
                      <div style={{ height: "1px", background: "var(--border-subtle)", margin: "4px 0 10px" }} />
                      <h3 className="pedido-total" style={{ margin: 0 }}>Total: ${totalCarrito.toLocaleString("es-AR")}</h3>
                    </div>
                  ) : (
                    <h3 className="pedido-total">Total: ${totalCarrito.toLocaleString("es-AR")}</h3>
                  )}
                  <textarea placeholder="Notas para cocina..." value={notas} onChange={(e) => setNotas(e.target.value)} maxLength={MAX_NOTAS} className="input-notas" />
                  <small className="contador-notas">{notas.length}/{MAX_NOTAS}</small>
                  <input type="number" placeholder="N° de Mesa" value={mesa} min="1" max="200" onChange={(e) => setMesa(e.target.value)} className="input-mesa" />
                  <div className="pago-selector">
                    <p className="pago-titulo">Método de Pago</p>
                    <div className="pago-opciones">
                      {METODOS_PAGO_OPCIONES.map((m) => (
                        <button key={m.id} className={`pago-opcion ${metodoPago === m.id ? "seleccionado" : ""}`} onClick={() => setMetodoPago(m.id)}
                          style={metodoPago === m.id ? { borderColor: m.color, boxShadow: `0 0 12px ${m.color}33` } : {}}>
                          {m.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <button onClick={enviarPedido} disabled={enviando} className="btn-enviar-cocina">
                    {enviando ? "Enviando..." : `🔔 CONFIRMAR PEDIDO ($${totalCarrito.toLocaleString("es-AR")})`}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Order Confirmation ── */}
      {mostrarConfirmacion && datosConfirmacion && (
        <div className="confirmacion-overlay">
          <div className="confirmacion-card">
            <div className="confirmacion-check">✓</div>
            <h2>¡Pedido en marcha!</h2>
            <p className="confirmacion-orden">{datosConfirmacion.numeroOrden}</p>
            <p className="confirmacion-mesa">Mesa {datosConfirmacion.mesa}</p>
            <ul className="confirmacion-items">{datosConfirmacion.items.map((it, i) => <li key={i}>{it.cantidad}x {it.nombre}</li>)}</ul>
            <div className="confirmacion-total">Total: ${datosConfirmacion.total.toLocaleString("es-AR")}</div>
            <div className="confirmacion-metodo">💳 {datosConfirmacion.metodoPago}</div>
            <button className="btn-confirmacion-cerrar" onClick={() => setMostrarConfirmacion(false)}>ACEPTAR</button>
          </div>
        </div>
      )}

      {verHistorial && <VistaHistorial alCerrar={() => setVerHistorial(false)} />}
    </>
  );
}
