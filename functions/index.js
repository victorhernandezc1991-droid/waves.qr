// ─── Cloud Functions de Waves ──────────────────────────────────────────────
// Trigger: cuando se crea un nuevo pedido en `comercios/{slug}/pedidos/{id}`,
// le mandamos push notification a todos los tokens FCM guardados para ese
// comercio (= dispositivos de los admins/cocineros que abrieron la app).

const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { setGlobalOptions } = require("firebase-functions/v2");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore }  = require("firebase-admin/firestore");
const { getMessaging }  = require("firebase-admin/messaging");

initializeApp();
setGlobalOptions({ region: "us-central1", maxInstances: 10 });

exports.notificarNuevoPedido = onDocumentCreated(
  "comercios/{slug}/pedidos/{pedidoId}",
  async (event) => {
    const slug   = event.params.slug;
    const pedido = event.data?.data();
    if (!pedido) return;

    // Solo notificamos pedidos nuevos (estado pendiente)
    if (pedido.estado !== "pendiente") return;

    const db = getFirestore();
    const tokensSnap = await db.collection("comercios").doc(slug).collection("fcmTokens").get();
    if (tokensSnap.empty) {
      console.log(`[notificarNuevoPedido] Sin tokens FCM para ${slug}`);
      return;
    }

    const tokens = tokensSnap.docs.map(d => d.data().token).filter(Boolean);
    if (tokens.length === 0) return;

    const titulo = pedido.tipo === "delivery" ? "🛵 Nuevo delivery" : `🔔 Mesa ${pedido.mesa ?? "—"}`;
    const subtitulo = `${(pedido.items || []).length} item${(pedido.items || []).length === 1 ? "" : "s"} · $${(pedido.total || 0).toLocaleString("es-AR")}`;

    const message = {
      notification: { title: titulo, body: subtitulo },
      data: {
        slug,
        pedidoId: event.params.pedidoId,
        url: `/${slug}`,
        numeroOrden: pedido.numeroOrden || "",
      },
      tokens,
    };

    try {
      const result = await getMessaging().sendEachForMulticast(message);
      console.log(`[notificarNuevoPedido] Enviados: ${result.successCount}/${tokens.length}`);

      // Limpiar tokens inválidos
      const tokensInvalidos = [];
      result.responses.forEach((resp, i) => {
        if (!resp.success) {
          const code = resp.error?.code;
          if (code === "messaging/invalid-registration-token" || code === "messaging/registration-token-not-registered") {
            tokensInvalidos.push(tokensSnap.docs[i].id);
          }
        }
      });
      if (tokensInvalidos.length > 0) {
        const batch = db.batch();
        tokensInvalidos.forEach(id => batch.delete(db.collection("comercios").doc(slug).collection("fcmTokens").doc(id)));
        await batch.commit();
        console.log(`[notificarNuevoPedido] Limpiados ${tokensInvalidos.length} tokens inválidos`);
      }
    } catch (err) {
      console.error("[notificarNuevoPedido] Error enviando push:", err);
    }
  }
);
