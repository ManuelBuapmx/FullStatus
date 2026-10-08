// Copia los archivos web de la raíz a www/ (fuente que usa Capacitor/Android).
const fs = require("fs");
const path = require("path");

const root = __dirname;
const www = path.join(root, "www");
const files = [
  "app.js",
  "index.html",
  "styles.css",
  "manifest.webmanifest",
  "FS.png",
  "FullStatus.png",
  path.join("vendor", "exceljs.min.js")
];

for (const file of files) {
  const target = path.join(www, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(path.join(root, file), target);
  console.log("copiado " + file);
}
