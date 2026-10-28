/** La clave del tema elegido en `localStorage`, compartida con `ThemeToggle`. */
export const THEME_STORAGE_KEY = "portal-theme";

/**
 * Corre antes de pintar, inline en `<head>`: sin él, una página con el tema
 * fijado en claro se pintaría oscura un instante si el sistema prefiere oscuro.
 * Sólo lee una preferencia de presentación del navegador; no hay nada que
 * filtrar ni servidor que consultar. La CSP ya admite scripts inline.
 *
 * Vive fuera de `theme-toggle.tsx` porque el layout es un Server Component:
 * importar un valor de un módulo `"use client"` le daría una referencia de
 * cliente, no el texto.
 */
export const THEME_BOOTSTRAP_SCRIPT = `try{var t=localStorage.getItem("${THEME_STORAGE_KEY}");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;
