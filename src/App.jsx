import { useEffect, useState, useRef } from "react";
import { db, auth, provider } from "./firebaseConfig";
import {
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  getRedirectResult,
} from "firebase/auth";
import {
  collection,
  onSnapshot,
  addDoc,
  deleteDoc,
  doc,
  updateDoc,
  writeBatch,
} from "firebase/firestore";
import "./App.css";

// --- COMPONENTE PRODUCTO ITEM ---
function ProductoItem({ p, eliminarProducto, agregarAlCarrito, esAdmin }) {
  const [cantidad, setCantidad] = useState(1);
  const [agregado, setAgregado] = useState(false);

  const manejarAgregar = () => {
    agregarAlCarrito(p, cantidad);
    setAgregado(true);
    setTimeout(() => setAgregado(false), 1000);
  };

  const toggleDisponible = async () => {
    await updateDoc(doc(db, "productos", p.id), {
      disponible: p.disponible === false ? true : false,
    });
  };

  const estaAgotado = p.disponible === false;

  return (
    <div className={`product-card ${estaAgotado ? "agotado-card" : ""}`}>
      {p.foto && (
        <img
          src={p.foto}
          alt={p.nombre}
          className="product-img"
          style={{ opacity: estaAgotado ? 0.5 : 1 }}
        />
      )}
      <h2 className="product-name">
        {p.nombre} {estaAgotado && "(AGOTADO)"}
      </h2>
      <p className="product-price">$ {p.precio}</p>

      <div className="qty-container">
        <button
          disabled={estaAgotado}
          className="btn-qty"
          onClick={() => setCantidad(Math.max(1, cantidad - 1))}
        >
          -
        </button>
        <span className="qty-text">{cantidad}</span>
        <button
          disabled={estaAgotado}
          className="btn-qty"
          onClick={() => setCantidad(cantidad + 1)}
        >
          +
        </button>
      </div>

      <button
        className={`btn-add-cart ${agregado ? "btn-success" : ""}`}
        onClick={manejarAgregar}
        disabled={estaAgotado}
      >
        {estaAgotado
          ? "🚫 Agotado"
          : agregado
            ? "¡Listo! ✅"
            : "🛒 Agregar al Carrito"}
      </button>

      {esAdmin && (
        <div style={{ display: "flex", gap: "10px", marginTop: "10px" }}>
          <button className="btn-admin-small" onClick={toggleDisponible}>
            {estaAgotado ? "Habilitar" : "Agotar"}
          </button>
          <button
            className="btn-delete-db"
            onClick={() => eliminarProducto(p.id)}
          >
            Eliminar
          </button>
        </div>
      )}
    </div>
  );
}

