/**
 * Texto visible de un fragmento de HTML escrito a mano.
 *
 * No es un parser de HTML ni pretende serlo: las dos publicaciones del registro
 * son tablas y listas planas, y lo único que hace falta es sacar las etiquetas,
 * decodificar las entidades que los emisores usan y colapsar los espacios. Un
 * `&nbsp;` que sobrevive rompe una comparación de etiquetas sin que se note.
 */
const NAMED_ENTITIES: Readonly<Record<string, string>> = Object.freeze({
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  aacute: "á",
  eacute: "é",
  iacute: "í",
  oacute: "ó",
  uacute: "ú",
  Aacute: "Á",
  Eacute: "É",
  Iacute: "Í",
  Oacute: "Ó",
  Uacute: "Ú",
  ntilde: "ñ",
  Ntilde: "Ñ",
  uuml: "ü",
  Uuml: "Ü",
  ccedil: "ç",
  Ccedil: "Ç",
  atilde: "ã",
  otilde: "õ",
  ecirc: "ê",
  ocirc: "ô",
});

function decodeEntities(raw: string): string {
  return raw.replace(
    /&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|[a-z]{2,8});/giu,
    (entity, body: string) => {
      if (body.startsWith("#x") || body.startsWith("#X")) {
        const codePoint = Number.parseInt(body.slice(2), 16);

        return codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : entity;
      }

      if (body.startsWith("#")) {
        const codePoint = Number.parseInt(body.slice(1), 10);

        return codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : entity;
      }

      return NAMED_ENTITIES[body] ?? entity;
    },
  );
}

/**
 * Las etiquetas de bloque separan palabras y las de línea no: el emisor escribe
 * `<strong>T</strong>i<strong>cker</strong>`, y reemplazar cada etiqueta por un
 * espacio convertiría «Ticker» en «T i cker».
 */
const BLOCK_TAG =
  /<\/?(?:br|p|div|li|ul|ol|tr|td|th|table|thead|tbody)\b[^>]*>/giu;

export function htmlToText(fragment: string): string {
  return decodeEntities(
    fragment.replace(BLOCK_TAG, " ").replace(/<[^>]*>/gu, ""),
  )
    .replace(/\s+/gu, " ")
    .trim();
}

/**
 * Líneas de texto de un fragmento: cada ítem de lista, párrafo o salto de línea
 * es una línea. Sirve para las descripciones que el emisor escribe a veces como
 * `<li>` y a veces como texto separado por `<br />`.
 */
export function htmlToLines(fragment: string): string[] {
  return fragment
    .replace(BLOCK_TAG, "\n")
    .split("\n")
    .map((line) => htmlToText(line))
    .filter((line) => line.length > 0);
}
