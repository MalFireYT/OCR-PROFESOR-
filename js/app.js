import { renderSheet } from "./sheet.js";
import { detectSheet, preloadCv } from "./omr.js";
import { calcNota, gradeAnswers } from "./grading.js";
import * as db from "./db.js";

const ALL = ["A", "B", "C", "D", "E"];
const SCALE = { exigencia: 0.6, notaMin: 1.0, notaAprob: 4.0, notaMax: 7.0 };
const CFG_KEY = "ocr_config";

const $ = (id) => document.getElementById(id);

let config = loadConfig();
let lastResult = null; // { detected, perQuestion, debugCanvas }
let cursos = [];        // cache de cursos del profesor

// ---- Configuración (sigue local: es el "borrador" de la prueba actual) ----
function loadConfig() {
  try {
    const c = JSON.parse(localStorage.getItem(CFG_KEY));
    if (c && c.numQuestions) return c;
  } catch {}
  return { titulo: "Prueba", numQuestions: 20, numOptions: 5, exigencia: 0.6, key: Array(20).fill(null) };
}
function saveConfig() {
  localStorage.setItem(CFG_KEY, JSON.stringify(config));
}

// ---- Autenticación ----
function setAuthMsg(text, cls = "") {
  const m = $("auth-msg");
  m.textContent = text;
  m.className = "auth-msg" + (cls ? " " + cls : "");
}
$("btn-login").addEventListener("click", async () => {
  try {
    setAuthMsg("Entrando…");
    await db.signIn($("auth-email").value.trim(), $("auth-pass").value);
    setAuthMsg("");
  } catch (e) { setAuthMsg(traducirAuth(e.message), "err"); }
});
$("btn-signup").addEventListener("click", async () => {
  try {
    setAuthMsg("Creando cuenta…");
    const r = await db.signUp($("auth-email").value.trim(), $("auth-pass").value);
    if (r.session) setAuthMsg("");
    else setAuthMsg("Cuenta creada. Revisa tu correo para confirmarla y luego entra.", "ok");
  } catch (e) { setAuthMsg(traducirAuth(e.message), "err"); }
});
$("btn-logout").addEventListener("click", () => db.signOut());

function traducirAuth(msg) {
  const m = (msg || "").toLowerCase();
  if (m.includes("invalid login")) return "Correo o contraseña incorrectos.";
  if (m.includes("already registered")) return "Ese correo ya tiene cuenta. Entra normalmente.";
  if (m.includes("password")) return "La contraseña debe tener al menos 6 caracteres.";
  if (m.includes("email")) return "Revisa el correo ingresado.";
  return msg || "Error de autenticación.";
}

db.onAuthChange(async (user) => {
  if (user) {
    document.body.classList.add("authed");
    $("user-email").textContent = user.email || "";
    await refreshCursos();
  } else {
    document.body.classList.remove("authed");
    cursos = [];
  }
});

// ---- Tabs ----
document.querySelectorAll(".tab").forEach((t) => {
  t.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((x) => x.classList.remove("active"));
    document.querySelectorAll(".panel").forEach((x) => x.classList.remove("active"));
    t.classList.add("active");
    $("tab-" + t.dataset.tab).classList.add("active");
    const sw = $("sheet-container");
    if (t.dataset.tab === "hoja") { sw.classList.remove("hidden"); drawSheet(); }
    else { sw.classList.add("hidden"); }
    if (t.dataset.tab === "corregir") { prepareCv(); renderHist(); }
  });
});

// Precarga OpenCV en segundo plano (en el worker, sin congelar la interfaz).
let cvStarted = false;
function prepareCv() {
  if (cvStarted) return;
  cvStarted = true;
  $("cv-status").textContent = "Preparando motor de visión en segundo plano…";
  $("cv-status").style.color = "#92400e";
  preloadCv()
    .then(() => { $("cv-status").textContent = "✓ Listo para corregir."; $("cv-status").style.color = "#059669"; })
    .catch((e) => { cvStarted = false; $("cv-status").textContent = "✗ " + e.message; $("cv-status").style.color = "#b91c1c"; });
}

// ---- Cursos ----
async function refreshCursos() {
  try {
    cursos = await db.listCursos();
  } catch (e) { cursos = []; }
  renderCursos();
  fillCursoSelects();
  renderAlumnos();
  renderHist();
}

function renderCursos() {
  const cont = $("cursos-list");
  if (!cursos.length) { cont.innerHTML = `<p class="hint">Aún no tienes cursos. Crea uno arriba.</p>`; return; }
  cont.className = "card-list";
  cont.innerHTML = cursos.map((c) =>
    `<div class="card-item">
      <span><strong>${esc(c.nombre)}</strong> <span class="meta">${esc(c.materia || "")}</span></span>
      <button class="btn-del" data-del-curso="${c.id}">Borrar</button>
    </div>`).join("");
  cont.querySelectorAll("[data-del-curso]").forEach((b) =>
    b.addEventListener("click", async () => {
      if (!confirm("¿Borrar el curso, su nómina y sus notas?")) return;
      await db.deleteCurso(b.dataset.delCurso);
      await refreshCursos();
    }));
}

