(function(){
  "use strict";

  var STORAGE_KEY = "listaAsistenciaData_v2";
  var ESTADOS = ["P","A","R"];
  var ESTADO_VALOR_EXPORT = {P:1, A:0, R:2};

  function uid(){ return Date.now().toString(36) + Math.random().toString(36).slice(2,8); }
  function todayISO(){
    var d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-" + String(d.getDate()).padStart(2,"0");
  }
  function displayFecha(iso){
    var p = iso.split("-");
    return p.length===3 ? p[2]+"/"+p[1]+"/"+p[0] : iso;
  }
  function excelFechaSerial(iso){
    var partes = iso.split("-").map(Number);
    return (Date.UTC(partes[0], partes[1]-1, partes[2]) / 86400000) + 25569;
  }
  function parseFechaMX(value){
    var match = String(value).trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if(!match) return null;
    var day = Number(match[1]), month = Number(match[2]), year = Number(match[3]);
    var date = new Date(year, month-1, day);
    if(date.getFullYear() !== year || date.getMonth() !== month-1 || date.getDate() !== day) return null;
    return year + "-" + String(month).padStart(2,"0") + "-" + String(day).padStart(2,"0");
  }
  function esc(s){
    return String(s).replace(/[&<>"']/g, function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]; });
  }

  function defaultState(){ return { grupos: [], grupoActivoId: null, asistencias: {} }; }
  function loadState(){
    try{
      var raw = localStorage.getItem(STORAGE_KEY);
      if(!raw) return defaultState();
      var parsed = JSON.parse(raw);
      if(!parsed.grupos) return defaultState();
      return parsed;
    }catch(e){ return defaultState(); }
  }
  function saveState(markPending){
    try{
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      if(markPending !== false){
        cambiosPendientes = true;
        localStorage.setItem("listaAsistenciaCambiosPendientes_v1", "1");
        if(document.getElementById("connText")) updateConn();
      }
    }
    catch(e){ showToast("No se pudo guardar en este dispositivo (¿modo privado?)."); }
  }

  var CACHE_DB = "integratorium_cache_v1";
  function abrirCache(){
    return new Promise(function(resolve, reject){
      var request = indexedDB.open(CACHE_DB, 1);
      request.onupgradeneeded = function(){ request.result.createObjectStore("archivos"); };
      request.onsuccess = function(){ resolve(request.result); };
      request.onerror = function(){ reject(request.error); };
    });
  }
  function guardarPlantillaLocal(buffer){
    return abrirCache().then(function(db){
      return new Promise(function(resolve, reject){
        var tx = db.transaction("archivos", "readwrite");
        tx.objectStore("archivos").put(buffer, "institucional");
        tx.oncomplete = resolve;
        tx.onerror = function(){ reject(tx.error); };
      });
    });
  }
  function cargarPlantillaLocal(){
    return abrirCache().then(function(db){
      return new Promise(function(resolve, reject){
        var request = db.transaction("archivos").objectStore("archivos").get("institucional");
        request.onsuccess = function(){ resolve(request.result || null); };
        request.onerror = function(){ reject(request.error); };
      });
    }).catch(function(){ return null; });
  }
  async function restaurarCacheLocal(){
    var buffer = await cargarPlantillaLocal();
    if(!buffer) return;
    try{
      plantillaExcel = new ExcelJS.Workbook();
      await plantillaExcel.xlsx.load(buffer);
      if(!state.grupos.length){
        var grupos = [], asistencias = {};
        plantillaExcel.worksheets.forEach(function(ws){
          var datos = extraerGrupoDeHoja(ws), grupoId = uid();
          grupos.push({id:grupoId, nombre:ws.name, estudiantes:datos ? datos.estudiantes : [], materia:datos ? datos.materia : "", profesor:datos ? datos.profesor : ""});
          asistencias[grupoId] = datos ? datos.asistencias : {};
        });
        state.grupos = grupos;
        state.asistencias = asistencias;
        state.grupoActivoId = grupos[0] ? grupos[0].id : null;
        saveState(false);
      }
    }catch(error){ console.error("No se pudo restaurar la plantilla local", error); }
  }

  var state = loadState();
  var currentTab = "pasar";
  var pasarFecha = todayISO();
  var pasarIndex = null;
  var pasarViewMode = "card";
  var histDesde = "";
  var histHasta = "";
  var plantillaExcel = null;
  var GOOGLE_CLIENT_ID = "814235047466-9bp0f3j15l5eikmpjasgigol9gnvdelv.apps.googleusercontent.com";
  var GOOGLE_SHEET_ID = "1MyLylWU_26VzjMI8t3JZzDiDkcvsiYTi";
  var DRIVE_FILE_KEY = "listaAsistenciaDriveFileId_v1";
  var GOOGLE_AUTH_KEY = "listaAsistenciaGoogleDriveAuth_v2";
  var driveFileId = localStorage.getItem(DRIVE_FILE_KEY) || GOOGLE_SHEET_ID;
  var driveTokenClient = null;
  var drivePendingAction = null;
  var cambiosPendientes = localStorage.getItem("listaAsistenciaCambiosPendientes_v1") === "1";

  function grupoActivo(){ return state.grupos.find(function(g){ return g.id === state.grupoActivoId; }) || null; }
  function ordenarEstudiantes(grupo){
    if(!grupo || !Array.isArray(grupo.estudiantes)) return;
    grupo.estudiantes.sort(function(a, b){
      return a.nombre.localeCompare(b.nombre, "es", {sensitivity:"base"});
    });
  }
  function ensureAsistenciaBucket(grupoId, fecha){
    if(!state.asistencias[grupoId]) state.asistencias[grupoId] = {};
    if(!state.asistencias[grupoId][fecha]) state.asistencias[grupoId][fecha] = {};
    return state.asistencias[grupoId][fecha];
  }
  function fechasDelGrupo(grupoId){ return Object.keys(state.asistencias[grupoId] || {}).sort(); }
  function faltasEquivalentes(faltas, retardos){ return faltas + Math.floor(retardos / 3); }

  function showToast(msg){
    var t = document.getElementById("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(showToast._h);
    showToast._h = setTimeout(function(){ t.classList.remove("show"); }, 2600);
  }

  function setTab(tab){
    currentTab = tab;
    document.querySelectorAll("nav.tabs button").forEach(function(b){ b.classList.toggle("active", b.dataset.tab === tab); });
    render();
  }
  function render(){
    var panel = document.getElementById("panelContent");
    state.grupos.forEach(ordenarEstudiantes);
    if(currentTab === "grupos") panel.innerHTML = renderGrupos();
    else if(currentTab === "pasar") panel.innerHTML = renderPasar();
    else panel.innerHTML = renderHistorial();
    attachHandlers();
  }

  // =========================================================
  // GRUPOS
  // =========================================================
  function renderGrupos(){
    var html = "";

    html += '<div class="card">';
    html += "<h2>Grupos institucionales</h2>";
    html += '<p class="helptext" style="margin-top:0;">El archivo se carga una vez y queda disponible en este dispositivo. Sin conexión, tus cambios se guardan localmente y se sincronizan al volver internet.</p>';
    html += '<button class="btn" id="btnCargarGoogle">Cargar archivo institucional desde Drive</button>';
    html += '<span id="cargarGoogleEstado" class="helptext" style="margin-left:10px;"></span>';
    html += "</div>";

    html += '<div class="card">';
    html += "<h2>Tus grupos</h2>";
    if(state.grupos.length === 0){
      html += '<p class="empty">Aún no tienes ningún grupo. Cárgalos desde Google Sheets.</p>';
    } else {
      html += '<div class="grupo-selector">';
      html += '<select id="selGrupoActivo">';
      state.grupos.forEach(function(g){
        html += '<option value="'+esc(g.id)+'" '+(g.id===state.grupoActivoId?"selected":"")+'>'+esc(g.nombre)+' ('+g.estudiantes.length+')</option>';
      });
      html += "</select>";
      html += '<button class="btn danger" id="btnEliminarGrupo">Eliminar este grupo</button>';
      html += "</div>";
      var g = grupoActivo();
      if(g){
        html += '<div class="meta-fields">';
        html += '<div class="field"><label for="inputMateria">Materia (opcional)</label><input type="text" id="inputMateria" value="'+esc(g.materia||"")+'" placeholder="Ej. Inglés VIII"></div>';
        html += '<div class="field"><label for="inputProfesor">Profesor (opcional)</label><input type="text" id="inputProfesor" value="'+esc(g.profesor||"")+'" placeholder="Ej. Ing. José Manuel Robles"></div>';
        html += "</div>";
      }
    }
    html += "</div>";

    html += '<div class="card">';
    html += "<h2>Crear un grupo manualmente</h2>";
    html += '<div class="row">';
    html += '<input type="text" id="inputNuevoGrupo" placeholder="Ej. 3° A — Matemáticas" style="flex:1;min-width:200px;">';
    html += '<button class="btn" id="btnCrearGrupo">Crear grupo</button>';
    html += "</div></div>";

    var g2 = grupoActivo();
    if(g2){
      html += '<div class="card">';
      html += "<h2>Estudiantes de "+esc(g2.nombre)+"</h2>";
      if(g2.estudiantes.length === 0){
        html += '<p class="empty">Este grupo no tiene estudiantes todavía.</p>';
      } else {
        html += '<ul class="estudiantes">';
        g2.estudiantes.forEach(function(e){
          html += '<li><span>'+esc(e.nombre)+'</span><button class="btn danger" data-del-estudiante="'+esc(e.id)+'">Quitar</button></li>';
        });
        html += "</ul>";
      }
      html += '<div class="row" style="margin-top:16px;">';
      html += '<input type="text" id="inputNuevoEstudiante" placeholder="Nombre del estudiante" style="flex:1;min-width:180px;">';
      html += '<button class="btn secondary" id="btnAgregarEstudiante">Agregar</button>';
      html += "</div>";
      html += '<div class="field" style="margin-top:14px;">';
      html += '<label for="textareaBulk">O pega varios nombres, uno por línea</label>';
      html += '<textarea id="textareaBulk" placeholder="Ana Torres&#10;Luis Martínez&#10;Sofía Ramírez"></textarea>';
      html += "</div>";
      html += '<button class="btn secondary" id="btnAgregarVarios">Agregar todos</button>';
      html += "</div>";
    }
    return html;
  }

  // ---- Lectura de la plantilla institucional ----
  function normalizaEtiqueta(v){ return String(v==null?"":v).replace(/\s+/g,"").toUpperCase(); }
  function esEncabezadoAlumno(v){
    var etiqueta = normalizaEtiqueta(v);
    return etiqueta.indexOf("ALUMNO") !== -1 || (etiqueta.indexOf("NOMBRE") !== -1 && etiqueta.indexOf("PROFESOR") === -1 && etiqueta.indexOf("GRUPO") === -1);
  }

  function buscarValorEtiqueta(ws, etiquetaBuscada, maxRow, maxCol){
    for(var r=1; r<=maxRow; r++){
      var row = ws.getRow(r);
      for(var c=1; c<=maxCol; c++){
        var val = row.getCell(c).value;
        if(val && typeof val === "object" && val.richText){
          val = val.richText.map(function(t){return t.text;}).join("");
        }
        if(normalizaEtiqueta(val).indexOf(etiquetaBuscada) !== -1){
          for(var c2=c+1; c2<=Math.min(c+8,maxCol); c2++){
            var v2 = row.getCell(c2).value;
            if(v2 && typeof v2 === "object" && v2.richText) v2 = v2.richText.map(function(t){return t.text;}).join("");
            if(v2 !== null && v2 !== undefined && String(v2).trim() !== ""){
              return String(v2).trim();
            }
          }
        }
      }
    }
    return "";
  }

  function extraerGrupoDeHoja(ws){
    var MAX_HEADER_SEARCH = 200, MAX_COL = 100;
    var headerRow = -1, nameCol = -1;
    for(var r=1; r<=MAX_HEADER_SEARCH && headerRow===-1; r++){
      var row = ws.getRow(r);
      for(var c=1; c<=MAX_COL; c++){
        var val = row.getCell(c).value;
        if(val && typeof val === "object" && val.richText) val = val.richText.map(function(t){return t.text;}).join("");
        if(esEncabezadoAlumno(val)){
          headerRow = r; nameCol = c; break;
        }
      }
    }
    if(headerRow === -1) return null;

    var headerRowObj = ws.getRow(headerRow);
    var columnasFecha = [];
    for(var c2 = nameCol+1; c2 <= MAX_COL; c2++){
      var v = headerRowObj.getCell(c2).value;
      if(v instanceof Date){ columnasFecha.push({col:c2, fecha:v}); }
    }

    var estudiantes = [];
    var asistenciasPorFecha = {};
    columnasFecha.forEach(function(cf){
      var iso = cf.fecha.getFullYear() + "-" + String(cf.fecha.getMonth()+1).padStart(2,"0") + "-" + String(cf.fecha.getDate()).padStart(2,"0");
      asistenciasPorFecha[iso] = {};
    });

    var r3 = headerRow + 1, vaciasSeguidas = 0, tope = headerRow + 400;
    while(r3 <= tope){
      var rowObj = ws.getRow(r3);
      var nameVal = rowObj.getCell(nameCol).value;
      if(nameVal && typeof nameVal === "object" && nameVal.richText) nameVal = nameVal.richText.map(function(t){return t.text;}).join("");
      var nombre = (nameVal===null||nameVal===undefined) ? "" : String(nameVal).trim();
      if(!nombre){
        vaciasSeguidas++;
        if(vaciasSeguidas >= 2) break;
        r3++; continue;
      }
      vaciasSeguidas = 0;
      var estId = uid();
      estudiantes.push({id: estId, nombre: nombre});
      columnasFecha.forEach(function(cf){
        var iso = cf.fecha.getFullYear() + "-" + String(cf.fecha.getMonth()+1).padStart(2,"0") + "-" + String(cf.fecha.getDate()).padStart(2,"0");
        var raw = rowObj.getCell(cf.col).value;
        var estado = null;
        if(raw === 1) estado = "P";
        else if(raw === 0) estado = "A";
        else if(raw === 2 || (typeof raw === "string" && (raw.trim() === "2" || raw.trim().toUpperCase() === "R"))) estado = "R";
        if(estado) asistenciasPorFecha[iso][estId] = estado;
      });
      r3++;
    }
    var materia = buscarValorEtiqueta(ws, "MATERIA", headerRow, MAX_COL);
    var profesor = buscarValorEtiqueta(ws, "PROFESOR", headerRow, MAX_COL);

    return { nombre: ws.name, estudiantes: estudiantes, asistencias: asistenciasPorFecha, materia: materia, profesor: profesor };
  }

  function importarArchivoExcel(file){
    var estadoEl = document.getElementById("importarEstado");
    if(estadoEl) estadoEl.textContent = "Leyendo archivo…";
    var reader = new FileReader();
    reader.onload = function(ev){
      (async function(){
        try{
          var wb = new ExcelJS.Workbook();
          await wb.xlsx.load(ev.target.result);
          plantillaExcel = wb;
          var importados = 0, estudiantesTotal = 0, omitidos = [];
          for(var i=0; i<wb.worksheets.length; i++){
            var ws = wb.worksheets[i];
            var datos = extraerGrupoDeHoja(ws);
            if(!datos){ omitidos.push(ws.name); continue; }
            var existente = state.grupos.find(function(g){ return g.nombre.trim().toLowerCase() === datos.nombre.trim().toLowerCase(); });
            if(existente){
              var reemplazar = confirm('Ya existe un grupo llamado "'+datos.nombre+'". ¿Reemplazar sus datos con lo que viene del archivo?\n\nCancelar para omitir esta hoja.');
              if(!reemplazar){ omitidos.push(ws.name); continue; }
              delete state.asistencias[existente.id];
              state.grupos = state.grupos.filter(function(g){ return g.id !== existente.id; });
            }
            var nuevoId = uid();
            state.grupos.push({ id: nuevoId, nombre: datos.nombre, estudiantes: datos.estudiantes, materia: datos.materia, profesor: datos.profesor });
            state.asistencias[nuevoId] = datos.asistencias;
            importados++;
            estudiantesTotal += datos.estudiantes.length;
            if(!state.grupoActivoId) state.grupoActivoId = nuevoId;
          }
          saveState();
          render();
          if(importados > 0){
            showToast("Importado" + (importados>1?"s ":" ") + importados + " grupo(s) con " + estudiantesTotal + " estudiante(s) en total.");
          }
          if(omitidos.length){
            showToast("No se pudo leer: " + omitidos.join(", "));
          }
          if(estadoEl) estadoEl.textContent = "";
        }catch(err){
          console.error(err);
          if(estadoEl) estadoEl.textContent = "";
          showToast("No se pudo leer el archivo. ¿Es un .xlsx válido?");
        }
      })();
    };
    reader.onerror = function(){ showToast("No se pudo leer el archivo."); };
    reader.readAsArrayBuffer(file);
  }

  // =========================================================
  // PASAR LISTA (modo tarjeta)
  // =========================================================
  function renderSelectorGrupoPasar(g){
    var html = '<div class="field" style="margin-bottom:0;"><label for="selGrupoPasar">Grupo</label><select id="selGrupoPasar">';
    state.grupos.forEach(function(grupo){
      html += '<option value="'+esc(grupo.id)+'" '+(grupo.id===g.id?"selected":"")+'>'+esc(grupo.nombre)+' ('+grupo.estudiantes.length+')</option>';
    });
    return html + '</select></div>';
  }

  function renderPasar(){
    var g = grupoActivo();
    if(!g) return '<div class="card"><p class="empty">Primero crea o importa un grupo en la pestaña "Grupos".</p></div>';
    if(g.estudiantes.length === 0) return '<div class="card">'+renderSelectorGrupoPasar(g)+'<p class="empty">"'+esc(g.nombre)+'" todavía no tiene estudiantes. Agrégalos en la pestaña "Grupos".</p></div>';

    var bucket = ensureAsistenciaBucket(g.id, pasarFecha);
    if(pasarIndex === null){
      var idx = g.estudiantes.findIndex(function(e){ return !bucket[e.id]; });
      pasarIndex = idx === -1 ? g.estudiantes.length : idx;
    }

    var html = '<div class="card">';
    html += '<div class="row" style="justify-content:space-between;">';
    html += renderSelectorGrupoPasar(g);
    html += '<div class="field" style="margin-bottom:0;"><label for="inputFechaLista">Fecha (dd/mm/aaaa)</label><input type="text" id="inputFechaLista" value="'+displayFecha(pasarFecha)+'" placeholder="dd/mm/aaaa" inputmode="numeric" maxlength="10"></div>';
    html += '<button class="link-sutil" id="btnToggleVista">'+(pasarViewMode==="card" ? "Ver lista completa" : "Volver a modo tarjeta")+'</button>';
    html += "</div></div>";

    if(pasarViewMode === "list"){
      html += renderPasarListaCompleta(g, bucket);
      return html;
    }

    if(pasarIndex >= g.estudiantes.length){
      var counts = {P:0,A:0,R:0};
      g.estudiantes.forEach(function(e){ var v=bucket[e.id]; if(v) counts[v]++; });
      var faltasTotales = faltasEquivalentes(counts.A, counts.R);
      html += '<div class="card completo">';
      html += "<h3>Lista completa</h3>";
      html += '<p class="helptext">'+esc(g.nombre)+' — '+displayFecha(pasarFecha)+'</p>';
      html += '<div class="resumen-final">';
      html += '<span><b style="color:var(--presente)">'+counts.P+'</b>presentes</span>';
      html += '<span><b style="color:var(--falta)">'+faltasTotales+'</b>faltas equivalentes</span>';
      html += '<span><b style="color:var(--retardo)">'+counts.R+'</b>retardos</span>';
      html += "</div>";
      html += '<p class="helptext">Cada 3 retardos se convierten en 1 falta.</p>';
      html += '<div class="row" style="justify-content:center;">';
      html += '<button class="btn secondary" id="btnRevisarLista">Revisar y corregir</button>';
      html += '<button class="btn secondary" id="btnReiniciarLista">Empezar de nuevo</button>';
      html += "</div></div>";
      return html;
    }

    var est = g.estudiantes[pasarIndex];
    var pct = Math.round((pasarIndex / g.estudiantes.length) * 100);
    html += '<div class="progreso">';
    html += '<div style="flex:1;"><div class="progreso-texto">'+(pasarIndex+1)+' de '+g.estudiantes.length+'</div><div class="barra"><div class="barra-fill" style="width:'+pct+'%;"></div></div></div>';
    html += "</div>";

    html += '<div class="tarjeta">';
    html += '<div class="num-lista">Alumno '+(pasarIndex+1)+'</div>';
    html += '<div class="nombre-grande">'+esc(est.nombre)+'</div>';
    html += '<div class="botones-estado">';
    html += '<button class="btn-estado presente" data-marcar="P">Asistencia</button>';
    html += '<button class="btn-estado falta" data-marcar="A">Falta</button>';
    html += '<button class="btn-estado retardo" data-marcar="R">Retardo</button>';
    html += "</div>";
    html += '<div class="fila-secundaria">';
    html += '<button class="link-sutil" id="btnAnterior" '+(pasarIndex===0?"disabled":"")+'>‹ Anterior</button>';
    html += '<button class="link-sutil" id="btnSaltar">Omitir por ahora</button>';
    html += "</div></div>";
    return html;
  }

  function renderPasarListaCompleta(g, bucket){
    var html = '<div class="card">';
    html += '<table class="registro">';
    g.estudiantes.forEach(function(e, i){
      var v = bucket[e.id] || "";
      html += "<tr><td>"+(i+1)+". "+esc(e.nombre)+"</td>";
      html += '<td class="estados">';
      ESTADOS.forEach(function(code){
        html += '<span class="chip '+code+(v===code?" on":"")+'" data-chip data-estudiante="'+esc(e.id)+'" data-estado="'+code+'">'+ESTADO_VALOR_EXPORT[code]+"</span>";
      });
      html += "</td></tr>";
    });
    html += "</table></div>";
    return html;
  }

  // =========================================================
  // HISTORIAL
  // =========================================================
  function renderHistorial(){
    var g = grupoActivo();
    if(!g) return '<div class="card"><p class="empty">Primero crea o importa un grupo en la pestaña "Grupos".</p></div>';

    var fechas = fechasDelGrupo(g.id).filter(function(f){
      if(histDesde && f < histDesde) return false;
      if(histHasta && f > histHasta) return false;
      return true;
    });
    var resumen = {P:0, A:0, R:0};
    fechas.forEach(function(fecha){
      Object.keys(state.asistencias[g.id][fecha] || {}).forEach(function(estudianteId){
        var estado = state.asistencias[g.id][fecha][estudianteId];
        if(resumen[estado] !== undefined) resumen[estado]++;
      });
    });

    var html = '<div class="card">';
    html += '<div class="hist-head"><div><div class="eyebrow">Consulta de asistencia</div><h2>Historial de '+esc(g.nombre)+'</h2></div>';
    html += '<div class="field hist-group-field"><label for="selGrupoHistorial">Grupo</label><select id="selGrupoHistorial">';
    state.grupos.forEach(function(grupo){
      html += '<option value="'+esc(grupo.id)+'" '+(grupo.id===g.id?"selected":"")+'>'+esc(grupo.nombre)+'</option>';
    });
    html += '</select></div></div>';
    html += '<div class="hist-summary">';
    html += '<div><strong>'+fechas.length+'</strong><span> días registrados</span></div>';
    html += '<div class="summary-P"><strong>'+resumen.P+'</strong><span> asistencias</span></div>';
    html += '<div class="summary-A"><strong>'+faltasEquivalentes(resumen.A, resumen.R)+'</strong><span> faltas equivalentes</span></div>';
    html += '<div class="summary-R"><strong>'+resumen.R+'</strong><span> retardos</span></div>';
    html += '</div>';
    html += '<div class="hist-toolbar">';
    html += '<div class="field" style="margin-bottom:0;"><label for="histDesde">Desde (dd/mm/aaaa)</label><input type="text" id="histDesde" value="'+displayFecha(histDesde)+'" placeholder="dd/mm/aaaa" inputmode="numeric" maxlength="10"></div>';
    html += '<div class="field" style="margin-bottom:0;"><label for="histHasta">Hasta (dd/mm/aaaa)</label><input type="text" id="histHasta" value="'+displayFecha(histHasta)+'" placeholder="dd/mm/aaaa" inputmode="numeric" maxlength="10"></div>';
    html += '<button class="btn secondary" id="btnLimpiarFiltro">Quitar filtro</button>';
    html += "</div>";
    html += '<div class="hist-legend"><span><b class="legend-P">1</b> Asistencia</span><span><b class="legend-A">0</b> Falta</span><span><b class="legend-R">2</b> Retardo</span></div>';
    html += '<p class="helptext hist-rule">Cada 3 retardos se convierten en 1 falta equivalente.</p>';

    if(fechas.length === 0 || g.estudiantes.length === 0){
      html += '<p class="empty">Todavía no hay registros de asistencia'+(fechas.length===0?" en este rango de fechas":"")+'.</p></div>';
      return html;
    }

    html += '<div class="table-scroll"><table class="matriz"><thead><tr><th>Estudiante</th>';
    fechas.forEach(function(f){ html += "<th>"+displayFecha(f)+"</th>"; });
    html += "<th>Total presente</th></tr></thead><tbody>";
    g.estudiantes.forEach(function(e){
      html += '<tr><td title="'+esc(e.nombre)+'">'+esc(e.nombre)+"</td>";
      var totalP = 0;
      fechas.forEach(function(f){
        var v = (state.asistencias[g.id][f] || {})[e.id] || "";
        if(v==="P") totalP++;
        html += '<td class="'+(v?"mark-"+v:"mark-empty")+'">'+(v?ESTADO_VALOR_EXPORT[v]:"–")+"</td>";
      });
      html += "<td><b>"+totalP+"</b></td></tr>";
    });
    html += "</tbody></table></div>";

    html += '<div class="hist-actions">';
    html += '<button class="btn" id="btnCopiarExcel">Copiar para pegar en Excel</button>';
    html += '<button class="btn secondary" id="btnDescargarXlsx">Descargar Excel institucional</button>';
    html += '<button class="btn" id="btnActualizarDrive">'+(driveFileId ? "Actualizar en Google Drive" : "Guardar en Google Drive")+'</button>';
    html += "</div>";
    html += '<p class="helptext">La primera vez se guarda el archivo institucional en Drive. Después, "Actualizar en Google Drive" modifica ese mismo archivo.</p>';
    html += "</div>";
    return html;
  }

  function construirMatrizActiva(){
    var g = grupoActivo();
    var fechas = fechasDelGrupo(g.id).filter(function(f){
      if(histDesde && f < histDesde) return false;
      if(histHasta && f > histHasta) return false;
      return true;
    });
    var header = ["Estudiante"].concat(fechas.map(displayFecha)).concat(["Total presente"]);
    var rows = [header];
    g.estudiantes.forEach(function(e){
      var row = [e.nombre], totalP = 0;
      fechas.forEach(function(f){
        var v = (state.asistencias[g.id][f] || {})[e.id] || "";
        if(v==="P") totalP++;
        row.push(v ? ESTADO_VALOR_EXPORT[v] : "");
      });
      row.push(totalP);
      rows.push(row);
    });
    return rows;
  }

  function copiarPortapapeles(text){
    if(navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(text).then(function(){ showToast("Tabla copiada. Pégala en Excel con Ctrl+V."); }).catch(function(){ fallbackCopy(text); });
    } else fallbackCopy(text);
  }
  function fallbackCopy(text){
    var ta = document.createElement("textarea");
    ta.value = text; ta.style.position="fixed"; ta.style.opacity="0";
    document.body.appendChild(ta); ta.select();
    try{ document.execCommand("copy"); showToast("Tabla copiada. Pégala en Excel con Ctrl+V."); }
    catch(e){ showToast("No se pudo copiar. Usa la descarga de Excel."); }
    document.body.removeChild(ta);
  }

  function nombreHojaValido(nombre, usados){
    var limpio = String(nombre).replace(/[\[\]\*\?\/\\:]/g, "").trim().slice(0,31) || "Grupo";
    var base = limpio, n = 2;
    while(usados[limpio]){ limpio = (base.slice(0,28) + " " + n).slice(0,31); n++; }
    usados[limpio] = true;
    return limpio;
  }

  async function crearBufferPlantillaInstitucional(){
    plantillaExcel.worksheets.forEach(function(ws){
      var grupo = state.grupos.find(function(g){ return g.nombre.trim().toLowerCase() === ws.name.trim().toLowerCase(); });
      if(!grupo) return;

      var headerRow = -1, nameCol = -1, maxRow = Math.min(ws.rowCount, 60), maxCol = Math.min(ws.columnCount, 70);
      for(var r=1; r<=maxRow && headerRow===-1; r++){
        for(var c=1; c<=maxCol; c++){
          var etiqueta = normalizaEtiqueta(ws.getRow(r).getCell(c).value);
          if(esEncabezadoAlumno(etiqueta)){
            headerRow = r; nameCol = c; break;
          }
        }
      }
      if(headerRow === -1) return;

      var fechas = {};
      var totalCol = -1;
      var anchoFechaOriginal = null;
      for(var fechaCol=nameCol+1; fechaCol<=maxCol; fechaCol++){
        var headerValue = ws.getRow(headerRow).getCell(fechaCol).value;
        if(headerValue instanceof Date){
          var iso = headerValue.getFullYear() + "-" + String(headerValue.getMonth()+1).padStart(2,"0") + "-" + String(headerValue.getDate()).padStart(2,"0");
          fechas[fechaCol] = iso;
          if(anchoFechaOriginal === null && ws.getColumn(fechaCol).width){
            anchoFechaOriginal = ws.getColumn(fechaCol).width;
          }
        } else if(normalizaEtiqueta(headerValue).indexOf("TOTAL") !== -1){
          totalCol = fechaCol;
          break;
        }
      }
      if(anchoFechaOriginal === null) anchoFechaOriginal = 6;
      var fechasEstado = Object.keys(state.asistencias[grupo.id] || {}).sort();
      var ultimaColumnaFecha = Object.keys(fechas).reduce(function(maximo, col){ return Math.max(maximo, Number(col)); }, nameCol + 2);
      fechasEstado.forEach(function(iso){
        var existe = Object.keys(fechas).some(function(col){ return fechas[col] === iso; });
        if(existe) return;
        ultimaColumnaFecha++;
        fechas[ultimaColumnaFecha] = iso;
        var headerCell = ws.getRow(headerRow).getCell(ultimaColumnaFecha);
        headerCell.value = excelFechaSerial(iso);
        headerCell.numFmt = "dd/mm/yyyy";
        ws.getColumn(ultimaColumnaFecha).width = anchoFechaOriginal;
        ws.getColumn(ultimaColumnaFecha).customWidth = true;
      });

      var estudiantesOrdenados = grupo.estudiantes.slice().sort(function(a, b){
        return a.nombre.localeCompare(b.nombre, "es", {sensitivity:"base"});
      });
      estudiantesOrdenados.forEach(function(est, indice){
        var rowNumber = headerRow + 1 + indice;
        var filaAlumno = ws.getRow(rowNumber);
        filaAlumno.getCell(nameCol).value = est.nombre;
        if(nameCol > 0 && !filaAlumno.getCell(nameCol - 1).value){
          filaAlumno.getCell(nameCol - 1).value = rowNumber - headerRow;
        }
        var totalP = 0;
        Object.keys(fechas).forEach(function(colText){
          var col = Number(colText), estado = (state.asistencias[grupo.id][fechas[col]] || {})[est.id] || "";
          var cell = ws.getRow(rowNumber).getCell(col);
          cell.value = estado ? ESTADO_VALOR_EXPORT[estado] : null;
          if(estado === "P") totalP++;
        });
        if(totalCol !== -1) ws.getRow(rowNumber).getCell(totalCol).value = totalP;
      });
      Object.keys(fechas).forEach(function(colText){
        var fechaCell = ws.getRow(headerRow).getCell(Number(colText));
        fechaCell.numFmt = "dd/mm/yyyy";
        ws.getColumn(Number(colText)).width = anchoFechaOriginal;
        ws.getColumn(Number(colText)).customWidth = true;
      });
    });

    return await plantillaExcel.xlsx.writeBuffer();
  }

  async function descargarPlantillaInstitucional(){
    var buffer = await crearBufferPlantillaInstitucional();
    var blob = new Blob([buffer], {type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"});
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = "asistencia_institucional_" + todayISO() + ".xlsx";
    document.body.appendChild(link); link.click(); document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showToast("Archivo institucional descargado sin cambiar su formato.");
  }

  function iniciarGoogleDrive(action){
    if(location.protocol === "file:" && !window.Capacitor){
      showToast("Abre FullStatus desde http://localhost para iniciar sesión con Google.");
      return;
    }
    if(!window.google || !google.accounts || !google.accounts.oauth2){
      showToast("No se pudo cargar el acceso de Google. Revisa tu conexión.");
      return;
    }
    drivePendingAction = action;
    if(!driveTokenClient){
      driveTokenClient = google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: "https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/spreadsheets",
        callback: function(response){
          if(response.error){
            console.error("Error de autorización de Google", response);
            showToast("Google bloqueó la autorización. Registra "+location.origin+" en Google Cloud Console.");
            return;
          }
          localStorage.setItem(GOOGLE_AUTH_KEY, "1");
          var pending = drivePendingAction;
          drivePendingAction = null;
          if(pending) pending(response.access_token);
        }
      });
    }
    driveTokenClient.requestAccessToken({prompt: localStorage.getItem(GOOGLE_AUTH_KEY) ? "" : "consent"});
  }

  function columnaA1(numero){
    var resultado = "";
    while(numero > 0){
      var resto = (numero-1) % 26;
      resultado = String.fromCharCode(65+resto) + resultado;
      numero = Math.floor((numero-1) / 26);
    }
    return resultado;
  }

  async function cargarGruposExcelDrive(accessToken){
    var response = await fetch("https://www.googleapis.com/drive/v3/files/"+encodeURIComponent(GOOGLE_SHEET_ID)+"?fields=mimeType", {
      headers: {Authorization:"Bearer "+accessToken}
    });
    if(!response.ok) throw new Error("No se pudo consultar el archivo de Drive (HTTP "+response.status+")");
    var metadata = await response.json();
    var fileResponse = await fetch("https://www.googleapis.com/drive/v3/files/"+encodeURIComponent(GOOGLE_SHEET_ID)+"?alt=media", {
      headers: {Authorization:"Bearer "+accessToken}
    });
    if(!fileResponse.ok) throw new Error("No se pudo descargar el archivo institucional");
    var workbookBuffer = await fileResponse.arrayBuffer();
    var workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(workbookBuffer);
    await guardarPlantillaLocal(workbookBuffer);
    plantillaExcel = workbook;
    var grupos = [], asistencias = {};
    workbook.worksheets.forEach(function(ws){
      var datos = extraerGrupoDeHoja(ws);
      if(!datos){
        var grupoVacioId = uid();
        grupos.push({id:grupoVacioId, nombre:ws.name, estudiantes:[], materia:"", profesor:""});
        asistencias[grupoVacioId] = {};
        return;
      }
      var grupoId = uid();
      grupos.push({id:grupoId, nombre:datos.nombre, estudiantes:datos.estudiantes, materia:datos.materia, profesor:datos.profesor});
      asistencias[grupoId] = datos.asistencias;
    });
    if(!grupos.length) throw new Error("No se encontraron grupos en el archivo institucional");
    state.grupos = grupos;
    state.asistencias = asistencias;
    state.grupoActivoId = grupos[0].id;
    saveState(false);
    render();
    showToast(grupos.length+" grupo(s) cargado(s) desde Drive.");
  }

  async function cargarGruposGoogle(accessToken){
    var estadoEl = document.getElementById("cargarGoogleEstado");
    if(estadoEl) estadoEl.textContent = "Leyendo hoja institucional…";
    var driveMetadataResponse = await fetch("https://www.googleapis.com/drive/v3/files/"+encodeURIComponent(GOOGLE_SHEET_ID)+"?fields=mimeType", {
      headers: {Authorization:"Bearer "+accessToken}
    });
    if(driveMetadataResponse.ok){
      var driveMetadata = await driveMetadataResponse.json();
      if(driveMetadata.mimeType !== "application/vnd.google-apps.spreadsheet"){
        await cargarGruposExcelDrive(accessToken);
        if(estadoEl) estadoEl.textContent = "";
        return;
      }
    }
    var metadataResponse = await fetch("https://sheets.googleapis.com/v4/spreadsheets/"+encodeURIComponent(GOOGLE_SHEET_ID), {
      headers: {Authorization:"Bearer "+accessToken}
    });
    if(!metadataResponse.ok){
      var detail = await metadataResponse.text();
      if(metadataResponse.status === 403) throw new Error("Google Sheets API no habilitada o sin permisos para esta cuenta");
      throw new Error("No se pudo leer la hoja institucional (HTTP "+metadataResponse.status+"): "+detail.slice(0,160));
    }
    var metadata = await metadataResponse.json();
    var grupos = [], asistencias = {};

    for(var sheetIndex=0; sheetIndex<metadata.sheets.length; sheetIndex++){
      var title = metadata.sheets[sheetIndex].properties.title;
      var range = encodeURIComponent("'"+title.replace(/'/g,"''")+"'!A1:ZZ500");
      var valuesResponse = await fetch("https://sheets.googleapis.com/v4/spreadsheets/"+encodeURIComponent(GOOGLE_SHEET_ID)+"/values/"+range, {
        headers: {Authorization:"Bearer "+accessToken}
      });
      if(!valuesResponse.ok) continue;
      var values = (await valuesResponse.json()).values || [];
      var headerRow = -1, nameCol = -1;
      for(var rowIndex=0; rowIndex<Math.min(values.length,60) && headerRow===-1; rowIndex++){
        for(var colIndex=0; colIndex<(values[rowIndex] || []).length; colIndex++){
          var label = normalizaEtiqueta(values[rowIndex][colIndex]);
          if(esEncabezadoAlumno(label)){
            headerRow = rowIndex; nameCol = colIndex; break;
          }
        }
      }
      if(headerRow === -1) continue;
      var dateColumns = {};
      for(var dateCol=nameCol+1; dateCol<(values[headerRow] || []).length; dateCol++){
        var dateISO = valorFechaGoogle(values[headerRow][dateCol]);
        if(dateISO) dateColumns[dateCol] = dateISO;
      }
      var estudiantes = [], sheetAttendance = {};
      Object.keys(dateColumns).forEach(function(colText){ sheetAttendance[dateColumns[colText]] = {}; });
      for(var studentIndex=headerRow+1; studentIndex<values.length; studentIndex++){
        var rowValues = values[studentIndex] || [];
        var nombre = String(rowValues[nameCol] || "").trim();
        if(!nombre) continue;
        var estudiante = {id:uid(), nombre:nombre};
        estudiantes.push(estudiante);
        Object.keys(dateColumns).forEach(function(colText){
          var raw = String(rowValues[Number(colText)] === undefined ? "" : rowValues[Number(colText)]).trim();
          var estado = raw === "1" ? "P" : raw === "0" ? "A" : raw === "2" || raw.toUpperCase() === "R" ? "R" : "";
          if(estado) sheetAttendance[dateColumns[colText]][estudiante.id] = estado;
        });
      }
      if(estudiantes.length) {
        var grupoId = uid();
        grupos.push({id:grupoId, nombre:title, estudiantes:estudiantes, materia:"", profesor:""});
        asistencias[grupoId] = sheetAttendance;
      }
    }
    if(!grupos.length) throw new Error("No se encontraron grupos con alumnos");
    state.grupos = grupos;
    state.asistencias = asistencias;
    state.grupoActivoId = grupos[0].id;
    saveState(false);
    if(estadoEl) estadoEl.textContent = "";
    render();
    showToast(grupos.length+" grupo(s) cargado(s) desde Google Sheets.");
  }

  function valorFechaGoogle(value){
    if(value === null || value === undefined || value === "") return "";
    var texto = String(value).trim();
    var iso = parseFechaMX(texto);
    if(iso) return iso;
    var isoMatch = texto.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if(isoMatch) return isoMatch[1]+"-"+isoMatch[2]+"-"+isoMatch[3];
    if(/^\d+(\.\d+)?$/.test(texto)){
      var serial = Number(texto), date = new Date(Date.UTC(1899,11,30) + serial*86400000);
      return date.getUTCFullYear()+"-"+String(date.getUTCMonth()+1).padStart(2,"0")+"-"+String(date.getUTCDate()).padStart(2,"0");
    }
    return "";
  }

  async function actualizarHojaGoogle(accessToken){
    var baseUrl = "https://sheets.googleapis.com/v4/spreadsheets/"+encodeURIComponent(GOOGLE_SHEET_ID);
    var metadataResponse = await fetch(baseUrl, {headers:{Authorization:"Bearer "+accessToken}});
    if(!metadataResponse.ok){
      var detail = await metadataResponse.text();
      throw new Error("No se pudo leer la hoja institucional (HTTP "+metadataResponse.status+"): "+detail.slice(0,160));
    }
    var metadata = await metadataResponse.json(), totalUpdates = [], formatRequests = [], matchedGroups = 0;
    var normalizaNombre = function(nombre){ return String(nombre || "").trim().replace(/\s+/g," ").toLowerCase(); };

    async function leerValores(title){
      var range = encodeURIComponent("'"+title.replace(/'/g,"''")+"'!A1:ZZ500");
      var response = await fetch(baseUrl+"/values/"+range, {headers:{Authorization:"Bearer "+accessToken}});
      if(!response.ok) throw new Error("No se pudo leer la pestaña "+title+" (HTTP "+response.status+")");
      return (await response.json()).values || [];
    }
    async function aplicarEstructura(requests){
      if(!requests.length) return;
      var response = await fetch(baseUrl+":batchUpdate", {
        method:"POST", headers:{Authorization:"Bearer "+accessToken, "Content-Type":"application/json"},
        body:JSON.stringify({requests:requests})
      });
      if(!response.ok){
        var detail = await response.text();
        throw new Error("No se pudo preparar la pestaña institucional (HTTP "+response.status+"): "+detail.slice(0,160));
      }
    }

    for(var i=0; i<metadata.sheets.length; i++){
      var sheetProperties = metadata.sheets[i].properties, title = sheetProperties.title;
      var grupo = state.grupos.find(function(g){ return normalizaNombre(g.nombre) === normalizaNombre(title); });
      if(!grupo) continue;
      matchedGroups++;
      var values = await leerValores(title), headerRow = -1, nameCol = -1;
      for(var rowIndex=0; rowIndex<Math.min(values.length,60) && headerRow===-1; rowIndex++){
        for(var colIndex=0; colIndex<(values[rowIndex] || []).length; colIndex++){
          if(esEncabezadoAlumno(normalizaEtiqueta(values[rowIndex][colIndex]))){ headerRow=rowIndex; nameCol=colIndex; break; }
        }
      }
      if(headerRow === -1) continue;

      var initialHeader = values[headerRow] || [], initialTotalCol = -1;
      for(var initialCol=nameCol+1; initialCol<initialHeader.length; initialCol++){
        if(normalizaEtiqueta(initialHeader[initialCol]).indexOf("TOTAL") !== -1){ initialTotalCol=initialCol; break; }
      }
      var requestedDates = Object.keys(state.asistencias[grupo.id] || {}).sort(), knownDates = {};
      for(var c=nameCol+1; c<initialHeader.length; c++){
        var knownDate = valorFechaGoogle(initialHeader[c]);
        if(knownDate) knownDates[knownDate] = true;
      }
      var missingDates = requestedDates.filter(function(date){ return !knownDates[date]; });
      if(missingDates.length){
        var insertAt = initialTotalCol === -1 ? initialHeader.length : initialTotalCol;
        await aplicarEstructura(missingDates.map(function(){
          return {insertDimension:{range:{sheetId:sheetProperties.sheetId, dimension:"COLUMNS", startIndex:insertAt, endIndex:insertAt+1}, inheritFromBefore:insertAt > 0}};
        }));
        values = await leerValores(title);
      }

      var header = values[headerRow] || [], dateColumns = {}, totalCol = -1;
      for(var dateCol=nameCol+1; dateCol<header.length; dateCol++){
        var dateISO = valorFechaGoogle(header[dateCol]);
        if(dateISO) dateColumns[dateCol] = dateISO;
        else if(normalizaEtiqueta(header[dateCol]).indexOf("TOTAL") !== -1){ totalCol=dateCol; break; }
      }
      missingDates.forEach(function(date){
        var col = Object.keys(dateColumns).find(function(colText){ return dateColumns[colText] === date; });
        if(col === undefined) throw new Error("No se pudo crear la fecha "+displayFecha(date)+" en la pestaña "+title);
        totalUpdates.push({range:"'"+title.replace(/'/g,"''")+"'!"+columnaA1(Number(col)+1)+(headerRow+1), values:[[displayFecha(date)]]});
      });

      var rowsByName = {}, lastStudentRow = headerRow;
      for(var studentIndex=headerRow+1; studentIndex<values.length; studentIndex++){
        var studentName = normalizaNombre((values[studentIndex] || [])[nameCol]);
        if(studentName){ rowsByName[studentName] = studentIndex; lastStudentRow = studentIndex; }
      }
      var nextRow = lastStudentRow + 1;
      grupo.estudiantes.forEach(function(est){
        var key = normalizaNombre(est.nombre), row = rowsByName[key];
        if(row === undefined){
          row = nextRow++; rowsByName[key] = row;
          if(lastStudentRow > headerRow){
            formatRequests.push({copyPaste:{source:{sheetId:sheetProperties.sheetId, startRowIndex:lastStudentRow, endRowIndex:lastStudentRow+1, startColumnIndex:0, endColumnIndex:Math.max(totalCol+1,nameCol+1)}, destination:{sheetId:sheetProperties.sheetId, startRowIndex:row, endRowIndex:row+1, startColumnIndex:0, endColumnIndex:Math.max(totalCol+1,nameCol+1)}, pasteType:"PASTE_FORMAT", orientation:"NORMAL"}});
          }
          totalUpdates.push({range:"'"+title.replace(/'/g,"''")+"'!"+columnaA1(nameCol+1)+(row+1), values:[[est.nombre]]});
          if(nameCol > 0) totalUpdates.push({range:"'"+title.replace(/'/g,"''")+"'!"+columnaA1(nameCol)+(row+1), values:[[row-headerRow]]});
        }
        var totalPresent = 0;
        Object.keys(dateColumns).forEach(function(colText){
          var col = Number(colText), estado = ((state.asistencias[grupo.id] || {})[dateColumns[col]] || {})[est.id] || "";
          if(estado === "P") totalPresent++;
          totalUpdates.push({range:"'"+title.replace(/'/g,"''")+"'!"+columnaA1(col+1)+(row+1), values:[[estado ? ESTADO_VALOR_EXPORT[estado] : ""]]});
        });
        if(totalCol !== -1) totalUpdates.push({range:"'"+title.replace(/'/g,"''")+"'!"+columnaA1(totalCol+1)+(row+1), values:[[totalPresent]]});
      });
    }
    if(!matchedGroups) throw new Error("No se encontró la pestaña del grupo en Google Sheets");
    await aplicarEstructura(formatRequests);
    if(!totalUpdates.length) throw new Error("No hay alumnos o asistencias nuevas para guardar");
    var updateResponse = await fetch(baseUrl+":values:batchUpdate", {
      method:"POST", headers:{Authorization:"Bearer "+accessToken, "Content-Type":"application/json"},
      body:JSON.stringify({valueInputOption:"USER_ENTERED", data:totalUpdates})
    });
    if(!updateResponse.ok){
      var updateDetail = await updateResponse.text();
      throw new Error("No se pudieron guardar los alumnos en Google Sheets (HTTP "+updateResponse.status+"): "+updateDetail.slice(0,160));
    }
    localStorage.setItem(DRIVE_FILE_KEY, GOOGLE_SHEET_ID);
    showToast("Alumnos y asistencias actualizados en la hoja institucional.");
    render();
  }

  async function guardarEnGoogleDrive(accessToken){
    try{
      var fileInfo = await fetch("https://www.googleapis.com/drive/v3/files/"+encodeURIComponent(GOOGLE_SHEET_ID)+"?fields=mimeType", {
        headers: {Authorization:"Bearer "+accessToken}
      });
      if(fileInfo.ok){
        var fileMetadata = await fileInfo.json();
        if(fileMetadata.mimeType !== "application/vnd.google-apps.spreadsheet"){
          if(!plantillaExcel){
            var gruposLocales = state.grupos;
            var asistenciasLocales = state.asistencias;
            var grupoActivoLocal = state.grupoActivoId;
            await cargarGruposExcelDrive(accessToken);
            state.grupos = gruposLocales;
            state.asistencias = asistenciasLocales;
            state.grupoActivoId = grupoActivoLocal;
          }
          var buffer = await crearBufferPlantillaInstitucional();
          var upload = await fetch("https://www.googleapis.com/upload/drive/v3/files/"+encodeURIComponent(GOOGLE_SHEET_ID)+"?uploadType=media", {
            method:"PATCH", headers:{Authorization:"Bearer "+accessToken, "Content-Type":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}, body:buffer
          });
          if(!upload.ok) throw new Error("No se pudo actualizar el Excel institucional");
          showToast("Archivo institucional actualizado en Drive.");
          return true;
        }
      }
      await actualizarHojaGoogle(accessToken);
      return true;
    }catch(error){
      console.error(error);
      showToast(error.message || "No se pudo actualizar Google Sheets. Verifica el acceso y la API.");
      return false;
    }
  }

  function marcarSincronizado(){
    cambiosPendientes = false;
    localStorage.removeItem("listaAsistenciaCambiosPendientes_v1");
  }
  function sincronizarPendientes(){
    if(!navigator.onLine || !cambiosPendientes) return;
    iniciarGoogleDrive(function(accessToken){
      guardarEnGoogleDrive(accessToken).then(function(ok){ if(ok) marcarSincronizado(); });
    });
  }

  async function descargarXlsxCompleto(){
    if(plantillaExcel){
      try{
        await descargarPlantillaInstitucional();
      }catch(err){
        console.error(err);
        showToast("No se pudo actualizar el archivo institucional.");
      }
      return;
    }
    showToast("Generando archivo…");
    var wb = new ExcelJS.Workbook();
    var usados = {};
    var colorBanda = "FFCCCCCC", colorFecha = "FF92D050";

    state.grupos.forEach(function(g){
      var fechas = fechasDelGrupo(g.id);
      var ws = wb.addWorksheet(nombreHojaValido(g.nombre, usados));

      ws.mergeCells(1,1,1,3+fechas.length);
      var titulo = ws.getCell(1,1);
      titulo.value = "LISTA - ACTA DE ASISTENCIA";
      titulo.font = {name:"Arial", size:12, bold:true};
      titulo.alignment = {horizontal:"center", vertical:"middle"};

      var filaMeta = 2;
      ws.getCell(filaMeta,1).value = "Grupo:";
      ws.getCell(filaMeta,1).font = {name:"Arial", size:10, bold:true};
      ws.getCell(filaMeta,2).value = g.nombre;
      ws.getCell(filaMeta,2).font = {name:"Arial", size:10};
      if(g.materia){
        ws.getCell(filaMeta,4).value = "Materia:";
        ws.getCell(filaMeta,4).font = {name:"Arial", size:10, bold:true};
        ws.getCell(filaMeta,5).value = g.materia;
        ws.getCell(filaMeta,5).font = {name:"Arial", size:10};
      }
      if(g.profesor){
        var filaProf = 3;
        ws.getCell(filaProf,1).value = "Profesor:";
        ws.getCell(filaProf,1).font = {name:"Arial", size:10, bold:true};
        ws.getCell(filaProf,2).value = g.profesor;
        ws.getCell(filaProf,2).font = {name:"Arial", size:10};
      }

      var filaHeader = g.profesor ? 5 : 4;
      var hNo = ws.getCell(filaHeader,1), hAlumno = ws.getCell(filaHeader,2);
      hNo.value = "No."; hAlumno.value = "ALUMNO";
      [hNo,hAlumno].forEach(function(c){ c.font={name:"Arial",size:10,bold:true}; c.alignment={horizontal:"center",vertical:"middle"}; });
      hAlumno.alignment = {horizontal:"left", vertical:"middle"};

      fechas.forEach(function(f, i){
        var col = 3+i;
        var cell = ws.getCell(filaHeader, col);
        var partes = f.split("-").map(Number);
        cell.value = new Date(partes[0], partes[1]-1, partes[2]);
        cell.numFmt = "dd/mm/yyyy";
        cell.font = {name:"Arial", size:9, bold:true};
        cell.alignment = {horizontal:"center", vertical:"middle", textRotation:90};
        cell.fill = {type:"pattern", pattern:"solid", fgColor:{argb:colorFecha}};
      });
      var hTotal = ws.getCell(filaHeader, 3+fechas.length);
      hTotal.value = "Total presente";
      hTotal.font = {name:"Arial", size:9, bold:true};
      hTotal.alignment = {horizontal:"center", vertical:"middle", wrapText:true};

      g.estudiantes.forEach(function(est, i){
        var fila = filaHeader + 1 + i;
        var bandear = i % 2 === 0;
        var celdaNo = ws.getCell(fila,1), celdaNombre = ws.getCell(fila,2);
        celdaNo.value = i+1;
        celdaNombre.value = est.nombre;
        [celdaNo, celdaNombre].forEach(function(c){
          c.font = {name:"Arial", size:10};
          if(bandear) c.fill = {type:"pattern", pattern:"solid", fgColor:{argb:colorBanda}};
        });
        celdaNo.alignment = {horizontal:"center"};
        var totalP = 0;
        fechas.forEach(function(f, j){
          var v = (state.asistencias[g.id][f] || {})[est.id] || "";
          var col = 3+j;
          var c = ws.getCell(fila, col);
          if(v){ c.value = ESTADO_VALOR_EXPORT[v]; if(v==="P") totalP++; }
          c.font = {name:"Arial", size:10};
          c.alignment = {horizontal:"center"};
          if(bandear) c.fill = {type:"pattern", pattern:"solid", fgColor:{argb:colorBanda}};
        });
        var cTotal = ws.getCell(fila, 3+fechas.length);
        cTotal.value = totalP;
        cTotal.font = {name:"Arial", size:10, bold:true};
        cTotal.alignment = {horizontal:"center"};
        if(bandear) cTotal.fill = {type:"pattern", pattern:"solid", fgColor:{argb:colorBanda}};
      });

      ws.getColumn(1).width = 5;
      ws.getColumn(2).width = 34;
      for(var k=0;k<fechas.length;k++) ws.getColumn(3+k).width = 4;
      ws.getColumn(3+fechas.length).width = 10;
      ws.getRow(filaHeader).height = 46;
    });

    try{
      var buf = await wb.xlsx.writeBuffer();
      var blob = new Blob([buf], {type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"});
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = "asistencia_" + todayISO() + ".xlsx";
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast("Archivo descargado.");
    }catch(err){
      console.error(err);
      showToast("No se pudo generar el archivo de Excel.");
    }
  }

  // =========================================================
  // EVENTOS
  // =========================================================
  function attachHandlers(){
    var btnCargarGoogle = document.getElementById("btnCargarGoogle");
    if(btnCargarGoogle) btnCargarGoogle.addEventListener("click", function(){
      iniciarGoogleDrive(function(accessToken){
        cargarGruposGoogle(accessToken).catch(function(err){
          console.error(err);
          var estadoEl = document.getElementById("cargarGoogleEstado");
          if(estadoEl) estadoEl.textContent = "";
          showToast(err.message || "No se pudieron cargar los grupos desde Google Sheets.");
        });
      });
    });

    var sel = document.getElementById("selGrupoActivo");
    if(sel) sel.addEventListener("change", function(){ state.grupoActivoId = sel.value; pasarIndex = null; saveState(); render(); });

    var btnEliminarGrupo = document.getElementById("btnEliminarGrupo");
    if(btnEliminarGrupo) btnEliminarGrupo.addEventListener("click", function(){
      var g = grupoActivo(); if(!g) return;
      if(!confirm('¿Eliminar el grupo "'+g.nombre+'" y todos sus registros de asistencia? No se puede deshacer.')) return;
      state.grupos = state.grupos.filter(function(x){ return x.id !== g.id; });
      delete state.asistencias[g.id];
      state.grupoActivoId = state.grupos.length ? state.grupos[0].id : null;
      pasarIndex = null;
      saveState(); render();
    });

    var inputMateria = document.getElementById("inputMateria");
    if(inputMateria) inputMateria.addEventListener("change", function(){ grupoActivo().materia = inputMateria.value.trim(); saveState(); });
    var inputProfesor = document.getElementById("inputProfesor");
    if(inputProfesor) inputProfesor.addEventListener("change", function(){ grupoActivo().profesor = inputProfesor.value.trim(); saveState(); });

    var btnCrearGrupo = document.getElementById("btnCrearGrupo");
    if(btnCrearGrupo) btnCrearGrupo.addEventListener("click", function(){
      var input = document.getElementById("inputNuevoGrupo");
      var nombre = input.value.trim();
      if(!nombre){ showToast("Escribe un nombre para el grupo."); return; }
      var g = {id: uid(), nombre: nombre, estudiantes: [], materia:"", profesor:""};
      state.grupos.push(g);
      state.grupoActivoId = g.id;
      pasarIndex = null;
      saveState(); render();
    });

    var btnAgregarEstudiante = document.getElementById("btnAgregarEstudiante");
    if(btnAgregarEstudiante) btnAgregarEstudiante.addEventListener("click", function(){
      var input = document.getElementById("inputNuevoEstudiante");
      var nombre = input.value.trim();
      if(!nombre) return;
      grupoActivo().estudiantes.push({id: uid(), nombre: nombre});
      pasarIndex = null;
      saveState(); render();
    });
    var inputNE = document.getElementById("inputNuevoEstudiante");
    if(inputNE) inputNE.addEventListener("keydown", function(ev){ if(ev.key==="Enter") document.getElementById("btnAgregarEstudiante").click(); });

    var btnAgregarVarios = document.getElementById("btnAgregarVarios");
    if(btnAgregarVarios) btnAgregarVarios.addEventListener("click", function(){
      var ta = document.getElementById("textareaBulk");
      var lineas = ta.value.split("\n").map(function(s){return s.trim();}).filter(Boolean);
      if(lineas.length === 0) return;
      var g = grupoActivo();
      lineas.forEach(function(nombre){ g.estudiantes.push({id: uid(), nombre: nombre}); });
      ta.value = ""; pasarIndex = null;
      saveState(); render();
      showToast(lineas.length + " estudiante(s) agregado(s).");
    });
    document.querySelectorAll("[data-del-estudiante]").forEach(function(btn){
      btn.addEventListener("click", function(){
        var g = grupoActivo();
        if(!confirm("¿Quitar a este estudiante del grupo?")) return;
        g.estudiantes = g.estudiantes.filter(function(e){ return e.id !== btn.getAttribute("data-del-estudiante"); });
        pasarIndex = null;
        saveState(); render();
      });
    });

    // Pasar lista
    var selGrupoPasar = document.getElementById("selGrupoPasar");
    if(selGrupoPasar) selGrupoPasar.addEventListener("change", function(){
      state.grupoActivoId = selGrupoPasar.value;
      pasarIndex = null;
      pasarViewMode = "card";
      saveState();
      render();
    });
    var inputFecha = document.getElementById("inputFechaLista");
    if(inputFecha) inputFecha.addEventListener("change", function(){
      var fecha = parseFechaMX(inputFecha.value);
      if(!fecha){ showToast("Escribe la fecha como dd/mm/aaaa."); render(); return; }
      pasarFecha = fecha;
      pasarIndex = null;
      pasarViewMode = "card";
      render();
    });
    var btnToggleVista = document.getElementById("btnToggleVista");
    if(btnToggleVista) btnToggleVista.addEventListener("click", function(){
      pasarViewMode = pasarViewMode === "card" ? "list" : "card";
      render();
    });
    document.querySelectorAll("[data-marcar]").forEach(function(btn){
      btn.addEventListener("click", function(){
        var g = grupoActivo();
        var bucket = ensureAsistenciaBucket(g.id, pasarFecha);
        var est = g.estudiantes[pasarIndex];
        bucket[est.id] = btn.getAttribute("data-marcar");
        pasarIndex++;
        saveState(); render();
      });
    });
    var btnAnterior = document.getElementById("btnAnterior");
    if(btnAnterior) btnAnterior.addEventListener("click", function(){ if(pasarIndex>0){ pasarIndex--; render(); } });
    var btnSaltar = document.getElementById("btnSaltar");
    if(btnSaltar) btnSaltar.addEventListener("click", function(){ pasarIndex++; render(); });
    var btnRevisarLista = document.getElementById("btnRevisarLista");
    if(btnRevisarLista) btnRevisarLista.addEventListener("click", function(){ pasarViewMode = "list"; render(); });
    var btnReiniciarLista = document.getElementById("btnReiniciarLista");
    if(btnReiniciarLista) btnReiniciarLista.addEventListener("click", function(){ pasarIndex = 0; render(); });
    document.querySelectorAll("[data-chip]").forEach(function(chip){
      chip.addEventListener("click", function(){
        var g = grupoActivo();
        var bucket = ensureAsistenciaBucket(g.id, pasarFecha);
        var estId = chip.getAttribute("data-estudiante"), estado = chip.getAttribute("data-estado");
        if(bucket[estId] === estado) delete bucket[estId]; else bucket[estId] = estado;
        saveState(); render();
      });
    });

    // Historial
    var selGrupoHistorial = document.getElementById("selGrupoHistorial");
    if(selGrupoHistorial) selGrupoHistorial.addEventListener("change", function(){
      state.grupoActivoId = selGrupoHistorial.value;
      pasarIndex = null;
      saveState();
      render();
    });
    var hd = document.getElementById("histDesde");
    if(hd) hd.addEventListener("change", function(){
      histDesde = hd.value.trim() ? parseFechaMX(hd.value) : "";
      if(hd.value.trim() && !histDesde){ showToast("Escribe la fecha como dd/mm/aaaa."); histDesde=""; }
      render();
    });
    var hh = document.getElementById("histHasta");
    if(hh) hh.addEventListener("change", function(){
      histHasta = hh.value.trim() ? parseFechaMX(hh.value) : "";
      if(hh.value.trim() && !histHasta){ showToast("Escribe la fecha como dd/mm/aaaa."); histHasta=""; }
      render();
    });
    var btnLimpiarFiltro = document.getElementById("btnLimpiarFiltro");
    if(btnLimpiarFiltro) btnLimpiarFiltro.addEventListener("click", function(){ histDesde=""; histHasta=""; render(); });
    var btnCopiarExcel = document.getElementById("btnCopiarExcel");
    if(btnCopiarExcel) btnCopiarExcel.addEventListener("click", function(){
      var rows = construirMatrizActiva();
      copiarPortapapeles(rows.map(function(r){ return r.join("\t"); }).join("\n"));
    });
    var btnDescargarXlsx = document.getElementById("btnDescargarXlsx");
    if(btnDescargarXlsx) btnDescargarXlsx.addEventListener("click", descargarXlsxCompleto);
    var btnActualizarDrive = document.getElementById("btnActualizarDrive");
    if(btnActualizarDrive) btnActualizarDrive.addEventListener("click", function(){
      if(!navigator.onLine){ showToast("Sin conexión: el cambio quedó guardado y se sincronizará después."); return; }
      iniciarGoogleDrive(function(accessToken){
        guardarEnGoogleDrive(accessToken).then(function(ok){ if(ok) marcarSincronizado(); });
      });
    });
  }

  // =========================================================
  // CONEXIÓN
  // =========================================================
  function updateConn(){
    var ind = document.getElementById("connIndicator"), txt = document.getElementById("connText");
    if(navigator.onLine){ ind.classList.remove("offline"); txt.textContent = cambiosPendientes ? "En línea · cambios pendientes" : "En línea"; }
    else { ind.classList.add("offline"); txt.textContent = "Sin conexión — tus datos se guardan en este dispositivo"; }
  }
  window.addEventListener("online", function(){ updateConn(); sincronizarPendientes(); });
  window.addEventListener("offline", updateConn);

  // =========================================================
  // INICIO
  // =========================================================
  document.querySelectorAll("nav.tabs button").forEach(function(b){
    b.addEventListener("click", function(){ setTab(b.dataset.tab); });
  });
  if(!state.grupoActivoId && state.grupos.length) state.grupoActivoId = state.grupos[0].id;
  updateConn();
  restaurarCacheLocal().then(function(){
    setTab("pasar");
    sincronizarPendientes();
  });
})();