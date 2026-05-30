// Cálculo de puntaje y nota (escala chilena con exigencia configurable).

// scale = { exigencia: 0.6, notaMin: 1.0, notaAprob: 4.0, notaMax: 7.0 }
export function calcNota(score, totalPoints, scale) {
  const e = scale.exigencia;
  const min = scale.notaMin;
  const aprob = scale.notaAprob;
  const max = scale.notaMax;
  const puntajeAprob = e * totalPoints;

  let nota;
  if (totalPoints <= 0) return min;
  if (score >= puntajeAprob) {
    const denom = totalPoints - puntajeAprob || 1;
    nota = aprob + ((score - puntajeAprob) / denom) * (max - aprob);
  } else {
    const denom = puntajeAprob || 1;
    nota = min + (score / denom) * (aprob - min);
  }
  nota = Math.max(min, Math.min(max, nota));
  return Math.round(nota * 10) / 10;
}

// Compara respuestas detectadas con la pauta.
// detected: array indexado por pregunta (0-based) con la letra o null.
// key: array con la letra correcta por pregunta.
export function gradeAnswers(detected, key) {
  const detail = [];
  let correct = 0;
  for (let i = 0; i < key.length; i++) {
    const got = detected[i] || null;
    const expected = key[i] || null;
    const ok = got !== null && got === expected;
    if (ok) correct++;
    detail.push({ q: i + 1, got, expected, ok });
  }
  return { correct, total: key.length, detail };
}
