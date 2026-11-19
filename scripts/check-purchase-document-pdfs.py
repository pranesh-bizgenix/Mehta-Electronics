from pathlib import Path
import json
import re
from pypdf import PdfReader
root = Path('verification-output/purchase-documents/2026-11-18')
results = []
for name in ['sample-vendor-rfq.pdf', 'sample-supplier-po-33.pdf', 'sample-supplier-po-19.pdf', 'sample-rfq-multipage.pdf']:
    pdf = PdfReader(root / name)
    text = '\n'.join(page.extract_text() or '' for page in pdf.pages)
    assert 'DEMO' in text and 'SUPPLIER' in text
    assert 'KG Electro' not in text and 'KARNATAKA' not in text and '24%' not in text
    for i, page in enumerate(pdf.pages):
        content = page.extract_text() or ''
        assert 'SAMPLE - NOT FOR' in content and 'ISSUE' in content
        assert f'Page {i+1} of {len(pdf.pages)}' in content
        assert 'DEMO Mehta issuer' in content
    if 'supplier-po' in name:
        assert '90.00' in text and '180.00' in text and '212.00' in text
        assert '-0.40' in text and 'Rupees two hundred twelve only' in text
    if 'multipage' in name:
        assert len(pdf.pages) > 1
        assert all(f'DEMO-{i}' in text for i in range(1,37))
    else:
        assert len(pdf.pages) == 1
    results.append({'file':name,'pages':len(pdf.pages),'status':'PASS'})
stress = root / 'sample-long-content.pdf'
if stress.exists():
    pdf = PdfReader(stress)
    text = re.sub(r'\s+', '', '\n'.join(page.extract_text() or '' for page in pdf.pages))
    assert 'END-TERMS-MARKER' in text and 'END-ITEM-DESCRIPTION' in text
    assert all(f'Page {i+1} of {len(pdf.pages)}' in (page.extract_text() or '') for i,page in enumerate(pdf.pages))
    results.append({'file':stress.name,'pages':len(pdf.pages),'status':'PASS','longContentRetained':True})
(root / 'pdf-verification.json').write_text(json.dumps({'status':'PASS','results':results},indent=2),encoding='utf-8')
print('PASS: all sample fields, totals, watermarks, repeated headers, page counts and all 36 RFQ lines.')
