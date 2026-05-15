import { useEffect, useState, useRef, useCallback, useMemo, memo, lazy, Suspense } from "react";
import { Routes, Route, Navigate, useParams } from "react-router-dom";
import { db, auth, provider } from "./firebaseConfig";
import { signInWithPopup, signOut, onAuthStateChanged } from "firebase/auth";
import {
  collection, onSnapshot, addDoc, deleteDoc,
  doc, updateDoc, serverTimestamp, query, where,
  runTransaction,
} from "firebase/firestore";
import JsBarcode from "jsbarcode";
import { InstallPrompt, UpdateBanner } from "./components/PWAControls.jsx";
import "./App.css";

// Componentes admin (lazy — solo se cargan cuando el usuario admin los abre)
const CocinaAdmin  = lazy(() => import("./components/CocinaAdmin.jsx"));
const CierreCaja   = lazy(() => import("./components/CierreCaja.jsx"));
const ConfigLocal  = lazy(() => import("./components/ConfigLocal.jsx"));
const StockManager = lazy(() => import("./components/StockManager.jsx"));
const MenuDelDia   = lazy(() => import("./components/MenuDelDia.jsx"));
const ImageUpload  = lazy(() => import("./components/ImageUpload.jsx"));

// ─── CONSTANTES ───────────────────────────────────────────────────────────────
const CATEGORIAS = ["todos","hamburguesas","pizzas","pastas","milanesas","asado","cafe","bebidas","postres"];
const CAT_ICONS  = { todos:"🍽️",hamburguesas:"🍔",pizzas:"🍕",pastas:"🍝",milanesas:"🥩",asado:"🥓",cafe:"☕",bebidas:"🥤",postres:"🍰" };
const COOLDOWN_MS = 30_000;
const MAX_NOTAS   = 200;
const MAX_NOMBRE  = 80;
const METODOS_PAGO = [
  { id: "efectivo",    label: "💵 Efectivo",     color: "#34c759" },
  { id: "tarjeta",     label: "💳 Tarjeta",      color: "#2b7fff" },
  { id: "mercadoPago", label: "📱 Mercado Pago", color: "#00b1ea" },
];

// ─── UTILIDADES ──────────────────────────────────────────────────────────────
// Strip HTML/JS metachars y URI schemes peligrosos. React escapa al renderizar
// JSX, pero queremos evitar que strings maliciosos lleguen a Firestore para no
// contaminar exports/JSON dumps ni habilitar ataques en lectores externos.
const sanitize = s => String(s ?? "")
  .trim()
  .replace(/[<>"'`\\]/g, "")
  .replace(/javascript:/gi, "")
  .replace(/data:text\/html/gi, "")
  .slice(0, MAX_NOMBRE);
const validarPrecio = v => { const n = parseFloat(v); return !isNaN(n) && n > 0 && n < 1_000_000; };
const validarMesa   = v => { const n = parseInt(v, 10); return !isNaN(n) && n > 0 && n <= 200; };
const esURLSegura   = u => typeof u === "string" && /^https?:\/\/.+/.test(u.trim());
const numOrden      = () => `W-${String(Math.floor(Math.random() * 9999)).padStart(4, "0")}`;

// ─── HOOK TOAST ──────────────────────────────────────────────────────────────
function useToast() {
  const [toasts, setToasts] = useState([]);
  const addToast = useCallback((msg, type = "info") => {
    const id = Date.now() + Math.random();
    setToasts(p => [...p, { id, msg, type }]);
    setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), 3500);
  }, []);
  return { toasts, addToast };
}
function ToastContainer({ toasts }) {
  if (!toasts.length) return null;
  return <div className="toast-container">{toasts.map(t => <div key={t.id} className={`toast toast-${t.type}`}>{t.msg}</div>)}</div>;
}

// ─── HOOK COMERCIO ────────────────────────────────────────────────────────────
function useComercio(slug) {
  const [comercio, setComercio] = useState(null);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState(null);

  useEffect(() => {
    if (!slug) { setLoading(false); setError("not_found"); return; }
    const unsub = onSnapshot(
      doc(db, "comercios", slug),
      snap => {
        if (snap.exists()) { setComercio({ id: snap.id, ...snap.data() }); setError(null); }
        else { setComercio(null); setError("not_found"); }
        setLoading(false);
      },
      err => {
        console.error("useComercio error:", err);
        setError(err.code === "permission-denied" ? "permission_denied" : "network");
        setLoading(false);
      }
    );
    return () => unsub();
  }, [slug]);

  return { comercio, loading, error };
}

// ImageUpload se importa desde ./components/ImageUpload.jsx

