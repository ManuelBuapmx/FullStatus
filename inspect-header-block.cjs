const ExcelJS = require("./vendor/exceljs.min.js");
const fs = require("fs");

const FILE = "C:\\Users\\manue\\Documents\\UTTECAM SEP-DIC 2026\\Lista de asistencia.xlsx";

function esc(v){
  if(v === null || v === undefined) return "";
  if(v instanceof Date) return "DATE:" + v.toISOString().slice(0,10);
  if(typeof v === "object") return JSON.stringify(v).slice(0,60);
  return String(v);
}

async function main(){
  const wb = new ExcelJS.Workbook();
  const buffer = fs.readFileSync(FILE);
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets.find(function(w){ return w.name === "7B"; });
  console.log("rowCount:", ws.rowCount, "columnCount:", ws.columnCount);
  console.log("Merges:", JSON.stringify((ws.model && ws.model.merges) || []));
  for(var r=1; r<=15; r++){
    var vals = [];
    for(var c=1; c<=48; c++){
      var cell = ws.getRow(r).getCell(c);
      if(cell.value !== null && cell.value !== undefined && cell.value !== ""){
        vals.push(c + ":" + esc(cell.value));
      }
    }
    console.log("Row " + r + ": " + vals.join(" | "));
  }
  console.log("\nImages:", JSON.stringify((ws.getImages && ws.getImages()) || []).slice(0,500));
}

main().catch(function(e){ console.error(e); process.exit(1); });
