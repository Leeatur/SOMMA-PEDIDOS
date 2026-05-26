import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'

export interface CatalogPage {
  pageNumber: number
  references: string[]
  productName: string
  sizeRange: string
  imagePath: string | null
}

export interface CatalogImportResult {
  pages: CatalogPage[]
  totalPages: number
  matched: number   // referências encontradas no catálogo
  unmatched: string[] // refs da tabela de preço sem foto
}

// Extrai texto de todas as páginas do PDF via Python/PyMuPDF
function extractPdfData(pdfPath: string): Array<{ page: number; text: string; imageCount: number }> {
  const script = `
import sys, json, fitz
doc = fitz.open(sys.argv[1])
result = []
for i, page in enumerate(doc):
    text = page.get_text().strip()
    imgs = len(page.get_images(full=True))
    result.append({"page": i+1, "text": text, "imageCount": imgs})
print(json.dumps(result))
doc.close()
`
  const tmpScript = `/tmp/pdf_extract_${Date.now()}.py`
  fs.writeFileSync(tmpScript, script)
  try {
    const output = execSync(`python3 "${tmpScript}" "${pdfPath}"`, { maxBuffer: 10 * 1024 * 1024 })
    return JSON.parse(output.toString())
  } finally {
    fs.unlinkSync(tmpScript)
  }
}

// Renderiza uma página do PDF como JPEG e salva no diretório de uploads
function renderPageAsImage(pdfPath: string, pageNumber: number, outputDir: string, reference: string): string | null {
  const outputPath = path.join(outputDir, `${reference}.jpg`)
  if (fs.existsSync(outputPath)) return `/uploads/products/${reference}.jpg`

  const script = `
import sys, fitz
doc = fitz.open(sys.argv[1])
page = doc[int(sys.argv[2])]
mat = fitz.Matrix(1.5, 1.5)
pix = page.get_pixmap(matrix=mat)
pix.save(sys.argv[3])
doc.close()
`
  const tmpScript = `/tmp/pdf_render_${Date.now()}.py`
  fs.writeFileSync(tmpScript, script)
  try {
    execSync(`python3 "${tmpScript}" "${pdfPath}" "${pageNumber - 1}" "${outputPath}"`)
    return fs.existsSync(outputPath) ? `/uploads/products/${reference}.jpg` : null
  } catch {
    return null
  } finally {
    if (fs.existsSync(tmpScript)) fs.unlinkSync(tmpScript)
  }
}

// Extrai referências de um texto de página
function extractReferences(text: string): string[] {
  const matches = text.match(/(?:TE|PKTE)\d+/gi)
  return matches ? [...new Set(matches.map(r => r.toUpperCase()))] : []
}

// Extrai nome do produto (primeira linha não-referência)
function extractProductName(text: string): string {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  for (const line of lines) {
    if (!/^(TE|PKTE)\d+/i.test(line) && !/^\d+\s+AO\s+\d+/i.test(line)) {
      return line
    }
  }
  return ''
}

// Extrai faixa de tamanho (ex: "34 AO 52", "P AO EXG")
function extractSizeRange(text: string): string {
  const match = text.match(/(\d+|[PMGX]+)\s+AO\s+(\d+|[PMGX]+)/i)
  return match ? match[0] : ''
}

export async function importCatalogPdf(
  pdfPath: string,
  uploadDir: string,
  priceTableRefs: string[] // referências já importadas da tabela de preço
): Promise<CatalogImportResult> {
  const pages = extractPdfData(pdfPath)
  const result: CatalogPage[] = []
  const foundRefs = new Set<string>()

  for (const page of pages) {
    if (!page.text && page.imageCount === 0) continue

    const references = extractReferences(page.text)
    if (references.length === 0) continue

    const productName = extractProductName(page.text)
    const sizeRange = extractSizeRange(page.text)

    // Renderiza imagem usando a primeira referência como nome do arquivo
    let imagePath: string | null = null
    if (page.imageCount > 0 && references.length > 0) {
      imagePath = renderPageAsImage(pdfPath, page.page, uploadDir, references[0])

      // Copia a mesma imagem para referências adicionais na mesma página
      for (let i = 1; i < references.length; i++) {
        const aliasPath = path.join(uploadDir, `${references[i]}.jpg`)
        if (!fs.existsSync(aliasPath) && imagePath) {
          try {
            fs.copyFileSync(path.join(uploadDir, `${references[0]}.jpg`), aliasPath)
          } catch {}
        }
      }
    }

    references.forEach(r => foundRefs.add(r))
    result.push({ pageNumber: page.page, references, productName, sizeRange, imagePath })
  }

  const unmatched = priceTableRefs.filter(r => !foundRefs.has(r.toUpperCase()))

  return {
    pages: result,
    totalPages: pages.length,
    matched: foundRefs.size,
    unmatched,
  }
}
