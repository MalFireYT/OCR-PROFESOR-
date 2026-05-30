// Detección OMR con OpenCV.js: localizar marcas, enderezar y leer burbujas.
import { buildLayout, mmToWarpPx, WARP_W, WARP_H } from "./layout.js";

const OPENCV_URL = "https://docs.opencv.org/4.9.0/opencv.js";
let cvReadyPromise = null;

// Carga OpenCV.js bajo demanda (no al abrir la página, para no congelar la UI).
export function cvReady() {
  if (cvReadyPromise) return cvReadyPromise;
  cvReadyPromise = new Promise((resolve, reject) => {
    const onReady = () => {
      if (window.cv && window.cv.Mat) return resolve(window.cv);
      window.cv["onRuntimeInitialized"] = () => resolve(window.cv);
    };
    if (window.cv && window.cv.Mat) return resolve(window.cv);
    const existing = document.getElementById("opencv-js");
    if (existing) { existing.addEventListener("load", onReady); return; }
    const s = document.createElement("script");
    s.id = "opencv-js";
    s.async = true;
    s.src = OPENCV_URL;
    s.onload = onReady;
    s.onerror = () => reject(new Error("No se pudo cargar el motor de visión (¿conexión a internet?)."));
    document.body.appendChild(s);
  });
  return cvReadyPromise;
}

const ABS_MIN_FILL = 0.30;   // mínimo para considerar una burbuja marcada
const DOUBLE_MARGIN = 0.15;  // margen entre 1ra y 2da para detectar doble marca

// imgEl: HTMLImageElement o canvas ya cargado.
// config: { numQuestions, numOptions }
export async function detectSheet(imgEl, config) {
  const cv = await cvReady();
  const layout = buildLayout(config);

  const src = cv.imread(imgEl);
  const gray = new cv.Mat();
  cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

  const corners = findFiducials(cv, gray);
  if (!corners) {
    src.delete(); gray.delete();
    return { ok: false, error: "No se detectaron las 4 marcas de esquina. Asegúrate de que toda la hoja salga en la foto, con buena luz y sin reflejos." };
  }

  // Enderezar (corrección de perspectiva) a un tamaño canónico.
  const srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
    corners.tl.x, corners.tl.y,
    corners.tr.x, corners.tr.y,
    corners.br.x, corners.br.y,
    corners.bl.x, corners.bl.y,
  ]);
  const dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
    0, 0, WARP_W, 0, WARP_W, WARP_H, 0, WARP_H,
  ]);
  const M = cv.getPerspectiveTransform(srcTri, dstTri);
  const warped = new cv.Mat();
  cv.warpPerspective(gray, warped, M, new cv.Size(WARP_W, WARP_H));

  // Binarizar robusto a iluminación despareja.
  const bin = new cv.Mat();
  cv.adaptiveThreshold(
    warped, bin, 255,
    cv.ADAPTIVE_THRESH_MEAN_C, cv.THRESH_BINARY_INV, 41, 12
  );

  const perQuestion = readBubbles(cv, bin, layout);

  // Canvas de depuración (hoja enderezada con marcas detectadas).
  const debugCanvas = makeDebugCanvas(cv, warped, layout, perQuestion);

  src.delete(); gray.delete(); warped.delete(); bin.delete();
  srcTri.delete(); dstTri.delete(); M.delete();

  return { ok: true, perQuestion, debugCanvas, layout };
}

