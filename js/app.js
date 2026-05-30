import { renderSheet } from "./sheet.js";
import { detectSheet, preloadCv } from "./omr.js";
import { calcNota, gradeAnswers } from "./grading.js";

const ALL = ["A", "B", "C", "D", "E"];
const SCALE = { exigencia: 0.6, notaMin: 1.0, notaAprob: 4.0, notaMax: 7.0 };
const CFG_KEY = "ocr_config";
const HIST_KEY = "ocr_historial";

let config = loadConfig();
let lastResult = null; // { detected, override }

// ---- Persistencia ----
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
function loadHist() {
  try { return JSON.parse(localStorage.getItem(HIST_KEY)) || []; } catch { return []; }
}
function saveHist(h) { localStorage.setItem(HIST_KEY, JSON.stringify(h)); }

// ---- Tabs ----
document.querySelectorAll(".tab").forEach((t) => {
  t.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((x) => x.classList.remove("active"));
    document.querySelectorAll(".panel").forEach((x) => x.classList.remove("active"));
    t.classList.add("active");
    document.getElementById("tab-" + t.dataset.tab).classList.add("active");
    const sw = $("sheet-container");
    if (t.dataset.tab === "hoja") { sw.classList.remove("hidden"); drawSheet(); }
    else { sw.classList.add("hidden"); }
    if (t.dataset.tab === "corregir") prepareCv();
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

// ---- Configuración UI ----
const $ = (id) => document.getElementById(id);
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
  // Ajustar largo de la pauta.
  const k = config.key || [];
  k.length = config.numQuestions;
  for (let i = 0; i < config.numQuestions; i++) if (k[i] === undefined) k[i] = null;
  // Limpiar respuestas fuera de rango de opciones.
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
  if (!sheetDirty) return; // ya está dibujada para esta configuración
  renderSheet($("sheet-container"), config, { titulo: config.titulo });
  sheetDirty = false;
}
$("btn-print").addEventListener("click", () => { drawSheet(); window.print(); });

// ---- Corregir ----
$("foto").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const img = $("hidden-img");
  prepareCv(); // por si entró directo sin pasar por la pestaña
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
    <button id="btn-save-nota" class="primary">Guardar nota en la lista</button>
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

function saveNota() {
  const { correct, total } = gradeAnswers(lastResult.detected, config.key);
  const nota = calcNota(correct, total, { ...SCALE, exigencia: config.exigencia });
  const hist = loadHist();
  hist.push({
    alumno: $("alumno").value.trim() || "(sin nombre)",
    prueba: config.titulo,
    correctas: correct,
    total,
    nota: nota.toFixed(1),
    fecha: new Date().toLocaleString("es-CL"),
  });
  saveHist(hist);
  $("alumno").value = "";
  $("foto").value = "";
  $("resultado").innerHTML = `<div class="nota-box">✓ Nota guardada (${nota.toFixed(1)}). Listo para la siguiente prueba.</div>`;
  renderHist();
}

function renderHist() {
  const hist = loadHist();
  const cont = $("historial");
  if (!hist.length) { cont.innerHTML = `<p class="hint">Aún no hay notas guardadas.</p>`; return; }
  let html = `<table class="hist"><tr><th>Alumno</th><th>Correctas</th><th>Nota</th><th>Fecha</th></tr>`;
  hist.forEach((h) => {
    html += `<tr><td>${esc(h.alumno)}</td><td>${h.correctas}/${h.total}</td><td><strong>${h.nota}</strong></td><td>${esc(h.fecha)}</td></tr>`;
  });
  html += `</table>`;
  cont.innerHTML = html;
}

$("btn-csv").addEventListener("click", () => {
  const hist = loadHist();
  if (!hist.length) return;
  const rows = [["Alumno", "Prueba", "Correctas", "Total", "Nota", "Fecha"]];
  hist.forEach((h) => rows.push([h.alumno, h.prueba, h.correctas, h.total, h.nota, h.fecha]));
  const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "notas.csv";
  a.click();
});
$("btn-clear-hist").addEventListener("click", () => {
  if (confirm("¿Borrar toda la lista de notas guardadas?")) { saveHist([]); renderHist(); }
});

// ---- utils ----
function clamp(v, lo, hi) { v = Number(v) || lo; return Math.max(lo, Math.min(hi, Math.round(v))); }
function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

// ---- init ----
syncConfigForm();
readConfigForm();
buildPauta();
renderHist();
