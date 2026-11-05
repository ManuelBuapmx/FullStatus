/* ============================================================================
   Propiedad intelectual de PRISMAL MESH. Todos los derechos reservados.

   supabase-calificaciones.js  (FullStatus)

   Publica en Supabase las calificaciones por unidad de cada alumno (1-10), con el
   modelo del grupo y si aprueba: modelo nuevo reprueba con menos de 7; modelo
   anterior, con menos de 8. La regla vive en app.js (FullStatusCalifExport).

   - Reutiliza la sesión de supabase-asistencias.js (window.FullStatusSupabase.rpc):
     cargar ESE script antes que este, ambos después de app.js.
   - Offline primero: sin internet o sin sesión no pasa nada; se reintenta al volver
     la conexión o en el siguiente cambio. La fuente de verdad sigue siendo localStorage.
   - Escribe solo con la función RPC `publicar_calificaciones` (ver supabase_calificaciones.sql).
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

    let grupos;
    try { grupos = window.FullStatusCalifExport(); } catch (e) { console.warn('[supabase-calificaciones]', e); return; }
    const payload = { grupos: grupos };
    const texto = JSON.stringify(payload);
    if (!manual && texto === ultimoEnviado) return;

    subiendo = true;
    try {
      const datos = await api.rpc('publicar_calificaciones', { p_payload: payload });
      if (datos && datos.sinSesion) return; // sin sesión: se publicará al iniciar sesión
      ultimoEnviado = texto;
      window.FullStatusCalifEstado = datos;
      if (datos && datos.sin_matricula && datos.sin_matricula.length) {
        console.warn('[supabase-calificaciones] Sin matrícula en Supabase:', datos.sin_matricula.join(', '));
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
