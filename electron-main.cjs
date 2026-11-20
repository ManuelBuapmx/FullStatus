const { app, BrowserWindow, shell, Menu, ipcMain, dialog, safeStorage } = require("electron");
const http = require("http");
const { execFile } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = __dirname;
const PORT = 5173;
const CHROME_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function startLocalServer() {
  const contentTypes = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".woff2": "font/woff2"
  };

  const server = http.createServer((request, response) => {
    const requestedPath = decodeURIComponent((request.url || "/").split("?")[0]);
    const relativePath = requestedPath === "/" ? "/index.html" : requestedPath;
    const filePath = path.resolve(ROOT, "." + relativePath);

    if (!filePath.startsWith(ROOT + path.sep) && filePath !== ROOT) {
      response.writeHead(403);
      response.end("Forbidden");
      return;
    }

    fs.readFile(filePath, (error, data) => {
      if (error) {
        response.writeHead(error.code === "ENOENT" ? 404 : 500);
        response.end(error.code === "ENOENT" ? "Not found" : "Server error");
        return;
      }

      response.writeHead(200, {
        "Content-Type": contentTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream"
      });
      response.end(data);
    });
  });

  server.listen(PORT, "localhost");
  return server;
}

// Secretos del equipo (sesión de Supabase que se mantiene sola): se guardan CIFRADOS con el almacén del sistema
// (en Windows, DPAPI: solo este usuario de este equipo puede descifrarlos). Archivo: <userData>/secretos.bin
function rutaSecretos() { return path.join(app.getPath("userData"), "secretos.bin"); }
function leerSecretos() {
  try {
    if (!safeStorage.isEncryptionAvailable() || !fs.existsSync(rutaSecretos())) return {};
    return JSON.parse(safeStorage.decryptString(fs.readFileSync(rutaSecretos()))) || {};
  } catch (e) { return {}; }
}
function escribirSecretos(obj) {
  if (!safeStorage.isEncryptionAvailable()) return false;
  fs.writeFileSync(rutaSecretos(), safeStorage.encryptString(JSON.stringify(obj)));
  return true;
}
function origenPermitido(event) {
  const origen = event.senderFrame ? event.senderFrame.url : "";
  return origen.startsWith("http://localhost:" + PORT);
}
ipcMain.handle("fullstatus:secreto-guardar", (event, datos) => {
  if (!origenPermitido(event) || !datos || typeof datos.clave !== "string" || typeof datos.valor !== "string") return false;
  try { const s = leerSecretos(); s[datos.clave] = datos.valor; return escribirSecretos(s); } catch (e) { return false; }
});
ipcMain.handle("fullstatus:secreto-leer", (event, clave) => {
  if (!origenPermitido(event) || typeof clave !== "string") return null;
  const v = leerSecretos()[clave];
  return typeof v === "string" ? v : null;
});
ipcMain.handle("fullstatus:secreto-borrar", (event, clave) => {
  if (!origenPermitido(event) || typeof clave !== "string") return false;
  try { const s = leerSecretos(); delete s[clave]; return escribirSecretos(s); } catch (e) { return false; }
});

// Actualizar la app desde GitHub sin abrir la terminal: git fetch / git pull --ff-only en la carpeta del proyecto.
// Solo funciona si la app corre desde el repositorio (npm run start:windows). Si cambian archivos del proceso principal
// (electron-main.cjs, preload.cjs, package.json) la app se reinicia sola; si no, solo se recarga la ventana.
function git(args) {
  return new Promise((resolve) => {
    execFile("git", args, { cwd: ROOT, timeout: 90000, windowsHide: true }, (err, stdout, stderr) => {
      resolve({ ok: !err, out: String(stdout || "").trim(), err: String(stderr || (err && err.message) || "").trim() });
    });
  });
}
ipcMain.handle("fullstatus:actualizar-revisar", async (event) => {
  if (!origenPermitido(event)) return { ok: false, error: "Origen no permitido." };
  if (!fs.existsSync(path.join(ROOT, ".git"))) return { ok: false, sinGit: true, error: "Esta instalación no está conectada a GitHub (no hay carpeta .git)." };
  const f = await git(["fetch", "--quiet", "origin", "main"]);
  if (!f.ok) return { ok: false, error: "No se pudo consultar GitHub: " + f.err };
  const c = await git(["rev-list", "--count", "HEAD..origin/main"]);
  const n = parseInt(c.out, 10) || 0;
  const l = n ? await git(["log", "--format=%s", "-n", "5", "HEAD..origin/main"]) : { out: "" };
  return { ok: true, pendientes: n, resumen: l.out ? l.out.split("\n") : [] };
});
ipcMain.handle("fullstatus:actualizar-aplicar", async (event) => {
  if (!origenPermitido(event)) return { ok: false, error: "Origen no permitido." };
  if (!fs.existsSync(path.join(ROOT, ".git"))) return { ok: false, error: "Esta instalación no está conectada a GitHub (no hay carpeta .git)." };
  const sucio = await git(["status", "--porcelain", "--untracked-files=no"]);
  if (sucio.out) return { ok: false, error: "Hay cambios locales sin guardar en la carpeta del proyecto; no se actualiza para no perderlos:\n" + sucio.out.split("\n").slice(0, 6).join("\n") };
  const antes = await git(["rev-parse", "HEAD"]);
  const p = await git(["pull", "--ff-only", "--quiet", "origin", "main"]);
  if (!p.ok) return { ok: false, error: "No se pudo actualizar: " + p.err };
  const despues = await git(["rev-parse", "HEAD"]);
  if (antes.out === despues.out) return { ok: true, igual: true, archivos: [], reinicio: false };
  const dif = await git(["diff", "--name-only", antes.out, despues.out]);
  const archivos = dif.out ? dif.out.split("\n") : [];
  const reinicio = archivos.some((f) => /^(electron-main\.cjs|preload\.cjs|package\.json|package-lock\.json)$/.test(f));
  const dependencias = archivos.some((f) => /^package(-lock)?\.json$/.test(f));
  return { ok: true, igual: false, archivos: archivos, reinicio: reinicio, dependencias: dependencias };
});
ipcMain.handle("fullstatus:recargar", (event) => {
  if (!origenPermitido(event)) return false;
  event.sender.reloadIgnoringCache();
  return true;
});
ipcMain.handle("fullstatus:reiniciar", (event) => {
  if (!origenPermitido(event)) return false;
  setTimeout(() => { app.relaunch(); app.exit(0); }, 300);
  return true;
});

