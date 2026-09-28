-- Clientes de Mercado Pago (clientes-mp.js, 28/9/2026): quién pagó cada cobro, tomado del
-- reporte "Todas las transacciones" que se sube a fin de mes. pago_id = SOURCE_ID del reporte
-- = pagos.pago_id. Tabla aparte: no toca pagos ni cierres. Solo usuarios con sesión (el
-- kiosco) pueden leer y escribir.
create table if not exists public.mp_pagadores (
  pago_id text primary key,
  nombre text not null,
  fecha date not null,
  hora text,
  monto numeric(14,2) not null,
  devuelto boolean not null default false,
  cargado_en timestamptz not null default now()
);
create index if not exists mp_pagadores_fecha_idx on public.mp_pagadores (fecha);

alter table public.mp_pagadores enable row level security;
drop policy if exists kiosco_auth on public.mp_pagadores;
create policy kiosco_auth on public.mp_pagadores for all to authenticated using (true) with check (true);
