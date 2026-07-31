#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 3 ]]; then
  printf 'usage: MP_WEBHOOK_SECRET=secret %s <base-url> <payment-id> <status>\n' "$0" >&2
  exit 2
fi

if [[ -z "${MP_WEBHOOK_SECRET:-}" ]]; then
  printf 'MP_WEBHOOK_SECRET is required\n' >&2
  exit 2
fi

base_url="${1%/}"
payment_id="$2"
status="$3"
ts="$(date +%s)"
request_id="test-${payment_id}-${ts}"
manifest="id:${payment_id};request-id:${request_id};ts:${ts};"
signature="$(printf '%s' "$manifest" | openssl dgst -sha256 -hmac "$MP_WEBHOOK_SECRET" -hex | awk '{print $2}')"
payload="$(printf '{"id":"evt_%s_%s","type":"payment","action":"payment.updated","data":{"id":"%s"},"live_mode":false,"date_created":"%s","status":"%s"}' "$payment_id" "$ts" "$payment_id" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$status")"

curl -fsS \
  -X POST "${base_url}/webhooks/mercadopago" \
  -H 'Content-Type: application/json' \
  -H "x-request-id: ${request_id}" \
  -H "x-signature: ts=${ts},v1=${signature}" \
  --data "$payload"
