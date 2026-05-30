// Geometría compartida entre el generador de la hoja y el detector OMR.
// Todo en milímetros sobre una página A4 vertical (210 x 297 mm).
// Las 4 marcas de esquina (fiduciales) definen el sistema de coordenadas.

export const PAGE = { w: 210, h: 297 };

// Centros de las marcas fiduciales (cuadrados negros sólidos).
export const FID = {
  tl: { x: 18, y: 18 },
  tr: { x: 192, y: 18 },
  bl: { x: 18, y: 279 },
  br: { x: 192, y: 279 },
};
export const FID_SIZE = 10; // lado del cuadrado en mm

// Rectángulo definido por los centros de las marcas.
export const FID_RECT = {
  x: FID.tl.x,
  y: FID.tl.y,
  w: FID.tr.x - FID.tl.x, // 174
  h: FID.bl.y - FID.tl.y, // 261
};

// Resolución de la imagen "enderezada" (px por mm).
export const PX_PER_MM = 4;
export const WARP_W = Math.round(FID_RECT.w * PX_PER_MM); // 696
export const WARP_H = Math.round(FID_RECT.h * PX_PER_MM); // 1044

const ALL_OPTIONS = ["A", "B", "C", "D", "E"];

// Construye todas las posiciones de burbujas a partir de la config.
// config = { numQuestions: 1..50, numOptions: 2..5 }
export function buildLayout(config) {
  const numQuestions = clamp(config.numQuestions, 1, 50);
  const numOptions = clamp(config.numOptions, 2, 5);
  const options = ALL_OPTIONS.slice(0, numOptions);

  const nCols = numQuestions > 25 ? 2 : 1;
  const rowsPerCol = Math.ceil(numQuestions / nCols);

  // Zona de burbujas dentro del rectángulo fiducial.
  const areaX = 24;        // margen izq respecto a la página
  const areaRight = 186;   // margen der
  const gridTop = 64;      // deja espacio para encabezado (nombre)
  const gridBottom = 272;  // sobre las marcas inferiores

  const areaW = areaRight - areaX;
  const colW = areaW / nCols;
  const usableH = gridBottom - gridTop;
  const rowH = Math.min(9, usableH / rowsPerCol);

  const numLabelDX = 3;     // posición del número de pregunta dentro de la columna
  const firstBubbleDX = 15; // primera burbuja
  const optSpacing = Math.min(10, (colW - firstBubbleDX - 4) / numOptions);
  const bubbleDiam = 5.5;

  const bubbles = []; // { q, option, optIndex, x, y }
  const rowAnchors = []; // { q, x, y } para dibujar el número de pregunta

  for (let i = 0; i < numQuestions; i++) {
    const col = Math.floor(i / rowsPerCol);
    const rowInCol = i % rowsPerCol;
    const colX = areaX + col * colW;
    const y = gridTop + rowInCol * rowH + rowH / 2;
    rowAnchors.push({ q: i + 1, x: colX + numLabelDX, y });
    for (let o = 0; o < numOptions; o++) {
      const x = colX + firstBubbleDX + o * optSpacing;
      bubbles.push({ q: i + 1, option: options[o], optIndex: o, x, y });
    }
  }

  return {
    numQuestions,
    numOptions,
    options,
    nCols,
    rowsPerCol,
    bubbleDiam,
    bubbles,
    rowAnchors,
    optSpacing,
  };
}

// Convierte un punto en mm (relativo al rectángulo fiducial) a píxeles
// de la imagen enderezada.
export function mmToWarpPx(xMm, yMm) {
  return {
    x: (xMm - FID_RECT.x) * PX_PER_MM,
    y: (yMm - FID_RECT.y) * PX_PER_MM,
  };
}

function clamp(v, lo, hi) {
  v = Number(v) || lo;
  return Math.max(lo, Math.min(hi, Math.round(v)));
}
