import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { randomUUID } from 'crypto'
import path from 'path'

// Cloudflare R2 é compatível com S3
const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId:     process.env.R2_ACCESS_KEY_ID     || '',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
  },
})

const BUCKET = process.env.R2_BUCKET_NAME || 'somma-pedidos'
const PUBLIC_URL = (process.env.R2_PUBLIC_URL || '').replace(/\/$/, '')

export function isR2Configured(): boolean {
  return !!(
    process.env.R2_ACCOUNT_ID &&
    process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_SECRET_ACCESS_KEY &&
    process.env.R2_PUBLIC_URL
  )
}

/**
 * Faz upload de um buffer para o R2 e retorna a URL pública.
 * @param buffer  Conteúdo do arquivo
 * @param originalName  Nome original para inferir extensão
 * @param folder  Pasta dentro do bucket (ex: "products", "logos")
 * @param fixedName  Se definido, usa este nome em vez de UUID (ex: "company-logo.png")
 */
export async function uploadToR2(
  buffer: Buffer,
  originalName: string,
  folder: string,
  fixedName?: string,
): Promise<string> {
  const ext = path.extname(originalName).toLowerCase()
  const filename = fixedName ?? `${randomUUID()}${ext}`
  const key = `${folder}/${filename}`

  const contentType = getContentType(ext)

  await r2.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: buffer,
    ContentType: contentType,
    CacheControl: 'public, max-age=31536000',
  }))

  return `${PUBLIC_URL}/${key}`
}

export async function deleteFromR2(url: string): Promise<void> {
  try {
    // Extrai o key da URL pública
    const key = url.replace(`${PUBLIC_URL}/`, '')
    if (!key || key === url) return
    await r2.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }))
  } catch {
    // ignora erros de deleção
  }
}

function getContentType(ext: string): string {
  const map: Record<string, string> = {
    '.jpg':  'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png':  'image/png',
    '.webp': 'image/webp',
    '.gif':  'image/gif',
  }
  return map[ext] || 'application/octet-stream'
}
