# Plan de mejoras — mi-catalogo-qr (Waves QR)

## Context

Este proyecto es una app multi-tenant de pedidos para restaurantes (React + Vite + Firebase + Cloudinary). El código local fue reconstruido por ingeniería inversa del bundle de producción (`/tmp/prod.js`), así que tiene gaps tanto de paridad como de calidad. Auditoría reveló 25+ items de mejora cruzando seguridad, paridad con producción, calidad y performance.

El usuario eligió plan grande (1-2 días) cubriendo las 4 áreas. Orden de ejecución: checkpoint primero (backup del plan + commit del estado actual) → seguridad → calidad → paridad → performance.

---

## Fase 0 — Checkpoint de seguridad

### 0.1 Copiar plan a directorio del proyecto
Copiar `C:\Users\E47\.claude\plans\haz-un-plan-de-inherited-twilight.md` → `C:\Users\E47\mi-catalogo-qr\PLAN-MEJORAS.md` para que quede versionado junto al código.

### 0.2 Verificar estado limpio en git
```
cd C:\Users\E47\mi-catalogo-qr
git status   # debe mostrar "nothing to commit"
git log --oneline -5  # confirmar último commit
```

### 0.3 Commit checkpoint con el plan
```
git add PLAN-MEJORAS.md
git commit -m "docs: snapshot plan de mejoras antes de implementación"
```
Este commit deja una marca clara en el árbol: "última versión funcional antes de cambios". Si algo se rompe en las fases siguientes, podemos volver a este SHA con `git reset --hard <sha>`.

### 0.4 (Opcional) Crear branch defensiva
```
git branch backup-pre-mejoras   # branch que apunta al checkpoint
```
Sin checkout — solo deja una etiqueta para volver fácil.

### 0.5 `git push origin main`
Subir todo (commits previos + checkpoint) a GitHub para tener respaldo remoto antes de empezar.

---

## Fase 1 — Seguridad crítica

### 1.1 `firestore.rules` — Reglas con `ownerUid` real
Las reglas actuales permiten que cualquier usuario logueado escriba a CUALQUIER comercio. Hay que verificar contra `comercios/{slug}.ownerUid`.

```
match /comercios/{slug} {
  allow read: if true;
  allow write: if request.auth != null && request.auth.uid == resource.data.ownerUid;
  allow create: if request.auth != null;

  match /productos/{docId} {
    allow read: if true;
    allow write: if isOwner(slug);
  }
  match /pedidos/{docId} {
    allow read: if true;                  // status tracking
    allow create: if true;                // anónimo permitido (cliente en mesa)
    allow update, delete: if isOwner(slug);
  }
  match /llamadasMozo/{docId} {
    allow create: if true;
    allow read, update, delete: if isOwner(slug);
  }
  // ... etc
}

function isOwner(slug) {
  return request.auth != null
    && request.auth.uid == get(/databases/$(database)/documents/comercios/$(slug)).data.ownerUid;
}
```
- Eliminar las reglas legacy planas (`/productos`, `/pedidos`, etc.) — ya migramos a `comercios/{slug}/...`
- Re-deploy con `npx firebase deploy --only firestore:rules`

### 1.2 `src/components/ImageUpload.jsx` — Quitar fallback hardcoded
```diff
- const CLOUDINARY_CLOUD_NAME = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME || "dtsustj3q";
- const CLOUDINARY_UPLOAD_PRESET = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET || "presetwaves";
+ const CLOUDINARY_CLOUD_NAME = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME;
+ const CLOUDINARY_UPLOAD_PRESET = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET;
```
Mover los valores reales al `.env`. Lanzar error claro si falta config.

### 1.3 `src/App.jsx:31` — Sanitización XSS
Reemplazar `sanitize` por una versión más robusta (sin agregar dependencia de DOMPurify, vale con regex más estricta):
```js
const sanitize = s => String(s ?? "")
  .trim()
  .replace(/[<>"'`\\]/g, "")        // strip HTML/JS metachars
  .replace(/javascript:/gi, "")
  .slice(0, MAX_NOMBRE);
