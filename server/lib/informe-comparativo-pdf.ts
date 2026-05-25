import PDFDocument from 'pdfkit'
import { sortArchivosByPropuestaPriority } from './convocatorias-drive-ia.js'

export function driveFileViewUrl(fileId: string): string {
  return `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/view`
}

type ArchivoDrive = { id: string; name: string }

type AnalisisInformeRow = {
  id: string
  conjunto?: string | null
  servicio?: string | null
  anio?: string | null
  created_at?: string
  folder_id?: string
  criterios?: Array<{
    nombre: string
    peso?: number
    tipo?: string
    descripcion?: string
    unidad?: string
  }>
  top_3?: Array<{ proveedor?: string; puntaje?: number; justificacion?: string }>
  propuestas?: Array<{
    proveedor?: string
    puntaje?: number
    justificacion?: string
  }>
  analisis_extendido?: {
    resumen_ejecutivo?: {
      sintesis_global?: string
      proveedores?: Array<{
        proveedor?: string
        puntaje_global?: number | null
        veredicto?: string
        por_criterio?: Array<{
          criterio?: string
          peso_pct?: number
          medicion_tr?: string
          valor_ofertado?: string
          confianza_extraccion?: string | null
          subpuntaje_10?: number
          hallazgo?: string
        }>
      }>
    }
    analisis_criterios?: Array<{
      criterio?: string
      medicion_tr?: string
      peso_pct?: number
      proveedores?: Array<{
        proveedor?: string
        puntaje_criterio?: number
        valor_ofertado?: string
        confianza_extraccion?: string | null
      }>
    }>
    financiero?: {
      resumen?: string
      comparativo?: Array<{
        concepto?: string
        valores_por_proveedor?: Record<string, string>
      }>
    }
  }
  documentacion?: {
    archivos_por_proveedor?: Array<{ proveedor?: string; archivos?: ArchivoDrive[] }>
  }
}

function normKey(s: string) {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim()
    .toLowerCase()
}

function safeFilenamePart(s: string): string {
  return s.replace(/[^\w.\- ]+/g, '_').slice(0, 60).trim() || 'licitacion'
}

function pdfBuffer(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    doc.on('data', (c) => chunks.push(c as Buffer))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
    doc.end()
  })
}

class InformePdf {
  private doc: InstanceType<typeof PDFDocument>
  private y = 0
  private readonly margin = 48
  private readonly pageW: number
  private readonly contentW: number
  private readonly bottom = 780

  constructor() {
    this.doc = new PDFDocument({ size: 'A4', margin: this.margin, bufferPages: true })
    this.pageW = this.doc.page.width
    this.contentW = this.pageW - this.margin * 2
    this.y = this.margin
  }

  private ensureSpace(h: number) {
    if (this.y + h > this.bottom) {
      this.doc.addPage()
      this.y = this.margin
    }
  }

  private heading(text: string, size = 14) {
    this.ensureSpace(size + 14)
    this.doc.font('Helvetica-Bold').fontSize(size).fillColor('#0f172a').text(text, this.margin, this.y, {
      width: this.contentW,
    })
    this.y = this.doc.y + 10
  }

  private paragraph(text: string, size = 10) {
    if (!text.trim()) return
    this.doc.font('Helvetica').fontSize(size).fillColor('#334155')
    const h = this.doc.heightOfString(text, { width: this.contentW })
    this.ensureSpace(h + 8)
    this.doc.text(text, this.margin, this.y, { width: this.contentW, align: 'justify' })
    this.y = this.doc.y + 8
  }

  private linkLine(label: string, url: string, size = 9) {
    this.ensureSpace(16)
    const x = this.margin
    this.doc.font('Helvetica').fontSize(size).fillColor('#1d4ed8')
    this.doc.text(label, x, this.y, { width: this.contentW, link: url, underline: true })
    this.y = this.doc.y + 4
    this.doc.fillColor('#334155')
  }

