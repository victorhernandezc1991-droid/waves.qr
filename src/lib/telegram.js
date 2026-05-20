// ─── Telegram Bot — notificar al admin de pedidos nuevos ─────────────────────
// Reemplaza Cloud Functions FCM. El bot manda un mensaje al admin con los
// detalles del pedido. El admin recibe la notificación nativa de Telegram
// (sonido + vibración + lock-screen alert) en su celular.
//
// Setup: ver SETUP-PUSH.md (renombrar a SETUP-TELEGRAM.md más adelante).

const TOKEN   = import.meta.env.VITE_TELEGRAM_BOT_TOKEN;
const CHAT_ID = import.meta.env.VITE_TELEGRAM_CHAT_ID;

if (!TOKEN || !CHAT_ID) {
  console.warn(
    "[telegram] Faltan VITE_TELEGRAM_BOT_TOKEN o VITE_TELEGRAM_CHAT_ID en .env. " +
    "Las notificaciones al admin no van a funcionar."
  );
}

const EMOJI_TIPO = {
  delivery:   "🛵",
  presencial: "🏪",
  manual:     "✍️",
};

const EMOJI_PAGO = {
  efectivo:    "💵",
  tarjeta:     "💳",
  mercadoPago: "📱",
};

/**
 * Manda una notificación al admin con los detalles del pedido recién creado.
 * No bloquea el flujo: si falla solo loguea warning.
 * Espera un objeto pedido con shape:
 *   { tipo, numeroOrden, total, metodoPago, clienteInfo: {nombre, telefono, direccion?}, items: [{cantidad, nombre}] }
 */
export async function notificarPedidoNuevo(pedido) {
  if (!TOKEN || !CHAT_ID) return;

  const tipoEmoji = EMOJI_TIPO[pedido.tipo] || "🔔";
  const pagoEmoji = EMOJI_PAGO[pedido.metodoPago] || "💳";
  const cliente   = pedido.clienteInfo?.nombre || "—";
  const telefono  = pedido.clienteInfo?.telefono ? `\n📞 ${pedido.clienteInfo.telefono}` : "";
  const direccion = pedido.clienteInfo?.direccion ? `\n📍 ${pedido.clienteInfo.direccion}` : "";

  const items = (pedido.items || [])
    .map(it => `• ${it.cantidad}× ${it.nombre}`)
    .join("\n");

  const text =
    `🔔 *NUEVO PEDIDO ${pedido.numeroOrden || ""}*\n` +
    `${tipoEmoji} *${(pedido.tipo || "").toUpperCase()}* — ${cliente}${telefono}${direccion}\n\n` +
    `${items}\n\n` +
    `💰 *Total: $${(pedido.total || 0).toLocaleString("es-AR")}*\n` +
    `${pagoEmoji} ${pedido.metodoPago || "—"}`;

  try {
    const params = new URLSearchParams({
      chat_id: CHAT_ID,
      text,
      parse_mode: "Markdown",
      disable_web_page_preview: "true",
    });
    const r = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
      method:  "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body:    params.toString(),
    });
    if (!r.ok) {
      const body = await r.text().catch(() => "");
      console.warn(`[telegram] sendMessage ${r.status}: ${body}`);
    }
  } catch (err) {
    console.warn("[telegram] sendMessage falló:", err);
  }
}

/**
 * Notifica una "solicitud de cuenta" (pedir la cuenta en presencial).
 */
export async function notificarPedidoCuenta({ nombreCliente, pedidoId, numeroOrden }) {
  if (!TOKEN || !CHAT_ID) return;
  const text =
    `💵 *PEDIDO DE CUENTA*\n\n` +
    `👤 ${nombreCliente}\n` +
    `🧾 Orden: ${numeroOrden || pedidoId.slice(0, 6)}`;
  try {
    const params = new URLSearchParams({
      chat_id: CHAT_ID, text, parse_mode: "Markdown",
    });
    await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
  } catch (err) {
    console.warn("[telegram] cuenta falló:", err);
  }
}
