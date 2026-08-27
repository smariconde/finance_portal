import http from "node:http";
import https from "node:https";
import net from "node:net";
import { describe, expect, it } from "vitest";

/**
 * El guard de red es infraestructura de la suite, así que necesita su propia
 * prueba: si dejara de bloquear, todos los demás tests seguirían en verde y el
 * contrato "sin red" pasaría a ser una afirmación sin respaldo.
 */
describe("guard de red de la suite unitaria", () => {
  it("bloquea fetch y nombra el destino", () => {
    expect(() => fetch("https://api.sec.gov/submissions")).toThrow(
      /Blocked network access via fetch\(\) to "https:\/\/api\.sec\.gov\/submissions"/,
    );
  });

  it("bloquea fetch construido con URL y con Request", () => {
    expect(() => fetch(new URL("https://query1.finance.yahoo.com/v8"))).toThrow(
      /query1\.finance\.yahoo\.com/,
    );

    expect(() =>
      fetch(new Request("https://data.bcra.gob.ar/estadisticas")),
    ).toThrow(/data\.bcra\.gob\.ar/);
  });

  it("falla sincrónicamente para que un `.catch()` no pueda tragarse la salida", () => {
    const swallow = () => {
      try {
        return fetch("https://example.invalid").catch(
          () => "valor por defecto",
        );
      } catch (error) {
        return error;
      }
    };

    expect(swallow()).toBeInstanceOf(Error);
  });

  it("bloquea http y https, que no pasan por fetch", () => {
    expect(() => http.request("http://127.0.0.1:9/")).toThrow(
      /Blocked network access via http\.request\(\)/,
    );
    expect(() => https.get({ hostname: "www.sec.gov", port: 443 })).toThrow(
      /Blocked network access via https\.get\(\) to "www\.sec\.gov:443"/,
    );
  });

  it("bloquea un socket TCP directo, que es por donde saldría el driver de PostgreSQL", () => {
    const socket = new net.Socket();

    try {
      expect(() => socket.connect({ host: "127.0.0.1", port: 55432 })).toThrow(
        /Blocked network access via net\.Socket#connect\(\) to "127\.0\.0\.1:55432"/,
      );
      expect(() => socket.connect(55432, "127.0.0.1")).toThrow(
        /net\.Socket#connect\(\)/,
      );
    } finally {
      socket.destroy();
    }
  });

  it("explica cómo salir del error en vez de sólo negarlo", () => {
    expect(() => fetch("https://example.invalid")).toThrow(
      /Use a fixture or a test double instead/,
    );
  });
});
