type SecurityHeaderOptions = {
  development?: boolean;
};

export function createSecurityHeaders({
  development = false,
}: SecurityHeaderOptions = {}) {
  const scriptSources = [
    "'self'",
    "'unsafe-inline'",
    ...(development ? ["'unsafe-eval'"] : []),
  ].join(" ");
  const contentSecurityPolicy = [
    "default-src 'self'",
    `script-src ${scriptSources}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");

  return [
    { key: "Content-Security-Policy", value: contentSecurityPolicy },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
    },
  ];
}