// Genera un PDF a partir del HTML que arma la interfaz (pestaña Calificaciones):
// lo carga en una ventana oculta sin JavaScript, lo imprime a PDF y pide dónde guardarlo.
ipcMain.handle("fullstatus:generar-pdf", async (event, datos) => {
  const origen = event.senderFrame ? event.senderFrame.url : "";
  if (!origen.startsWith("http://localhost:" + PORT)) return { ok: false, error: "Origen no permitido." };
  if (!datos || typeof datos.html !== "string" || datos.html.length > 5000000) return { ok: false, error: "Contenido no válido." };

  const nombreBase = String(datos.nombre || "Calificaciones").replace(/[\\/:*?"<>|]/g, "").trim().slice(0, 80) || "Calificaciones";
  const ventanaOrigen = BrowserWindow.fromWebContents(event.sender);
  const temporal = path.join(os.tmpdir(), "fullstatus-" + Date.now() + ".html");
  let ventanaPdf = null;
  try {
    fs.writeFileSync(temporal, datos.html, "utf8");
    ventanaPdf = new BrowserWindow({
      show: false,
      webPreferences: { javascript: false, sandbox: true, contextIsolation: true, nodeIntegration: false }
    });
    await ventanaPdf.loadFile(temporal);
    const pdf = await ventanaPdf.webContents.printToPDF({
      pageSize: "Letter",
      landscape: true,
      printBackground: true,
      preferCSSPageSize: true
    });

    const eleccion = await dialog.showSaveDialog(ventanaOrigen, {
      title: "Guardar calificaciones en PDF",
      defaultPath: path.join(app.getPath("documents"), nombreBase + ".pdf"),
      filters: [{ name: "PDF", extensions: ["pdf"] }]
    });
    // Tras un cuadro nativo, se devuelve el foco del teclado a la ventana de la app.
    if (ventanaOrigen) { ventanaOrigen.focus(); event.sender.focus(); }
    if (eleccion.canceled || !eleccion.filePath) return { ok: false, cancelado: true };

    fs.writeFileSync(eleccion.filePath, pdf);
    shell.showItemInFolder(eleccion.filePath);
    return { ok: true };
  } catch (error) {
    console.error("No se pudo generar el PDF", error);
    return { ok: false, error: "No se pudo generar el PDF." };
  } finally {
    if (ventanaPdf && !ventanaPdf.isDestroyed()) ventanaPdf.close();
    fs.unlink(temporal, () => {});
  }
});

function createWindow() {
  const window = new BrowserWindow({
    width: 1200,
    height: 820,
    minWidth: 900,
    minHeight: 640,
    backgroundColor: "#0f172a",
    icon: path.join(__dirname, "FS.png"),
    autoHideMenuBar: true,
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: "#0f172a",
      symbolColor: "#ffffff",
      height: 48
    },
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.cjs")
    }
  });

  window.webContents.setUserAgent(CHROME_UA);

  window.webContents.on("before-input-event", (event, input) => {
    if (input.key === "F12") window.webContents.toggleDevTools();
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://accounts.google.com")) {
      return {
        action: "allow",
        overrideBrowserWindowOptions: {
          width: 500,
          height: 650,
          webPreferences: {
            contextIsolation: true,
            nodeIntegration: false
          }
        }
      };
    }
    shell.openExternal(url);
    return { action: "deny" };
  });

  window.loadURL(`http://localhost:${PORT}`);
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  startLocalServer();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
