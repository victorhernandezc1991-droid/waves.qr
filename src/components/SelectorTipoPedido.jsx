// ─── Selector de tipo de pedido ──────────────────────────────────────────────
// Se muestra ANTES del menú para que el cliente elija si pide delivery o
// presencial. Si el local está CERRADO en config/local.estado, se reemplaza
// por una pantalla "Volvemos pronto" sin botones.

const DIAS_ES = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

function horarioHoy(configLocal) {
  if (!configLocal?.horarios) return null;
  const hoy = DIAS_ES[new Date().getDay()];
  return configLocal.horarios[hoy] || null;
}

export default function SelectorTipoPedido({ configLocal, logoUrl, nombre, onSelect }) {
  const cerrado = configLocal?.estado === "CERRADO";
  const h = horarioHoy(configLocal);

  return (
    <div className="selector-tipo-container">
      {/* Logo + nombre */}
      <div className="selector-tipo-header">
        {logoUrl && (
          <div className="selector-tipo-logo">
            <img src={logoUrl} alt={`Logo de ${nombre || "comercio"}`} />
          </div>
        )}
        {nombre && (
          <h1 className="selector-tipo-nombre">
            {(() => {
              const partes = (nombre || "").trim().split(/\s+/);
              if (partes.length < 2) return <span className="drawer-brand-first">{nombre}</span>;
              return (
                <>
                  <span className="drawer-brand-first">{partes[0]}</span>{" "}
                  <span className="drawer-brand-rest">{partes.slice(1).join(" ")}</span>
                </>
              );
            })()}
          </h1>
        )}
      </div>

      {cerrado ? (
        <div className="selector-tipo-cerrado" role="status">
          <span className="selector-tipo-cerrado-icon">🚧</span>
          <h2 className="selector-tipo-cerrado-titulo">Volvemos pronto</h2>
          <p className="selector-tipo-cerrado-texto">
            El local está cerrado en este momento. No podemos tomar pedidos.
          </p>
          {h && !h.cerrado && (
            <p className="selector-tipo-cerrado-horarios">
              Horarios de hoy: <strong>{h.apertura} — {h.cierre}</strong>
            </p>
          )}
          {configLocal?.telefono && (
            <p className="selector-tipo-cerrado-tel">
              📞 {configLocal.telefono}
            </p>
          )}
        </div>
      ) : (
        <>
          <p className="selector-tipo-pregunta">¿Cómo querés hacer tu pedido?</p>
          <div className="selector-tipo-opciones">
            <button
              type="button"
              className="selector-tipo-btn selector-tipo-btn-delivery"
              onClick={() => onSelect("delivery")}
            >
              <span className="selector-tipo-btn-icon">🛵</span>
              <span className="selector-tipo-btn-titulo">Pedir para delivery</span>
              <span className="selector-tipo-btn-sub">Te lo llevamos a tu casa</span>
            </button>
            <button
              type="button"
              className="selector-tipo-btn selector-tipo-btn-presencial"
              onClick={() => onSelect("presencial")}
            >
              <span className="selector-tipo-btn-icon">🏪</span>
              <span className="selector-tipo-btn-titulo">Pedir en el local</span>
              <span className="selector-tipo-btn-sub">Estás acá adentro</span>
            </button>
          </div>
        </>
      )}
    </div>
  );
}
