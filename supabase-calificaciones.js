/* ============================================================================
   Propiedad intelectual de PRISMAL MESH. Todos los derechos reservados.

   supabase-calificaciones.js  (FullStatus)

   Publica en Supabase las calificaciones por unidad de cada alumno (1-10), ligadas a su
   matrícula (tabla calificaciones_unidad, la que lee la app FullStatus Student). Cada grupo
   lleva el mínimo para aprobar según su modelo: nuevo = 7 (reprueba con menos de 7) y
   anterior = 8. La regla vive en app.js (CALIF_MINIMA / FullStatusCalifExport).

   - Reutiliza la sesión de supabase-asistencias.js (window.FullStatusSupabase.rpc):
     cargar ESE script antes que este, ambos después de app.js.
   - Offline primero: sin internet o sin sesión no pasa nada; se reintenta al volver
     la conexión o en el siguiente cambio. La fuente de verdad sigue siendo localStorage.
   - Escribe solo con la función RPC `publicar_calificaciones` (ya existe en Supabase; agrega minimo y pts_extra).
   ============================================================================ */
(function () {
  'use strict';

  const CLAVE_ESTADO = 'listaAsistenciaData_v2';
  const CLAVE_CALIF = 'listaAsistenciaCalificaciones_v1';
  const ESPERA_MS = 5000;

  let temporizador = null;
  let subiendo = false;
  let pendiente = false;
  let ultimoEnviado = '';

  function programar() {
    clearTimeout(temporizador);
    temporizador = setTimeout(function () { subir(false); }, ESPERA_MS);
  }

  async function subir(manual) {
    const api = window.FullStatusSupabase;
    if (!api || !api.rpc || typeof window.FullStatusCalifExport !== 'function') return;
    if (subiendo) { pendiente = true; return; }
    if (!navigator.onLine) return; // el evento "online" vuelve a programar

    let payload;
    try { payload = window.FullStatusCalifExport(); } catch (e) { console.warn('[supabase-calificaciones]', e); return; }
    if (!payload.grupos.length) return; // sin grupo a la vista no hay nada que publicar
    const texto = JSON.stringify(payload);
    if (!manual && texto === ultimoEnviado) return;

    subiendo = true;
    try {
      const datos = await api.rpc('publicar_calificaciones', { p_payload: payload });
      if (datos && datos.sinSesion) return; // sin sesión: se publicará al iniciar sesión
      ultimoEnviado = texto;
      window.FullStatusCalifEstado = datos;
      if (datos && datos.sin_match && datos.sin_match.length) {
        console.warn('[supabase-calificaciones] Sin matrícula en Supabase:', datos.sin_match.join(', '));
      }
      if (datos && datos.ambiguos && datos.ambiguos.length) {
        console.warn('[supabase-calificaciones] Nombre repetido en "alumnos":', datos.ambiguos.join(', '));
      }
    } catch (e) {
      if (!(e instanceof TypeError)) console.warn('[supabase-calificaciones] No se pudo publicar:', e.message || e);
    } finally {
      subiendo = false;
      if (pendiente) { pendiente = false; programar(); }
    }
  }

  // Engancha el guardado de app.js sin editarlo (mismo patrón que supabase-asistencias.js).
  const setItemOriginal = Storage.prototype.setItem;
  Storage.prototype.setItem = function (clave) {
    const resultado = setItemOriginal.apply(this, arguments);
    try {
      if (this === window.localStorage && (clave === CLAVE_CALIF || clave === CLAVE_ESTADO)) programar();
    } catch (e) { /* un fallo aquí nunca debe afectar el guardado de la app */ }
    return resultado;
  };

  window.addEventListener('online', programar);
  // Al abrir la app se sube una vez (si ya hay sesión), después de la de asistencias.
  setTimeout(function () { subir(false); }, 4000);

  window.FullStatusCalificacionesSupabase = { subirAhora: function () { return subir(true); } };
})();
