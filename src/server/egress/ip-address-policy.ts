/**
 * Clasificación de una dirección IP literal como convención versionada.
 *
 * Es la mitad de `TM-08` que no depende de la URL: una vez que el nombre está en
 * la allowlist, lo que decide si el socket se abre es la dirección a la que ese
 * nombre resuelve. Un atacante que controla DNS —o una fuente que un día devuelve
 * un CNAME distinto— puede apuntar un host aprobado a `127.0.0.1`, a la red
 * privada del runtime o al endpoint de metadata de la nube.
 *
 * Dos decisiones fijan el sentido de todo el archivo:
 *
 * - **Lo que no se entiende se rechaza.** El parser acepta una única forma
 *   canónica: cuatro octetos decimales sin ceros a la izquierda para IPv4, y
 *   grupos hexadecimales para IPv6. `0177.0.0.1`, `2130706433` y `0x7f.1` no son
 *   direcciones válidas acá, así que caen en `unparsable`, que es una negativa.
 *   Aceptarlas y clasificarlas bien sería reimplementar la tabla de formas
 *   heredadas de `inet_aton`, que es justo donde viven los bypasses.
 * - **IPv6 que envuelve IPv4 se desenvuelve.** `::ffff:127.0.0.1` abre el mismo
 *   socket que `127.0.0.1`; clasificarlo por su prefijo IPv6 lo daría por
 *   público. Los tres prefijos que embeben una IPv4 real —mapped, NAT64 y
 *   6to4— se clasifican por la dirección embebida y la declaran.
 *
 * Sin categoría "probablemente pública": la rama final es `public` sólo después
 * de haber descartado explícitamente cada rango especial que la IANA registra.
 */
export const IP_ADDRESS_POLICY_VERSION = "ip-address-policy-1.0.0";

export type IpAddressCategory =
  | "public"
  | "unparsable"
  | "unspecified"
  | "loopback"
  | "private"
  | "shared_address_space"
  | "link_local"
  | "cloud_metadata"
  | "unique_local"
  | "multicast"
  | "broadcast"
  | "documentation"
  | "benchmarking"
  | "reserved";

export type IpAddressClassification = {
  readonly category: IpAddressCategory;
  readonly version: 4 | 6 | null;
  /**
   * Dirección IPv4 embebida que decidió la clasificación, cuando la entrada era
   * un IPv6 que envuelve una IPv4. Se declara para que el rechazo sea legible en
   * el log: el motivo no es el prefijo IPv6 sino lo que hay adentro.
   */
  readonly embeddedIpv4: string | null;
};

function parseIpv4(literal: string): Uint8Array | null {
  const parts = literal.split(".");

  if (parts.length !== 4) {
    return null;
  }

  const bytes = new Uint8Array(4);

  for (const [index, part] of parts.entries()) {
    // Un cero a la izquierda es la puerta de entrada a la interpretación octal:
    // `0177.0.0.1` es `127.0.0.1` para `inet_aton` y "algo raro" para un regex
    // permisivo. Acá directamente no es una dirección.
    if (!/^(?:0|[1-9]\d{0,2})$/u.test(part)) {
      return null;
    }

    const value = Number(part);

    if (value > 255) {
      return null;
    }

    bytes[index] = value;
  }

  return bytes;
}

function formatIpv4(bytes: Uint8Array, offset = 0): string {
  return [
    bytes[offset],
    bytes[offset + 1],
    bytes[offset + 2],
    bytes[offset + 3],
  ].join(".");
}

function groupsToBytes(groups: readonly number[]): Uint8Array {
  const bytes = new Uint8Array(16);

  for (const [index, group] of groups.entries()) {
    bytes[index * 2] = (group >> 8) & 0xff;
    bytes[index * 2 + 1] = group & 0xff;
  }

  return bytes;
}

function readIpv6Groups(text: string): number[] | null {
  if (text.length === 0) {
    return [];
  }

  const tokens = text.split(":");
  const groups: number[] = [];

  for (const [index, token] of tokens.entries()) {
    const isLast = index === tokens.length - 1;

    if (isLast && token.includes(".")) {
      const embedded = parseIpv4(token);

      if (embedded === null) {
        return null;
      }

      groups.push(
        (embedded[0] << 8) | embedded[1],
        (embedded[2] << 8) | embedded[3],
      );
      continue;
    }

    if (!/^[0-9a-f]{1,4}$/iu.test(token)) {
      return null;
    }

    groups.push(Number.parseInt(token, 16));
  }

  return groups;
}

