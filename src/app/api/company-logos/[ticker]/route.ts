import { servesRealData } from "@/modules/configuration/domain/config-health";
import { companyLogoSymbol } from "@/modules/configuration/domain/company-logo";
import { getCompanyLogoLoader } from "@/server/company-logos/load-company-logo";
import { getRequestConfigHealth } from "@/server/config/app-environment";

export async function GET(
  request: Request,
  context: { params: Promise<{ ticker: string }> },
) {
  const noStore = {
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  };
  if (!servesRealData(await getRequestConfigHealth())) {
    return new Response(null, { status: 404, headers: noStore });
  }
  const { ticker } = await context.params;
  if (
    companyLogoSymbol(ticker) === null ||
    new URL(request.url).search !== ""
  ) {
    return new Response(null, { status: 400, headers: noStore });
  }
  try {
    const result = await getCompanyLogoLoader()(ticker);
    if (result.state !== "stored") {
      return new Response(null, {
        status: result.state === "missing" ? 404 : 503,
        headers: noStore,
      });
    }
    const headers = {
      "Content-Type": "image/png",
      "Content-Length": String(result.logo.bytes.byteLength),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=86400",
      ETag: `"${result.logo.contentHash}"`,
    };
    if (request.headers.get("if-none-match") === headers.ETag) {
      return new Response(null, { status: 304, headers });
    }
    return new Response(new Uint8Array(result.logo.bytes), { headers });
  } catch {
    // La falla de storage o proveedor nunca revela SQL, URL ni clave.
    return new Response(null, { status: 503, headers: noStore });
  }
}
