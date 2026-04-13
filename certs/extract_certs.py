#!/usr/bin/env python3
"""
Extract CSCA certificates from ICAO Master List (.ml file).

Parses the DER-encoded CMS SignedData structure, extracts all X.509 certificates,
deduplicates by public key, and outputs:
  - cscas.pem: all unique certificates in PEM format
  - cscas.json: metadata for each cert (modulus, exponent, country, etc.)
"""

import json
import sys
from pathlib import Path

from cryptography import x509
from cryptography.hazmat.primitives.serialization import Encoding
from cryptography.x509.oid import ExtensionOID


def extract_csca_certs(ml_path: str, output_dir: str):
    ml_path = Path(ml_path)
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    with open(ml_path, "rb") as f:
        data = f.read()

    certificates = []
    seen_keys = set()
    pem_bytes = b""

    # Scan for DER-encoded X.509 certificate patterns
    # Certificates are SEQUENCE (0x30 0x82) with length 500-5000 bytes
    for i in range(len(data) - 4):
        if data[i : i + 2] != b"\x30\x82":
            continue

        length = int.from_bytes(data[i + 2 : i + 4], "big")
        if not (500 < length < 5000):
            continue

        try:
            cert = x509.load_der_x509_certificate(data[i : i + 4 + length])
        except Exception:
            continue

        pub_key = cert.public_key()
        if not hasattr(pub_key, "public_numbers"):
            continue

        numbers = pub_key.public_numbers()
        key_tuple = (numbers.n, numbers.e)

        if key_tuple in seen_keys:
            continue
        seen_keys.add(key_tuple)

        country_attrs = cert.subject.get_attributes_for_oid(
            x509.oid.NameOID.COUNTRY_NAME
        )
        org_attrs = cert.subject.get_attributes_for_oid(
            x509.oid.NameOID.ORGANIZATION_NAME
        )
        cn_attrs = cert.subject.get_attributes_for_oid(
            x509.oid.NameOID.COMMON_NAME
        )

        # Extract Subject Key Identifier if present
        ski_hex = None
        try:
            ski_ext = cert.extensions.get_extension_for_oid(
                ExtensionOID.SUBJECT_KEY_IDENTIFIER
            )
            ski_hex = ski_ext.value.digest.hex()
        except x509.ExtensionNotFound:
            pass

        cert_info = {
            "subject": cert.subject.rfc4514_string(),
            "country": country_attrs[0].value if country_attrs else None,
            "organization": org_attrs[0].value if org_attrs else None,
            "common_name": cn_attrs[0].value if cn_attrs else None,
            "not_before": cert.not_valid_before_utc.isoformat(),
            "not_after": cert.not_valid_after_utc.isoformat(),
            "key_size": numbers.n.bit_length(),
            "exponent": numbers.e,
            "modulus_hex": format(numbers.n, "x"),
            "ski": ski_hex,
        }
        certificates.append(cert_info)
        pem_bytes += cert.public_bytes(Encoding.PEM)

    # Write outputs
    pem_path = output_dir / "cscas.pem"
    json_path = output_dir / "cscas.json"

    with open(pem_path, "wb") as f:
        f.write(pem_bytes)

    with open(json_path, "w") as f:
        json.dump(certificates, f, indent=2)

    print(f"Extracted {len(certificates)} unique CSCA certificates")
    print(f"  {pem_path}")
    print(f"  {json_path}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python extract_certs.py <ICAO_ML_file> [output_dir]")
        sys.exit(1)

    ml_file = sys.argv[1]
    out_dir = sys.argv[2] if len(sys.argv) > 2 else "."
    extract_csca_certs(ml_file, out_dir)