// --- COMPONENTE: SECCIÓN DE VENTAS CON CIERRE DE CAJA ---
function SeccionVentas({ pedidos }) {
  const ventasHoy = pedidos.filter((p) => p.estado === "finalizado");
  const totalCaja = ventasHoy.reduce((acc, p) => acc + (p.total || 0), 0);

  const cerrarCaja = async () => {
    if (ventasHoy.length === 0)
      return alert("No hay ventas finalizadas para cerrar.");

    if (
      window.confirm(
        `¿Cerrar caja? Se archivará un total de $${totalCaja} en el historial y se limpiará la cocina.`,
      )
    ) {
      try {
        const batch = writeBatch(db);
        const fechaCierre = new Date().toLocaleString();

        ventasHoy.forEach((pedido) => {
          const historialRef = doc(collection(db, "historial"));
          batch.set(historialRef, {
            ...pedido,
            fechaCierre: fechaCierre,
            idOriginal: pedido.id,
          });

          const docRef = doc(db, "pedidos", pedido.id);
          batch.delete(docRef);
        });

        await batch.commit();
        alert("✅ Caja cerrada. Los datos se han movido al historial.");
      } catch (error) {
        console.error("Error al cerrar caja:", error);
        alert("Error al procesar el cierre.");
      }
    }
  };

  if (ventasHoy.length === 0) return null;

  return (
    <div className="ventas-caja">
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <h2 style={{ color: "#d9ed21", margin: 0 }}>💰 Resumen de Caja</h2>
        <button onClick={cerrarCaja} className="btn-cerrar-caja">
          CERRAR CAJA Y ARCHIVAR
        </button>
      </div>
      <p style={{ fontSize: "1.5rem", fontWeight: "bold", margin: "10px 0" }}>
        Total Recaudado: ${totalCaja}
      </p>
      <div className="ventas-scroll">
        {ventasHoy.map((v) => (
          <div key={v.id} className="venta-row">
            <span>Mesa {v.mesa}</span>
            <span>
              ${v.total}{" "}
              <small style={{ color: "#aaa" }}>({v.entregadoHora})</small>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// --- COMPONENTE PANEL COCINA ---
function PanelCocina() {
  const [pedidos, setPedidos] = useState([]);
  const [interactuado, setInteractuado] = useState(false);
  const audioNotificacion = useRef(
    new Audio(
      "https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3",
    ),
  );
  const pedidosAnteriores = useRef(0);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "pedidos"), (snapshot) => {
      const todos = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      const pendientes = todos.filter(
        (p) => p.estado === "pendiente" || p.estado === "preparando",
      );

      if (
        pendientes.length > pedidosAnteriores.current &&
        pedidosAnteriores.current !== 0 &&
        interactuado
      ) {
        audioNotificacion.current.play().catch(() => {});
      }
      pedidosAnteriores.current = pendientes.length;
      setPedidos(todos);
    });
    return () => unsub();
  }, [interactuado]);

  const cambiarEstado = async (id, nuevoEstado) => {
    await updateDoc(doc(db, "pedidos", id), {
      estado: nuevoEstado,
      entregadoHora:
        nuevoEstado === "finalizado" ? new Date().toLocaleTimeString() : null,
    });
  };

  const activos = pedidos.filter(
    (p) => p.estado === "pendiente" || p.estado === "preparando",
  );

  return (
    <div className="cocina-container" onClick={() => setInteractuado(true)}>
      <h1 className="cocina-title">👨‍🍳 COMANDAS</h1>
      <div className="cocina-grid">
        {activos.map((p) => (
          <div key={p.id} className={`comanda-card ${p.estado}`}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <h2>MESA {p.mesa}</h2>
              <span className={`badge-${p.estado}`}>
                {p.estado.toUpperCase()}
              </span>
            </div>
            {p.notas && <div className="nota-cocina">⚠️ {p.notas}</div>}
            <ul className="comanda-lista">
              {p.items?.map((it, i) => (
                <li key={i}>
                  • {it.cantidad}x {it.nombre}
                </li>
              ))}
            </ul>
            <div style={{ display: "flex", gap: "5px" }}>
              {p.estado === "pendiente" && (
                <button
                  className="btn-preparar"
                  onClick={() => cambiarEstado(p.id, "preparando")}
                >
                  EMPEZAR
                </button>
              )}
              <button
                className="btn-listo"
                onClick={() => cambiarEstado(p.id, "finalizado")}
              >
                LISTO
              </button>
            </div>
          </div>
        ))}
      </div>
      <SeccionVentas pedidos={pedidos} />
    </div>
  );
}

// --- COMPONENTE VISTA HISTORIAL ---
function VistaHistorial({ alCerrar }) {
  const [registros, setRegistros] = useState([]);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "historial"), (snapshot) => {
      const docs = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      setRegistros(
        docs.sort((a, b) => new Date(b.fechaCierre) - new Date(a.fechaCierre)),
      );
    });
    return () => unsub();
  }, []);

  return (
    <div
      className="historial-modal"
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        background: "#111",
        zIndex: 3000,
        padding: "20px",
        overflowY: "auto",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "20px",
        }}
      >
        <h1 style={{ color: "#d9ed21" }}>📁 Historial de Ventas</h1>
        <button
          onClick={alCerrar}
          style={{
            background: "#ff4d4d",
            color: "white",
            border: "none",
            padding: "10px 20px",
            borderRadius: "5px",
            fontWeight: "bold",
          }}
        >
          VOLVER
        </button>
      </div>

      {registros.length === 0 ? (
        <p style={{ textAlign: "center", color: "#666" }}>
          No hay registros archivados aún.
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "15px" }}>
          {registros.map((reg) => (
            <div
              key={reg.id}
              style={{
                background: "#222",
                padding: "15px",
                borderRadius: "10px",
                border: "1px solid #333",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  color: "#d9ed21",
                  fontWeight: "bold",
                }}
              >
                <span>📅 {reg.fechaCierre}</span>
                <span>Mesa {reg.mesa}</span>
              </div>
              <ul
                style={{
                  listStyle: "none",
                  padding: "10px 0",
                  margin: 0,
                  color: "#ccc",
                }}
              >
                {reg.items?.map((it, i) => (
                  <li key={i}>
                    • {it.cantidad}x {it.nombre} (${it.total})
                  </li>
                ))}
              </ul>
              <div
                style={{
                  textAlign: "right",
                  borderTop: "1px solid #333",
                  paddingTop: "10px",
                  fontSize: "1.2rem",
                  fontWeight: "bold",
                }}
              >
                Total: ${reg.total}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// --- COMPONENTE PRINCIPAL APP ---
export default function App() {
  const [productos, setProductos] = useState([]);
  const [carrito, setCarrito] = useState([]);
  const [notas, setNotas] = useState("");
  const [verHistorial, setVerHistorial] = useState(false);
  const [vistaCocina, setVistaCocina] = useState(
    () => localStorage.getItem("vista") === "cocina",
  );
  const [ultimoPedidoId, setUltimoPedidoId] = useState(
    localStorage.getItem("ultimoPedidoId"),
  );
  const [estadoPedido, setEstadoPedido] = useState(null);
  const [loginError, setLoginError] = useState(null);

  const [user, setUser] = useState(null);
  const [busqueda, setBusqueda] = useState("");
  const [categoriaSel, setCategoriaSel] = useState("todos");

  const [mesa, setMesa] = useState(() => {
    return new URLSearchParams(window.location.search).get("mesa") || "";
  });

  // NUEVO: Estado para controlar el menú hamburguesa
  const [menuAbierto, setMenuAbierto] = useState(false);

  const esAdmin = user && user.email === "victorhernandezc1991@gmail.com";

  useEffect(() => {
    getRedirectResult(auth)
      .then((result) => {
        if (result) {
          console.log("✅ Login exitoso:", result.user.displayName);
          setLoginError(null);
        }
      })
      .catch((error) => {
        console.error("❌ Error en login con redirect:", error);
        setLoginError(error.message);
      });

    const unsubAuth = onAuthStateChanged(auth, (usuario) => {
      setUser(usuario);
    });
    return () => unsubAuth();
  }, []);

  useEffect(() => {
    localStorage.setItem("vista", vistaCocina ? "cocina" : "menu");
  }, [vistaCocina]);

  useEffect(() => {
    if (!ultimoPedidoId) return;
    const unsub = onSnapshot(doc(db, "pedidos", ultimoPedidoId), (doc) => {
      if (doc.exists()) {
        setEstadoPedido(doc.data().estado);
      } else {
        setEstadoPedido(null);
        setUltimoPedidoId(null);
      }
    });
    return () => unsub();
  }, [ultimoPedidoId]);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "productos"), (s) => {
      setProductos(s.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return () => unsub();
  }, []);

  const login = async () => {
    try {
      setLoginError(null);
      await signInWithPopup(auth, provider);
    } catch (error) {
      setLoginError(error.message);
    }
  };

  const logout = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error("Error al cerrar sesión:", error);
    }
  };

  const agregarAlCarrito = (p, c) =>
    setCarrito([...carrito, { ...p, cantidad: c, total: p.precio * c }]);

  const eliminarProducto = async (id) => {
    if (window.confirm("¿Eliminar del menú para siempre?")) {
      await deleteDoc(doc(db, "productos", id));
    }
  };

  const agregarProducto = async (e) => {
    e.preventDefault();
    const { nombre, precio, foto, categoria } = e.target.elements;
    try {
      await addDoc(collection(db, "productos"), {
        nombre: nombre.value,
        precio: parseFloat(precio.value),
        foto: foto.value,
        categoria: categoria.value,
        disponible: true,
      });
      e.target.reset();
      alert("✅ Producto añadido con éxito");
    } catch (error) {
      alert("❌ Error al añadir el producto");
    }
  };

  const enviarPedido = async () => {
    if (!mesa) return alert("Pon tu mesa");
    const docRef = await addDoc(collection(db, "pedidos"), {
      mesa,
      items: carrito,
      notas,
      total: carrito.reduce((a, i) => a + i.total, 0),
      estado: "pendiente",
      hora: new Date().toLocaleTimeString(),
    });
    setUltimoPedidoId(docRef.id);
    localStorage.setItem("ultimoPedidoId", docRef.id);
    setCarrito([]);
    setNotas("");
    alert("¡Pedido en cocina!");
  };

  const productosFiltrados = productos.filter((p) => {
    const coincideNombre = p.nombre
      .toLowerCase()
      .includes(busqueda.toLowerCase());
    const coincideCategoria =
      categoriaSel === "todos" ||
      p.categoria?.toLowerCase() === categoriaSel.toLowerCase();
    return coincideNombre && coincideCategoria;
  });

  return (
    <>
      {esAdmin && (
        <button
          onClick={() => setVistaCocina(!vistaCocina)}
          className="btn-toggle-vista"
        >
          {vistaCocina ? "📖 Ver Menú" : "👨‍🍳 Ver Cocina"}
        </button>
      )}

      {vistaCocina && esAdmin ? (
        <PanelCocina />
      ) : (
        <div className="menu-container">
          <header className="header">
            <div
              onClick={user ? logout : login}
              className="header-icon"
              style={{ cursor: "pointer" }}
            >
              <img
                src={user ? user.photoURL : "/logo-waves.png"}
                alt="Logo"
                style={{ borderRadius: user ? "50%" : "0" }}
              />
            </div>
            <h1 className="header-title">Waves</h1>
            {user && (
              <p style={{ color: "#d9ed21", fontSize: "0.9rem", margin: 0 }}>
                Logueado como: {user.displayName}
              </p>
            )}
          </header>

          {loginError && (
            <div className="login-error-banner">
              ⚠️ Error de login: {loginError}
            </div>
          )}

          <div style={{ padding: "0 10px", marginBottom: "30px" }}>
            <input
              type="text"
              placeholder="🔍 Buscar plato, bebida, postre..."
              className="input-base search-bar"
              onChange={(e) => setBusqueda(e.target.value)}
            />

            {/* --- BLOQUE DE NAVEGACIÓN ACTUALIZADO --- */}
            <div className="navegacion-categorias">
              {/* BOTÓN HAMBURGUESA: Solo para celulares */}
              <button className="hamburguesa-movil" onClick={() => setMenuAbierto(true)}>
                ☰ Categorías
              </button>

              {/* MENÚ LATERAL: Solo funcional en móviles */}
              <div className={`sidebar-movil ${menuAbierto ? "open" : ""}`}>
                <div className="sidebar-header">
                  <h3>Menú</h3>
                  <button onClick={() => setMenuAbierto(false)}>✕</button>
                </div>
                {["todos", "hamburguesas", "pizzas", "pastas", "bebidas", "postres"].map((cat) => (
                  <button
                    key={cat}
                    className={categoriaSel === cat ? "active" : ""}
                    onClick={() => { setCategoriaSel(cat); setMenuAbierto(false); }}
                  >
                    {cat.toUpperCase()}
                  </button>
                ))}
              </div>

              {/* MENÚ HORIZONTAL: Solo para PC */}
              <div className="categorias-escritorio">
                {["todos", "hamburguesas", "pizzas", "pastas", "bebidas", "postres"].map((cat) => (
                  <button
                    key={cat}
                    className={categoriaSel === cat ? "active" : ""}
                    onClick={() => setCategoriaSel(cat)}
                  >
                    {cat}
                  </button>
                ))}
              </div>

              {menuAbierto && <div className="overlay" onClick={() => setMenuAbierto(false)}></div>}
            </div>
          </div>

          {esAdmin && (
            <div className="admin-actions">
              <button onClick={() => setVerHistorial(true)} className="btn-historial-trigger">
                📂 VER HISTORIAL DE CIERRES
              </button>

              <form onSubmit={agregarProducto} className="form-container">
                <input name="nombre" placeholder="Nombre" required className="input-base" />
                <input name="precio" type="number" placeholder="Precio" required className="input-base" />
                <input name="foto" placeholder="Link imagen" className="input-base" />
                <select name="categoria" className="input-base">
                  <option value="hamburguesas">Hamburguesas</option>
                  <option value="pizzas">Pizzas</option>
                  <option value="pastas">Pastas</option>
                  <option value="bebidas">Bebidas</option>
                  <option value="postres">Postres</option>
                </select>
                <button type="submit" className="btn-submit"> + Añadir </button>
              </form>
            </div>
          )}

          {estadoPedido && (
            <div className={`status-banner ${estadoPedido}`}>
              {estadoPedido === "pendiente" && "⏳ Tu pedido fue recibido"}
              {estadoPedido === "preparando" && "👨‍🍳 ¡En cocina! Se está preparando..."}
              {estadoPedido === "finalizado" && "✅ ¡Pedido listo! Te lo llevamos"}
            </div>
          )}

          <div className="product-list">
            {productosFiltrados.map((p) => (
              <ProductoItem
                key={p.id}
                p={p}
                esAdmin={esAdmin}
                eliminarProducto={eliminarProducto}
                agregarAlCarrito={agregarAlCarrito}
              />
            ))}
            {productosFiltrados.length === 0 && (
              <p style={{ textAlign: "center", width: "100%", color: "#666" }}>
                No se encontraron productos.
              </p>
            )}
          </div>

          <div className="pedido-container">
            <div className="pedido-header">
              <h2>📝 Tu Pedido</h2>
              {carrito.length > 0 && (
                <button
                  className="btn-vaciar"
                  onClick={() => window.confirm("¿Vaciar?") && setCarrito([])}
                >
                  🗑️ Vaciar
                </button>
              )}
            </div>

            {carrito.length === 0 ? (
              <p style={{ textAlign: "center", color: "#666" }}> No has seleccionado nada aún </p>
            ) : (
              <>
                <ul className="carrito-lista">
                  {carrito.map((item, index) => (
                    <li key={index} className="carrito-item">
                      <span><strong>{item.cantidad}x</strong> {item.nombre}</span>
                      <span>
                        <strong>${item.total}</strong>
                        <button
                          className="btn-quitar-item"
                          onClick={() => setCarrito(carrito.filter((_, i) => i !== index))}
                        >✕</button>
                      </span>
                    </li>
                  ))}
                </ul>
                <div style={{ marginTop: "20px" }}>
                  <h3 className="pedido-total">
                    Total: ${carrito.reduce((a, i) => a + i.total, 0)}
                  </h3>
                  <textarea
                    placeholder="Notas..."
                    value={notas}
                    onChange={(e) => setNotas(e.target.value)}
                    className="input-notas"
                  />
                  <input
                    type="number"
                    placeholder="N° de Mesa"
                    value={mesa}
                    onChange={(e) => setMesa(e.target.value)}
                    className="input-mesa"
                  />
                  <button onClick={enviarPedido} className="btn-enviar-cocina">
                    🔔 ENVIAR A COCINA ({carrito.reduce((a, i) => a + i.total, 0)})
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {verHistorial && <VistaHistorial alCerrar={() => setVerHistorial(false)} />}
    </>
  );
}