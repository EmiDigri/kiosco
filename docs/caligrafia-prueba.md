# Prueba de caligrafia

Este piloto NO modifica `/api/cierre-foto` ni activa memoria visual en la lectura diaria.
No entrena un modelo: compara la transcripcion de un recorte sin ejemplos contra la
misma tarea con hasta dos ejemplos verificados de la misma persona y tipo.

## Uso

1. Abrir Cierre manual > Caligrafia - prueba. Elegir una foto ya revisada.
2. Indicar quien escribio el recorte (no necesariamente quien cubrio el turno),
   fecha de la hoja, e importe o nombre. Seleccionar una sola celda con el recortador.
3. Escribir su transcripcion exacta, verificarla y guardar el ejemplo. No usa IA.
4. Elegir un recorte de OTRA FECHA, de la misma persona y tipo, y su respuesta correcta.
5. Autorizar explicitamente dos consultas y pulsar Comparar. La respuesta correcta
   del objetivo nunca se envia al modelo. El resultado muestra ambas lecturas,
   aciertos y tokens informados por la API.

Usar ejemplos de distintos digitos y nombres. No mezclar letras de suplentes.
Mantener las hojas de evaluacion fuera de los ejemplos. Excluimos del contexto
la misma fecha, el mismo archivo y el mismo recorte. Una buena lectura aislada no
demuestra que el sistema mejoro. Medir hojas no usadas como ejemplos y no quedarse
solo con los resultados favorables. No hay activacion automatica del piloto.

## Costos y privacidad

- Guardar, listar, borrar ejemplos y consultar resultados no llama a Anthropic.
- Cada comparacion autorizada hace hasta dos llamadas con el mismo modelo que el
  lector actual (`ANTHROPIC_MODEL`, o su valor predeterminado). Sin reintentos automaticos.
- Limite de piloto: 8 comparaciones por dia UTC, 30 ejemplos; los listados de
  resultados muestran los ultimos 20. No es un limite de facturacion global.
- Los ejemplos conservan solo recortes JPEG de hasta 720 x 360 px en el cliente,
  hasta 100000 caracteres base64 por ejemplo. No se copia la foto completa al piloto.
- Bucket nuevo `caligrafia-prueba`, privado, creado por el servidor al primer uso.
  Utiliza las mismas variables privadas de Supabase y Anthropic que la app.
  No requiere SQL ni una clave nueva. No habilitar acceso publico al bucket.
- Los usuarios autenticados del proyecto comparten ejemplos y resultados.
  El propietario puede borrar un ejemplo desde la interfaz. Los resultados retienen
  transcripciones y hashes, pero no la foto objetivo. Para vaciar todo el piloto,
  eliminar los objetos del bucket privado desde Supabase.
- Identificador inmutable por comparacion: el servidor reserva la prueba ANTES de
  llamar a la IA. Reenviar el mismo ID devuelve el estado, nunca repite los cargos.
  Un corte puede dejarla pendiente; no se reejecuta por consultarla.
- Si se repite un recorte de evaluacion, el resumen cuenta solo la ultima prueba
  completa de ese archivo/recorte. Los resultados no son metricas financieras.

## Verificacion

`node tests/caligrafia.cjs`: API aislada con Storage y Anthropic simulados.

`node tests/caligrafia-browser.cjs`: interfaz en Edge, escritorio y mobile,
con API simulada y sin gastos de IA ni escrituras de produccion.

Cropper.js 1.6.2 y los iconos Lucide 0.468.0 se distribuyen localmente en `vendor/`
con sus licencias MIT/ISC. El recortador se carga solo al abrir la prueba.

Referencias: [vision e imagenes multiples de Claude](https://platform.claude.com/docs/en/build-with-claude/vision),
[Cropper.js](https://github.com/fengyuanchen/cropperjs/tree/v1.6.2) y
[buckets privados de Supabase](https://supabase.com/docs/guides/storage/buckets/fundamentals).
