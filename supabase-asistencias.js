/* ============================================================================
   Propiedad intelectual de PRISMAL MESH. Todos los derechos reservados.

   supabase-asistencias.js  (FullStatus)

   Publica las asistencias de FullStatus en Supabase para que cada alumno las
   consulte desde la app FullStatus Student.

   Cómo funciona:
   - Lee el estado local (`localStorage.listaAsistenciaData_v2`), que sigue
     siendo la fuente de verdad. NO cambia el modelo de datos ni el Excel.
   - Cada vez que app.js guarda ese estado, programa una subida (con espera de
     unos segundos para juntar varios cambios en una sola).
   - Offline primero: si no hay internet o sesión, NO pasa nada malo; se
     reintenta cuando vuelve la conexión o en el siguiente cambio.
   - Se identifica como admin con correo y contraseña de Supabase (los mismos
     de admin.html). Solo se guarda el token de renovación, nunca la contraseña.
   - Escribe SOLO mediante la función RPC `publicar_asistencias`, que comprueba
     en el servidor que seas admin (ver supabase_asistencias.sql).

   Instalación: ver README (agregar <script src="supabase-asistencias.js"> en
   index.html DESPUÉS de app.js y correr `npm run sync:www`).
   ============================================================================ */
(function () {
  'use strict';

  // --- Configuración -------------------------------------------------------
  // La clave anon es pública por diseño (la seguridad real está en las políticas
  // y funciones de Supabase). NUNCA poner aquí la Secret key (service_role).
  const SUPABASE_URL = 'https://TU-PROYECTO.supabase.co';
  const SUPABASE_ANON_KEY = 'TU_CLAVE_ANON_PUBLICA';

  // Claves de localStorage. La primera es la de app.js (no cambiarla).
  const CLAVE_ESTADO = 'listaAsistenciaData_v2';
  const CLAVE_AUTH = 'fullstatusSupabaseAuth_v1';

  // Espera antes de subir tras un cambio: así tomar lista de 30 alumnos no
  // dispara 30 subidas, solo una al terminar.
  const ESPERA_MS = 5000;

  // Si no se rellenó la configuración, el módulo se queda apagado sin romper nada.
  const configurado = !/TU-PROYECTO|TU_CLAVE/.test(SUPABASE_URL + SUPABASE_ANON_KEY);
  if (!configurado) {
    console.warn('[supabase-asistencias] Falta configurar SUPABASE_URL y SUPABASE_ANON_KEY.');
    return;
  }

  // --- Estado interno ------------------------------------------------------
  let sesion = null;          // { access_token, refresh_token, expira }
  let subiendo = false;       // evita dos subidas simultáneas
  let pendiente = false;      // hubo cambios mientras se subía
  let temporizador = null;    // debounce
  let ultimoEnviado = '';     // evita reenviar exactamente lo mismo
  const info = { estado: 'sin sesión', registros: 0, sinMatch: [], ambiguos: [], error: '' };

  // ==========================================================================
  // Construcción del envío a partir del estado local
  // ==========================================================================

  // Convierte el estado de FullStatus a lo que espera `publicar_asistencias`.
  // Modelo (ver README): asistencias[grupoId][fechaISO][estudianteId] = 'P'|'A'|'R'
  //                      justificantes[grupoId][fechaISO][estudianteId] = { nota }
  function construirPayload() {
    let estado;
    try {
      estado = JSON.parse(localStorage.getItem(CLAVE_ESTADO) || 'null');
    } catch (e) {
      return null; // estado ilegible: mejor no subir nada
    }
    if (!estado || !Array.isArray(estado.grupos)) return null;

    const asist = estado.asistencias || {};
    const just = estado.justificantes || {};

    const grupos = estado.grupos.map(function (g) {
      const porFecha = asist[g.id] || {};
      const justGrupo = just[g.id] || {};
      const fechas = Object.keys(porFecha).sort();

      const alumnos = (g.estudiantes || []).map(function (est) {
        const marcas = [];
        fechas.forEach(function (fecha) {
          const e = porFecha[fecha] && porFecha[fecha][est.id];
          if (e !== 'P' && e !== 'A' && e !== 'R') return; // sin marca = no se envía
          const j = justGrupo[fecha] && justGrupo[fecha][est.id];
          marcas.push({
            f: fecha,
            e: e,
            // Una justificación solo tiene sentido sobre una falta.
            j: e === 'A' && !!j,
            n: e === 'A' && j && j.nota ? String(j.nota) : null
          });
        });
        return { nombre: est.nombre, marcas: marcas };
      });

      return { id: String(g.id), nombre: g.nombre || '', materia: g.materia || '', alumnos: alumnos };
    });

    return { grupos: grupos };
  }

  // ==========================================================================
  // Autenticación con Supabase Auth (REST, sin librerías)
  // ==========================================================================

  // Pide tokens a Supabase. Distingue errores de red (se reintenta luego, la
  // sesión guardada sigue válida) de rechazos del servidor (sesión inválida).
  async function pedirTokens(tipo, cuerpo) {
    const resp = await fetch(SUPABASE_URL + '/auth/v1/token?grant_type=' + tipo, {
      method: 'POST',
      headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpo)
    });
    const datos = await resp.json().catch(function () { return {}; });
    if (!resp.ok) {
      const err = new Error(datos.error_description || datos.msg || datos.message || 'No se pudo iniciar sesión');
      err.rechazado = true;
      throw err;
    }
    sesion = {
      access_token: datos.access_token,
      refresh_token: datos.refresh_token,
      // Se resta 1 minuto para renovar antes de que expire.
      expira: Date.now() + (datos.expires_in || 3600) * 1000 - 60000
    };
    // Supabase rota el refresh_token en cada renovación: se guarda el nuevo.
    // Se guarda solo el token de renovación, nunca la contraseña.
    localStorage.setItem(CLAVE_AUTH, JSON.stringify({ refresh_token: sesion.refresh_token }));
  }

  async function iniciarSesion(correo, contrasena) {
    await pedirTokens('password', { email: correo, password: contrasena });
  }

  function cerrarSesion() {
    sesion = null;
    localStorage.removeItem(CLAVE_AUTH);
    ultimoEnviado = '';
    info.estado = 'sin sesión';
    pintarBoton();
  }

  function haySesionGuardada() {
    try {
      const g = JSON.parse(localStorage.getItem(CLAVE_AUTH) || 'null');
      return !!(g && g.refresh_token);
    } catch (e) {
      return false;
    }
  }

  // Devuelve un access_token vigente, o null si hay que volver a iniciar sesión.
  // Lanza error de red si no hay internet (el llamador lo trata como "offline").
  async function obtenerToken() {
    if (sesion && Date.now() < sesion.expira) return sesion.access_token;
    let guardada = null;
    try { guardada = JSON.parse(localStorage.getItem(CLAVE_AUTH) || 'null'); } catch (e) { /* nada */ }
    if (!guardada || !guardada.refresh_token) return null;
    try {
      await pedirTokens('refresh_token', { refresh_token: guardada.refresh_token });
      return sesion.access_token;
    } catch (e) {
      if (e.rechazado) { // token inválido o revocado: hay que iniciar sesión otra vez
        localStorage.removeItem(CLAVE_AUTH);
        sesion = null;
        return null;
      }
      throw e; // error de red
    }
  }

  // ==========================================================================
  // Subida
  // ==========================================================================

  function programarSubida() {
    if (!haySesionGuardada() && !sesion) return; // sin sesión no hay nada que hacer
    clearTimeout(temporizador);
    temporizador = setTimeout(function () { subir(false); }, ESPERA_MS);
  }

  // manual = true: ignora la comprobación de "nada ha cambiado".
  async function subir(manual) {
    if (subiendo) { pendiente = true; return; }
    if (!navigator.onLine) {
      info.estado = 'sin conexión';
      pintarBoton();
      return; // el evento "online" volverá a programar la subida
    }
    const payload = construirPayload();
    if (!payload) return;
    const texto = JSON.stringify(payload);
    if (!manual && texto === ultimoEnviado) return;

    subiendo = true;
    info.estado = 'subiendo…';
    info.error = '';
    pintarBoton();
    try {
      const token = await obtenerToken();
      if (!token) {
        info.estado = 'sin sesión';
        return;
      }
      const resp = await fetch(SUPABASE_URL + '/rest/v1/rpc/publicar_asistencias', {
        method: 'POST',
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ p_payload: payload })
      });
      const datos = await resp.json().catch(function () { return {}; });
      if (!resp.ok) throw new Error(datos.message || 'Error al publicar (' + resp.status + ')');

      ultimoEnviado = texto;
      info.registros = datos.registros || 0;
      info.sinMatch = datos.sin_match || [];
      info.ambiguos = datos.ambiguos || [];
      const hora = new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
      info.estado = 'al día ' + hora;
    } catch (e) {
      // TypeError de fetch = sin red: no es un error "real", solo se reintenta.
      if (e instanceof TypeError) {
        info.estado = 'sin conexión';
      } else {
        info.estado = 'error';
        info.error = e.message || String(e);
      }
    } finally {
      subiendo = false;
      pintarBoton();
      refrescarModal();
      if (pendiente) { // hubo cambios durante la subida
        pendiente = false;
        programarSubida();
      }
    }
  }

  // ==========================================================================
  // Interfaz: botón flotante + cuadro propio
  // (no se usa alert/confirm/prompt: Electron no soporta prompt y los demás
  //  son diálogos nativos; mismo criterio que `pedirTexto` de app.js)
  // ==========================================================================

  let boton = null;
  let fondo = null;
  let cajaCuerpo = null;

  function estilos() {
    const s = document.createElement('style');
    s.textContent =
      '#fsb-boton{position:fixed;left:12px;bottom:12px;z-index:9998;background:#1e2327;color:#fff;' +
      'border:1px solid #555;border-radius:999px;padding:6px 12px;font:12px/1.2 system-ui,sans-serif;cursor:pointer;opacity:.9}' +
      '#fsb-boton:hover{opacity:1}' +
      '#fsb-fondo{position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.55);display:none;align-items:center;justify-content:center;padding:16px}' +
      '#fsb-caja{background:#fff;color:#222;border-radius:10px;max-width:420px;width:100%;max-height:90vh;overflow:auto;' +
      'padding:16px;font:14px/1.4 system-ui,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.4)}' +
      '#fsb-caja h3{margin:0 0 8px;font-size:16px}' +
      '#fsb-caja input{width:100%;box-sizing:border-box;margin:4px 0 8px;padding:8px;border:1px solid #bbb;border-radius:6px;font-size:14px}' +
      '#fsb-caja button{margin:4px 6px 0 0;padding:8px 12px;border:0;border-radius:6px;background:#1e2327;color:#fff;font-size:14px;cursor:pointer}' +
      '#fsb-caja button.sec{background:#e3e3e3;color:#222}' +
      '#fsb-caja .aviso{background:#fff4d6;border:1px solid #e0b84a;border-radius:6px;padding:8px;margin:8px 0;font-size:13px}' +
      '#fsb-caja .error{background:#fde3e3;border:1px solid #d66;border-radius:6px;padding:8px;margin:8px 0;font-size:13px}';
    document.head.appendChild(s);
  }

  function pintarBoton() {
    if (!boton) return;
    const avisos = info.sinMatch.length + info.ambiguos.length;
    boton.textContent = '☁ Alumnos: ' + info.estado + (avisos ? ' ⚠' : '');
  }

  function el(tag, texto, clase) {
    const e = document.createElement(tag);
    if (texto) e.textContent = texto; // textContent: los nombres de alumnos nunca se interpretan como HTML
    if (clase) e.className = clase;
    return e;
  }

  function lista(titulo, nombres, clase) {
    const d = el('div', null, clase);
    d.appendChild(el('strong', titulo));
    d.appendChild(el('div', nombres.join(', ')));
    return d;
  }

  function refrescarModal() {
    if (!fondo || fondo.style.display !== 'flex') return;
    cajaCuerpo.textContent = '';
    cajaCuerpo.appendChild(el('h3', 'Publicar asistencias a la app del alumno'));
    cajaCuerpo.appendChild(el('div', 'Estado: ' + info.estado));

    if (info.error) cajaCuerpo.appendChild(el('div', info.error, 'error'));

    if (!sesion && !haySesionGuardada()) {
      // --- Sin sesión: formulario de acceso (sin <form>, se envía con el botón o Enter)
      cajaCuerpo.appendChild(el('p', 'Inicia sesión con tu cuenta de administrador de Supabase (la de admin.html).'));
      const correo = el('input');
      correo.type = 'email';
      correo.placeholder = 'Correo';
      correo.autocomplete = 'username';
      const pass = el('input');
      pass.type = 'password';
      pass.placeholder = 'Contraseña';
      pass.autocomplete = 'current-password';
      const entrar = el('button', 'Iniciar sesión');
      const hacerLogin = async function () {
        entrar.disabled = true;
        info.error = '';
        try {
          await iniciarSesion(correo.value.trim(), pass.value);
          pass.value = ''; // no dejar la contraseña en el DOM
          info.estado = 'sesión iniciada';
          pintarBoton();
          await subir(true);
        } catch (e) {
          info.error = e instanceof TypeError ? 'Sin conexión a internet.' : (e.message || String(e));
        }
        refrescarModal();
      };
      entrar.addEventListener('click', hacerLogin);
      pass.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') hacerLogin(); });
      cajaCuerpo.appendChild(correo);
      cajaCuerpo.appendChild(pass);
      cajaCuerpo.appendChild(entrar);
    } else {
      // --- Con sesión
      if (info.registros) cajaCuerpo.appendChild(el('div', 'Registros publicados: ' + info.registros));
      if (info.sinMatch.length) {
        cajaCuerpo.appendChild(lista(
          'Sin matrícula en Supabase (no verán sus asistencias):', info.sinMatch, 'aviso'));
        cajaCuerpo.appendChild(el('div',
          'Revisa que el nombre sea el mismo que en la tabla "alumnos" (se ignoran acentos, mayúsculas y orden).'));
      }
      if (info.ambiguos.length) {
        cajaCuerpo.appendChild(lista(
          'Nombre repetido en "alumnos" (el grupo no desempata):', info.ambiguos, 'aviso'));
      }
      const subirBtn = el('button', 'Subir ahora');
      subirBtn.addEventListener('click', function () { subir(true); });
      const salir = el('button', 'Cerrar sesión', 'sec');
      salir.addEventListener('click', function () { cerrarSesion(); refrescarModal(); });
      cajaCuerpo.appendChild(subirBtn);
      cajaCuerpo.appendChild(salir);
    }

    const cerrar = el('button', 'Cerrar', 'sec');
    cerrar.addEventListener('click', function () { fondo.style.display = 'none'; });
    cajaCuerpo.appendChild(cerrar);
  }

  function abrirModal() {
    fondo.style.display = 'flex';
    refrescarModal();
  }

  function montarInterfaz() {
    estilos();
    boton = el('button');
    boton.id = 'fsb-boton';
    boton.type = 'button';
    boton.addEventListener('click', abrirModal);

    fondo = el('div');
    fondo.id = 'fsb-fondo';
    cajaCuerpo = el('div');
    cajaCuerpo.id = 'fsb-caja';
    fondo.appendChild(cajaCuerpo);
    // Cerrar al tocar fuera de la caja.
    fondo.addEventListener('click', function (ev) { if (ev.target === fondo) fondo.style.display = 'none'; });

    document.body.appendChild(boton);
    document.body.appendChild(fondo);
    if (haySesionGuardada()) info.estado = 'pendiente';
    pintarBoton();
  }

  // ==========================================================================
  // Arranque
  // ==========================================================================

  // Engancha el guardado de app.js SIN editarlo: cada vez que escribe su estado
  // en localStorage, se programa una subida. La subida solo LEE el estado.
  const setItemOriginal = Storage.prototype.setItem;
  Storage.prototype.setItem = function (clave) {
    const resultado = setItemOriginal.apply(this, arguments);
    try {
      if (this === window.localStorage && clave === CLAVE_ESTADO) programarSubida();
    } catch (e) { /* un fallo aquí nunca debe afectar el guardado de la app */ }
    return resultado;
  };

  // Al volver el internet se reintenta lo que haya quedado pendiente.
  window.addEventListener('online', programarSubida);

  function iniciar() {
    montarInterfaz();
    // Al abrir la app se sube una vez (si ya hay sesión) para ponerse al día.
    if (haySesionGuardada()) setTimeout(function () { subir(false); }, 3000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();

  // Por si quieres dispararlo desde la consola o desde app.js más adelante.
  window.FullStatusSupabase = { subirAhora: function () { return subir(true); } };
})();
