// Puente seguro entre la interfaz y el proceso principal de Electron.
// Solo expone la generación de PDF (la interfaz no tiene acceso a Node).
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("fullstatusPDF", {
  generar: (html, nombreSugerido) =>
    ipcRenderer.invoke("fullstatus:generar-pdf", { html: html, nombre: nombreSugerido })
});