  private tableRow(cols: string[], widths: number[], bold = false) {
    const font = bold ? 'Helvetica-Bold' : 'Helvetica'
    const size = 8
    let rowH = 0
    const cellHeights = cols.map((cell, i) => {
      this.doc.font(font).fontSize(size)
      return this.doc.heightOfString(cell || '—', { width: widths[i]! - 6 })
    })
    rowH = Math.max(...cellHeights, 12) + 8
    this.ensureSpace(rowH + 4)
    let x = this.margin
    const y0 = this.y
    cols.forEach((cell, i) => {
      this.doc.font(font).fontSize(size).fillColor(bold ? '#0f172a' : '#334155')
      this.doc.text(cell || '—', x + 3, y0 + 4, { width: widths[i]! - 6, lineBreak: true })
      x += widths[i]!
    })
    this.doc
      .strokeColor('#e2e8f0')
      .moveTo(this.margin, y0 + rowH)
      .lineTo(this.margin + widths.reduce((a, b) => a + b, 0), y0 + rowH)
      .stroke()
    this.y = y0 + rowH + 2
  }

  build(row: AnalisisInformeRow): InstanceType<typeof PDFDocument> {
    const titulo = [row.servicio, row.conjunto].filter(Boolean).join(' · ') || 'Convocatoria'
    const fecha = row.created_at
      ? new Date(row.created_at).toLocaleString('es-CO', { dateStyle: 'long', timeStyle: 'short' })
      : '—'

    const top3 = (Array.isArray(row.top_3) ? row.top_3 : []).slice(0, 3)
    const topNames = top3.map((t) => String(t.proveedor ?? '').trim()).filter(Boolean)

    const archivosMap = new Map<string, ArchivoDrive[]>()
    for (const p of row.documentacion?.archivos_por_proveedor ?? []) {
      if (!p.proveedor) continue
      archivosMap.set(normKey(p.proveedor), sortArchivosByPropuestaPriority(p.archivos ?? []))
    }

    const findArchivos = (proveedor: string) => {
      const k = normKey(proveedor)
      for (const [key, files] of archivosMap) {
        if (key === k || key.includes(k) || k.includes(key)) return files
      }
      return archivosMap.get(k) ?? []
    }

    this.heading('Informe comparativo de propuestas', 16)
    this.paragraph(`${titulo}${row.anio ? ` · ${row.anio}` : ''}`)
    this.paragraph(`Generado: ${fecha} · ID análisis: ${row.id}`)
    if (row.folder_id) {
      this.linkLine('Carpeta del servicio en Google Drive', `https://drive.google.com/drive/folders/${row.folder_id}`)
    }

    const sintesis = row.analisis_extendido?.resumen_ejecutivo?.sintesis_global?.trim()
    if (sintesis) {
      this.heading('Síntesis', 12)
      this.paragraph(sintesis)
    }

    const finResumen = row.analisis_extendido?.financiero?.resumen?.trim()
    if (finResumen) {
      this.heading('Propuesta económica (resumen)', 12)
      this.paragraph(finResumen)
    }

    this.heading('Top 3 — acceso a propuestas en Drive', 12)
    if (top3.length === 0) {
      this.paragraph('No hay ranking disponible para este análisis.')
    }
    top3.forEach((t, i) => {
      const prov = String(t.proveedor ?? `Proveedor ${i + 1}`)
      const puntaje = typeof t.puntaje === 'number' ? t.puntaje : '—'
      this.doc.font('Helvetica-Bold').fontSize(10).fillColor('#0f172a')
      this.ensureSpace(20)
      this.doc.text(`${i + 1}. ${prov} — Puntaje global: ${puntaje}`, this.margin, this.y, { width: this.contentW })
      this.y = this.doc.y + 4

      const reProv = row.analisis_extendido?.resumen_ejecutivo?.proveedores?.find(
        (p) => normKey(String(p.proveedor ?? '')) === normKey(prov),
      )
      if (reProv?.veredicto) this.paragraph(reProv.veredicto, 9)
      else if (t.justificacion) this.paragraph(String(t.justificacion), 9)

      const archivos = findArchivos(prov)
      const principal = archivos[0]
      if (principal?.id) {
        this.linkLine(`Propuesta principal: ${principal.name}`, driveFileViewUrl(principal.id))
      }
      const otros = archivos.slice(1, 5)
      for (const a of otros) {
        if (a.id) this.linkLine(`· ${a.name}`, driveFileViewUrl(a.id), 8)
      }
      if (archivos.length > 5) {
        this.paragraph(`(+${archivos.length - 5} archivos más en la carpeta del proveedor en Drive)`, 8)
      }
      if (!principal) {
        this.paragraph('Sin PDFs enlazados en el análisis (revisar carpeta en Drive).', 8)
      }
      this.y += 6
    })

    const criteriosTr = Array.isArray(row.criterios) ? row.criterios : []
    if (criteriosTr.length > 0 && topNames.length > 0) {
      this.heading('Cuadro comparativo por criterios del TR (Top 3)', 12)
      const col0 = 118
      const colRest = (this.contentW - col0) / topNames.length
      const widths = [col0, ...topNames.map(() => colRest)]

      this.tableRow(['Criterio (medición TR)', ...topNames], widths, true)

      for (const cr of criteriosTr) {
        const nombre = cr.nombre
        const medicion = [cr.unidad, cr.descripcion].filter(Boolean).join(' — ') || '—'
        const cells = topNames.map((prov) => {
          const fromRe = row.analisis_extendido?.resumen_ejecutivo?.proveedores
            ?.find((p) => normKey(String(p.proveedor ?? '')) === normKey(prov))
            ?.por_criterio?.find((c) => normKey(String(c.criterio ?? '')) === normKey(nombre))
          if (fromRe) {
            const conf = fromRe.confianza_extraccion ? ` · conf. ${fromRe.confianza_extraccion}` : ''
            return `${fromRe.valor_ofertado ?? '—'}\n${fromRe.subpuntaje_10 ?? '—'}/10${conf}\n${fromRe.hallazgo ?? ''}`
          }
          const fromAc = row.analisis_extendido?.analisis_criterios
            ?.find((c) => normKey(String(c.criterio ?? '')) === normKey(nombre))
            ?.proveedores?.find((p) => normKey(String(p.proveedor ?? '')) === normKey(prov))
          if (fromAc) {
            const conf = fromAc.confianza_extraccion ? ` · conf. ${fromAc.confianza_extraccion}` : ''
            return `${fromAc.valor_ofertado ?? '—'}\n${fromAc.puntaje_criterio ?? '—'}/10${conf}`
          }
          return '—'
        })
        this.tableRow([`${nombre}\n${medicion}`, ...cells], widths)
      }
    }

    const comparativoFin = row.analisis_extendido?.financiero?.comparativo ?? []
    if (comparativoFin.length > 0 && topNames.length > 0) {
      this.heading('Valores económicos declarados', 12)
      const col0 = 118
      const colRest = (this.contentW - col0) / topNames.length
      const widths = [col0, ...topNames.map(() => colRest)]
      this.tableRow(['Concepto', ...topNames], widths, true)
      for (const rowFin of comparativoFin) {
        const cells = topNames.map((prov) => rowFin.valores_por_proveedor?.[prov] ?? '—')
        this.tableRow([String(rowFin.concepto ?? ''), ...cells], widths)
      }
    }

    this.heading('Criterios de evaluación (TR)', 12)
    for (const cr of criteriosTr) {
      this.doc.font('Helvetica-Bold').fontSize(9).fillColor('#0f172a')
      this.ensureSpace(14)
      this.doc.text(`${cr.nombre} — Peso ${cr.peso ?? '—'}% (${cr.tipo ?? '—'})`, this.margin, this.y, {
        width: this.contentW,
      })
      this.y = this.doc.y + 2
      this.paragraph([cr.unidad, cr.descripcion].filter(Boolean).join(' · ') || '—', 8)
    }

    this.ensureSpace(24)
    this.paragraph(
      'Enlaces: abra los PDF desde un lector compatible con hipervínculos (Chrome, Acrobat, Preview). Requiere acceso a la carpeta en Google Drive con su cuenta.',
      8,
    )

    return this.doc
  }
}

export async function buildInformeComparativoPdf(row: AnalisisInformeRow): Promise<Buffer> {
  const informe = new InformePdf()
  const doc = informe.build(row)
  return pdfBuffer(doc)
}

export function informePdfFilename(row: AnalisisInformeRow): string {
  const part = safeFilenamePart(String(row.servicio ?? row.conjunto ?? 'informe'))
  const stamp = row.created_at ? new Date(row.created_at).toISOString().slice(0, 10) : 'fecha'
  return `informe-comparativo-${part}-${stamp}.pdf`
}
