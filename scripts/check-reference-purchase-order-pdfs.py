"""File-only inspection of fictional PO layout samples; requires QA pypdf."""
from pathlib import Path
from pypdf import PdfReader

root = Path('verification-output/purchase-order-format')
for name in ['sample-po-cgst-sgst', 'sample-po-igst', 'sample-po-net-rate', 'sample-po-multipage']:
    pdf = PdfReader(root / (name + '.pdf'))
    text = '\n'.join(page.extract_text() or '' for page in pdf.pages)
    assert 'Purchase Order' in text and 'Mehta Electric Corporation' in text
    assert 'SAMPLE-ITEM-001' in text and 'Authorised Signatory' in text
    assert 'KG Electro' not in text and '51,312.80' not in text and '194 Q' not in text
    for i, page in enumerate(pdf.pages):
        content = page.extract_text() or ''
        assert 'SAMPLE - NOT FOR ISSUE' in content
        assert f'Page {i + 1} of {len(pdf.pages)}' in content
    if name.endswith('multipage'):
        assert len(pdf.pages) > 1 and 'SAMPLE-ITEM-040' in text
    else:
        assert len(pdf.pages) == 1 and '212.00' in text and '-0.40' in text
    if name.endswith('cgst-sgst'):
        assert 'CGST' in text and 'SGST' in text
    if name.endswith('igst'):
        assert 'IGST' in text and 'CGST' not in text
    if name.endswith('net-rate'):
        assert 'Disc %' not in text and '90.00' in text
    else:
        assert 'Disc %' in text and '100.00' in text
    print(f'{name}: PASS ({len(pdf.pages)} pages)')
