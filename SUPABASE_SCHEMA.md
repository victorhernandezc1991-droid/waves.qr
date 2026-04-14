# Propuesta de Arquitectura: Supabase (PostgreSQL)

Para escalar la aplicación y soportar métricas avanzadas, personalización de publicidad y segmentación de usuarios (como se discutió para "Menú del Día", "20% OFF Primer Compra" y recomendaciones alusivas), se recomienda implementar la siguiente estructura relacional en **Supabase**.

## 1. Tabla `profiles` (Usuarios)
Esta tabla se vincula mediante Foreign Key con `auth.users` de Supabase para mantener la identidad segura y persistir métricas globales del perfil.

| Columna | Tipo | Descripción |
|---|---|---|
| `id` | `uuid` | Primary Key, referencia a `auth.users(id)`. |
| `email` | `text` | Correo electrónico del usuario. |
| `full_name` | `text` | Nombre completo extraído del proveedor (Ej: Google). |
| `orders_count` | `int4` | Default: 0. Contador total de pedidos realizados. Permite identificar al instante si es "First-time user" para aplicar cupones de bienvenida. |
| `last_order_date` | `timestamptz` | Fecha de la última compra para detectar "churn" (usuarios inactivos) y enviar promociones de reactivación. |
| `favorite_category`| `text` | Columna calculada/actualizada mediante trigger (ej: "hamburguesas", "pizzas"). Sirve para la publicidad dinámica. |
| `loyalty_points`| `int4` | Default: 0. Puntos acumulados por cada compra, útil para futuros programas de recompensas. |
| `created_at` | `timestamptz` | Fecha de creación de la cuenta. |

## 2. Tabla `user_metrics` (Preferencias Detalladas)
Opcional, pero muy útil si quieres mantener un desglose fino de comportamientos sin sobrecargar la tabla `profiles`.

| Columna | Tipo | Descripción |
|---|---|---|
| `user_id` | `uuid` | Primary key y Foreign Key -> `profiles(id)`. |
| `top_product_id` | `uuid` | Foreign key -> `products(id)`. El producto más pedido (Ej: "Triple Oklahoma Burger"). |
| `most_active_day` | `int2` | Día de la semana que más frecuenta este usuario (0=Dom, 1=Lun...). Útil para la lógica "Es Martes de Burger". |
| `avg_ticket_size` | `numeric` | Ticket promedio de este usuario. Sirve para hacer cross-selling (sugerir postres si el ticket suele ser bajo). |

## 3. Ejemplo de Función / Vista (RPC)
En lugar de procesar los favoritos en el frontend iterando todos los pedidos (como se hace con Firebase por temas de limitación NoSQL), en Supabase podés crear una vista `user_order_stats`:

```sql
CREATE VIEW user_order_stats AS
SELECT 
  user_id,
  product_id,
  COUNT(*) as times_ordered,
  MAX(created_at) as last_ordered
FROM order_items
GROUP BY user_id, product_id;
```

De esta forma, la App solo debe consultar esta vista o una función de base de datos para obtener al instante el plato favorito del usuario para la **Publicidad Dinámica**.
