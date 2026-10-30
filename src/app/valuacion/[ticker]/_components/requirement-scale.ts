/**
 * Posiciones de la barra de una exigencia (`F6-28`): lo que mostró la
 * empresa, lo que usa el modelo y lo que exige el precio, sobre un mismo eje.
 *
 * Es geometría de dibujo, no aritmética financiera: los valores ya vienen
 * calculados y la barra sólo los ubica en porcentaje del ancho. El eje
 * empieza en cero —o en el menor valor, si alguno es negativo— y deja un
 * margen a la derecha para que la marca más alta no toque el borde.
 */
export type RequirementMarks = {
  readonly shown: string | null;
  readonly model: string | null;
  readonly required: string | null;
};

export type RequirementScale = {
  readonly shown: number | null;
  readonly model: number | null;
  readonly required: number | null;
  /** Dónde cae el cero, para dibujar la línea de base si el eje lo cruza. */
  readonly zero: number;
};

const HEADROOM = 1.12;

export function requirementScale(marks: RequirementMarks): RequirementScale {
  const values = [marks.shown, marks.model, marks.required]
    .map((value) => (value === null ? null : Number(value)))
    .filter(
      (value): value is number => value !== null && Number.isFinite(value),
    );
  const lower = Math.min(0, ...values);
  const upper = Math.max(0, ...values);
  const span = (upper - lower) * HEADROOM;
  const at = (value: string | null): number | null => {
    if (value === null) return null;
    const number = Number(value);
    if (!Number.isFinite(number)) return null;
    return span === 0 ? 0 : ((number - lower) / span) * 100;
  };

  return {
    shown: at(marks.shown),
    model: at(marks.model),
    required: at(marks.required),
    zero: span === 0 ? 0 : ((0 - lower) / span) * 100,
  };
}