```

---

## Fase 2 — Calidad y robustez

### 2.1 Crear `.env.example`
```
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
VITE_CLOUDINARY_CLOUD_NAME=
VITE_CLOUDINARY_UPLOAD_PRESET=
```

### 2.2 `src/components/ErrorBoundary.jsx` — Wrapper global
Componente que captura errores de render y muestra una UI fallback en vez de pantalla en blanco. Wrappear `<App />` en `main.jsx`.

### 2.3 Cleanup de listeners — Auditoría rápida
Verificar que TODOS los `onSnapshot` retornen `unsub` correctamente. Casos a revisar:
- `src/App.jsx:281-291` (productos, menuDelDia, configLocal, metricsUsuario, ultimoPedido)
- `src/components/CocinaAdmin.jsx:42-60` (pedidos, llamadasMozo)
- `src/components/CierreCaja.jsx:23-31` (pedidos)
- `src/components/StockManager.jsx:8-13`
- `src/components/ConfigLocal.jsx:62-79`

### 2.4 Mejor manejo de errores
Reemplazar `catch { addToast("Error.", "error") }` (que oculta diagnóstico) por:
```js
catch (err) {
  console.error("[enviarPedido]", err);
  addToast(err?.message || "Error al enviar pedido.", "error");
}
```

### 2.5 Accesibilidad — Quick wins
- `<img>` con `alt` descriptivo (no genérico "Logo" o "Preview")
- `aria-label` en botones-only-icon (`btn-theme-toggle`, `btn-cocina-quick`, `btn-floating-add`)
- `aria-pressed` en toggles (categorías, métodos de pago, estado abierto/cerrado)
- `role="dialog"` y `aria-modal="true"` en `confirmacion-overlay` y drawer

---

## Fase 3 — Paridad con producción

### 3.1 Sequential order numbering (`comercios/{slug}/config/contadores`)
Reemplazar `numOrden()` (random) por una transacción Firestore que incrementa `ultimaOrden` y reinicia diariamente. Lugar: `enviarPedido` en `App.jsx:342`.

```js
const { runTransaction, doc, getDoc } = await import("firebase/firestore");
const counterRef = doc(db, "comercios", slug, "config", "contadores");
let nuevoNum;
await runTransaction(db, async (tx) => {
  const snap = await tx.get(counterRef);
  const fechaHoy = new Date().toLocaleDateString("es-AR");
  const data = snap.exists() ? snap.data() : {};
  if (data.fecha !== fechaHoy) nuevoNum = 1;
  else nuevoNum = (data.ultimaOrden || 0) + 1;
  tx.set(counterRef, { ultimaOrden: nuevoNum, fecha: fechaHoy }, { merge: true });
});
const nOrden = `W-${String(nuevoNum).padStart(4, "0")}`;
```

### 3.2 Validación de stock en carrito y al enviar
- En `agregarAlCarrito` (`App.jsx:319`): bloquear si `p.stock != null && p.stock <= 0` o si en carrito ya alcanza `stock`.
- En `enviarPedido`: dentro de la transacción, leer cada producto y verificar stock antes de crear el pedido. Si falla, abortar con toast: `Sin stock: {nombre}`.
- También decrementar stock dentro de la transacción.

### 3.3 Soporte de delivery
Cuando `configLocal.estado === "CERRADO"`:
- En vez de `mesa`, mostrar form con `nombre`, `dirección`, `teléfono`.
- Validar que `whatsapp` del comercio exista (si no, mostrar warning).
- El pedido se guarda con `tipo: "delivery"` y `deliveryInfo: {nombre, direccion, telefono}` en lugar de `mesa`.
- Banner `banner-local-cerrado` arriba del menú.
- En `CocinaAdmin`, mostrar "🛵 DELIVERY" en lugar de "MESA N" cuando aplica.

### 3.4 Campo descripción en productos
- Form admin: `<textarea name="descripcion" />` (opcional).
- Tarjeta: mostrar `descripción` debajo del nombre si existe (estilo `product-description`).
- Persistir en Firestore.

### 3.5 Banner de pedido (mesa no identificada / sin conexión)
- Si `mesaInvalidaEnURL && user && !esAdmin && !esDelivery`: banner amarillo "⚠️ Mesa no identificada. Escaneá el QR de la mesa."
- Si fallaron las consultas (state `errorConexion`): banner naranja "📡 Sin conexión. Reintentando..."

### 3.6 Banner de promos por favoritos
Después del banner del 15% OFF, agregar:
```jsx
{metricasUsuario.favorite?.includes("burger") && new Date().getDay() !== 4 && (
  <div className="promo-banner ad-banner">🍔 ¡Día de Burger! Aprovechá para pedir tu favorita.</div>
)}
{metricasUsuario.favorite?.includes("pizza") && new Date().getDay() !== 2 && (
  <div className="promo-banner ad-banner">🍕 Antojo de Pizza: Sabemos que te encanta, ¡pedila ahora!</div>
)}
```

### 3.7 `cartId` único en items del carrito
```diff
- return [...prev, { ...p, cantidad: cant, total: p.precio * cant }];
+ return [...prev, { ...p, cartId: `${p.id}-${Date.now()}`, cantidad: cant, total: p.precio * cant }];
```
Usar `cartId` como `key` en el render del carrito (en vez de índice).

### 3.8 Barcode en ticket de confirmación
- Instalar `jsbarcode`: `npm i jsbarcode`
- En el modal de confirmación, agregar `<canvas ref={barcodeRef} />`
- `useEffect` que llame `JsBarcode(barcodeRef.current, datosConfirmacion.numeroOrden, { format: "CODE128", lineColor: "#000", width: 2, height: 50, displayValue: false })`
- Aplicar estilos `ticket-termico` (fondo blanco, texto negro)

### 3.9 Polish del banner "15% OFF" para usuarios no logueados
Estilo más rico con gradient + backdrop-filter (lo tenía producción):
```css
.promo-banner.new-user-banner-fancy {
  background: linear-gradient(135deg, rgba(43,127,255,.9), rgba(26,106,224,.9));
  backdrop-filter: blur(10px);
  box-shadow: 0 8px 24px rgba(43,127,255,.3);
}
```

---

## Fase 4 — Performance

### 4.1 Memoización en hot paths (`src/App.jsx`)
```js
const productosFiltrados = useMemo(
  () => productos.filter(p => { /* ... */ }),
  [productos, busqueda, categoriaSel]
);
const subtotalCarrito = useMemo(() => carrito.reduce(...), [carrito]);
```

### 4.2 `useCallback` en handlers que se pasan a hijos
- `agregarAlCarrito`, `eliminarProducto`, `agregarProducto`
- Sin esto cada re-render de App causa re-render de cada `ProductoItem`.

### 4.3 `React.memo` en `ProductoItem`
```js
export default React.memo(ProductoItem, (prev, next) =>
  prev.p.id === next.p.id &&
  prev.p.disponible === next.p.disponible &&
  prev.p.stock === next.p.stock &&
  prev.p.foto === next.p.foto &&
  prev.p.precio === next.p.precio
);
```

### 4.4 `vite.config.js` — Manual chunks
Reducir el chunk principal (618KB):
```js
build: {
  rollupOptions: {
    output: {
      manualChunks: {
        firebase: ['firebase/app', 'firebase/firestore', 'firebase/auth'],
        react: ['react', 'react-dom', 'react-router-dom'],
      },
    },
  },
},
```

### 4.5 Lazy-load `ImageUpload`
Solo lo usa el admin. `lazy(() => import('./components/ImageUpload.jsx'))` y wrappear con `<Suspense>` donde se usa.

---

## Archivos críticos a modificar

- `firestore.rules` (Fase 1.1)
- `src/components/ImageUpload.jsx` (1.2, 4.5)
- `src/App.jsx` (1.3, 2.3, 2.4, 2.5, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 4.1, 4.2)
- `src/components/CocinaAdmin.jsx` (2.3, 3.3 — soporte delivery en comandas)
- `src/components/CierreCaja.jsx` (2.3, 2.4)
- `src/components/StockManager.jsx` (2.3)
- `src/components/ConfigLocal.jsx` (2.3, 2.4)
- `src/components/ErrorBoundary.jsx` (NEW — Fase 2.2)
- `src/main.jsx` (envolver con ErrorBoundary)
- `src/App.css` (3.5, 3.6, 3.9 — nuevos banners y estilos delivery)
- `vite.config.js` (4.4)
- `.env.example` (NEW — 2.1)
- `package.json` (3.8 — agregar jsbarcode)

---

## Funciones / utilidades existentes a reusar

- `sanitize`, `validarPrecio`, `validarMesa`, `esURLSegura` en `App.jsx:30-35`
- `useToast` / `ToastContainer` en `App.jsx:38-50`
- `useComercio` hook en `App.jsx:54-77`
- `compressImage`, `uploadToCloudinary` en `ImageUpload.jsx:7-44`
- `filtrarPorTurno` en `src/lib/utils.js`
- Lazy-loading patrón ya implementado para `CocinaAdmin`, `CierreCaja`, etc. — usar el mismo para `ImageUpload`

---

## Verificación end-to-end

Después de cada fase, ejecutar:

1. **Build limpio**: `cd C:\Users\E47\mi-catalogo-qr && npm run build` → debe pasar sin errores
2. **Dev server local**: `npm run dev` → abrir `http://localhost:5173/waves`
3. **Reglas Firestore desplegadas**: `npx firebase deploy --only firestore:rules --project waves-qr1`

