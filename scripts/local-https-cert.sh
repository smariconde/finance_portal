#!/bin/sh
# Certificado autofirmado para `pnpm dev:https` (ADR 0076): Schwab sólo acepta
# callbacks HTTPS, y el registrado para desarrollo es
# https://127.0.0.1:3443/cuenta/schwab/callback.
#
# Se genera con openssl y no con `next dev --experimental-https` a secas, que
# descarga mkcert e instala una autoridad de certificación en el sistema. Este
# certificado no se instala en ningún lado: el navegador avisa una vez y se
# acepta para 127.0.0.1. Vive 30 días en `.certs/`, que Git ignora.
set -eu

mkdir -p .certs
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes \
  -days 30 -subj "/CN=127.0.0.1" -addext "subjectAltName=IP:127.0.0.1" \
  -keyout .certs/127.0.0.1-key.pem -out .certs/127.0.0.1.pem 2>/dev/null
chmod 600 .certs/127.0.0.1-key.pem
echo "Certificado en .certs/ hasta $(openssl x509 -enddate -noout -in .certs/127.0.0.1.pem | cut -d= -f2)."
