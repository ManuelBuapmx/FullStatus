const ExcelJS = require("./vendor/exceljs.min.js");
const fs = require("fs");

const FILE = "C:\\Users\\manue\\Documents\\UTTECAM SEP-DIC 2026\\Lista de asistencia.xlsx";
const SOURCE_SHEET = "7B";
const DRY_RUN = process.argv.includes("--dry-run");

function esc(v){
  if(v === null || v === undefined) return "";
  if(v instanceof Date) return "DATE:" + v.toISOString().slice(0,10);
  if(typeof v === "object") return JSON.stringify(v).slice(0,40);
  return String(v);
}

async function main(){
  const wb = new ExcelJS.Workbook();
  const buffer = fs.readFileSync(FILE);
  await wb.xlsx.load(buffer);

  if(wb.worksheets.some(function(w){ return w.name.trim().toLowerCase() === "plantilla"; })){
    console.log("A 'Plantilla' sheet already exists — aborting, nothing changed.");
    return;
  }

  const source = wb.worksheets.find(function(w){ return w.name === SOURCE_SHEET; });
  if(!source){ console.log("Source sheet not found: " + SOURCE_SHEET); return; }

  const maxFila = Math.max(source.rowCount, 50);
  const maxColumna = Math.max(source.columnCount, 50);

  const nueva = wb.addWorksheet("Plantilla");

  for(var c=1; c<=maxColumna; c++){
    var colOrigen = source.getColumn(c);
    if(colOrigen && colOrigen.width) nueva.getColumn(c).width = colOrigen.width;
  }
  for(var r=1; r<=maxFila; r++){
    var filaOrigen = source.getRow(r);
    var filaNueva = nueva.getRow(r);
    for(var c2=1; c2<=maxColumna; c2++){
      var celdaOrigen = filaOrigen.getCell(c2);
      var celdaNueva = filaNueva.getCell(c2);
      celdaNueva.value = celdaOrigen.value;
      if(celdaOrigen.style) celdaNueva.style = JSON.parse(JSON.stringify(celdaOrigen.style));
    }
    if(filaOrigen.height) filaNueva.height = filaOrigen.height;
  }
  ((source.model && source.model.merges) || []).forEach(function(rango){
    try{ nueva.mergeCells(rango); }catch(e){}
  });
  if(source.getImages){
    source.getImages().forEach(function(img){
      try{ nueva.addImage(img.imageId, img.range); }catch(e){}
    });
  }

  // --- Blank out group-specific data, keep structure/labels/styles intact ---
  nueva.getRow(7).getCell(10).value = null;   // Profesor: value (merged J7:AH7)
  nueva.getRow(12).getCell(2).value = null;   // "CUATRIMESTRE: ..." text (merged B12:D14)
  nueva.getRow(12).getCell(10).value = null;  // Materia value (merged J12:AH12)

  // Clear all date headers on row 15 (cols 6..45), keep eval labels at 46-48.
  for(var dc=6; dc<=45; dc++){
    nueva.getRow(15).getCell(dc).value = null;
  }

  // Clear the whole student roster block (rows 16..46), columns 2..45.
  for(var rr=16; rr<=46; rr++){
    for(var cc=2; cc<=45; cc++){
      var cell = nueva.getRow(rr).getCell(cc);
      cell.value = null;
      cell.note = undefined;
    }
  }

  console.log("Preview of new 'Plantilla' sheet (rows 1-16):");
  for(var pr=1; pr<=16; pr++){
    var pvals = [];
    for(var pc=1; pc<=48; pc++){
      var pcell = nueva.getRow(pr).getCell(pc);
      if(pcell.value !== null && pcell.value !== undefined && pcell.value !== ""){
        pvals.push(pc + ":" + esc(pcell.value));
      }
    }
    if(pvals.length) console.log("Row " + pr + ": " + pvals.join(" | "));
  }

  if(DRY_RUN){
    console.log("\n(DRY RUN — file not saved)");
    return;
  }
  var out = await wb.xlsx.writeBuffer();
  fs.writeFileSync(FILE, Buffer.from(out));
  console.log("\nSaved. 'Plantilla' sheet added to: " + FILE);
}

main().catch(function(e){ console.error(e); process.exit(1); });
