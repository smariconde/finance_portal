# Modelo de identidad financiera

- Estado: contrato implementado en dominio y persistido en PostgreSQL
- Versión: 0.2
- Fecha: 2026-09-04
- Alcance: entity, security, listing, identifiers y programas depositarios
- Implementación (`F1-04`):
  [`identity-graph.ts`](../../src/modules/identity/domain/identity-graph.ts),
  [`resolve-identity.ts`](../../src/modules/identity/domain/resolve-identity.ts) y
  la fixture sintética
  [`demo-identity-fixtures.ts`](../../src/modules/identity/infrastructure/demo-identity-fixtures.ts)
- Persistencia (`F2-02`): migración
  [`0004_common_proteus.sql`](../../drizzle/0004_common_proteus.sql) con su
  rollback pareado; repositorio
  [`postgres-universe-repository.ts`](../../src/server/db/postgres-universe-repository.ts).
  Los programas depositarios y sus ratios siguen viviendo sólo en dominio y
  fixture: su fuente es el acceso CEDEAR y su tabla llega en `F6-04`

## Propósito

El modelo evita unir fuentes mediante nombres o tickers inestables. Distingue a
la organización legal que reporta, el instrumento emitido, el mercado donde se
negocia y el programa depositario que representa a otro instrumento.

```text
legal_entity
  ├── issues ──> security/share_class
  │                ├── trades_as ──> listing ──> listing_symbol
  │                └── identified_by ──> security_identifier
  └── identified_by ──> entity_identifier

depositary_program
  ├── depositary_security_id ──> security
  ├── underlying_security_id ──> security
  └── versions ──> depositary_ratio
```

Cada nodo usa un ID interno opaco e inmutable. Los identificadores externos son
atributos con fuente y vigencia; nunca reemplazan la clave interna.

Todos los registros versionados de este documento implementan el mismo envelope:

```ts
type TemporalIdentityVersion = {
  validFrom: string;
  validTo: string | null;
  availableAt: string;
  supersededAt: string | null;
  sourceId: string;
  provenanceId: string;
  contentHash: string;
  recordedAt: string;
};
```

La semántica de cada campo está definida en el
[contrato point-in-time](point-in-time-contract.md). Los tipos siguientes agregan
los campos propios de cada nivel.

## Niveles de identidad

### Legal entity

Organización jurídica que emite un instrumento, presenta un filing o asume una
obligación. Puede ser una sociedad operativa, holding, trust, fondo, banco o
vehículo depositario.

Campos mínimos:

```ts
type LegalEntity = TemporalIdentityVersion & {
  legalEntityId: string;
  legalName: string;
  entityType:
    | "operating_company"
    | "holding_company"
    | "bank"
    | "insurer"
    | "fund"
    | "trust"
    | "depositary"
    | "other";
  jurisdiction: string | null;
  status: "active" | "inactive" | "merged" | "dissolved" | "unknown";
};
```

CIK y LEI pertenecen a este nivel cuando identifican al filer o entidad legal.
Un CIK no se copia a todas las securities como si fuera un identificador del
instrumento.

### Security

Instrumento o clase emitida que representa derechos económicos concretos. Dos
clases de acciones de la misma entidad son securities diferentes. Una acción,
ADR y CEDEAR tampoco son el mismo instrumento aunque estén relacionados.

```ts
type Security = TemporalIdentityVersion & {
  securityId: string;
  issuerLegalEntityId: string;
  securityType:
    | "common_equity"
    | "preferred_equity"
    | "depositary_receipt"
    | "fund_unit"
    | "etf_share"
    | "debt"
    | "other";
  shareClass: string | null;
  economicCurrency: string | null;
  status: "active" | "inactive" | "converted" | "cancelled" | "unknown";
};
```

ISIN y share-class FIGI se asignan a este nivel cuando la fuente los define para
el instrumento o clase. El contrato conserva `identifier_type`, `scope` y fuente
porque distintos esquemas pueden resolver niveles diferentes.

### Listing

Relación de negociación entre una security y un venue. La misma security puede
tener múltiples listings con moneda, lot size, calendario y estado distintos.

```ts
type Listing = TemporalIdentityVersion & {
  listingId: string;
  securityId: string;
  mic: string;
  quoteCurrency: string;
  country: string;
  status: "active" | "suspended" | "delisted" | "unknown";
  primaryListing: boolean;
};
```

MIC identifica el mercado o plataforma conforme a ISO 10383. El nombre comercial
del exchange es metadata versionada, no la clave de la relación.

### Listing symbol

Ticker o símbolo local asignado a un listing durante un intervalo. Se modela
separado porque cambia, puede reutilizarse y requiere mercado y fecha para ser
interpretable.

