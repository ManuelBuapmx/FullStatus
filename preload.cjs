// Puente seguro entre la interfaz y el proceso principal de Electron.
// Solo expone la generación de PDF (la interfaz no tiene acceso a Node).
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("fullstatusPDF", {
  generar: (html, nombreSugerido) =>
    ipcRenderer.invoke("fullstatus:generar-pdf", { html: html, nombre: nombreSugerido })
});

// Secretos del equipo cifrados por el sistema (sesión de Supabase que se mantiene sola). Solo guardar / leer / borrar.
contextBridge.exposeInMainWorld("fullstatusSecretos", {
  guardar: (clave, valor) => ipcRenderer.invoke("fullstatus:secreto-guardar", { clave: clave, valor: valor }),
  leer: (clave) => ipcRenderer.invoke("fullstatus:secreto-leer", clave),
  borrar: (clave) => ipcRenderer.invoke("fullstatus:secreto-borrar", clave)
});
