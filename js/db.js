// Cliente Supabase + capa de datos (auth, cursos, alumnos, notas).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = "https://zuumtainozzyidslfngx.supabase.co";
// Clave anonima (publica, segura para el navegador). NUNCA poner aqui la service_role.
const SUPABASE_ANON =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp1dW10YWlub3p6eWlkc2xmbmd4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAxMDQ4NDYsImV4cCI6MjA5NTY4MDg0Nn0.EAnCzmXeFhDuqITYM5nMhJkquTi9bI1pe0lGUUFulFU";

export const supa = createClient(SUPABASE_URL, SUPABASE_ANON);

// ---- Auth ----
export async function signIn(email, password) {
  const { data, error } = await supa.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data.user;
}
export async function signUp(email, password) {
  const { data, error } = await supa.auth.signUp({ email, password });
  if (error) throw error;
  return data;
}
export async function signOut() {
  await supa.auth.signOut();
}
export async function getUser() {
  const { data } = await supa.auth.getUser();
  return data.user || null;
}
export function onAuthChange(cb) {
  supa.auth.onAuthStateChange((_event, session) => cb(session?.user || null));
}

// ---- Cursos ----
export async function listCursos() {
  const { data, error } = await supa
    .from("cursos").select("*").order("created_at", { ascending: true });
  if (error) throw error;
  return data;
}
export async function addCurso(nombre, materia) {
  const user = await getUser();
  const { data, error } = await supa
    .from("cursos").insert({ user_id: user.id, nombre, materia }).select().single();
  if (error) throw error;
  return data;
}
export async function deleteCurso(id) {
  const { error } = await supa.from("cursos").delete().eq("id", id);
  if (error) throw error;
}

// ---- Alumnos (nomina) ----
export async function listAlumnos(cursoId) {
  const { data, error } = await supa
    .from("alumnos").select("*").eq("curso_id", cursoId)
    .order("nombre", { ascending: true });
  if (error) throw error;
  return data;
}
export async function addAlumnos(cursoId, nombres) {
  const user = await getUser();
  const rows = nombres
    .map((n) => n.trim()).filter(Boolean)
    .map((nombre) => ({ user_id: user.id, curso_id: cursoId, nombre }));
  if (!rows.length) return [];
  const { data, error } = await supa.from("alumnos").insert(rows).select();
  if (error) throw error;
  return data;
}
export async function deleteAlumno(id) {
  const { error } = await supa.from("alumnos").delete().eq("id", id);
  if (error) throw error;
}

// ---- Notas ----
export async function listNotas(cursoId) {
  let q = supa.from("notas").select("*").order("fecha", { ascending: false });
  if (cursoId) q = q.eq("curso_id", cursoId);
  const { data, error } = await q;
  if (error) throw error;
  return data;
}
export async function addNota(nota) {
  const user = await getUser();
  const { data, error } = await supa
    .from("notas").insert({ ...nota, user_id: user.id }).select().single();
  if (error) throw error;
  return data;
}
export async function deleteNota(id) {
  const { error } = await supa.from("notas").delete().eq("id", id);
  if (error) throw error;
}