$("btn-add-curso").addEventListener("click", async () => {
  const nombre = $("curso-nombre").value.trim();
  if (!nombre) { $("curso-status").textContent = "Escribe un nombre."; return; }
  try {
    await db.addCurso(nombre, $("curso-materia").value.trim());
    $("curso-nombre").value = ""; $("curso-materia").value = "";
    $("curso-status").textContent = "✓ Curso creado";
    setTimeout(() => ($("curso-status").textContent = ""), 2000);
    await refreshCursos();
  } catch (e) { $("curso-status").textContent = "✗ " + e.message; }
});

function fillCursoSelects() {
  const opts = cursos.map((c) => `<option value="${c.id}">${esc(c.nombre)}</option>`).join("");
  const placeholder = `<option value="">— elige un curso —</option>`;
  for (const id of ["nomina-curso", "corr-curso"]) {
    const sel = $(id);
    const prev = sel.value;
    sel.innerHTML = placeholder + opts;
    if (prev && cursos.some((c) => c.id === prev)) sel.value = prev;
  }
}

// ---- Nómina (alumnos) ----
$("nomina-curso").addEventListener("change", renderAlumnos);
$("btn-add-alumnos").addEventListener("click", async () => {
  const cursoId = $("nomina-curso").value;
  if (!cursoId) { $("nomina-status").textContent = "Elige un curso primero."; return; }
  const nombres = $("nomina-text").value.split("\n");
  try {
    const added = await db.addAlumnos(cursoId, nombres);
    $("nomina-text").value = "";
    $("nomina-status").textContent = `✓ ${added.length} alumno(s) agregado(s)`;
    setTimeout(() => ($("nomina-status").textContent = ""), 2500);
    renderAlumnos();
  } catch (e) { $("nomina-status").textContent = "✗ " + e.message; }
});

async function renderAlumnos() {
  const cursoId = $("nomina-curso").value;
  const cont = $("alumnos-list");
  if (!cursoId) { cont.innerHTML = ""; return; }
  let alumnos = [];
  try { alumnos = await db.listAlumnos(cursoId); } catch {}
  if (!alumnos.length) { cont.innerHTML = `<p class="hint">Sin alumnos en este curso todavía.</p>`; return; }
  cont.className = "card-list";
  cont.innerHTML = alumnos.map((a) =>
    `<div class="card-item"><span>${esc(a.nombre)}</span>
      <button class="btn-del" data-del-alumno="${a.id}">Quitar</button></div>`).join("");
  cont.querySelectorAll("[data-del-alumno]").forEach((b) =>
    b.addEventListener("click", async () => {
      await db.deleteAlumno(b.dataset.delAlumno);
      renderAlumnos();
    }));
}

// ---- Configuración UI ----
function syncConfigForm() {
  $("cfg-titulo").value = config.titulo;
  $("cfg-nq").value = config.numQuestions;
  $("cfg-nopt").value = config.numOptions;
  $("cfg-exig").value = Math.round(config.exigencia * 100);
}
function readConfigForm() {
  config.titulo = $("cfg-titulo").value.trim() || "Prueba";
  config.numQuestions = clamp(+$("cfg-nq").value, 1, 50);
  config.numOptions = clamp(+$("cfg-nopt").value, 2, 5);
  config.exigencia = clamp(+$("cfg-exig").value, 40, 80) / 100;
  const k = config.key || [];
  k.length = config.numQuestions;
  for (let i = 0; i < config.numQuestions; i++) if (k[i] === undefined) k[i] = null;
  const valid = ALL.slice(0, config.numOptions);
  config.key = k.map((v) => (valid.includes(v) ? v : null));
}

function buildPauta() {
  const cont = $("pauta");
  cont.innerHTML = "";
  const valid = ALL.slice(0, config.numOptions);
  for (let i = 0; i < config.numQuestions; i++) {
    const row = document.createElement("div");
    row.className = "pauta-row";
    const qn = document.createElement("span");
    qn.className = "qn";
    qn.textContent = (i + 1) + ".";
    row.appendChild(qn);
    valid.forEach((opt) => {
      const b = document.createElement("button");
      b.className = "opt" + (config.key[i] === opt ? " sel" : "");
      b.textContent = opt;
      b.addEventListener("click", () => {
        config.key[i] = config.key[i] === opt ? null : opt;
        row.querySelectorAll(".opt").forEach((o) => o.classList.remove("sel"));
        if (config.key[i]) b.classList.add("sel");
      });
      row.appendChild(b);
    });
    cont.appendChild(row);
  }
}

