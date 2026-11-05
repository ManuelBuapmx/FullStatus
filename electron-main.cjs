const { app, BrowserWindow, shell, Menu, ipcMain, dialog } = require("electron");
const http = require("http");
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