function parseIpv6(literal: string): Uint8Array | null {
  // El zone id (`fe80::1%eth0`) sólo aparece en direcciones link-local, que se
  // rechazan igual. Se recorta para que la presencia del scope no convierta un
  // rechazo nombrado en `unparsable`.
  const [withoutZone] = literal.split("%");
  const halves = withoutZone.split("::");

  if (halves.length > 2) {
    return null;
  }

  const head = readIpv6Groups(halves[0]);

  if (head === null) {
    return null;
  }

  if (halves.length === 1) {
    return head.length === 8 ? groupsToBytes(head) : null;
  }

  const tail = readIpv6Groups(halves[1]);

  if (tail === null) {
    return null;
  }

  const missing = 8 - head.length - tail.length;

  // `::` tiene que representar al menos un grupo en cero: una dirección con los
  // ocho grupos escritos y un `::` de más está mal formada.
  if (missing < 1) {
    return null;
  }

  return groupsToBytes([...head, ...Array<number>(missing).fill(0), ...tail]);
}

function matchesIpv4Prefix(
  bytes: Uint8Array,
  prefix: readonly number[],
  prefixLength: number,
): boolean {
  const fullBytes = Math.floor(prefixLength / 8);
  const remainingBits = prefixLength % 8;

  for (let index = 0; index < fullBytes; index += 1) {
    if (bytes[index] !== prefix[index]) {
      return false;
    }
  }

  if (remainingBits === 0) {
    return true;
  }

  const mask = (0xff << (8 - remainingBits)) & 0xff;

  return (bytes[fullBytes] & mask) === (prefix[fullBytes] & mask);
}

/**
 * Direcciones de metadata de instancia, separadas del resto de link-local porque
 * son el objetivo concreto de `TM-08` y el rechazo debe nombrarlas: `169.254.169.254`
 * es el endpoint de EC2/GCE/Azure y `169.254.170.2` el de las tareas de ECS.
 */
const CLOUD_METADATA_IPV4: ReadonlySet<string> = new Set([
  "169.254.169.254",
  "169.254.170.2",
]);

function classifyIpv4Bytes(bytes: Uint8Array): IpAddressCategory {
  const literal = formatIpv4(bytes);

  if (literal === "0.0.0.0") {
    return "unspecified";
  }

  if (literal === "255.255.255.255") {
    return "broadcast";
  }

  if (CLOUD_METADATA_IPV4.has(literal)) {
    return "cloud_metadata";
  }

  const ranges: ReadonlyArray<
    readonly [readonly number[], number, IpAddressCategory]
  > = [
    [[0, 0, 0, 0], 8, "reserved"],
    [[10, 0, 0, 0], 8, "private"],
    [[100, 64, 0, 0], 10, "shared_address_space"],
    [[127, 0, 0, 0], 8, "loopback"],
    [[169, 254, 0, 0], 16, "link_local"],
    [[172, 16, 0, 0], 12, "private"],
    // Asignaciones de protocolo IETF, incluida `192.0.0.0/29` de DS-Lite.
    [[192, 0, 0, 0], 24, "reserved"],
    [[192, 0, 2, 0], 24, "documentation"],
    // Anycast de relay 6to4: deprecado y sin destino verificable.
    [[192, 88, 99, 0], 24, "reserved"],
    [[192, 168, 0, 0], 16, "private"],
    [[198, 18, 0, 0], 15, "benchmarking"],
    [[198, 51, 100, 0], 24, "documentation"],
    [[203, 0, 113, 0], 24, "documentation"],
    [[224, 0, 0, 0], 4, "multicast"],
    [[240, 0, 0, 0], 4, "reserved"],
  ];

  for (const [prefix, prefixLength, category] of ranges) {
    if (matchesIpv4Prefix(bytes, prefix, prefixLength)) {
      return category;
    }
  }

  return "public";
}