// ─── PRODUCTO ─────────────────────────────────────────────────────────────────
const ProductoItem = memo(function ProductoItem({ p, slug, eliminarProducto, agregarAlCarrito, esAdmin, addToast }) {
  const [imgError,  setImgError]  = useState(false);
  const [cantidad,  setCantidad]  = useState(1);

  const manejarAgregar = e => {
    e.stopPropagation();
    agregarAlCarrito(p, esAdmin ? 1 : cantidad);
    addToast(`✅ ${p.nombre}${!esAdmin && cantidad > 1 ? " x" + cantidad : ""} agregado`, "success");
    if (!esAdmin) setCantidad(1);
  };

  const toggleDisponible = async () => {
    try { await updateDoc(doc(db, "comercios", slug, "productos", p.id), { disponible: !p.disponible }); }
    catch { addToast("Error al actualizar.", "error"); }
  };

  const agotado    = p.disponible === false;
  const stockBajo  = p.stock != null && p.stock > 0 && p.stock <= (p.stockMinimo || 5);
  const tieneImagen = p.foto && esURLSegura(p.foto) && !imgError;

  return (
    <div className={`product-card ${agotado ? "agotado-card" : ""}`}>
      <div className="product-img-wrapper">
        {tieneImagen
          ? <img src={p.foto} alt={sanitize(p.nombre)} className="product-img" style={{ opacity: agotado ? 0.4 : 1 }} onError={() => setImgError(true)} />
          : <div className="product-img-placeholder">{CAT_ICONS[p.categoria] || "🍽️"}</div>}
        {esAdmin && !agotado && <button className="btn-floating-add" onClick={manejarAgregar} title="Agregar 1 rápido">+</button>}
      </div>
      <div className="product-info-wrapper">
        <h2 className="product-name">
          {p.nombre}
          {agotado   && <span className="badge-agotado">AGOTADO</span>}
          {stockBajo && !agotado && <span className="badge-stock-bajo">ÚLTIMAS UNID.</span>}
        </h2>
        {p.descripcion && <p className="product-description">{p.descripcion}</p>}
        <p className="product-price-large">$ {p.precio?.toLocaleString("es-AR")}</p>
      </div>
      {!esAdmin && !agotado && (
        <div className="card-order-row">
          <div className="card-qty-group">
            <button className="card-qty-btn" onClick={e => { e.stopPropagation(); setCantidad(q => Math.max(1, q - 1)); }}>−</button>
            <span className="card-qty-num">{cantidad}</span>
            <button className="card-qty-btn" onClick={e => { e.stopPropagation(); setCantidad(q => Math.min(20, q + 1)); }}>+</button>
          </div>
          <button className="card-add-btn" onClick={manejarAgregar}>🛒 Pedir</button>
        </div>
      )}
      {esAdmin && (
        <div className="admin-card-actions">
          <button className="btn-admin-small" onClick={toggleDisponible}>{agotado ? "✅ Hab." : "⛔ Agotar"}</button>
          <button className="btn-delete-db" onClick={() => eliminarProducto(p.id)}>🗑️</button>
        </div>
      )}
    </div>
  );
}, (prev, next) =>
  prev.esAdmin === next.esAdmin &&
  prev.p.id === next.p.id &&
  prev.p.disponible === next.p.disponible &&
  prev.p.stock === next.p.stock &&
  prev.p.stockMinimo === next.p.stockMinimo &&
  prev.p.foto === next.p.foto &&
  prev.p.precio === next.p.precio &&
  prev.p.nombre === next.p.nombre &&
  prev.p.descripcion === next.p.descripcion
);

