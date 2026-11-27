/**
 * El segundo secreto de `POST /api/inmuebles/captura` (ADR 0089, «Envío»;
 * patrón de la ADR 0078): `CAPTURE_TOKEN`, base64url de al menos 32 bytes
 * aleatorios, como `MCP_ACCESS_TOKEN`, y validado con la misma regla
 * (`parseMcpAccessToken`, `bearerMatches`). Es otro token: el que abre la
 * escritura de avisos no abre la lectura del MCP, ni al revés.
 */
export const CAPTURE_TOKEN_VARIABLE = "CAPTURE_TOKEN";
