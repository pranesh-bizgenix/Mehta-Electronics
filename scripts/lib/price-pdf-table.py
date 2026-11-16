"""Bounded, offline PDF layout extraction; never interprets document instructions."""
import io
import json
import logging
import sys

logging.disable(logging.CRITICAL)
try:
    from pypdf import PdfReader
except ImportError:
    sys.exit(77)

try:
    data = sys.stdin.buffer.read(8388609)
    if not data.startswith(b'%PDF-') or len(data) > 8388608:
        sys.exit(65)
    reader = PdfReader(io.BytesIO(data), strict=True)
    if reader.is_encrypted or not 1 <= len(reader.pages) <= 1000:
        sys.exit(65)
    rows = []
    total = 0
    for page_number, page in enumerate(reader.pages, 1):
        text = page.extract_text(extraction_mode='layout') or ''
        for line in text.splitlines():
            if len(line) > 2000 or '\x00' in line:
                sys.exit(65)
            total += len(line.encode('utf-8'))
            if total > 16777216 or len(rows) >= 20000:
                sys.exit(65)
            rows.append({'number': len(rows) + 1, 'page': page_number, 'text': line})
    if not any(row['text'].strip() for row in rows):
        sys.exit(66)
    sys.stdout.write(json.dumps({'pages': len(reader.pages), 'rows': rows}, ensure_ascii=True))
except Exception:
    # No PDF contents, client paths, parser diagnostics or bank/pricing data in errors.
    sys.exit(65)
