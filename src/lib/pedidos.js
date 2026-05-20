// ─── Helpers compartidos sobre la entidad Pedido ─────────────────────────────

/**
 * Devuelve el título corto del pedido para mostrar en CocinaAdmin / CierreCaja.
 * Reemplaza el viejo "Mesa N" por algo descriptivo según el tipo.
 */
export function tituloPedido(p) {
  const cliente = p.clienteInfo?.nombre || p.deliveryInfo?.nombre || "";
  if (p.tipo === "delivery")   return `🛵 Delivery — ${cliente}`;
  if (p.tipo === "presencial") return `🏪 Presencial — ${cliente}`;
  if (p.tipo === "manual")     return `✍️ Manual — ${cliente}`;
  // Fallback legacy: pedidos viejos (waves-qr1) que todavía tengan p.mesa
  if (p.mesa != null) return `🍽️ Mesa ${p.mesa}`;
  return cliente ? `🔔 ${cliente}` : "🔔 Pedido";
}

/**
 * Etiqueta corta para CSV / historial. Sin emoji, más limpia.
 */
export function etiquetaPedido(p) {
  const cliente = p.clienteInfo?.nombre || p.deliveryInfo?.nombre || "";
  if (p.tipo === "delivery")   return `Delivery — ${cliente}`;
  if (p.tipo === "presencial") return `Presencial — ${cliente}`;
  if (p.tipo === "manual")     return `Manual — ${cliente}`;
  if (p.mesa != null) return `Mesa ${p.mesa}`;
  return cliente || "Pedido";
}
