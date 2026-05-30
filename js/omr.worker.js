// Web Worker: corre OpenCV.js en un hilo aparte para no congelar la interfaz.
let ready = false;

self.Module = {
  onRuntimeInitialized() {
    ready = true;
    self.postMessage({ type: "ready" });
  },
};

self.onmessage = function (e) {
  const msg = e.data;
  if (msg.type === "init") {
    if (ready) { self.postMessage({ type: "ready" }); return; }
    try {
      self.importScripts(msg.url);
    } catch (err) {
      self.postMessage({ type: "initerror", error: "No se pudo cargar OpenCV (¿conexión a internet?)." });
    }
    return;
  }
  if (msg.type === "detect") {
    if (!ready) { self.postMessage({ type: "detecterror", id: msg.id, error: "El motor aún no está listo." }); return; }
    try {
      const r = detect(msg.imageData, msg.geom);
      const transfer = r.warped ? [r.warped.data.buffer] : [];
      self.postMessage({ type: "result", id: msg.id, ...r }, transfer);
    } catch (err) {
      self.postMessage({ type: "detecterror", id: msg.id, error: String((err && err.message) || err) });
    }
  }
};

const ABS_MIN_FILL = 0.30;
const DOUBLE_MARGIN = 0.15;
const SAMPLE_R = 8; // 2mm * 4 px/mm

function detect(imageData, geom) {
  const cv = self.cv;
  const src = cv.matFromImageData(imageData);
  const gray = new cv.Mat();
  cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

  const corners = findFiducials(cv, gray);
  if (!corners) {
    src.delete(); gray.delete();
    return { ok: false, error: "No se detectaron las 4 marcas de esquina. Asegúrate de que toda la hoja salga en la foto, con buena luz y sin reflejos." };
  }

  const srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
    corners.tl.x, corners.tl.y, corners.tr.x, corners.tr.y,
    corners.br.x, corners.br.y, corners.bl.x, corners.bl.y,
  ]);
  const dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
    0, 0, geom.warpW, 0, geom.warpW, geom.warpH, 0, geom.warpH,
  ]);
  const M = cv.getPerspectiveTransform(srcTri, dstTri);
  const warped = new cv.Mat();
  cv.warpPerspective(gray, warped, M, new cv.Size(geom.warpW, geom.warpH));

  const bin = new cv.Mat();
  cv.adaptiveThreshold(warped, bin, 255, cv.ADAPTIVE_THRESH_MEAN_C, cv.THRESH_BINARY_INV, 41, 12);

  const perQuestion = readBubbles(bin, geom);

  // Imagen enderezada (RGBA) para el panel de depuración.
  const rgba = new cv.Mat();
  cv.cvtColor(warped, rgba, cv.COLOR_GRAY2RGBA);
  const warpedData = new Uint8ClampedArray(rgba.data);

  src.delete(); gray.delete(); warped.delete(); bin.delete();
  srcTri.delete(); dstTri.delete(); M.delete(); rgba.delete();

  return { ok: true, perQuestion, warped: { width: geom.warpW, height: geom.warpH, data: warpedData } };
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
      candidates.push({ cx: rect.x + rect.width / 2, cy: rect.y + rect.height / 2, area });
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
  const tl = pick(0, 0), tr = pick(W, 0), br = pick(W, H), bl = pick(0, H);
  const pts = [tl, tr, br, bl];
  for (let i = 0; i < 4; i++)
    for (let j = i + 1; j < 4; j++)
      if (Math.hypot(pts[i].cx - pts[j].cx, pts[i].cy - pts[j].cy) < W * 0.1) return null;

  return {
    tl: { x: tl.cx, y: tl.cy }, tr: { x: tr.cx, y: tr.cy },
    br: { x: br.cx, y: br.cy }, bl: { x: bl.cx, y: bl.cy },
  };
}

function readBubbles(bin, geom) {
  const data = bin.data;
  const width = bin.cols, height = bin.rows;
  const byQ = new Map();
  for (const b of geom.bubbles) {
    if (!byQ.has(b.q)) byQ.set(b.q, []);
    byQ.get(b.q).push(b);
  }
  const result = [];
  for (let q = 1; q <= geom.numQuestions; q++) {
    const opts = byQ.get(q);
    const fills = opts.map((b) => fillRatio(data, width, height, b.px, b.py, SAMPLE_R));
    let best = 0, second = 0, bestIdx = -1;
    fills.forEach((f, i) => {
      if (f > best) { second = best; best = f; bestIdx = i; }
      else if (f > second) { second = f; }
    });
    let answer = null, flag = null;
    if (best < ABS_MIN_FILL) flag = "vacia";
    else if (best - second < DOUBLE_MARGIN && second >= ABS_MIN_FILL) flag = "doble";
    else answer = opts[bestIdx].option;
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
