# Setup de Push Notifications (FCM)

Las push notifications ya están integradas en el código pero necesitan dos pasos manuales para activarse de punta a punta.

## 1. VAPID key — para que el navegador se pueda suscribir

Sin la VAPID key el cliente no puede pedirle un token a Firebase y el código falla silenciosamente con un warning en consola.

1. Entrar a https://console.firebase.google.com/project/waves-qr1/settings/cloudmessaging
2. Bajar a la sección **Web Push certificates**
3. Si no hay ninguno, hacer click en **Generate key pair**
4. Copiar el "Key pair" (la string larga que empieza con `B...`)
5. Pegarla en `.env`:
   ```
   VITE_FIREBASE_VAPID_KEY=B...
   ```
6. Re-buildear y deployar:
   ```
   npm run build
   npx firebase deploy --only hosting
   ```

Después de esto, cuando el admin entre a Cocina:
- El navegador pide permiso de notificaciones
- Se obtiene un token FCM
- El token se guarda en `comercios/waves/fcmTokens/{hash}` en Firestore

Podés verificar en la Firebase Console > Firestore que aparezca el documento.

## 2. Cloud Function — para mandar la push automáticamente

El código de la Function ya está en `functions/index.js`. El deploy falla con plan Spark (gratis) porque las Functions de 2da generación requieren **plan Blaze** (pay-as-you-go con cuota gratuita).

Pasos para activar:

1. Entrar a https://console.firebase.google.com/project/waves-qr1/usage/details
2. Click en **Modify plan** → seleccionar **Blaze**
3. Asociar una tarjeta. La cuota gratuita mensual cubre fácil ~125k invocaciones, no vas a pagar nada hasta llegar a esos volúmenes.
4. Una vez en Blaze, deployar:
   ```
   cd functions && npm install && cd ..
   npx firebase deploy --only functions
   ```

La Function `notificarNuevoPedido` se va a disparar cada vez que se crea un documento en `comercios/{slug}/pedidos/{id}` con `estado === "pendiente"`.

Manda push a todos los tokens FCM guardados de ese comercio.

## Probar push end-to-end

1. Abrir la app en Chrome/Edge en una computadora
2. Login con admin → entrar a Cocina (la primera vez te pide permiso de notificaciones)
3. Verificar en Firestore que aparezca `comercios/waves/fcmTokens/{hash}` con tu token
4. Cerrar la pestaña (o ponerla en background)
5. En otra computadora/celular, sin login, hacer un pedido
6. La PC original debe recibir una notificación nativa con el número de mesa

## Limpieza de tokens

La Function limpia automáticamente los tokens que devuelven `messaging/registration-token-not-registered` (cuando el usuario revoca el permiso o desinstala la PWA). No tenés que mantener nada.

## Sin Blaze: alternativa parcial

Si no querés activar Blaze ahora, la app sigue funcionando con notificaciones **sólo cuando la pestaña está abierta**:
- En Cocina, cuando llega un pedido nuevo y la pestaña no tiene foco, suena el audio + se muestra una notificación nativa (esto NO usa FCM, es la API `Notification` directa).
- Sin FCM, no hay push si el navegador está cerrado.