### Casos de prueba específicos:

**Fase 1 (seguridad):**
- Sin login: navegar productos ✅, agregar producto ❌ (debe fallar)
- Con login NO admin: agregar producto ❌ (debe fallar por reglas)
- Con login admin: agregar producto ✅, modificar config ✅
- Probar `<script>alert(1)</script>` en nombre de producto → no debe ejecutarse ni almacenarse

**Fase 2 (calidad):**
- Tirar un error a propósito (ej: `throw new Error("test")` en algún componente) → ErrorBoundary muestra UI, no pantalla negra
- Tab nav por la app — todos los botones accesibles con teclado
- `git clone` simulado: verificar que `.env.example` documenta todas las vars

**Fase 3 (paridad):**
- Crear pedido → número debe ser secuencial (`W-0001`, `W-0002` mismo día, reinicia al día siguiente)
- Modal de confirmación muestra barcode CODE128 escaneable
- Bajar stock de producto a 0 → no debe poder agregarse al carrito
- Cerrar local desde Configuración → menú principal muestra form de delivery (nombre/dirección/teléfono) en vez de mesa
- Pedido delivery aparece en `CocinaAdmin` como "🛵 DELIVERY" con dirección visible
- Login con nuevo user → ver banner 15% OFF con estilo gradient
- Hacer 3 pedidos de hamburguesa → banner "Día de Burger" debe aparecer (excepto jueves)

**Fase 4 (performance):**
- Build → ver que el chunk principal bajó de ~618KB a algo menor (objetivo: <450KB)
- React DevTools Profiler → al cambiar cantidad en un producto, solo ese `ProductoItem` re-renderiza
- Lighthouse mobile → ganar puntos en "Reduce JavaScript execution time"

### Final: commit y deploy
- Commit por fase con mensajes descriptivos
- `git push origin main` cuando todas las fases pasen
- Deploy de reglas: `npx firebase deploy --only firestore:rules`

### Si algo se rompe
Volver al checkpoint creado en Fase 0:
```
git reset --hard backup-pre-mejoras   # rama defensiva creada en 0.4
# o
git log --oneline | grep "snapshot plan" # buscar el SHA y reset --hard a él
```
