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

export function pdfFixture(pageCount = 2, withOutline = false) {
  const stream = (text: string) => {
    const content = `BT /F1 24 Tf 60 700 Td (${text}) Tj ET`
    return `<< /Length ${content.length} >>\nstream\n${content}\nendstream`
  }
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${Array.from({ length: pageCount }, (_, index) => `${index + 3} 0 R`).join(' ')}] /Count ${pageCount} >>`,
    ...Array.from({ length: pageCount }, (_, index) => `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${pageCount + 3} 0 R >> >> /Contents ${pageCount + 4 + index} 0 R >>`),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ...Array.from({ length: pageCount }, (_, index) => stream(`A quiet journey - page ${index + 1}`)),
  ]
  if (withOutline) {
    const root = objects.length + 1
    // A real nested outline: direct page reference followed by a named destination.
    objects[0] = `<< /Type /Catalog /Pages 2 0 R /Outlines ${root} 0 R /Names << /Dests << /Names [(horizon) [${pageCount + 2} 0 R /Fit]] >> >> >>`
    objects.push(
      `<< /Type /Outlines /First ${root + 1} 0 R /Last ${root + 1} 0 R /Count 2 >>`,
      `<< /Title (The beginning) /Parent ${root} 0 R /Dest [3 0 R /Fit] /First ${root + 2} 0 R /Last ${root + 2} 0 R /Count 1 >>`,
      `<< /Title (A new horizon) /Parent ${root + 1} 0 R /Dest (horizon) >>`,
    )
  }
  let pdf = '%PDF-1.4\n'
  const offsets = [0]
  for (const [index, object] of objects.entries()) { offsets.push(pdf.length); pdf += `${index + 1} 0 obj\n${object}\nendobj\n` }
  const xref = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  pdf += offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(pdf)
}