["cfg-nq", "cfg-nopt"].forEach((id) =>
  $(id).addEventListener("change", () => { readConfigForm(); buildPauta(); sheetDirty = true; })
);
["cfg-titulo", "cfg-exig"].forEach((id) =>
  $(id).addEventListener("input", () => { sheetDirty = true; })
);
$("btn-guardar").addEventListener("click", () => {
  readConfigForm();
  saveConfig();
  $("cfg-status").textContent = "✓ Guardado";
  setTimeout(() => ($("cfg-status").textContent = ""), 2000);
});

// ---- Hoja ----
let sheetDirty = true;
function drawSheet() {
  readConfigForm();
  if (!sheetDirty) return;
  renderSheet($("sheet-container"), config, { titulo: config.titulo });
  sheetDirty = false;
}
$("btn-print").addEventListener("click", () => { drawSheet(); window.print(); });

// ---- Corregir ----
$("corr-curso").addEventListener("change", fillAlumnoSelect);
async function fillAlumnoSelect() {
  const cursoId = $("corr-curso").value;
  const sel = $("corr-alumno");
  if (!cursoId) { sel.innerHTML = `<option value="">— elige un curso —</option>`; return; }
  let alumnos = [];
  try { alumnos = await db.listAlumnos(cursoId); } catch {}
  sel.innerHTML = `<option value="">— elige alumno —</option>` +
    alumnos.map((a) => `<option value="${a.id}">${esc(a.nombre)}</option>`).join("");
}

$("foto").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const img = $("hidden-img");
  prepareCv();
  $("cv-status").textContent = "Procesando imagen…";
  $("cv-status").style.color = "#92400e";
  img.onload = () => runDetection(img);
  img.src = URL.createObjectURL(file);
});

async function runDetection(img) {
  try {
    const res = await detectSheet(img, config);
    if (!res.ok) {
      $("resultado").innerHTML = `<div class="nota-box warn">${res.error}</div>`;
      $("cv-status").textContent = "";
      return;
    }
    const detected = res.perQuestion.map((p) => p.answer);
    lastResult = { detected: detected.slice(), perQuestion: res.perQuestion, debugCanvas: res.debugCanvas };
    renderResult();
    $("cv-status").textContent = "";
  } catch (err) {
    $("resultado").innerHTML = `<div class="nota-box warn">Error al procesar: ${err.message}</div>`;
  }
}

function renderResult() {
  const detected = lastResult.detected;
  const { correct, total, detail } = gradeAnswers(detected, config.key);
  const nota = calcNota(correct, total, { ...SCALE, exigencia: config.exigencia });
  const pct = total ? Math.round((correct / total) * 100) : 0;
  const cont = $("resultado");

  const notaCls = nota < SCALE.notaAprob ? "bajo" : "";
  let html = `<div class="nota-box">
    <div class="nota-num ${notaCls}">${nota.toFixed(1)}</div>
    <div>
      <div><strong>${correct}/${total}</strong> correctas (${pct}%)</div>
      <div class="hint">Exigencia ${Math.round(config.exigencia * 100)}% · puedes corregir lecturas dudosas abajo</div>
    </div>
  </div>`;

  html += `<div class="detalle">`;
  detail.forEach((d, i) => {
    const p = lastResult.perQuestion[i];
    const cls = d.ok ? "ok" : (p && p.flag ? "flag" : "bad");
    const opts = (p ? p.options : ALL.slice(0, config.numOptions));
    const sel = detected[i] || "";
    const optionsHtml = `<option value="">—</option>` +
      opts.map((o) => `<option value="${o}" ${o === sel ? "selected" : ""}>${o}</option>`).join("");
    const flagTxt = p && p.flag === "doble" ? " ⚠doble" : (p && p.flag === "vacia" ? " ⚠vacía" : "");
    html += `<div class="dq ${cls}">
      <span>P${d.q}</span>
      <select data-q="${i}">${optionsHtml}</select>
      <span class="hint">↔${d.expected || "?"}${flagTxt}</span>
    </div>`;
  });
  html += `</div>`;

  if (lastResult.debugCanvas) {
    html += `<details class="debug-wrap"><summary>Ver hoja enderezada</summary></details>`;
  }
  html += `<div class="actions">
    <button id="btn-save-nota" class="primary">Guardar nota</button>
  </div>`;

  cont.innerHTML = html;

  cont.querySelectorAll("select[data-q]").forEach((s) => {
    s.addEventListener("change", () => {
      const idx = +s.dataset.q;
      lastResult.detected[idx] = s.value || null;
      renderResult();
    });
  });
  if (lastResult.debugCanvas) {
    cont.querySelector("details").appendChild(lastResult.debugCanvas);
  }
  $("btn-save-nota").addEventListener("click", saveNota);
}

