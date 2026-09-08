# Activar Mostrador y el lector seguro

El codigo de la app y la actualizacion de la base se publican por separado.
Hasta ejecutar el SQL, se conserva la consulta del catalogo, pero las nuevas
escrituras avisan que falta configurar Supabase. No existe un fallback que
descuente stock de manera insegura.

## Activacion

1. En Supabase, abrir el proyecto **pilfeptwylgufhbmmday** (kiosco).
2. Antes de ejecutar, exportar/resguardar la tabla `public.catalogo`.
3. En SQL Editor, ejecutar este diagnostico de codigos repetidos:

```sql
select btrim(ean) as codigo, count(*) as productos, array_agg(uid) as ids
from public.catalogo
where ean is not null and btrim(ean) <> ''
group by btrim(ean) having count(*) > 1;
```

4. Si devuelve filas, revisar esos productos primero. La migracion no elimina
   ni fusiona registros automaticamente y aborta si hay duplicados activos.
5. Ejecutar el archivo `supabase/catalogo-transacciones.sql` completo.
6. Recargar la app en TODOS los equipos para abandonar los clientes anteriores.

La migracion se puede ejecutar nuevamente. Es una transaccion: si falla,
no queda aplicada parcialmente. Solo modifica `catalogo` y crea
`catalogo_operaciones` / `catalogo_aplicar`. No toca pagos, cierres, transferencias
ni los totales de Mercado Pago. No hace cobros ni devoluciones reales.

## Seguridad

La aplicacion representa un unico kiosco y sus cuentas autorizadas comparten el
catalogo. Mantener desactivado el registro publico de usuarios en Supabase Auth;
no usar este esquema para multiples negocios/clientes independientes.
La migracion activa RLS en las dos tablas del catalogo y deniega escrituras
directas a los navegadores. Solo la funcion transaccional puede escribir;
exige usuario autenticado. No cambiar RLS ni permisos de `pagos`.

## Verificacion con datos de prueba

- Un producto con stock 10: registrar 2 unidades deja 8 y un ticket.
- Reintentar la MISMA operacion no debe volver a descontar.
- Una venta con stock insuficiente no guarda ninguna parte del ticket.
- Recibir 3 unidades agrega exactamente 3 al stock conocido.
- Anular un ticket repone las unidades una sola vez y NO devuelve dinero.
- La consulta no modifica stock. Un stock sin controlar sigue siendo nulo.
- Desde otro equipo, los productos se actualizan al abrir Mostrador, volver
  a la ventana y cada 30 segundos mientras la pagina esta visible.

No probar ventas ficticias sobre productos reales. Las pruebas incluidas usan
PostgreSQL en memoria (PGlite) y una interfaz local sin trafico a Supabase:

```text
npm install --no-save --package-lock=false @electric-sql/pglite
node tests/catalogo-db.cjs
node tests/catalogo-client.cjs
node tests/catalogo-preview.cjs
```

## Conexion interrumpida y datos anteriores

Una operacion sin respuesta conserva su identificador y bloquea otras escrituras
hasta usar **Revisar pendiente**. Esto consulta/reintenta la misma transaccion;
no inventa un cobro confirmado. El carrito se conserva al cerrar o recargar.
Las ventas requieren conexion y no forman una cola de ventas offline.

Los cambios locales pendientes de versiones anteriores se respaldan en
`kiosco_catalogo_respaldo_local_v1` en ese navegador. **Revisar cambios locales**
permite revisar y guardar cada producto contra la version actual del servidor.
Nunca se reenvia automaticamente el stock absoluto de un navegador antiguo.
No borrar los datos del navegador si hay operaciones o borradores pendientes.

**Tickets** muestra los ultimos 200 registros de ventas/anulaciones. La base
conserva el historial completo. No se suman estos tickets a los ingresos MP
que ya calcula el dashboard.
