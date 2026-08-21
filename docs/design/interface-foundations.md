# Interface foundations and evidence

- Estado: implementado para `F1-UI-01`; revisión visual automatizada pendiente por limitación del navegador integrado
- Fecha: 2026-08-21
- Superficies implementadas: home `/`, configuración `/configuracion` y shell compartido
- Modo de interacción: `Operate`
- Dirección: `Workspace financiero estándar`
- Canon: `shadcn-finance-20260821`
- Tracker: [`../backlog/README.md`](../backlog/README.md#f1-ui-01--fundación-shadcn-y-migración-visual)

## Propósito

Este contrato evita que una portada experimental o un screenshot aislado se conviertan
en la plantilla accidental del producto. El portal usa convenciones conocidas de
software financiero: sidebar colapsable, header compacto, tarjetas de resumen,
tablas semánticas, estados explícitos y profundidad progresiva.

La familiaridad es una decisión de producto. El carácter surge de la calidad de la
información —unidades, fechas, provenance, comparabilidad y densidad numérica—, no de
inventar controles o geometrías propias.

## Orden de autoridad

1. [`../product/prd.md`](../product/prd.md), roadmap y contratos financieros definen
   verdad, alcance, estados y contenido.
2. [`../../PRODUCT.md`](../../PRODUCT.md) fija los compromisos de marca y el uso
   `shadcn-first` solicitado por el usuario.
3. [`../../DESIGN.md`](../../DESIGN.md) define tokens, componentes y reglas durables.
4. Los briefs de [home](../../.impeccable/surfaces/src-app-page-tsx.md) y
   [configuración](../../.impeccable/surfaces/src-app-configuracion-page-tsx.md)
   definen la composición de cada superficie.
5. [`../../src/app/globals.css`](../../src/app/globals.css), `src/components/ui/` y
   las páginas son la evidencia ejecutable.

Un sidecar o screenshot ayuda a revisar, pero no reemplaza estos niveles de autoridad.

## Baseline implementado

| Área        | Decisión                                                                                                |
| ----------- | ------------------------------------------------------------------------------------------------------- |
| Componentes | shadcn CLI con primitivas Base UI editables en `src/components/ui/`                                     |
| Navegación  | sidebar colapsable en escritorio y drawer en mobile; sólo Inicio y Configuración son rutas activas      |
| Layout      | header de 3.5rem, contenido máximo de 80rem, gutters responsivos y footer discreto                      |
| Superficies | fondo neutral, cards blancas con borde/ring suave, radio base de 0.75rem y sin glass/gradientes         |
| Color       | azul funcional para interacción; verde, ámbar y neutral sólo para estados acompañados por icono y texto |
| Tipografía  | Archivo Variable local; escala operativa fija y numerales tabulares para datos comparables              |
| Estado      | `ready                                                                                                  | degraded | disabled | planned` mediante badge, icono y etiqueta; nunca sólo color |
| Responsive  | grids apilan, sidebar pasa a drawer y las tablas anchas conservan scroll horizontal                     |
| Movimiento  | transiciones propias de componentes; `prefers-reduced-motion` reduce animación y scroll                 |

## Wireframe de referencia

### Escritorio

```text
┌──────── sidebar ────────┬───────────────────────────────────────────┐
│ marca / workspace       │ header compacto                  modo     │
│ Inicio                  ├───────────────────────────────────────────┤
│ Configuración           │ título + contexto                         │
│                         │ alerta operativa                          │
│ Herramientas plan       │ resumen en 3 métricas                     │
│                         │ cards / tabla / evidencia según la tarea  │
│ modo                    │                                           │
└─────────────────────────┴───────────────────────────────────────────┘
```

### Mobile

```text
┌─────────────────────────┐
│ menú  Portal       modo │
├─────────────────────────┤
│ título + contexto       │
│ alerta                  │
│ métricas apiladas       │
│ contenido en una col.   │
│ tabla con scroll        │
└─────────────────────────┘
```

## Componentes y límites

- Reutilizar `Button`, `Input`, `Badge`, `Alert`, `Card`, `Table`, `Sidebar`,
  `Sheet`, `Tooltip`, `Separator` y `Skeleton` antes de crear una primitiva nueva.
- Las cards agrupan una decisión o bloque real; no encapsulan cada línea, etiqueta o
  gráfico por decoración.
- Un control futuro se muestra deshabilitado sólo cuando explica por qué y cuándo se
  habilita. Las rutas planificadas no son enlaces.
- Fuente, fecha, unidad, moneda, transformación y estado viajan con el resultado.
- No hay charts decorativos en el shell o en la home. El primer chart real activa
  `financial-visualization-review` y usa Recharts/shadcn por defecto.
- ECharts o Canvas requieren un feature gap o presupuesto medido y permanecen
  route-local con carga diferida.

## Evidencia de `F1-UI-01`

| Gate                            | Resultado                                                                                                                  |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `pnpm lint`                     | pasa sin warnings                                                                                                          |
| `pnpm typecheck`                | pasa                                                                                                                       |
| `pnpm test`                     | 20/20 tests pasan, sin red                                                                                                 |
| `pnpm build`                    | pasa; `/` y `/configuracion` prerenderizan estáticamente                                                                   |
| Detector Impeccable             | `[]` sobre home, configuración, shell, sidebar, estados y CSS                                                              |
| Revisión browser desktop/mobile | no ejecutada: el navegador integrado rechazó la sesión por metadata de sandbox; no se sustituyó por automatización externa |

La ausencia de captura no se presenta como evidencia positiva. La inspección manual
desktop/mobile sigue siendo el follow-up de `UI-02`; cualquier hallazgo visual reabre
`F1-UI-01` antes de ampliar el sistema.

## Reglas para el siguiente cambio visual

1. Leer `PRODUCT.md`, `DESIGN.md`, este contrato y el brief de la ruta.
2. Usar Impeccable antes de editar UI y `financial-visualization-review` cuando haya
   datos financieros visualizados.
3. Empezar por componentes shadcn existentes y justificar cualquier primitiva propia.
4. Usar datos y estados del slice real; no crear números ambiguos ni capacidades falsas.
5. Revisar desktop y mobile en lote, corregir y confirmar una vez más.
6. Registrar contraste, teclado, reflow, tooltip accesible y alternativa tabular al
   introducir gráficos.
7. Convertir una corrección repetible en candidato de mejora del skill; nunca dejar
   que el skill se autoedite sin autorización y evidencia.