function readGroup(bytes: Uint8Array, index: number): number {
  return (bytes[index * 2] << 8) | bytes[index * 2 + 1];
}

function isZeroPrefix(bytes: Uint8Array, groups: number): boolean {
  for (let index = 0; index < groups; index += 1) {
    if (readGroup(bytes, index) !== 0) {
      return false;
    }
  }

  return true;
}

function classifyEmbedded(
  bytes: Uint8Array,
  offset: number,
): IpAddressClassification {
  const embedded = bytes.slice(offset, offset + 4);

  return {
    category: classifyIpv4Bytes(embedded),
    version: 6,
    embeddedIpv4: formatIpv4(embedded),
  };
}

function classifyIpv6Bytes(bytes: Uint8Array): IpAddressClassification {
  const plain = (category: IpAddressCategory): IpAddressClassification => ({
    category,
    version: 6,
    embeddedIpv4: null,
  });

  if (isZeroPrefix(bytes, 8)) {
    return plain("unspecified");
  }

  if (isZeroPrefix(bytes, 7) && readGroup(bytes, 7) === 1) {
    return plain("loopback");
  }

  // `::ffff:a.b.c.d` — IPv4-mapped. Abre exactamente el mismo socket que la IPv4
  // que envuelve, así que se clasifica por ella.
  if (isZeroPrefix(bytes, 5) && readGroup(bytes, 5) === 0xffff) {
    return classifyEmbedded(bytes, 12);
  }

  // `::a.b.c.d` — IPv4-compatible, deprecado por la RFC 4291. No se desenvuelve:
  // sin uso legítimo, la respuesta correcta es no conectar.
  if (isZeroPrefix(bytes, 6)) {
    return plain("reserved");
  }

  const first = readGroup(bytes, 0);
  const second = readGroup(bytes, 1);

  // `64:ff9b::/96` y `64:ff9b:1::/48` — NAT64. Traducen a la IPv4 embebida, que
  // es la que decide.
  if (first === 0x0064 && second === 0xff9b) {
    return classifyEmbedded(bytes, 12);
  }

  // `2002::/16` — 6to4: la IPv4 del túnel está en los bytes 2 a 5.
  if (first === 0x2002) {
    return classifyEmbedded(bytes, 2);
  }

  if (first === 0x2001 && second === 0x0db8) {
    return plain("documentation");
  }

  // `2001::/32` Teredo y `2001:20::/28` ORCHIDv2: embeben destinos que no se
  // pueden verificar con la misma regla, y ningún host aprobado resuelve a
  // ellos.
  if (first === 0x2001 && second <= 0x002f) {
    return plain("reserved");
  }

  // `100::/64` — prefijo de descarte.
  if (
    first === 0x0100 &&
    readGroup(bytes, 1) === 0 &&
    readGroup(bytes, 2) === 0 &&
    readGroup(bytes, 3) === 0
  ) {
    return plain("reserved");
  }

  if ((bytes[0] & 0xfe) === 0xfc) {
    return plain("unique_local");
  }

  if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) {
    return plain("link_local");
  }

  if (bytes[0] === 0xff) {
    return plain("multicast");
  }

  return plain("public");
}

const UNPARSABLE: IpAddressClassification = {
  category: "unparsable",
  version: null,
  embeddedIpv4: null,
};

export function classifyIpAddress(literal: string): IpAddressClassification {
  const trimmed = literal.trim();

  if (trimmed.length === 0 || trimmed.length > 45) {
    return UNPARSABLE;
  }

  if (trimmed.includes(":")) {
    const bytes = parseIpv6(trimmed);

    return bytes === null ? UNPARSABLE : classifyIpv6Bytes(bytes);
  }

  const bytes = parseIpv4(trimmed);

  if (bytes === null) {
    return UNPARSABLE;
  }

  return {
    category: classifyIpv4Bytes(bytes),
    version: 4,
    embeddedIpv4: null,
  };
}

/**
 * Único predicado que autoriza abrir un socket hacia una dirección. Se pregunta
 * por acá en vez de comparar categorías a mano, para que agregar una categoría
 * futura no habilite un rango por omisión.
 */
export function isPubliclyRoutable(literal: string): boolean {
  return classifyIpAddress(literal).category === "public";
}
