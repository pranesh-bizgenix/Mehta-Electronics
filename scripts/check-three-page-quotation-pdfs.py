"""Inspect file-only quotation previews. Requires QA pypdf, not a runtime dependency."""
from pathlib import Path
from pypdf import PdfReader

root = Path('verification-output/quotation-format')
for name in ['sample-quotation-cgst-sgst', 'sample-quotation-igst', 'sample-quotation-long', 'sample-quotation-legacy']:
    pdf = PdfReader(root / (name + '.pdf'))
    pages = [page.extract_text() or '' for page in pdf.pages]
    text = '\n'.join(pages)
    assert 'COVER & SUMMARY' in pages[0]
    assert 'ITEMIZED PRICING & SCOPE' in pages[1]
    assert 'TERMS & SIGN-OFF' in pages[-1]
    assert 'Authorised signatory' in pages[-1]
    assert 'Client acceptance / PO reference' in pages[-1]
    assert 'SAMPLE-ITEM-001' in text
    assert 'KG Electro' not in text and 'Discount' not in text and 'Margin' not in text
    assert all('DRAFT - NOT APPROVED FOR ISSUE' in page for page in pages)
    assert all(f'Page {i+1} of {len(pages)}' in page for i, page in enumerate(pages))
    if name.endswith('long'):
        assert len(pages) > 3 and 'SAMPLE-ITEM-040' in text
    else:
        assert len(pages) == 3
    if name.endswith('cgst-sgst'):
        assert 'CGST' in pages[1] and 'SGST' in pages[1] and '424.80' in pages[1]
    if name.endswith('igst'):
        assert 'IGST' in pages[1] and 'CGST' not in pages[1]
    if name.endswith('legacy'):
        assert 'GST (source total)' in pages[1] and '212.40' in pages[1]
    print(f'{name}: PASS ({len(pages)} pages)')

for filename in ['sample-quotation-browser-print.pdf', 'sample-quotation-browser-print-long.pdf']:
    path = root / filename
    if path.exists():
        pdf = PdfReader(path)
        text = '\n'.join(page.extract_text() or '' for page in pdf.pages)
        assert 'authorised signatory' in text.lower() and 'client acceptance' in text.lower()
        if filename.endswith('-long.pdf'):
            assert len(pdf.pages) > 3 and 'SAMPLE-ITEM-040' in text
        else:
            assert len(pdf.pages) == 3
        print(f'{filename}: PASS ({len(pdf.pages)} pages)')
