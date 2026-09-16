import { describe, expect, it } from "vitest";

import {
  classifyIpAddress,
  isPubliclyRoutable,
  type IpAddressCategory,
} from "@/server/egress/ip-address-policy";

describe("classifyIpAddress", () => {
  it("accepts a routable public address", () => {
    expect(classifyIpAddress("13.32.99.7")).toEqual({
      category: "public",
      version: 4,
      embeddedIpv4: null,
    });
    expect(classifyIpAddress("2600:9000:2000::1")).toEqual({
      category: "public",
      version: 6,
      embeddedIpv4: null,
    });
  });

  it.each<[string, IpAddressCategory]>([
    ["0.0.0.0", "unspecified"],
    ["0.1.2.3", "reserved"],
    ["10.0.0.1", "private"],
    ["10.255.255.255", "private"],
    ["100.64.0.1", "shared_address_space"],
    ["100.127.255.255", "shared_address_space"],
    ["127.0.0.1", "loopback"],
    ["127.255.255.254", "loopback"],
    ["169.254.1.1", "link_local"],
    ["172.16.0.1", "private"],
    ["172.31.255.255", "private"],
    ["192.0.0.1", "reserved"],
    ["192.0.2.5", "documentation"],
    ["192.88.99.1", "reserved"],
    ["192.168.1.1", "private"],
    ["198.18.0.1", "benchmarking"],
    ["198.19.255.255", "benchmarking"],
    ["198.51.100.5", "documentation"],
    ["203.0.113.5", "documentation"],
    ["224.0.0.1", "multicast"],
    ["240.0.0.1", "reserved"],
    ["255.255.255.255", "broadcast"],
  ])("classifies the IPv4 special range %s as %s", (literal, category) => {
    expect(classifyIpAddress(literal).category).toBe(category);
    expect(isPubliclyRoutable(literal)).toBe(false);
  });

  it("keeps the neighbours of a special range public", () => {
    // Los bordes importan: `172.15` y `172.32` no son privadas, y tratarlas como
    // si lo fueran haría inalcanzable una fuente legítima.
    expect(isPubliclyRoutable("9.255.255.255")).toBe(true);
    expect(isPubliclyRoutable("11.0.0.1")).toBe(true);
    expect(isPubliclyRoutable("172.15.255.255")).toBe(true);
    expect(isPubliclyRoutable("172.32.0.1")).toBe(true);
    expect(isPubliclyRoutable("100.63.255.255")).toBe(true);
    expect(isPubliclyRoutable("100.128.0.1")).toBe(true);
    expect(isPubliclyRoutable("198.17.255.255")).toBe(true);
    expect(isPubliclyRoutable("198.20.0.1")).toBe(true);
  });

  it("names the instance metadata endpoints instead of folding them into link-local", () => {
    // Son el objetivo concreto de `TM-08`: un rechazo que dice `cloud_metadata`
    // se lee distinto en un log que uno que dice `link_local`.
    expect(classifyIpAddress("169.254.169.254").category).toBe(
      "cloud_metadata",
    );
    expect(classifyIpAddress("169.254.170.2").category).toBe("cloud_metadata");
  });

  it.each<[string, IpAddressCategory]>([
    ["::", "unspecified"],
    ["::1", "loopback"],
    ["fc00::1", "unique_local"],
    ["fd12:3456::1", "unique_local"],
    ["fe80::1", "link_local"],
    ["febf::1", "link_local"],
    ["ff02::1", "multicast"],
    ["2001:db8::1", "documentation"],
    ["2001::1", "reserved"],
    ["2001:20::1", "reserved"],
    ["100::1", "reserved"],
    ["::1.2.3.4", "reserved"],
  ])("classifies the IPv6 special range %s as %s", (literal, category) => {
    expect(classifyIpAddress(literal).category).toBe(category);
    expect(isPubliclyRoutable(literal)).toBe(false);
  });

  it("unwraps an IPv4-mapped address instead of judging it by its prefix", () => {
    // `::ffff:127.0.0.1` abre el mismo socket que `127.0.0.1`. Clasificarlo por
    // el prefijo IPv6 lo daría por público, que es el bypass clásico.
    expect(classifyIpAddress("::ffff:127.0.0.1")).toEqual({
      category: "loopback",
      version: 6,
      embeddedIpv4: "127.0.0.1",
    });
    expect(classifyIpAddress("::ffff:169.254.169.254").category).toBe(
      "cloud_metadata",
    );
    expect(classifyIpAddress("::ffff:13.32.99.7")).toEqual({
      category: "public",
      version: 6,
      embeddedIpv4: "13.32.99.7",
    });
  });

  it("unwraps the IPv4 embedded in NAT64 and 6to4", () => {
    expect(classifyIpAddress("64:ff9b::10.0.0.1")).toEqual({
      category: "private",
      version: 6,
      embeddedIpv4: "10.0.0.1",
    });
    expect(classifyIpAddress("2002:7f00:1::1")).toEqual({
      category: "loopback",
      version: 6,
      embeddedIpv4: "127.0.0.1",
    });
    expect(classifyIpAddress("2002:0d20:6307::1").embeddedIpv4).toBe(
      "13.32.99.7",
    );
  });

  it("rejects the legacy IPv4 notations rather than interpreting them", () => {
    // `0177.0.0.1`, `2130706433` y `0x7f.1` son todas `127.0.0.1` para
    // `inet_aton`. Reimplementar esa tabla es donde viven los bypasses: acá
    // simplemente no son direcciones, y lo que no se entiende no se alcanza.
    for (const literal of [
      "0177.0.0.1",
      "2130706433",
      "0x7f.0.0.1",
      "127.1",
      "127.0.1",
      "010.0.0.1",
      "1.2.3.4.5",
      "1.2.3.256",
      "1.2.3.-1",
      " 127.0.0.1 x",
    ]) {
      expect(classifyIpAddress(literal).category).toBe("unparsable");
      expect(isPubliclyRoutable(literal)).toBe(false);
    }
  });

  it("rejects malformed IPv6 text", () => {
    for (const literal of [
      "::1::2",
      ":1::",
      "1:2:3:4:5:6:7",
      "1:2:3:4:5:6:7:8:9",
      "1:2:3:4:5:6:7:8::",
      "fe80::g",
      "12345::1",
    ]) {
      expect(classifyIpAddress(literal).category).toBe("unparsable");
    }
  });

  it("classifies a link-local address that carries a zone id", () => {
    // El scope no debe convertir un rechazo nombrado en `unparsable`.
    expect(classifyIpAddress("fe80::1%eth0").category).toBe("link_local");
  });

  it("treats a hostname as unparsable, never as an address", () => {
    expect(classifyIpAddress("data.sec.gov").category).toBe("unparsable");
    expect(classifyIpAddress("localhost").category).toBe("unparsable");
    expect(classifyIpAddress("").category).toBe("unparsable");
  });

  it("accepts the fully written form of a compressed address", () => {
    expect(
      classifyIpAddress("0000:0000:0000:0000:0000:0000:0000:0001"),
    ).toEqual({ category: "loopback", version: 6, embeddedIpv4: null });
  });
});