function findFiducials(cv, gray) {
  const blur = new cv.Mat();
  cv.GaussianBlur(gray, blur, new cv.Size(5, 5), 0);
  const bin = new cv.Mat();
  cv.threshold(blur, bin, 0, 255, cv.THRESH_BINARY_INV + cv.THRESH_OTSU);

  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  cv.findContours(bin, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

  const imgArea = gray.rows * gray.cols;
  const candidates = [];
  for (let i = 0; i < contours.size(); i++) {
    const c = contours.get(i);
    const area = cv.contourArea(c);
    if (area < imgArea * 0.0002 || area > imgArea * 0.05) { c.delete(); continue; }
    const rect = cv.boundingRect(c);
    const ar = rect.width / rect.height;
    const solidity = area / (rect.width * rect.height);
    if (ar > 0.6 && ar < 1.6 && solidity > 0.75) {
      candidates.push({
        cx: rect.x + rect.width / 2,
        cy: rect.y + rect.height / 2,
        area,
      });
    }
    c.delete();
  }
  contours.delete(); hierarchy.delete(); blur.delete(); bin.delete();

  if (candidates.length < 4) return null;

  const W = gray.cols, H = gray.rows;
  const pick = (tx, ty) => {
    let best = null, bestD = Infinity;
    for (const c of candidates) {
      const d = (c.cx - tx) ** 2 + (c.cy - ty) ** 2;
      if (d < bestD) { bestD = d; best = c; }
    }
    return best;
  };
  const tl = pick(0, 0);
  const tr = pick(W, 0);
  const br = pick(W, H);
  const bl = pick(0, H);

  // Validar que sean 4 puntos distintos y formen un área razonable.
  const pts = [tl, tr, br, bl];
  for (let i = 0; i < 4; i++)
    for (let j = i + 1; j < 4; j++)
      if (Math.hypot(pts[i].cx - pts[j].cx, pts[i].cy - pts[j].cy) < W * 0.1)
        return null;

  return {
    tl: { x: tl.cx, y: tl.cy },
    tr: { x: tr.cx, y: tr.cy },
    br: { x: br.cx, y: br.cy },
    bl: { x: bl.cx, y: bl.cy },
  };
}

function readBubbles(cv, bin, layout) {
  const data = bin.data; // Uint8, 255 = marca
  const width = bin.cols, height = bin.rows;
  const sampleR = Math.round(2.0 * 4); // 2mm * px_per_mm

  // Agrupar burbujas por pregunta.
  const byQ = new Map();
  for (const b of layout.bubbles) {
    if (!byQ.has(b.q)) byQ.set(b.q, []);
    byQ.get(b.q).push(b);
  }

  const result = [];
  for (let q = 1; q <= layout.numQuestions; q++) {
    const opts = byQ.get(q);
    const fills = opts.map((b) => {
      const c = mmToWarpPx(b.x, b.y);
      return fillRatio(data, width, height, c.x, c.y, sampleR);
    });

    let best = 0, second = 0, bestIdx = -1;
    fills.forEach((f, i) => {
      if (f > best) { second = best; best = f; bestIdx = i; }
      else if (f > second) { second = f; }
    });

    let answer = null, flag = null;
    if (best < ABS_MIN_FILL) {
      flag = "vacia";
    } else if (best - second < DOUBLE_MARGIN && second >= ABS_MIN_FILL) {
      flag = "doble";
    } else {
      answer = opts[bestIdx].option;
    }
    result.push({ q, answer, fills, flag, options: opts.map((o) => o.option) });
  }
  return result;
}

function fillRatio(data, width, height, cx, cy, r) {
  let dark = 0, total = 0;
  const x0 = Math.max(0, Math.round(cx - r));
  const x1 = Math.min(width - 1, Math.round(cx + r));
  const y0 = Math.max(0, Math.round(cy - r));
  const y1 = Math.min(height - 1, Math.round(cy + r));
  const r2 = r * r;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx, dy = y - cy;
      if (dx * dx + dy * dy > r2) continue;
      total++;
      if (data[y * width + x] > 127) dark++;
    }
  }
  return total ? dark / total : 0;
}

function makeDebugCanvas(cv, warped, layout, perQuestion) {
  const canvas = document.createElement("canvas");
  canvas.width = WARP_W;
  canvas.height = WARP_H;
  cv.imshow(canvas, warped);
  const ctx = canvas.getContext("2d");
  const ansByQ = new Map(perQuestion.map((p) => [p.q, p]));
  ctx.lineWidth = 2;
  for (const b of layout.bubbles) {
    const c = mmToWarpPx(b.x, b.y);
    const p = ansByQ.get(b.q);
    const chosen = p && p.answer === b.option;
    ctx.beginPath();
    ctx.arc(c.x, c.y, 12, 0, Math.PI * 2);
    ctx.strokeStyle = chosen ? "#16a34a" : "rgba(120,120,120,0.5)";
    ctx.lineWidth = chosen ? 3 : 1;
    ctx.stroke();
  }
  return canvas;
}
