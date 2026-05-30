// Genera la hoja de respuesta imprimible (A4) en mm.
import { PAGE, FID, FID_SIZE, buildLayout } from "./layout.js";

export function renderSheet(container, config, meta = {}) {
  const layout = buildLayout(config);
  container.innerHTML = "";

  const page = el("div", "sheet");
  page.style.width = PAGE.w + "mm";
  page.style.height = PAGE.h + "mm";

  // Marcas fiduciales (cuadrados negros sólidos en las 4 esquinas).
  for (const key of ["tl", "tr", "bl", "br"]) {
    const f = FID[key];
    const sq = el("div", "fiducial");
    place(sq, f.x - FID_SIZE / 2, f.y - FID_SIZE / 2);
    sq.style.width = FID_SIZE + "mm";
    sq.style.height = FID_SIZE + "mm";
    page.appendChild(sq);
  }

  // Encabezado: título + datos del alumno (a mano).
  const header = el("div", "sheet-header");
  place(header, 24, 22);
  header.style.width = "162mm";
  header.innerHTML = `
    <div class="sheet-title">${escapeHtml(meta.titulo || "Prueba")}</div>
    <div class="sheet-fields">
      <span>Nombre: ____________________________________</span>
      <span>Curso: __________</span>
      <span>Fecha: __________</span>
    </div>
    <div class="sheet-hint">Rellena completamente la burbuja. Usa lápiz pasta o grafito oscuro.</div>
  `;
  page.appendChild(header);

  // Encabezado de opciones (A B C ...) arriba de cada columna.
  for (const h of layout.headers) {
    const lab = el("div", "opt-header");
    lab.style.position = "absolute";
    lab.style.left = h.x + "mm";
    lab.style.top = h.y + "mm";
    lab.style.transform = "translateX(-50%)";
    lab.textContent = h.label;
    page.appendChild(lab);
  }

  // Números de pregunta + etiquetas de opción.
  for (const a of layout.rowAnchors) {
    const num = el("div", "qnum");
    place(num, a.x - 2, a.y - 2.5);
    num.textContent = a.q + ".";
    page.appendChild(num);
  }

  // Burbujas con su letra dentro.
  for (const b of layout.bubbles) {
    const d = layout.bubbleDiam;
    const bubble = el("div", "bubble");
    place(bubble, b.x - d / 2, b.y - d / 2);
    bubble.style.width = d + "mm";
    bubble.style.height = d + "mm";
    bubble.textContent = b.option;
    page.appendChild(bubble);
  }

  container.appendChild(page);
  return layout;
}

function el(tag, cls) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}
function place(e, xMm, yMm) {
  e.style.position = "absolute";
  e.style.left = xMm + "mm";
  e.style.top = yMm + "mm";
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}