async function saveNota() {
  const cursoId = $("corr-curso").value;
  if (!cursoId) { alert("Elige un curso antes de guardar la nota."); return; }
  const alumnoId = $("corr-alumno").value || null;
  const alumnoNombre = alumnoId
    ? $("corr-alumno").selectedOptions[0].textContent
    : "(sin nombre)";

  const { correct, total } = gradeAnswers(lastResult.detected, config.key);
  const nota = calcNota(correct, total, { ...SCALE, exigencia: config.exigencia });
  try {
    await db.addNota({
      curso_id: cursoId,
      alumno_id: alumnoId,
      alumno_nombre: alumnoNombre,
      prueba: config.titulo,
      correctas: correct,
      total,
      nota: Number(nota.toFixed(1)),
    });
    $("foto").value = "";
    if (alumnoId) $("corr-alumno").value = "";
    $("resultado").innerHTML = `<div class="nota-box">✓ Nota guardada (${nota.toFixed(1)}) para ${esc(alumnoNombre)}. Listo para la siguiente.</div>`;
    renderHist();
  } catch (e) {
    $("resultado").innerHTML = `<div class="nota-box warn">No se pudo guardar: ${esc(e.message)}</div>`;
  }
}

async function renderHist() {
  const cursoId = $("corr-curso").value;
  const cont = $("historial");
  if (!cont) return;
  if (!cursoId) { cont.innerHTML = `<p class="hint">Elige un curso para ver sus notas.</p>`; return; }
  let hist = [];
  try { hist = await db.listNotas(cursoId); } catch (e) { cont.innerHTML = `<p class="hint">No se pudieron cargar las notas.</p>`; return; }
  if (!hist.length) { cont.innerHTML = `<p class="hint">Aún no hay notas en este curso.</p>`; return; }
  let html = `<table class="hist"><tr><th>Alumno</th><th>Prueba</th><th>Correctas</th><th>Nota</th><th>Fecha</th><th></th></tr>`;
  hist.forEach((h) => {
    const fecha = new Date(h.fecha).toLocaleString("es-CL");
    html += `<tr><td>${esc(h.alumno_nombre || "")}</td><td>${esc(h.prueba || "")}</td><td>${h.correctas}/${h.total}</td><td><strong>${Number(h.nota).toFixed(1)}</strong></td><td>${esc(fecha)}</td><td><button class="btn-del" data-del-nota="${h.id}">✕</button></td></tr>`;
  });
  html += `</table>`;
  cont.innerHTML = html;
  cont.querySelectorAll("[data-del-nota]").forEach((b) =>
    b.addEventListener("click", async () => {
      await db.deleteNota(b.dataset.delNota);
      renderHist();
    }));
}

// ---- Exportar ----
async function getHistForExport() {
  const cursoId = $("corr-curso").value;
  if (!cursoId) { alert("Elige un curso para exportar sus notas."); return null; }
  const hist = await db.listNotas(cursoId);
  if (!hist.length) { alert("Ese curso no tiene notas todavía."); return null; }
  const curso = cursos.find((c) => c.id === cursoId);
  return { hist, curso };
}

$("btn-xlsx").addEventListener("click", async () => {
  const r = await getHistForExport();
  if (!r) return;
  const rows = [["Alumno", "Prueba", "Correctas", "Total", "Nota", "Fecha"]];
  r.hist.forEach((h) => rows.push([
    h.alumno_nombre || "", h.prueba || "", h.correctas, h.total,
    Number(h.nota), new Date(h.fecha).toLocaleString("es-CL"),
  ]));
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Notas");
  XLSX.writeFile(wb, `notas-${(r.curso?.nombre || "curso").replace(/[^\w]+/g, "_")}.xlsx`);
});

$("btn-csv").addEventListener("click", async () => {
  const r = await getHistForExport();
  if (!r) return;
  const rows = [["Alumno", "Prueba", "Correctas", "Total", "Nota", "Fecha"]];
  r.hist.forEach((h) => rows.push([
    h.alumno_nombre || "", h.prueba || "", h.correctas, h.total,
    Number(h.nota).toFixed(1), new Date(h.fecha).toLocaleString("es-CL"),
  ]));
  const csv = rows.map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `notas-${(r.curso?.nombre || "curso").replace(/[^\w]+/g, "_")}.csv`;
  a.click();
});

// ---- utils ----
function clamp(v, lo, hi) { v = Number(v) || lo; return Math.max(lo, Math.min(hi, Math.round(v))); }
function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

// ---- init (lo local funciona sin sesión; la nube se carga al loguear) ----
syncConfigForm();
readConfigForm();
buildPauta();
