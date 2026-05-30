// Interfaz (hilo principal) hacia el Web Worker que corre OpenCV.
import { buildLayout, mmToWarpPx, WARP_W, WARP_H } from "./layout.js";

const OPENCV_URL = "https://docs.opencv.org/4.9.0/opencv.js";
const MAX_DIM = 1600; // reducir la foto antes de procesar (mucho más rápido)

let worker = null;
let readyPromise = null;
let readyResolve = null, readyReject = null;
const pending = new Map();
let reqId = 0;

function getWorker() {
  if (worker) return worker;
  worker = new Worker("js/omr.worker.js");
  worker.onmessage = (e) => {
    const m = e.data;
    if (m.type === "ready") { if (readyResolve) readyResolve(); return; }
    if (m.type === "initerror") { if (readyReject) readyReject(new Error(m.error)); readyPromise = null; return; }
    if (m.type === "result" || m.type === "detecterror") {
      const p = pending.get(m.id);
      if (!p) return;
      pending.delete(m.id);
      if (m.type === "result") p.resolve(m);
      else p.reject(new Error(m.error));
    }
  };
  worker.onerror = (err) => {
    if (readyReject) readyReject(new Error("Error en el motor: " + err.message));
    readyPromise = null;
  };
  return worker;
}

// Empieza a cargar OpenCV en segundo plano (no congela la interfaz).
export function preloadCv() {
  if (readyPromise) return readyPromise;
  readyPromise = new Promise((res, rej) => { readyResolve = res; readyReject = rej; });
  getWorker().postMessage({ type: "init", url: OPENCV_URL });
  return readyPromise;
}

export async function detectSheet(imgEl, config) {
  await preloadCv();
  const layout = buildLayout(config);
  const imageData = toImageData(imgEl, MAX_DIM);
  const geom = {
    warpW: WARP_W,
    warpH: WARP_H,
    numQuestions: layout.numQuestions,
    numOptions: layout.numOptions,
    bubbles: layout.bubbles.map((b) => {
      const p = mmToWarpPx(b.x, b.y);
      return { q: b.q, optIndex: b.optIndex, option: b.option, px: p.x, py: p.y };
    }),
  };

  const id = ++reqId;
  const result = await new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ type: "detect", id, imageData, geom }, [imageData.data.buffer]);
  });

  if (!result.ok) return { ok: false, error: result.error };
  const debugCanvas = buildDebug(result.warped, geom, result.perQuestion);
  return { ok: true, perQuestion: result.perQuestion, debugCanvas, layout };
}

function toImageData(imgEl, maxDim) {
  let w = imgEl.naturalWidth || imgEl.width;
  let h = imgEl.naturalHeight || imgEl.height;
  const scale = Math.min(1, maxDim / Math.max(w, h));
  w = Math.max(1, Math.round(w * scale));
  h = Math.max(1, Math.round(h * scale));
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(imgEl, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

function buildDebug(warped, geom, perQuestion) {
  const canvas = document.createElement("canvas");
  canvas.width = warped.width;
  canvas.height = warped.height;
  const ctx = canvas.getContext("2d");
  ctx.putImageData(new ImageData(new Uint8ClampedArray(warped.data), warped.width, warped.height), 0, 0);
  const ansByQ = new Map(perQuestion.map((p) => [p.q, p]));
  for (const b of geom.bubbles) {
    const p = ansByQ.get(b.q);
    const chosen = p && p.answer === b.option;
    ctx.beginPath();
    ctx.arc(b.px, b.py, 12, 0, Math.PI * 2);
    ctx.strokeStyle = chosen ? "#16a34a" : "rgba(120,120,120,0.5)";
    ctx.lineWidth = chosen ? 3 : 1;
    ctx.stroke();
  }
  return canvas;
}
