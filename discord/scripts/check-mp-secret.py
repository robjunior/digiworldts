#!/usr/bin/env python3
"""
Testa se uma chave secreta valida a assinatura capturada do MercadoPago.

Uso:
    python3 check-mp-secret.py '<chave-secreta-do-painel>'

Não envia nada pra lugar nenhum — roda offline, só imprime match/no-match.
"""
import hashlib
import hmac
import sys

# Notificação real capturada em 2026-07-30T22:26:51Z
DATA_ID = "ORDTST01KYTJ69C18Z806VPPN8SMSBEF"
REQUEST_ID = "4eb34e70-df07-474a-bde9-da5ed273a2bc"
TS = "1785450412"
V1_RECEBIDO = "17be5cba38c4d5ccf99b541e67285bc9e231868b3e015f71ade507a4f3011625"


def manifests() -> dict[str, str]:
    lower, upper = DATA_ID.lower(), DATA_ID
    out: dict[str, str] = {}
    for label, did in (("lower", lower), ("upper", upper)):
        out[f"espaco/{label}"] = f"id:{did} request-id:{REQUEST_ID} ts:{TS}"
        out[f"ponto-virgula/{label}"] = f"id:{did};request-id:{REQUEST_ID};ts:{TS};"
        out[f"ponto-virgula-sem-trailing/{label}"] = f"id:{did};request-id:{REQUEST_ID};ts:{TS}"
        out[f"espaco-sem-request-id/{label}"] = f"id:{did} ts:{TS}"
    return out


def keys_for(secret: str) -> dict[str, bytes]:
    out: dict[str, bytes] = {"ascii": secret.encode()}
    try:
        out["hex-decodificada"] = bytes.fromhex(secret)
    except ValueError:
        pass
    return out


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__)
        return 2
    secret = sys.argv[1].strip()
    print(f"chave: {secret[:8]}…{secret[-4:]}  (len={len(secret)})")
    print(f"v1 esperado: {V1_RECEBIDO}\n")

    for key_label, key in keys_for(secret).items():
        for manifest_label, manifest in manifests().items():
            calc = hmac.new(key, manifest.encode(), hashlib.sha256).hexdigest()
            if calc == V1_RECEBIDO:
                print(f"MATCH  chave={key_label}  manifest={manifest_label}")
                print(f"  {manifest!r}")
                return 0

    print("Nenhuma combinação bateu — essa chave não assinou a notificação capturada.")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
