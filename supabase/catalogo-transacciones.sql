-- Run once in the Kiosco project's SQL Editor. Does not touch pagos/cierres.
-- All authenticated accounts belong to this single kiosk. Disable public signup.
begin;

create table if not exists public.catalogo (
  uid text primary key, ean text, nombre text not null, marca text,
  presentacion text, categoria text, costo numeric not null default 0,
  precio numeric not null default 0, stock integer,
  imagen text, origen text, updated_at timestamptz not null default now()
);
alter table public.catalogo add column if not exists stock integer;
alter table public.catalogo add column if not exists version bigint not null default 0;
alter table public.catalogo add column if not exists archived_at timestamptz;

-- Abort on ambiguous existing codes; never silently delete/merge merchandise.
create unique index if not exists catalogo_ean_activo_unico
  on public.catalogo (btrim(ean))
  where archived_at is null and ean is not null and btrim(ean) <> '';

create table if not exists public.catalogo_operaciones (
  id uuid primary key,
  tipo text not null check (tipo in ('guardar','archivar','venta','entrada','anular')),
  datos jsonb not null,
  resultado jsonb not null,
  creado_por uuid not null,
  created_at timestamptz not null default now(),
  original_id uuid unique references public.catalogo_operaciones(id)
);
create index if not exists catalogo_operaciones_fecha on public.catalogo_operaciones(created_at desc, id);

alter table public.catalogo enable row level security;
alter table public.catalogo_operaciones enable row level security;
drop policy if exists catalogo_lectura_autenticada on public.catalogo;
create policy catalogo_lectura_autenticada on public.catalogo for select to authenticated using (true);
drop policy if exists catalogo_operaciones_lectura on public.catalogo_operaciones;
create policy catalogo_operaciones_lectura on public.catalogo_operaciones for select to authenticated using (true);
revoke all on public.catalogo, public.catalogo_operaciones from public, anon;
revoke insert, update, delete, truncate, references, trigger on public.catalogo, public.catalogo_operaciones from authenticated;
grant select on public.catalogo, public.catalogo_operaciones to authenticated;

