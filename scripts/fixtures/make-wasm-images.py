"""Story 3.1: writes fixtures/pdf/wasm-images.pdf, one A4 page with a JPEG 2000
(JPXDecode) image and a CCITT Group 4 (CCITTFaxDecode) image. pdf.js 6 decodes
both with its wasm decoders (openjpeg.wasm, jbig2.wasm), so the production e2e
uses this file to prove the parser worker's CSP lets them run (ADR 0005).

Synthetic content only. Needs Pillow with OpenJPEG and libtiff (the standard
wheels have both):  python scripts/fixtures/make-wasm-images.py
"""

import io
import pathlib

from PIL import Image, ImageDraw

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / "fixtures" / "pdf" / "wasm-images.pdf"


def jpx_bytes():
    img = Image.new("RGB", (240, 160), (255, 255, 255))
    d = ImageDraw.Draw(img)
    d.rectangle([10, 10, 230, 150], outline=(200, 30, 30), width=6)
    d.ellipse([60, 30, 180, 130], fill=(30, 90, 200))
    buf = io.BytesIO()
    img.save(buf, format="JPEG2000", irreversible=False)
    return buf.getvalue(), img.size


def ccitt_bytes():
    img = Image.new("1", (320, 160), 1)
    d = ImageDraw.Draw(img)
    for x in range(10, 310, 20):
        d.line([(x, 10), (x, 150)], fill=0, width=3)
    d.rectangle([5, 5, 314, 154], outline=0, width=4)
    buf = io.BytesIO()
    img.save(buf, format="TIFF", compression="group4")
    tiff = Image.open(io.BytesIO(buf.getvalue()))
    offsets = tiff.tag_v2[273]
    counts = tiff.tag_v2[279]
    assert len(offsets) == 1, "expected a single strip"
    raw = buf.getvalue()[offsets[0] : offsets[0] + counts[0]]
    # CCITT codes white and black runs; with the PDF default BlackIs1 false, black
    # runs decode to 0 (black in DeviceGray), whatever bit sense the TIFF used.
    return raw, img.size


def pdf(objects):
    out = bytearray(b"%PDF-1.7\n%\xe2\xe3\xcf\xd3\n")
    offsets = []
    for i, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += f"{i} 0 obj\n".encode() + body + b"\nendobj\n"
    xref = len(out)
    out += f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode()
    for off in offsets:
        out += f"{off:010d} 00000 n \n".encode()
    out += f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    return bytes(out)


def stream(dict_body, data):
    return f"<< {dict_body} /Length {len(data)} >>\nstream\n".encode() + data + b"\nendstream"


def main():
    jpx, (jw, jh) = jpx_bytes()
    g4, (cw, ch) = ccitt_bytes()
    content = b"q 240 0 0 160 60 600 cm /Jpx Do Q\nq 320 0 0 160 60 380 cm /G4 Do Q\n"
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Jpx 4 0 R /G4 5 0 R >> >> /Contents 6 0 R >>",
        stream(f"/Type /XObject /Subtype /Image /Width {jw} /Height {jh} /Filter /JPXDecode", jpx),
        stream(
            f"/Type /XObject /Subtype /Image /Width {cw} /Height {ch} /ColorSpace /DeviceGray /BitsPerComponent 1 "
            f"/Filter /CCITTFaxDecode /DecodeParms << /K -1 /Columns {cw} /Rows {ch} >>",
            g4,
        ),
        stream("", content),
    ]
    OUT.write_bytes(pdf(objects))
    print(f"wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
