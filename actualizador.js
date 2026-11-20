/* actualizador.js — Actualizar FullStatus desde GitHub sin abrir la terminal (solo Electron corriendo desde el repositorio).

   - Revisa solo si hay una versión nueva: al abrir y cada 10 minutos (git fetch; no cambia nada).
   - Cuando hay una, el botón «⟳ Actualizar» de abajo a la derecha se marca con un punto rojo.
   - Al pulsarlo: git pull --ff-only; si cambiaron archivos de la interfaz solo recarga la ventana;
     si cambió el proceso principal (electron-main.cjs / preload.cjs / package.json) reinicia la app sola.
   - Si hay cambios locales sin guardar en la carpeta del proyecto, NO actualiza (para no perderlos) y lo avisa.
   - En web/Android o en el instalador (sin carpeta .git) el botón no aparece. */
(function () {
  'use strict';
  const api = window.fullstatusActualizar;
  if (!api) return; // no es Electron

  let boton = null, punto = null, ocupado = false, pendientes = 0, sinGit = false;

  function toast(msg) {
    const t = document.createElement('div');
    t.textContent = msg;
    t.style.cssText = 'position:fixed;right:16px;bottom:64px;max-width:380px;background:#0f172a;color:#fff;padding:10px 14px;border-radius:10px;font:13px/1.4 system-ui,sans-serif;z-index:100001;white-space:pre-line;box-shadow:0 4px 16px rgba(0,0,0,.3);';
    document.body.appendChild(t);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 7000);
  }

  let etiqueta = null;
  function pintar() {
    if (!boton) return;
    etiqueta.textContent = ocupado ? '⟳ Actualizando…' : '⟳ Actualizar';
    boton.disabled = ocupado;
    boton.title = pendientes ? 'Hay ' + pendientes + ' cambio(s) nuevo(s) en GitHub: pulsa para actualizar' : 'Buscar y aplicar actualizaciones desde GitHub';
    punto.style.display = pendientes ? 'block' : 'none';
  }

  async function revisar(silencioso) {
    try {
      const r = await api.revisar();
      if (!r.ok) {
        if (r.sinGit) { sinGit = true; if (boton) boton.style.display = 'none'; }
        else if (!silencioso) toast(r.error || 'No se pudo revisar.');
        return r;
      }
      pendientes = r.pendientes || 0;
      pintar();
      return r;
    } catch (e) {
      if (!silencioso) toast('No se pudo revisar: ' + (e.message || e));
      return { ok: false };
    }
  }

  async function actualizar() {
    if (ocupado) return;
    ocupado = true; pintar();
    try {
      const rev = await revisar(false);
      if (!rev || !rev.ok) return;
      if (!rev.pendientes) { toast('Ya tienes la última versión.'); return; }
      const r = await api.aplicar();
      if (!r.ok) { toast(r.error || 'No se pudo actualizar.'); return; }
      pendientes = 0; pintar();
      if (r.dependencias) toast('Se actualizó. Cambiaron las dependencias (package.json): si algo falla, ejecuta «npm install» una vez.');
      else toast('Actualizado (' + r.archivos.length + ' archivo(s)). ' + (r.reinicio ? 'Reiniciando…' : 'Recargando…'));
      setTimeout(function () { r.reinicio ? api.reiniciar() : api.recargar(); }, 1200);
    } catch (e) {
      toast('No se pudo actualizar: ' + (e.message || e));
    } finally {
      ocupado = false; pintar();
    }
  }

  function montar() {
    boton = document.createElement('button');
    boton.type = 'button';
    boton.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:100000;padding:8px 14px;border:0;border-radius:999px;background:#0f172a;color:#fff;font:600 13px system-ui,sans-serif;cursor:pointer;box-shadow:0 2px 10px rgba(0,0,0,.25);';
    etiqueta = document.createElement('span');
    punto = document.createElement('span');
    punto.style.cssText = 'display:none;position:absolute;top:-2px;right:-2px;width:12px;height:12px;border-radius:50%;background:#ef4444;border:2px solid #fff;';
    boton.appendChild(etiqueta);
    boton.appendChild(punto);
    boton.addEventListener('click', actualizar);
    document.body.appendChild(boton);
    pintar();
    setTimeout(function () { revisar(true); }, 8000);
    setInterval(function () { if (!ocupado && !sinGit) revisar(true); }, 600000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', montar);
  else montar();
})();