```ts
type ListingSymbol = TemporalIdentityVersion & {
  listingSymbolId: string;
  listingId: string;
  symbol: string;
  symbolType: "ticker" | "local_code" | "vendor_symbol";
};
```

`AAPL` sin MIC y fecha es una búsqueda, no una identidad. Una URL puede aceptar
un ticker por conveniencia, pero el caso de uso debe resolverlo a `listingId` y
guardar la decisión.

### Depositary program

Contrato que vincula una security depositaria con una security subyacente. Un
CEDEAR puede representar una acción, ADR, ETF u otro instrumento; no se asume una
relación 1:1 ni que el ticker coincida.

```ts
type DepositaryProgram = TemporalIdentityVersion & {
  depositaryProgramId: string;
  programType: "cedear" | "adr" | "gdr" | "other";
  depositarySecurityId: string;
  underlyingSecurityId: string;
  depositaryLegalEntityId: string | null;
  sponsorLegalEntityId: string | null;
  investorScope: string | null;
  status: "active" | "suspended" | "terminated" | "unknown";
};
```

La security depositaria tiene su propio ISIN, listing, símbolo, moneda y corporate
actions. El programa expresa la relación económica, no colapsa ambos instrumentos.

### Depositary ratio

El ratio se historiza como fracción exacta:

```ts
type DepositaryRatio = TemporalIdentityVersion & {
  depositaryRatioId: string;
  depositaryProgramId: string;
  depositaryUnits: string; // decimal positivo exacto
  underlyingUnits: string; // decimal positivo exacto
  announcedAt: string | null;
  sourceDocumentId: string;
};
```

`depositaryUnits=10` y `underlyingUnits=1` significa diez unidades depositarias
por una unidad subyacente. La UI puede mostrar `10:1`, pero cálculos y persistencia
usan ambos decimales exactos, sin convertirlos a un `number` binario. Un cambio
cierra el intervalo anterior y crea una versión; no actualiza la fila histórica.

## Identificadores

### Entity identifiers

| Tipo              | Scope esperado     | Uso                                   |
| ----------------- | ------------------ | ------------------------------------- |
| `CIK`             | legal entity/filer | submissions y filings SEC             |
| `LEI`             | legal entity       | reconciliación jurídica internacional |
| `local_entity_id` | legal entity       | registros oficiales de jurisdicción   |

### Security y listing identifiers

| Tipo                  | Scope esperado                         | Uso                                                               |
| --------------------- | -------------------------------------- | ----------------------------------------------------------------- |
| `ISIN`                | security/instrument                    | identificación internacional conforme a ISO 6166                  |
| `FIGI`                | instrumento o venue según variante     | reconciliación secundaria con scope conservado                    |
| `share_class_figi`    | share class                            | agrupar listings de la misma clase cuando la evidencia lo permite |
| `composite_figi`      | instrumento compuesto por mercado/país | reconciliación secundaria, no sustituto de listing                |
| `CUSIP` / `SEDOL`     | security según asignación              | lookup auxiliar sujeto a licencia                                 |
| `MIC`                 | venue                                  | mercado conforme a ISO 10383                                      |
| `ticker`              | listing + intervalo                    | búsqueda y navegación, nunca clave global                         |
| `local_security_code` | security o listing según emisor        | códigos de Caja u otras infraestructuras locales                  |

```ts
type IdentifierAssignment = TemporalIdentityVersion & {
  identifierAssignmentId: string;
  subjectType: "legal_entity" | "security" | "listing";
  subjectId: string;
  identifierType: string;
  identifierValue: string;
  normalizedValue: string;
  scope: string;
  issuingAuthority: string | null;
  confidence: "authoritative" | "confirmed" | "candidate" | "rejected";
};
```

Los valores originales se preservan. La normalización sólo aplica reglas del tipo
de identificador; no elimina guiones o caracteres sin una convención versionada.

## Nombres y clasificaciones

Nombres legales, nombres comerciales, sectores y países cambian o provienen de
taxonomías distintas. Se modelan como asignaciones versionadas:

- `entity_names`: nombre, tipo, idioma, vigencia y fuente;
- `security_descriptions`: descripción y clase publicadas;
- `classification_assignments`: taxonomía, versión, código y vigencia;
- `listing_venue_names`: nombre del mercado asociado a un MIC y vigencia.

No se mezcla GICS, SIC u otra taxonomía en una columna `sector` sin registrar la
taxonomía y versión.

## Corporate actions

Los eventos modifican relaciones o series, pero no reescriben identidad:

```ts
type CorporateAction = {
  corporateActionId: string;
  securityId: string;
  actionType:
    | "split"
    | "reverse_split"
    | "symbol_change"
    | "merger"
    | "spinoff"
    | "conversion"
    | "delisting"
    | "depositary_ratio_change";
  announcedAt: string | null;
  effectiveAt: string;
  terms: Record<string, string>;
  sourceDocumentId: string;
  availableAt: string;
};
```

Un cambio de ticker crea otro `ListingSymbol`. Una merger o spin-off crea edges
explícitos entre entidades/securities. Un split ajusta series mediante una
transformación versionada; no cambia el ID de la security.

## Reglas de vigencia

- Todos los intervalos son semiabiertos: `[validFrom, validTo)`.
- `validTo=null` significa abierto, no “vigente confirmado para siempre”.
- Para un mismo sujeto y atributo autoritativo no puede haber intervalos activos
  solapados sin un conflicto en quarantine.
- Un símbolo se resuelve por `(normalizedSymbol, MIC, effectiveAt)`.
- Un identificador se resuelve por `(type, normalizedValue, scope, effectiveAt)`.
- Una asignación `candidate` nunca participa en joins financieros automáticos.
- Eliminar un source snapshot no elimina identidades ya referenciadas; se suspende
  la fuente y se conserva lineage.

Las reglas de tiempo de conocimiento y revisión se detallan en
[`point-in-time-contract.md`](point-in-time-contract.md).

## Invariantes

1. Todo `listing` referencia exactamente una `security` y un MIC.
2. Toda `security` referencia un issuer legal; si la fuente no permite resolverlo,
   la fila queda en staging, no se inventa un issuer.
3. `depositarySecurityId` y `underlyingSecurityId` son distintos.
4. Numerador y denominador depositarios son decimales positivos, finitos y
   exactos.
5. No existe más de un ratio vigente para el mismo programa y fecha.
6. Un ticker no se guarda en hechos financieros como foreign key.
7. CIK no identifica una share class; MIC no identifica una empresa; ISIN no
   identifica un venue.
8. Una coincidencia de nombre no puede elevarse a `confirmed` sin otra evidencia.
9. Un merge conserva los IDs y agrega relaciones de sucesión; no recicla el ID
   del sobreviviente para el adquirido.
10. Los IDs internos no incluyen ticker, nombre, CIK, ISIN ni datos que puedan
    cambiar.

## Resolución de identidad

### Entrada

```ts
type IdentityQuery = {
  identifierType?: string;
  identifierValue?: string;
  symbol?: string;
  mic?: string;
  currency?: string;
  effectiveAt: string;
  knownAt: string;
};
```

### Proceso determinista

1. Normalizar sólo según el tipo declarado.
2. Buscar identificadores autoritativos vigentes y conocidos en el corte.
3. Para símbolo, exigir MIC o devolver candidatos explícitos.
4. Resolver `listing -> security -> legal_entity` y, si aplica, el programa
   depositario vigente.
5. Usar ISIN/FIGI u otros identificadores como evidencia adicional con scope.
6. Aplicar reglas de precedencia por fuente registradas, no una media opaca.
7. Si quedan múltiples candidatos plausibles, devolver `ambiguous_identity`.
8. Registrar candidatos, evidencia, regla, versión y decisión manual si la hubo.

```ts
type IdentityResolution = {
  status: "resolved" | "ambiguous" | "not_found" | "conflict";
  legalEntityId: string | null;
  securityId: string | null;
  listingId: string | null;
  depositaryProgramId: string | null;
  candidateIds: string[];
  matchedAssignmentIds: string[];
  resolutionRuleVersion: string;
  decidedBy: "rule" | "owner" | null;
  rationale: string;
};
```

OpenFIGI puede generar candidatos y metadata. No reemplaza fuentes oficiales ni
decide automáticamente cuando una consulta devuelve más de un instrumento.

## Conflictos y revisión manual

Se envía a `manual_review` cuando:

- una fuente asigna el mismo identificador autoritativo a sujetos incompatibles;
- ticker y MIC conducen a una security distinta del ISIN/FIGI confirmado;
- un CEDEAR cambia de subyacente, ratio o alcance sin documento efectivo claro;
- fechas de vigencia se superponen;
- una merger, spin-off o conversión no permite determinar sucesión;
- el nivel del identificador no puede distinguirse.

La decisión manual conserva todos los candidatos y no modifica el payload raw.
Un override declara owner, fecha, evidencia, motivo y versión de regla.

## Ejemplo conceptual