create or replace function public.catalogo_aplicar(p_id uuid, p_tipo text, p_datos jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  anterior public.catalogo_operaciones%rowtype;
  original public.catalogo_operaciones%rowtype;
  producto public.catalogo%rowtype;
  previo public.catalogo%rowtype;
  item jsonb;
  items jsonb;
  lineas jsonb := '[]'::jsonb;
  productos jsonb := '[]'::jsonb;
  resultado jsonb;
  cantidad integer;
  stock_nuevo integer;
  precio_unitario numeric;
  costo_unitario numeric;
  total numeric := 0;
  existe boolean;
  v_uid text;
  codigo text;
  v_original_id uuid;
  fecha timestamptz := now();
begin
  if actor is null then raise sqlstate 'PT401' using message = 'Inicia sesion para modificar el catalogo.'; end if;
  if p_id is null or p_tipo is null or p_datos is null or jsonb_typeof(p_datos) <> 'object' then
    raise sqlstate 'PT400' using message = 'Operacion invalida.';
  end if;
  -- One short transaction at a time for this kiosk, including idempotent retries.
  perform pg_advisory_xact_lock(hashtextextended('kiosco:catalogo:operaciones', 0));
  select * into anterior from public.catalogo_operaciones where id = p_id;
  if found then
    if anterior.tipo <> p_tipo or anterior.datos <> p_datos or anterior.creado_por <> actor then
      raise sqlstate 'PT409' using message = 'Ese numero de operacion ya tiene otros datos.';
    end if;
    return anterior.resultado;
  end if;

  if p_tipo in ('guardar','archivar') then
    v_uid := p_datos->>'uid';
    if v_uid is null or v_uid !~ '^c_[A-Za-z0-9_-]{1,100}$' then
      raise sqlstate 'PT400' using message = 'Identificador de producto invalido.';
    end if;
    select * into previo from public.catalogo where catalogo.uid = v_uid for update;
    existe := found;
    if existe and (previo.archived_at is not null or (p_datos->>'version')::bigint is distinct from previo.version) then
      raise sqlstate 'PT409' using message = 'El producto cambio en otro equipo. Actualiza y revisa antes de guardar.';
    end if;
    if not existe and p_tipo = 'archivar' then
      raise sqlstate 'PT409' using message = 'El producto ya no esta disponible.';
    end if;
    if p_tipo = 'archivar' then
      update public.catalogo set archived_at = fecha, version = version + 1, updated_at = fecha
        where catalogo.uid = v_uid returning * into producto;
    else
      codigo := nullif(btrim(p_datos->>'ean'), '');
      if codigo is not null and codigo !~ '^[0-9]{6,20}$' then
        raise sqlstate 'PT400' using message = 'El codigo debe tener entre 6 y 20 digitos.';
      end if;
      if exists(select 1 from public.catalogo c where btrim(c.ean) = codigo and c.uid <> v_uid and c.archived_at is null) then
        raise sqlstate 'PT409' using message = 'Ese codigo ya pertenece a otro producto.';
      end if;
      precio_unitario := (p_datos->>'precio')::numeric;
      costo_unitario := coalesce((p_datos->>'costo')::numeric, 0);
      if coalesce(length(btrim(p_datos->>'nombre')), 0) not between 1 and 90
        or coalesce(length(btrim(p_datos->>'categoria')), 0) not between 1 and 40
        or precio_unitario is null or precio_unitario <= 0 or precio_unitario > 100000000
        or costo_unitario < 0 or costo_unitario > 100000000 then
        raise sqlstate 'PT400' using message = 'Revisa nombre, categoria, precio y costo.';
      end if;
      stock_nuevo := case when p_datos ? 'stock' then (p_datos->>'stock')::integer else previo.stock end;
      if stock_nuevo < 0 or stock_nuevo > 10000000 then
        raise sqlstate 'PT400' using message = 'Stock invalido.';
      end if;
      insert into public.catalogo as c (uid,ean,nombre,marca,presentacion,categoria,costo,precio,stock,imagen,origen,version,updated_at)
      values (v_uid,codigo,btrim(p_datos->>'nombre'),p_datos->>'marca',p_datos->>'presentacion',btrim(p_datos->>'categoria'),
        round(costo_unitario,2),round(precio_unitario,2),stock_nuevo,
        p_datos->>'imagen',coalesce(p_datos->>'origen','manual'),coalesce(previo.version,0)+1,fecha)
      on conflict (uid) do update set
        ean=excluded.ean,nombre=excluded.nombre,marca=excluded.marca,presentacion=excluded.presentacion,
        categoria=excluded.categoria,costo=excluded.costo,precio=excluded.precio,
        stock=excluded.stock,imagen=excluded.imagen,origen=excluded.origen,version=excluded.version,updated_at=excluded.updated_at
      returning * into producto;
    end if;
    productos := jsonb_build_array(to_jsonb(producto));
    lineas := jsonb_build_array(jsonb_build_object('uid',v_uid,'nombre',producto.nombre,'stock_antes',previo.stock,'stock_despues',producto.stock));
  elsif p_tipo in ('venta','entrada','anular') then
    if p_tipo = 'anular' then
      v_original_id := (p_datos->>'original')::uuid;
      select * into original from public.catalogo_operaciones where id = v_original_id and tipo = 'venta';
      if not found then raise sqlstate 'PT404' using message = 'No se encontro la venta.'; end if;
      if exists(select 1 from public.catalogo_operaciones o where o.original_id = v_original_id) then
        raise sqlstate 'PT409' using message = 'La venta ya fue anulada.';
      end if;
      items := original.resultado->'lineas';
    else
      items := p_datos->'items';
    end if;
    if jsonb_typeof(items) is distinct from 'array' then
      raise sqlstate 'PT400' using message = 'Faltan los productos.';
    end if;
    if jsonb_array_length(items) not between 1 and 200 then
      raise sqlstate 'PT400' using message = 'La operacion debe tener entre 1 y 200 productos.';
    end if;
    if (select count(distinct x->>'uid') from jsonb_array_elements(items) x) <> jsonb_array_length(items) then
      raise sqlstate 'PT400' using message = 'Agrupa las cantidades de cada producto.';
    end if;
    if p_tipo = 'venta' and coalesce(p_datos->>'medio_pago','') not in ('efectivo','mp','point','otro') then
      raise sqlstate 'PT400' using message = 'Elegi la forma de pago.';
    end if;
    for item in select value from jsonb_array_elements(items) loop
      select * into producto from public.catalogo where catalogo.uid = item->>'uid' for update;
      if not found or (producto.archived_at is not null and p_tipo <> 'anular') then
        raise sqlstate 'PT409' using message = 'Un producto ya no esta disponible. Revisa el ticket.';
      end if;
      if coalesce(item->>'cantidad','') !~ '^[0-9]{1,6}$' then
        raise sqlstate 'PT400' using message = 'Cantidad invalida.';
      end if;
      cantidad := (item->>'cantidad')::integer;
      if cantidad < 1 or cantidad > 100000 then raise sqlstate 'PT400' using message = 'Cantidad invalida.'; end if;
      previo := producto;
      precio_unitario := producto.precio;
      if p_tipo = 'venta' then
        if producto.precio is null or producto.precio <= 0 then
          raise sqlstate 'PT409' using message = 'Falta un precio de venta valido para ' || producto.nombre || '.';
        end if;
        if (item->>'precio')::numeric is distinct from producto.precio then
          raise sqlstate 'PT409' using message = 'Cambio un precio. Actualiza el ticket antes de confirmar.';
        end if;
        if producto.stock is not null and producto.stock < cantidad then
          raise sqlstate 'PT409' using message = 'Stock insuficiente: ' || producto.nombre || ' (disponible: ' || producto.stock || ').';
        end if;
        producto.stock := producto.stock - cantidad; -- null means stock is not tracked
      elsif p_tipo = 'entrada' then
        if producto.stock is null then
          raise sqlstate 'PT409' using message = 'Primero carga el stock actual de ' || producto.nombre || '.';
        end if;
        producto.stock := producto.stock + cantidad;
        if item ? 'costo' then
          costo_unitario := (item->>'costo')::numeric;
          if costo_unitario is null or costo_unitario < 0 or costo_unitario > 100000000 then
            raise sqlstate 'PT400' using message = 'Costo invalido.';
          end if;
          producto.costo := round(costo_unitario,2);
        end if;
        precio_unitario := producto.costo;
      else
        precio_unitario := (item->>'precio')::numeric;
        if item->>'stock_antes' is not null then producto.stock := producto.stock + cantidad; end if;
      end if;
      if producto.stock > 10000000 then raise sqlstate 'PT400' using message = 'Stock fuera de rango.'; end if;
      update public.catalogo set stock=producto.stock,costo=producto.costo,version=version+1,updated_at=fecha
        where catalogo.uid=producto.uid returning * into producto;
      productos := productos || jsonb_build_array(to_jsonb(producto));
      lineas := lineas || jsonb_build_array(jsonb_build_object('uid',producto.uid,'nombre',producto.nombre,
        'cantidad',cantidad,'precio',precio_unitario,'costo',producto.costo,'stock_antes',previo.stock,'stock_despues',producto.stock));
      total := total + precio_unitario * cantidad;
    end loop;
  else
    raise sqlstate 'PT400' using message = 'Tipo de operacion invalido.';
  end if;
  resultado := jsonb_build_object('id',p_id,'tipo',p_tipo,'fecha',fecha,'total',round(total,2),
    'medio_pago',case when p_tipo='anular' then original.resultado->>'medio_pago' else p_datos->>'medio_pago' end,
    'original',v_original_id,'lineas',lineas,'productos',productos);
  insert into public.catalogo_operaciones(id,tipo,datos,resultado,creado_por,original_id)
    values(p_id,p_tipo,p_datos,resultado,actor,v_original_id);
  return resultado;
end;
$$;
revoke all on function public.catalogo_aplicar(uuid,text,jsonb) from public, anon;
grant execute on function public.catalogo_aplicar(uuid,text,jsonb) to authenticated;
notify pgrst, 'reload schema';
commit;
