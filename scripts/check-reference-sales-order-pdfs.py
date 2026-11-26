"""Validate file-only fictional sales-order previews (QA pypdf required)."""
from pathlib import Path
from pypdf import PdfReader

root = Path('verification-output/sales-order-format')
for name in ['sample-sales-order-cgst-sgst', 'sample-sales-order-igst', 'sample-sales-order-multipage']:
    pdf = PdfReader(root / (name + '.pdf'))
    text = '\n'.join(page.extract_text() or '' for page in pdf.pages)
    assert 'Sales Order' in text and 'SAMPLE-CUSTOMER-PO' in text
    assert 'Net Rate INR' in text and '90.00' in text
    assert 'KG Electro' not in text and 'HDFC0001242' not in text and 'Ex-Stock' not in text
    assert 'Disc %' not in text
    assert all('SAMPLE - NOT FOR ISSUE' in (page.extract_text() or '') for page in pdf.pages)
    assert all(f'Page {i+1} of {len(pdf.pages)}' in (page.extract_text() or '') for i, page in enumerate(pdf.pages))
    if name.endswith('multipage'):
        assert len(pdf.pages) > 1 and 'SAMPLE-ITEM-040' in text
    else:
        assert len(pdf.pages) == 1 and '424.80' in text
    if name.endswith('cgst-sgst'):
        assert 'CGST' in text and 'SGST' in text
    if name.endswith('igst'):
        assert 'IGST' in text and 'CGST' not in text
    print(f'{name}: PASS ({len(pdf.pages)} pages)')
