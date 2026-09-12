import { strToU8, zipSync } from 'fflate'

export function epubFixture() {
  const xml = (body: string) => strToU8(body)
  return Buffer.from(zipSync({
    mimetype: xml('application/epub+zip'),
    'META-INF/container.xml': xml('<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="EPUB/book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'),
    'EPUB/book.opf': xml('<package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>A quiet journey</dc:title></metadata><manifest><item id="one" href="one.xhtml" media-type="application/xhtml+xml"/><item id="two" href="two.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="one"/><itemref idref="two"/></spine></package>'),
    'EPUB/one.xhtml': xml('<html xmlns="http://www.w3.org/1999/xhtml"><head><title>The beginning</title></head><body><h1>The beginning</h1><p>Every journey begins with a single page.</p><script>parent.location="https://example.invalid/escape"</script><img src="https://example.invalid/tracker" onerror="alert(1)" alt="External image"/><a href="javascript:alert(1)">Unsafe link</a><form action="https://example.invalid/form"><input name="secret"/></form></body></html>'),
    'EPUB/two.xhtml': xml('<html xmlns="http://www.w3.org/1999/xhtml"><head><title>A new horizon</title></head><body><h1>A new horizon</h1><p>There is always another chapter waiting.</p></body></html>'),
  }))
}

export function pdfFixture() {
  const stream = (text: string) => {
    const content = `BT /F1 24 Tf 60 700 Td (${text}) Tj ET`
    return `<< /Length ${content.length} >>\nstream\n${content}\nendstream`
  }
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    stream('A quiet journey - page one'), stream('A new horizon - page two'),
  ]
  let pdf = '%PDF-1.4\n'
  const offsets = [0]
  for (const [index, object] of objects.entries()) { offsets.push(pdf.length); pdf += `${index + 1} 0 obj\n${object}\nendobj\n` }
  const xref = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  pdf += offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(pdf)
}