```text
LegalEntity: Example Global Inc.
  Security: common share Class A (ISIN de la acción)
    Listing: XNAS / USD
      Symbol: EXM [2020-01-01, 2024-06-01)
      Symbol: EXGL [2024-06-01, ∞)

LegalEntity: Depositario Local S.A.
  Security: CEDEAR Example Global (ISIN local)
    Listing: XBUE / ARS
      Symbol: EXGLD

DepositaryProgram:
  depositary security -> CEDEAR Example Global
  underlying security -> common share Class A
  ratio -> 10 depositary units / 1 underlying unit
```

El ejemplo es ficticio. Demuestra que símbolo, listing y programa pueden cambiar
sin alterar la identidad histórica de la acción subyacente.

## Persistencia

La migración `0004` separa cada nivel en dos tablas: un **registro** que sólo
declara que el ID existe y una tabla de **versiones** con atributos y vigencia.
Sin esa separación, `security_versions.issuer_legal_entity_id` no tendría a qué
apuntar: en una tabla versionada el mismo emisor aparece una vez por versión.

| Nivel                 | Registro         | Versiones                |
| --------------------- | ---------------- | ------------------------ |
| entidad legal         | `legal_entities` | `legal_entity_versions`  |
| security              | `securities`     | `security_versions`      |
| listing               | `listings`       | `listing_versions`       |
| símbolo               | —                | `listing_symbols`        |
| identificador externo | —                | `identifier_assignments` |
| pertenencia a índice  | —                | `index_memberships`      |

La clave primaria de cada versión es `(id, valid_from)`: su clave natural, sin
surrogate inventado. Cerrar una versión es un update dirigido a esa clave y nunca
un borrado.

Índices únicos parciales que espejan las invariantes en PostgreSQL:

- una sola versión abierta por sujeto (`*_open_uidx` en los tres niveles);
- un solo símbolo vigente por listing **y tipo**: un listing puede tener a la vez
  un ticker y un código local, pero no dos tickers;
- un identificador autoritativo no puede quedar abierto para dos sujetos
  (`identifier_assignments_authoritative_uidx`);
- una security no está dos veces en el mismo índice a la vez.

Todavía no tienen tabla, con su motivo: `depositary_programs` y
`depositary_ratios` esperan a su fuente (`F6-04`); `corporate_actions` y
`security_relationships` esperan a `F2-04`; `identity_resolution_runs`,
`identity_candidates` e `identity_decisions` esperan a la primera decisión manual
real. Los nombres, descripciones y clasificaciones tampoco se persisten: mezclar
una taxonomía sin registrar cuál es y en qué versión es exactamente lo que este
documento prohíbe, y el mapeo a industria es `F3-05`.

El constraint de exclusión temporal por rango sigue diferido: exige la extensión
`btree_gist` y por lo tanto un ADR propio. Hoy el no solapamiento se prueba en
dominio y en PostgreSQL se impide el caso peligroso —dos versiones vigentes
simultáneas para el mismo sujeto—.

## Tests requeridos

Los casos marcados con ✔ están cubiertos por
[`resolve-identity.test.ts`](../../src/modules/identity/domain/resolve-identity.test.ts)
sobre la fixture de `FixtureCo`, salvo donde se indique otro archivo; el resto
espera a las fuentes reales de Fase 2. A eso se suma, desde `F2-02`, lo que la
constitución del universo prueba sobre el grafo persistido: identidad no
colapsada, idempotencia, renombre historizado y salida del índice sin borrado.

- ✔ cambio de ticker con consulta antes y después del corte;
- dos listings de la misma security en MIC/monedas distintos;
- ✔ ticker reutilizado por otra security en un intervalo posterior;
- ✔ dos share classes del mismo issuer, con un solo CIK y dos securities
  ([`plan-universe-constitution.test.ts`](../../src/modules/universe/domain/plan-universe-constitution.test.ts));
- ADR cuyo subyacente no es el listing primario esperado;
- ✔ CEDEAR sobre acción (ADR y ETF siguen pendientes);
- ✔ cambio de ratio depositario anunciado antes de su vigencia;
- split, reverse split, merger, spin-off y delisting;
- ✔ identificador ambiguo y conflicto de fuentes; el override manual sigue
  pendiente;
- ✔ intervalos que se tocan sin solaparse y rechazo de solapamientos reales
  ([`temporal-version.test.ts`](../../src/modules/temporal/domain/temporal-version.test.ts)).

## Fuentes primarias

- [SEC: acceso a EDGAR y asociaciones CIK/ticker](https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data)
- [ISO 6166:2021, ISIN](https://www.iso.org/standard/78502.html)
- [ISO 10383, Market Identifier Codes](https://www.iso20022.org/market-identifier-codes)
- [OpenFIGI API](https://www.openfigi.com/api/documentation)
- [Caja de Valores: CEDEAR](https://cajadevalores.com.ar/Servicios/Cedears)
