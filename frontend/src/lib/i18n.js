// Tiny dependency-free i18n. English source strings are the keys; locale files in
// src/locales/ map them to translations and are lazy-loaded (Vite code-splits each
// import.meta.glob entry), so the initial bundle stays English-only.
// Exercise instructions come from separately generated packs in src/instr/ (one per
// language, from the upstream dataset) — also lazy-loaded on language switch.
import { useSyncExternalStore } from 'react'

// UI languages: only Galician (default), Spanish and English.
// gl has no instruction pack upstream — instructions fall back to English.
export const DEFAULT_LANG = 'gl'
export const LANGS = {
  gl: 'Galego', es: 'Español', en: 'English'
}
export const INSTR_LANGS = ['en', 'es']
const DATE_LOCALES = {
  gl: 'gl-ES', es: 'es-ES', en: 'en-GB'
}

// Only the supported languages are bundled; any other file in these folders is ignored.
const localePacks = import.meta.glob(['../locales/gl.js', '../locales/es.js'])
const instrPacks = import.meta.glob(['../instr/es.js'])

let lang = DEFAULT_LANG
let dict = {}
let instr = null            // { exId: [steps] } for the current language, null = English
let version = 0
const subs = new Set()
const notify = () => { version++; subs.forEach(f => f()) }

export const getLang = () => lang
export const dateLocale = () => DATE_LOCALES[lang] || DATE_LOCALES[DEFAULT_LANG]
// A saved language that is no longer offered (e.g. 'fr' from an old profile) becomes Galician.
export const normLang = l => (LANGS[l] ? l : DEFAULT_LANG)

// Translate a source string; {0},{1}… are replaced with args (also on the English fallback).
export function t(s, ...args) {
  let v = dict[s] || s
  for (let i = 0; i < args.length; i++) v = v.replaceAll('{' + i + '}', args[i])
  return v
}
// Instructions for an exercise in the current language (English steps as fallback).
export const instrFor = ex => (instr && instr[ex.id]) || ex.st || []

export async function setLang(l) {
  l = normLang(l)
  if (l === lang && version > 0) return
  lang = l
  try {
    dict = l === 'en' ? {} : (await localePacks['../locales/' + l + '.js']()).default
    instr = l === 'en' || !INSTR_LANGS.includes(l) ? null : (await instrPacks['../instr/' + l + '.js']()).default
  } catch (e) { dict = {}; instr = null }
  notify()
}

// Re-renders the subscribing component (and its children) whenever the language changes.
export function useLang() {
  return useSyncExternalStore(fn => { subs.add(fn); return () => subs.delete(fn) }, () => version)
}
