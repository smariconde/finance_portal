---
version: 2
slug: "src-app-not-found-tsx"
primary_target: "src/app/not-found.tsx"
related_targets:
  [
    "src/app/_components/runtime-locked-notice.tsx",
    "src/app/_components/portal-shell.tsx",
    "src/app/layout.tsx",
  ]
---

# 404 del portal

- Scope: la respuesta a una dirección que no corresponde a ninguna superficie, dentro del shell compartido.
- Visitor mode: Operate.
- Audience: el owner que llegó desde un enlace guardado o una ruta que cambió de nombre entre slices.
- Job: entender en un vistazo que la ruta no existe —no que el portal falló— y volver a una superficie real sin buscar el camino.
- Content: título, el código de estado dicho en prosa, por qué el portal sólo sirve lo que la navegación enumera, la nota de que un enlace guardado puede haber quedado viejo, y un único enlace de vuelta al inicio.
- Direction: comparte forma con `RuntimeLockedNotice` —una card en `max-w-3xl`, `h1` con icono inline— para que las dos superficies que dicen que no se reconozcan como la misma familia.
- Memorable moment: la explicación de que lo no construido aparece marcado como planificado en vez de responder con una página vacía; el estado de error enseña la regla del producto.
- Constraints: no adivina el destino ni ofrece una búsqueda que el portal no puede resolver todavía —el universo canónico llega en Fase 2—; sin `404` como número gigante, que es la plantilla de hero-métrica que el craft floor rechaza; conserva shell, foco visible y reflow.
- Unresolved: cuando exista búsqueda real (`F2-06`), evaluar si esta superficie debe ofrecerla; hoy sería una capacidad inventada.