// ─── CARRUSEL ─────────────────────────────────────────────────────────────────
function FeaturedCarousel({ productos, menuDiaIds, addToast, agregarAlCarrito }) {
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
              <button className="btn-add-carousel" onClick={() => { agregarAlCarrito(p, 1); addToast(`✅ ${p.nombre} agregado`, "success"); }}>+ Pedir</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── HISTORIAL ────────────────────────────────────────────────────────────────
function VistaHistorial({ slug, alCerrar }) {
  const [registros, setRegistros] = useState([]);
  const [loading,   setLoading]   = useState(true);
  useEffect(() => {
    const unsub = onSnapshot(collection(db, "comercios", slug, "historial"), snap => {
      setRegistros(snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => new Date(b.fechaCierre) - new Date(a.fechaCierre)));
      setLoading(false);
    });
    return () => unsub();
  }, [slug]);
  return (
    <div className="historial-modal">
      <div className="historial-header"><h1>📁 Historial de Ventas</h1><button className="btn-cerrar-historial" onClick={alCerrar}>✕ VOLVER</button></div>
      {loading && <p style={{ textAlign: "center", color: "var(--text-dim)" }}>Cargando...</p>}
      {!loading && registros.length === 0 && <p style={{ textAlign: "center", color: "var(--text-dim)" }}>No hay registros.</p>}
      <div className="historial-lista">
        {registros.map(r => (
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

// ─── PÁGINA NO ENCONTRADA ─────────────────────────────────────────────────────
function NotFound({ slug }) {
  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "var(--bg-body)", color: "var(--text-main)", padding: "24px", textAlign: "center" }}>
      <h1 style={{ fontSize: "3rem" }}>404</h1>
      <p style={{ color: "var(--text-dim)", marginBottom: "16px" }}>
        {slug ? `El restaurante "${slug}" no existe.` : "Página no encontrada."}
      </p>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// RESTAURANTE — vista principal
// ═════════════════════════════════════════════════════════════════════════════
function RestauranteApp() {
  const { comercioSlug: slug } = useParams();
  const { comercio, loading: loadingComercio, error: errorComercio } = useComercio(slug);

  const [productos,   setProductos]   = useState([]);
  const [loadingProductos, setLoadingProductos] = useState(true);
  const [errorConexion, setErrorConexion] = useState(false);
  const [mesaInvalidaEnURL, setMesaInvalidaEnURL] = useState(false);
  const [deliveryInfo, setDeliveryInfo] = useState({ nombre: "", direccion: "", telefono: "" });
  const [carrito,     setCarrito]     = useState(() => { try { return JSON.parse(localStorage.getItem(`carrito-${slug}`) || "[]"); } catch { return []; } });
  const [notas,       setNotas]       = useState("");
  const [verHistorial, setVerHistorial] = useState(false);
  const [vistaActiva, setVistaActiva] = useState("menu");
  const [ultimoPedidoId, setUltimoPedidoId] = useState(() => localStorage.getItem("ultimoPedidoId"));
  const [estadoPedido, setEstadoPedido] = useState(null);
  const [user,        setUser]        = useState(null);
  const [busqueda,    setBusqueda]    = useState("");
  const [categoriaSel, setCategoriaSel] = useState("todos");
  const [menuAbierto, setMenuAbierto] = useState(false);
  const [enviando,    setEnviando]    = useState(false);
  const [loginLoading, setLoginLoading] = useState(false);
  const [tema,        setTema]        = useState(() => localStorage.getItem("tema") || "dark");
  const [metodoPago,  setMetodoPago]  = useState("");
  const [mostrarConfirmacion, setMostrarConfirmacion] = useState(false);
  const [datosConfirmacion,   setDatosConfirmacion]   = useState(null);
  const [fotoProducto, setFotoProducto] = useState("");
  const [metricasUsuario, setMetricasUsuario] = useState({ ordersCount: 0, favorite: null });
  const [menuDiaIds,  setMenuDiaIds]  = useState([]);
  const [configLocal, setConfigLocal] = useState({ estado: "ABIERTO" });
  const [mesa, setMesa] = useState(() => {
    const p = new URLSearchParams(window.location.search).get("mesa") || "";
    return validarMesa(p) ? p : "";
  });

  const ultimaOrden = useRef(0);
  const barcodeRef  = useRef(null);
  const { toasts, addToast } = useToast();

  const esAdmin     = !!(user && comercio && user.uid === comercio.ownerUid);
  const esDelivery  = configLocal.estado === "CERRADO";

  // ── Efectos
  useEffect(() => { const u = onAuthStateChanged(auth, setUser); return () => u(); }, []);
  useEffect(() => { document.documentElement.setAttribute("data-theme", tema); localStorage.setItem("tema", tema); }, [tema]);
  useEffect(() => { if (slug) localStorage.setItem(`carrito-${slug}`, JSON.stringify(carrito)); }, [carrito, slug]);

  useEffect(() => {
    if (!ultimoPedidoId || !slug) return;
    const unsub = onSnapshot(doc(db, "comercios", slug, "pedidos", ultimoPedidoId), snap => {
      if (snap.exists()) setEstadoPedido(snap.data().estado);
      else { setEstadoPedido(null); setUltimoPedidoId(null); localStorage.removeItem("ultimoPedidoId"); }
    });
    return () => unsub();
  }, [ultimoPedidoId, slug]);

  useEffect(() => {
    if (!slug) return;
    const unsub = onSnapshot(
      collection(db, "comercios", slug, "productos"),
      snap => {
        setProductos(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        setLoadingProductos(false);
        setErrorConexion(false);
      },
      err => {
        console.error("[productos]", err);
        setLoadingProductos(false);
        setErrorConexion(true);
      }
    );
    return () => unsub();
  }, [slug]);

  useEffect(() => {
    if (!slug) return;
    const unsub = onSnapshot(doc(db, "comercios", slug, "config", "menuDelDia"), snap => {
      if (snap.exists()) setMenuDiaIds(snap.data().ids || []);
    });
    return () => unsub();
  }, [slug]);

  useEffect(() => {
    if (!slug) return;
    const unsub = onSnapshot(doc(db, "comercios", slug, "configuracion", "local"), snap => {
      if (snap.exists()) setConfigLocal(c => ({ ...c, ...snap.data() }));
    });
    return () => unsub();
  }, [slug]);

  useEffect(() => {
    if (!user?.uid || !slug) { setMetricasUsuario({ ordersCount: 0, favorite: null }); return; }
    const q = query(collection(db, "comercios", slug, "pedidos"), where("uid", "==", user.uid));
    const unsub = onSnapshot(q, snap => {
      const docs = snap.docs.map(d => d.data());
      const count = {};
      docs.forEach(d => d.items?.forEach(it => {
        if (it.categoria) count[it.categoria] = (count[it.categoria] || 0) + (it.cantidad || 1);
      }));
      const fav = Object.entries(count).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
      setMetricasUsuario({ ordersCount: snap.size, favorite: fav });
    });
    return () => unsub();
  }, [user?.uid, slug]);

  // Render del barcode cuando se muestra la confirmación
  useEffect(() => {
    if (!mostrarConfirmacion || !datosConfirmacion?.numeroOrden || !barcodeRef.current) return;
    try {
      JsBarcode(barcodeRef.current, String(datosConfirmacion.numeroOrden), {
        format: "CODE128",
        lineColor: "#000",
        background: "#fff",
        width: 2,
        height: 50,
        displayValue: false,
        margin: 0,
      });
    } catch (err) { console.error("[Barcode]", err); }
  }, [mostrarConfirmacion, datosConfirmacion]);

  useEffect(() => {
    const mesaParam = new URLSearchParams(window.location.search).get("mesa");
    if (!mesaParam) return;
    if (validarMesa(mesaParam)) {
      setMesa(mesaParam);
      setMesaInvalidaEnURL(false);
    } else {
      setMesaInvalidaEnURL(true);
    }
  }, []);

  // ── Auth
  const login  = async () => { setLoginLoading(true); try { await signInWithPopup(auth, provider); } catch { addToast("No se pudo iniciar sesión.", "error"); } finally { setLoginLoading(false); } };
  const logout = async () => { try { await signOut(auth); addToast("Sesión cerrada.", "info"); } catch { addToast("Error.", "error"); } };

  // ── Carrito
  const agregarAlCarrito = useCallback((p, cant) => {
    if (p.disponible === false) return addToast("Este producto está agotado.", "warning");
    if (p.stock != null && p.stock <= 0) return addToast("Sin stock disponible.", "warning");
    setCarrito(prev => {
      const idx = prev.findIndex(i => i.id === p.id);
      if (idx >= 0) {
        const enCarrito = prev[idx].cantidad;
        if (p.stock != null && enCarrito + cant > p.stock) {
          addToast(`Solo quedan ${p.stock} unidades de ${p.nombre}.`, "warning");
          return prev;
        }
        const u = [...prev];
        const nc = enCarrito + cant;
        u[idx] = { ...u[idx], cantidad: nc, total: nc * p.precio };
        return u;
      }
      if (p.stock != null && cant > p.stock) {
        addToast(`Solo quedan ${p.stock} unidades de ${p.nombre}.`, "warning");
        return prev;
      }
      return [...prev, { ...p, cartId: `${p.id}-${Date.now()}`, cantidad: cant, total: p.precio * cant }];
    });
  }, [addToast]);

  // ── CRUD Productos
  const eliminarProducto = useCallback(async id => {
    if (!window.confirm("¿Eliminar permanentemente?")) return;
    try {
      await deleteDoc(doc(db, "comercios", slug, "productos", id));
      addToast("Eliminado.", "success");
    } catch (err) {
      console.error("[eliminarProducto]", err);
      addToast(err?.message || "No se pudo eliminar.", "error");
    }
  }, [slug, addToast]);

  const agregarProducto = async e => {
    e.preventDefault();
    const { nombre, precio, foto, categoria, descripcion } = e.target.elements;
    const nc = sanitize(nombre.value);
    if (!nc) return addToast("Nombre vacío.", "warning");
    if (!validarPrecio(precio.value)) return addToast("Precio inválido.", "warning");
    const fotoFinal = fotoProducto || foto.value.trim();
    try {
      await addDoc(collection(db, "comercios", slug, "productos"), {
        nombre: nc, precio: parseFloat(precio.value),
        descripcion: sanitize(descripcion?.value || "").slice(0, 200),
        foto: esURLSegura(fotoFinal) ? fotoFinal : "",
        categoria: categoria.value, disponible: true,
        stock: 50, stockMinimo: 5, creadoEn: serverTimestamp(),
      });
      e.target.reset(); setFotoProducto(""); addToast("✅ Producto añadido.", "success");
    } catch (err) {
      console.error("[agregarProducto]", err);
      addToast(err?.message || "No se pudo agregar.", "error");
    }
  };

  // ── Enviar pedido
  // Usa una transacción Firestore que:
  //   1. Lee/incrementa el contador secuencial del día (config/contadores)
  //   2. Verifica stock de cada item del carrito
  //   3. Crea el documento del pedido
  //   4. Decrementa el stock de los productos
  // Todo atómico — si falla cualquier paso, no se persiste nada.
  const enviarPedido = async () => {
    if (carrito.length === 0) return addToast("Carrito vacío.", "warning");
    if (esDelivery) {
      if (!deliveryInfo.nombre.trim())    return addToast("Ingresá tu nombre.", "warning");
      if (!deliveryInfo.direccion.trim()) return addToast("Ingresá tu dirección.", "warning");
      if (!deliveryInfo.telefono.trim())  return addToast("Ingresá tu teléfono.", "warning");
    } else {
      if (!mesa)              return addToast("Ingresá mesa.", "warning");
      if (!validarMesa(mesa)) return addToast("Mesa inválida (1–200).", "warning");
    }
    if (!metodoPago)           return addToast("Seleccioná método de pago.", "warning");
    if (Date.now() - ultimaOrden.current < COOLDOWN_MS) return addToast("Esperá unos segundos.", "warning");
    setEnviando(true);
    try {
      const sub        = carrito.reduce((a, i) => a + i.total, 0);
      const descuento  = user && metricasUsuario.ordersCount === 0 && !esAdmin ? 0.15 : 0;
      const total      = sub * (1 - descuento);
      const counterRef = doc(db, "comercios", slug, "config", "contadores");
      const fechaHoy   = new Date().toLocaleDateString("es-AR");
      const pedidoRef  = doc(collection(db, "comercios", slug, "pedidos"));

      const { numeroFormateado } = await runTransaction(db, async tx => {
        // 1. Contador secuencial diario
        const counterSnap = await tx.get(counterRef);
        const counterData = counterSnap.exists() ? counterSnap.data() : {};
        const numero = counterData.fecha === fechaHoy ? (counterData.ultimaOrden || 0) + 1 : 1;
        const numeroFormateado = `W-${String(numero).padStart(4, "0")}`;

        // 2. Verificar y leer stock de cada producto
        const productSnaps = await Promise.all(
          carrito.map(item => tx.get(doc(db, "comercios", slug, "productos", item.id)))
        );
        for (let i = 0; i < carrito.length; i++) {
          const snap = productSnaps[i];
          if (!snap.exists()) throw new Error(`Producto "${carrito[i].nombre}" ya no existe.`);
          const data = snap.data();
          if (data.disponible === false) throw new Error(`"${carrito[i].nombre}" no está disponible.`);
          if (data.stock != null && data.stock < carrito[i].cantidad) {
            throw new Error(`Sin stock suficiente: ${carrito[i].nombre} (quedan ${data.stock}).`);
          }
        }

        // 3. Crear documento del pedido
        const pedidoData = {
          tipo: esDelivery ? "delivery" : "mesa",
          items: carrito.map(({ id, nombre, cantidad, total, categoria }) => ({ id, nombre, cantidad, total, categoria: categoria || null })),
          notas: sanitize(notas).slice(0, MAX_NOTAS),
          total, subtotal: sub, descuentoAplicado: descuento * 100,
          estado: "pendiente", hora: new Date().toLocaleTimeString("es-AR"),
          metodoPago, numeroOrden: numeroFormateado, creadoEn: serverTimestamp(),
          email: user?.email || null, uid: user?.uid || null,
        };
        if (esDelivery) {
          pedidoData.deliveryInfo = {
            nombre: sanitize(deliveryInfo.nombre).slice(0, 80),
            direccion: sanitize(deliveryInfo.direccion).slice(0, 160),
            telefono: sanitize(deliveryInfo.telefono).slice(0, 30),
          };
        } else {
          pedidoData.mesa = parseInt(mesa, 10);
        }
        tx.set(pedidoRef, pedidoData);

        // 4. Decrementar stock + actualizar contador
        for (let i = 0; i < carrito.length; i++) {
          const data = productSnaps[i].data();
          if (data.stock != null) {
            tx.update(productSnaps[i].ref, { stock: data.stock - carrito[i].cantidad });
          }
        }
        tx.set(counterRef, { ultimaOrden: numero, fecha: fechaHoy }, { merge: true });

        return { numeroFormateado };
      });

      ultimaOrden.current = Date.now();
      setUltimoPedidoId(pedidoRef.id); localStorage.setItem("ultimoPedidoId", pedidoRef.id);
      setDatosConfirmacion({
        numeroOrden: numeroFormateado,
        mesa: esDelivery ? null : parseInt(mesa, 10),
        deliveryInfo: esDelivery ? { ...deliveryInfo } : null,
        tipo: esDelivery ? "delivery" : "mesa",
        items: [...carrito],
        total,
        metodoPago,
      });
      setMostrarConfirmacion(true);
      setCarrito([]); setNotas(""); setMetodoPago("");
      setDeliveryInfo({ nombre: "", direccion: "", telefono: "" });
      addToast("🔔 ¡Pedido enviado!", "success");
    } catch (err) {
      console.error("[enviarPedido]", err);
      addToast(err?.message || "No se pudo enviar el pedido.", "error");
    } finally { setEnviando(false); }
  };

  // ── Llamar mozo
  const llamarMozo = async () => {
    if (!mesa || !validarMesa(mesa)) return addToast("Ingresá mesa primero.", "warning");
    try {
      await addDoc(collection(db, "comercios", slug, "llamadasMozo"), {
        mesa: parseInt(mesa, 10), hora: new Date().toLocaleTimeString("es-AR"),
        atendida: false, creadoEn: serverTimestamp(),
      });
      addToast("🖐️ ¡Mozo notificado!", "success");
    } catch (err) {
      console.error("[llamarMozo]", err);
      addToast(err?.message || "No se pudo llamar al mozo.", "error");
    }
  };

  const cambiarVista = v => { setVistaActiva(v); setMenuAbierto(false); };

  // ── Calculados (memoizados para evitar recálculos en cada re-render)
  const productosFiltrados = useMemo(() => {
    const q = busqueda.toLowerCase();
    return productos.filter(p => {
      const nom = p.nombre?.toLowerCase().includes(q);
      const cat = categoriaSel === "todos" || p.categoria?.toLowerCase() === categoriaSel;
      return nom && cat;
    });
  }, [productos, busqueda, categoriaSel]);
  const esNuevoUsuario  = !!(user && metricasUsuario.ordersCount === 0 && !esAdmin);
  const descuentoVal    = esNuevoUsuario ? 0.15 : 0;
  const subtotalCarrito = useMemo(() => carrito.reduce((a, i) => a + i.total, 0), [carrito]);
  const montoDescuento  = subtotalCarrito * descuentoVal;
  const totalCarrito    = subtotalCarrito - montoDescuento;

  // ── Loading
  if (loadingComercio) {
    return <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg-body)" }}><div className="loading-spinner" /></div>;
  }
  if (errorComercio === "not_found") return <NotFound slug={slug} />;

  const logoUrl = comercio?.logoUrl || "/logo-waves.png";
  const nombre  = comercio?.nombre  || "Waves";

  return (
    <>
      <ToastContainer toasts={toasts} />
      <UpdateBanner />
      <InstallPrompt />
      {vistaActiva === "menu" && (
        <div className="btn-top-controls">
          <button
            className="btn-theme-toggle"
            onClick={() => setTema(p => p === "light" ? "dark" : p === "dark" ? "seleccion" : "light")}
            title="Cambiar tema"
            aria-label={`Cambiar tema, actual: ${tema === "light" ? "claro" : tema === "dark" ? "oscuro" : "selección"}`}
          >
            {tema === "light" ? "☀️" : tema === "dark" ? "🌙" : "⭐"}
          </button>
          {esAdmin && (
            <button
              className="btn-cocina-quick"
              onClick={() => cambiarVista("cocina")}
              title="Ir a Cocina"
              aria-label="Ir a la vista de cocina"
            >
              👨‍🍳
            </button>
          )}
        </div>
      )}

      <Suspense fallback={null}>
        {vistaActiva === "cocina"     && esAdmin && <CocinaAdmin  slug={slug} addToast={addToast} alCerrar={() => cambiarVista("menu")} />}
        {vistaActiva === "cierreCaja" && esAdmin && <CierreCaja   slug={slug} addToast={addToast} alCerrar={() => cambiarVista("menu")} />}
        {vistaActiva === "config"     && esAdmin && <ConfigLocal  slug={slug} addToast={addToast} alCerrar={() => cambiarVista("menu")} />}
        {vistaActiva === "stock"      && esAdmin && <StockManager slug={slug} addToast={addToast} alCerrar={() => cambiarVista("menu")} />}
        {vistaActiva === "menuDia"    && esAdmin && (
          <MenuDelDia slug={slug} productos={productos} menuDiaIds={menuDiaIds} addToast={addToast} alCerrar={() => cambiarVista("menu")} />
        )}
      </Suspense>

      {vistaActiva === "menu" && (
        <div className="menu-container">
          {/* Header */}
          <header className="header">
            <button
              type="button"
              onClick={loginLoading ? undefined : user ? logout : login}
              className="header-icon"
              style={{ cursor: "pointer", opacity: loginLoading ? 0.5 : 1, background: "transparent", border: "none", padding: 0 }}
              aria-label={user ? `Cerrar sesión de ${user.displayName || user.email}` : "Iniciar sesión con Google"}
              disabled={loginLoading}
            >
              <img
                src={user ? user.photoURL : (tema === "seleccion" ? "/afa-logo.png" : logoUrl)}
                alt={user ? `Avatar de ${user.displayName || ""}` : `Logo de ${nombre}`}
                style={{ borderRadius: user && tema !== "seleccion" ? "50%" : (tema === "seleccion" ? "0" : "50%") }}
              />
            </button>
            {user && <p className="header-username">{user.displayName}</p>}
          </header>

          {/* Hamburger */}
          <button
            className="hamburger-btn"
            onClick={() => setMenuAbierto(true)}
            aria-label="Abrir menú"
            aria-expanded={menuAbierto}
            aria-controls="drawer-nav"
          >
            <span className="hamburger-line" /><span className="hamburger-line" /><span className="hamburger-line" />
          </button>

          {/* Drawer */}
          <div className={`drawer-overlay ${menuAbierto ? "open" : ""}`} onClick={() => setMenuAbierto(false)} />
          <nav
            id="drawer-nav"
            className={`drawer-menu ${menuAbierto ? "open" : ""}`}
            role="dialog"
            aria-modal={menuAbierto}
            aria-hidden={!menuAbierto}
          >
            <div className="drawer-header"><h2>{nombre}</h2><button className="drawer-close" onClick={() => setMenuAbierto(false)}>✕</button></div>
            <div className="drawer-section">
              <p className="drawer-section-title">Categorías</p>
              {CATEGORIAS.map(c => (
                <button
                  key={c}
                  className={`drawer-item ${categoriaSel === c ? "active" : ""}`}
                  onClick={() => { setCategoriaSel(c); setMenuAbierto(false); }}
                  aria-pressed={categoriaSel === c}
                >
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
              <button className="drawer-item" onClick={() => { setTema(p => p === "light" ? "dark" : p === "dark" ? "seleccion" : "light"); setMenuAbierto(false); }}>
                {tema === "light" ? "🌙 Modo Oscuro" : tema === "dark" ? "⭐ Modo Selección" : "☀️ Modo Claro"}
              </button>
            </div>
          </nav>

          {/* Search */}
          <div style={{ padding: "0 10px", marginBottom: "20px" }}>
            <input
              type="text"
              placeholder={tema === "seleccion" ? "🔍 ¿QUÉ DESEAN LOS CAMPEONES HOY?" : "🔍 Buscar plato, bebida, postre..."}
              className="input-base search-bar"
              maxLength={80}
              onChange={e => setBusqueda(e.target.value)}
            />
          </div>

          {/* Admin Form */}
          {esAdmin && (
            <div className="admin-actions" style={{ padding: "0 12px" }}>
              <form onSubmit={agregarProducto} className="form-container">
                <h3 style={{ color: "var(--accent-yellow)", marginBottom: "4px" }}>+ Agregar Producto</h3>
                <input name="nombre"   placeholder="Nombre"  required maxLength={MAX_NOMBRE} className="input-base" />
                <input name="precio"   type="number" min="1" max="999999" step="0.01" placeholder="Precio" required className="input-base" />
                <textarea name="descripcion" placeholder="Descripción (opcional)" maxLength={200} className="input-base" rows={2} />
                <Suspense fallback={<div style={{ padding: 12, textAlign: "center", color: "var(--text-dim)" }}>Cargando uploader…</div>}>
                  <ImageUpload onUpload={url => setFotoProducto(url)} addToast={addToast} initialUrl={fotoProducto} />
                </Suspense>
                <input name="foto" placeholder="O pegá URL de imagen" className="input-base" value={fotoProducto} onChange={e => setFotoProducto(e.target.value)} />
                <select name="categoria" className="input-base">
                  {CATEGORIAS.filter(c => c !== "todos").map(c => <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>)}
                </select>
                <button type="submit" className="btn-submit">+ Añadir Producto</button>
              </form>
            </div>
          )}

          {/* Status pedido */}
          {estadoPedido && (
            <div className={`status-banner ${estadoPedido}`}>
              {estadoPedido === "pendiente"  && "⏳ Pedido recibido, esperando cocina..."}
              {estadoPedido === "preparando" && "👨‍🍳 ¡Tu pedido está en preparación!"}
              {estadoPedido === "finalizado" && "✅ ¡Pedido listo! Te lo llevamos enseguida."}
            </div>
          )}

          {/* Banners de estado */}
          {errorConexion && (
            <div className="banner-conexion" role="status">
              📡 Sin conexión. Reintentando...
            </div>
          )}
          {esDelivery && (
            <div className="banner-local-cerrado" role="status">
              🛵 <strong>Local cerrado al público.</strong> Tomamos pedidos por delivery — completá tus datos abajo.
            </div>
          )}
          {mesaInvalidaEnURL && user && !esAdmin && !esDelivery && (
            <div className="banner-mesa-invalida" role="status">
              ⚠️ Mesa no identificada. Escaneá el QR de la mesa o ingresá el número abajo.
            </div>
          )}

          {/* Promos */}
          {!busqueda && categoriaSel === "todos" && (
            <>
              {!user && (
                <div className="promo-banner new-user-banner-fancy">
                  🎁 <strong>¡15% OFF PARA NUEVOS SOCIOS!</strong> Iniciá sesión arriba para aprovechar este regalo.
                </div>
              )}
              {esNuevoUsuario && (
                <div className="promo-banner new-user-banner-fancy">
                  🎁 ¡Bienvenido! Tenés <strong>15% OFF</strong> en tu primer pedido. Disfrutá tu descuento de bienvenida.
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

          {/* Productos agrupados por categoría */}
          {productosFiltrados.length === 0 && !loadingProductos ? (
            <p style={{ textAlign: "center", width: "100%", color: "var(--text-dim)", padding: "40px 0" }}>No se encontraron productos.</p>
          ) : (
            (() => {
              const grupos = productosFiltrados.reduce((acc, p) => {
                const label = (p.categoria || "Sin categoría").trim();
                const key   = label.toLowerCase();
                if (!acc[key]) acc[key] = { label, items: [] };
                acc[key].items.push(p);
                return acc;
              }, {});
              return Object.entries(grupos).map(([key, { label, items }]) => {
                const titulo = label.charAt(0).toUpperCase() + label.slice(1);
                const partes = titulo.split(" ");
                const bold   = partes[0];
                const resto  = partes.slice(1).join(" ");
                return (
                  <div key={key} className="categoria-seccion">
                    <div className="categoria-header">
                      <span className="categoria-linea" />
                      <div className="categoria-badge">
                        <span className="categoria-badge-bold">{bold}</span>
                        {resto && <span className="categoria-badge-regular">{resto}</span>}
                      </div>
                      <span className="categoria-linea" />
                    </div>
                    <div className="product-list">
                      {items.map(p => (
                        <ProductoItem key={p.id} p={p} slug={slug} esAdmin={esAdmin} eliminarProducto={eliminarProducto} agregarAlCarrito={agregarAlCarrito} addToast={addToast} />
                      ))}
                    </div>
                  </div>
                );
              });
            })()
          )}

          {/* Llamar mozo */}
          {mesa && <button className="btn-llamar-mozo" onClick={llamarMozo} style={{ margin: "20px 12px 0" }}>🖐️ Llamar al Mozo</button>}

          {/* Carrito */}
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
                    <li key={item.cartId || `${item.id}-${i}`} className="carrito-item">
                      <span><strong>{item.cantidad}x</strong> {item.nombre}</span>
                      <span>
                        <strong>${item.total.toLocaleString("es-AR")}</strong>
                        <button
                          type="button"
                          className="btn-quitar-item"
                          onClick={() => setCarrito(carrito.filter((_, j) => j !== i))}
                          aria-label={`Quitar ${item.nombre} del pedido`}
                        >✕</button>
                      </span>
                    </li>
                  ))}
                </ul>
                <div style={{ marginTop: "20px" }}>
                  {esNuevoUsuario ? (
                    <div style={{ padding: "12px", background: "var(--bg-surface)", border: "1px solid var(--border-subtle)", borderRadius: "12px", marginBottom: "15px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", color: "var(--text-muted)", marginBottom: "6px", fontSize: ".9rem" }}>
                        <span>Subtotal</span><span>${subtotalCarrito.toLocaleString("es-AR")}</span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", color: "var(--accent-yellow)", fontWeight: "700", marginBottom: "8px", fontSize: ".9rem" }}>
                        <span>🎁 Descuento Bienvenida (15%)</span><span>-${montoDescuento.toLocaleString("es-AR")}</span>
                      </div>
                      <div style={{ height: "1px", background: "var(--border-subtle)", margin: "4px 0 10px" }} />
                      <h3 className="pedido-total" style={{ margin: 0 }}>Total: ${totalCarrito.toLocaleString("es-AR")}</h3>
                    </div>
                  ) : (
                    <h3 className="pedido-total">Total: ${totalCarrito.toLocaleString("es-AR")}</h3>
                  )}
                  <textarea placeholder="Notas para cocina..." value={notas} onChange={e => setNotas(e.target.value)} maxLength={MAX_NOTAS} className="input-notas" />
                  <small className="contador-notas">{notas.length}/{MAX_NOTAS}</small>
                  {esDelivery ? (
                    <div className="delivery-form">
                      <input
                        type="text"
                        placeholder="Tu nombre"
                        value={deliveryInfo.nombre}
                        onChange={e => setDeliveryInfo(d => ({ ...d, nombre: e.target.value }))}
                        maxLength={80}
                        className="input-base"
                      />
                      <input
                        type="text"
                        placeholder="Dirección de entrega"
                        value={deliveryInfo.direccion}
                        onChange={e => setDeliveryInfo(d => ({ ...d, direccion: e.target.value }))}
                        maxLength={160}
                        className="input-base"
                      />
                      <input
                        type="tel"
                        placeholder="Teléfono"
                        value={deliveryInfo.telefono}
                        onChange={e => setDeliveryInfo(d => ({ ...d, telefono: e.target.value }))}
                        maxLength={30}
                        className="input-base"
                      />
                    </div>
                  ) : (
                    <input type="number" placeholder="N° de Mesa" value={mesa} min="1" max="200" onChange={e => setMesa(e.target.value)} className="input-mesa" />
                  )}
                  <div className="pago-selector">
                    <p className="pago-titulo">Método de Pago</p>
                    <div className="pago-opciones">
                      {METODOS_PAGO.map(m => (
                        <button
                          key={m.id}
                          type="button"
                          className={`pago-opcion ${metodoPago === m.id ? "seleccionado" : ""}`}
                          onClick={() => setMetodoPago(m.id)}
                          style={metodoPago === m.id ? { borderColor: m.color, boxShadow: `0 0 12px ${m.color}33` } : {}}
                          aria-pressed={metodoPago === m.id}
                        >
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

      {/* Confirmación */}
      {mostrarConfirmacion && datosConfirmacion && (
        <div className="confirmacion-overlay" role="dialog" aria-modal="true" aria-labelledby="confirmacion-title">
          <div className="confirmacion-card ticket-termico">
            <div className="confirmacion-check" aria-hidden="true">✓</div>
            <h2 id="confirmacion-title">¡Pedido en marcha!</h2>
            <p className="confirmacion-orden">Orden #{datosConfirmacion.numeroOrden}</p>
            {datosConfirmacion.tipo === "delivery" ? (
              <div className="confirmacion-delivery">
                <p>🛵 <strong>Delivery</strong></p>
                <p>{datosConfirmacion.deliveryInfo?.nombre}</p>
                <p>{datosConfirmacion.deliveryInfo?.direccion}</p>
                <p>📞 {datosConfirmacion.deliveryInfo?.telefono}</p>
              </div>
            ) : (
              <p className="confirmacion-mesa">Mesa {datosConfirmacion.mesa}</p>
            )}
            <ul className="confirmacion-items">{datosConfirmacion.items.map((it, i) => <li key={i}>{it.cantidad}x {it.nombre}</li>)}</ul>
            <div className="confirmacion-total">Total: ${datosConfirmacion.total.toLocaleString("es-AR")}</div>
            <div className="confirmacion-metodo">💳 {datosConfirmacion.metodoPago}</div>
            <div className="ticket-barcode-wrap">
              <svg ref={barcodeRef} aria-label={`Código de barras del pedido ${datosConfirmacion.numeroOrden}`} />
              <p className="ticket-orden-num">{datosConfirmacion.numeroOrden}</p>
            </div>
            <button className="btn-confirmacion-cerrar" onClick={() => setMostrarConfirmacion(false)}>ACEPTAR</button>
          </div>
        </div>
      )}

      {verHistorial && <VistaHistorial slug={slug} alCerrar={() => setVerHistorial(false)} />}
    </>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// APP PRINCIPAL con rutas
// ═════════════════════════════════════════════════════════════════════════════
export default function App() {
  return (
    <Routes>
      <Route path="/:comercioSlug" element={<RestauranteApp />} />
      <Route path="/" element={<Navigate to="/waves" replace />} />
    </Routes>
  );
}
