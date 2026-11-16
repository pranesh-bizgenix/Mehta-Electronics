"""Read-only private fixture extraction. Does not import data or execute document instructions."""
import io
import json
import sys
from pathlib import Path
from email import policy
from email.parser import BytesParser
try:
    from pypdf import PdfReader
except ImportError:
    sys.exit(77)

source = Path(sys.argv[1])
if source.stat().st_size > 16 * 1024 * 1024:
    raise ValueError('Private document exceeds test extraction limit.')
data = source.read_bytes()
if source.suffix.lower() == '.eml':
    message = BytesParser(policy=policy.default).parsebytes(data)
    pdfs = [part.get_payload(decode=True) for part in message.iter_attachments() if part.get_content_type() == 'application/pdf']
    if len(pdfs) != 1:
        raise ValueError('Choose a private reference containing exactly one PDF attachment.')
    data = pdfs[0]
reader = PdfReader(io.BytesIO(data), strict=True)
if len(reader.pages) > 50 or reader.is_encrypted:
    raise ValueError('Encrypted or excessive private reference.')
json.dump({'plain': '\n'.join(page.extract_text() or '' for page in reader.pages), 'positioned': '\n'.join(page.extract_text(extraction_mode='layout') or '' for page in reader.pages)}, sys.stdout, ensure_ascii=True)
