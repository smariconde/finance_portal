import { createHmac } from "node:crypto";

/**
 * La identidad de una cuenta Schwab en la base de trading
 * (`schwab-account-key-1.0.0`, ADR 0076, sección 5): HMAC-SHA256 del número con
 * la subclave `account-hmac`, en hex. El número completo nunca se guarda; la
 * página muestra sus últimos cuatro dígitos. Otra `TRADING_SECRET_KEY` da otra
 * clave: las transacciones guardadas quedarían bajo una cuenta que ya no se ve.
 */
export const ACCOUNT_KEY_VERSION = "schwab-account-key-1.0.0";

export function schwabAccountKey(
  subkey: Buffer,
  accountNumber: string,
): string {
  return createHmac("sha256", subkey)
    .update(`${ACCOUNT_KEY_VERSION}\n${accountNumber}`)
    .digest("hex");
}
