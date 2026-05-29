#!/usr/bin/env python3
"""
PASSO 2 — Importar fotos de lookbooks PDF para o R2 e atualizar o banco local.

Uso:
    python3 2_importar_fotos_pdf.py

O script vai perguntar interativamente:
  - Qual tabela de preço atualizar
  - Quais arquivos PDF processar (pode adicionar vários)
  - Se deve sobrescrever fotos existentes

Como funciona:
  - Para cada página do PDF extrai o texto
  - Procura referências (TE#### ou PKTE####) no texto
  - Se encontrar referência sem foto, renderiza a página e faz upload para o R2
  - Atualiza o banco com a URL da imagem

Dica: processe o lookbook masculino ANTES do feminino se as refs se sobrepõem,
pois o script pode copiar URLs entre tabelas (--copiar-de).
"""

import sys
import re
import uuid
import subprocess
import fitz  # PyMuPDF
import boto3
from config import (PSQL_PATH, DB_LOCAL, DB_LOCAL_USER,
                    R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
                    R2_BUCKET_NAME, R2_PUBLIC_URL)

# ── R2 client ─────────────────────────────────────────────────────────────────

s3 = boto3.client(
    's3',
    endpoint_url=f"https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com",
    aws_access_key_id=R2_ACCESS_KEY_ID,
    aws_secret_access_key=R2_SECRET_ACCESS_KEY,
    region_name='auto',
)

# ── helpers de banco ──────────────────────────────────────────────────────────

def db_query(sql: str) -> str:
    cmd = [PSQL_PATH, "-U", DB_LOCAL_USER, "-d", DB_LOCAL, "-t", "-A", "-c", sql]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"Erro SQL: {r.stderr}")
    return r.stdout.strip()

def db_run(sql: str):
    cmd = [PSQL_PATH, "-U", DB_LOCAL_USER, "-d", DB_LOCAL, "-c", sql]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"Erro SQL: {r.stderr}\nSQL: {sql[:300]}")

def list_price_tables() -> list[tuple[str, str]]:
    out = db_query("SELECT id, name FROM price_tables WHERE active=true ORDER BY name")
    if not out:
        return []
    return [tuple(row.split('|', 1)) for row in out.split('\n') if '|' in row]

def get_refs_for_table(table_id: str, overwrite: bool) -> set[str]:
    if overwrite:
        out = db_query(f"SELECT reference FROM products WHERE price_table_id='{table_id}'")
    else:
        out = db_query(f"SELECT reference FROM products WHERE price_table_id='{table_id}' AND (image_url IS NULL OR image_url='')")
    if not out:
        return set()
    return set(r.strip() for r in out.split('\n') if r.strip())

# ── upload ────────────────────────────────────────────────────────────────────

def upload_image(pix: fitz.Pixmap, quality: int = 88) -> str:
    key = f"products/{uuid.uuid4()}.jpg"
    img_bytes = pix.tobytes("jpeg", jpg_quality=quality)
    s3.put_object(
        Bucket=R2_BUCKET_NAME, Key=key, Body=img_bytes,
        ContentType='image/jpeg', CacheControl='public, max-age=31536000',
    )
    return f"{R2_PUBLIC_URL}/{key}"

def set_image_url(table_id: str, ref: str, url: str):
    db_run(f"UPDATE products SET image_url='{url}' WHERE price_table_id='{table_id}' AND reference='{ref}'")

# ── copiar de outra tabela ────────────────────────────────────────────────────

def copy_images_from_other_tables(table_id: str) -> int:
    """Copia image_url de outras tabelas onde a referência é a mesma."""
    sql = f"""
        UPDATE products p_dest
        SET image_url = p_src.image_url
        FROM products p_src
        WHERE p_dest.price_table_id = '{table_id}'
          AND p_dest.reference = p_src.reference
          AND p_src.price_table_id != '{table_id}'
          AND p_src.image_url IS NOT NULL AND p_src.image_url != ''
          AND (p_dest.image_url IS NULL OR p_dest.image_url = '')
    """
    db_run(sql)
    copied = db_query(f"""
        SELECT COUNT(*) FROM products
        WHERE price_table_id='{table_id}' AND image_url IS NOT NULL AND image_url!=''
    """)
    return int(copied or 0)

# ── importar PDF ──────────────────────────────────────────────────────────────

def import_pdf(pdf_path: str, table_id: str, refs_sem_foto: set[str], scale: float = 1.5) -> int:
    doc = fitz.open(pdf_path)
    total_pages = len(doc)
    imported = 0
    done = set()

    print(f"\n  Processando: {pdf_path}")
    print(f"  Páginas: {total_pages} | Produtos buscados: {len(refs_sem_foto)}")

    for pnum in range(total_pages):
        if not refs_sem_foto:  # Todos encontrados
            print(f"  → Todos os produtos foram encontrados antes do fim do PDF!")
            break

        page = doc[pnum]
        text = page.get_text()
        # Extrai todas as refs da página
        found = set(re.findall(r'(?:PKTE|TE)\d+', text, re.IGNORECASE))
        found = {r.upper() for r in found}

        # Intersecção com o que ainda falta
        matches = found & refs_sem_foto - done

        if not matches:
            if (pnum + 1) % 30 == 0:
                print(f"  ... pág {pnum+1}/{total_pages} — sem referência nesta página")
            continue

        # Renderiza a página uma só vez para todas as refs da página
        mat = fitz.Matrix(scale, scale)
        pix = page.get_pixmap(matrix=mat)

        for ref in sorted(matches):
            try:
                url = upload_image(pix)
                set_image_url(table_id, ref, url)
                done.add(ref)
                refs_sem_foto.discard(ref)
                imported += 1
                print(f"  ✓ pág {pnum+1:3d} | {ref:12s} → {url[-50:]}")
            except Exception as e:
                print(f"  ✗ pág {pnum+1:3d} | {ref:12s} → ERRO: {e}", file=sys.stderr)

    doc.close()
    return imported

# ── entrada interativa ────────────────────────────────────────────────────────

def ask(prompt: str, default: str = '') -> str:
    suffix = f' [{default}]' if default else ''
    val = input(f'{prompt}{suffix}: ').strip()
    return val if val else default

def main():
    print("=" * 60)
    print("  SOMMA PEDIDOS — Importar fotos de lookbooks PDF")
    print("=" * 60)
    print()

    tables = list_price_tables()
    if not tables:
        print("Nenhuma tabela de preço ativa encontrada.")
        sys.exit(1)

    print("Tabelas de preço disponíveis:")
    for i, (tid, tname) in enumerate(tables):
        print(f"  {i+1}. {tname}")

    idx_str = ask("\nNúmero da tabela a atualizar")
    try:
        idx = int(idx_str) - 1
        table_id, table_name = tables[idx]
    except (ValueError, IndexError):
        print("Seleção inválida.")
        sys.exit(1)

    print(f"\nTabela selecionada: {table_name}")

    # Copiar de outras tabelas primeiro?
    copy_first = ask("Copiar fotos de outras tabelas com mesmas referências? (s/n)", "s").lower().startswith('s')
    if copy_first:
        print("  Copiando URLs de outras tabelas...")
        with_photo = copy_images_from_other_tables(table_id)
        print(f"  → {with_photo} produtos agora têm foto (incluindo copiadas)")

    overwrite = ask("Sobrescrever fotos já existentes? (s/n)", "n").lower().startswith('s')
    refs_sem_foto = get_refs_for_table(table_id, overwrite)

    print(f"\nProdutos {'para atualizar' if overwrite else 'sem foto'}: {len(refs_sem_foto)}")
    if not refs_sem_foto:
        print("  → Todos os produtos já têm foto! Nada a fazer.")
        sys.exit(0)

    # Lista de PDFs
    print()
    print("Adicione os arquivos PDF dos lookbooks (um por linha, vazio para terminar):")
    pdf_paths = []
    while True:
        p = input("  PDF: ").strip()
        if not p:
            break
        pdf_paths.append(p)

    if not pdf_paths:
        print("Nenhum PDF informado.")
        sys.exit(0)

    # Escala de renderização
    print()
    scale_str = ask("Escala de renderização (1.0=baixa, 1.5=média, 2.0=alta qualidade)", "1.5")
    try:
        scale = float(scale_str)
    except ValueError:
        scale = 1.5

    # ── Processamento ────────────────────────────────────────────────────────

    print()
    total_imported = 0
    for pdf_path in pdf_paths:
        try:
            n = import_pdf(pdf_path, table_id, refs_sem_foto, scale)
            total_imported += n
        except Exception as e:
            print(f"\n  ✗ Erro ao processar '{pdf_path}': {e}", file=sys.stderr)

    # Relatório final
    still_missing = get_refs_for_table(table_id, False)
    print()
    print("=" * 60)
    print(f"  ✅ CONCLUÍDO — {total_imported} fotos importadas nesta sessão")
    if still_missing:
        print(f"  ⚠️  {len(still_missing)} produtos ainda sem foto:")
        for ref in sorted(still_missing):
            print(f"    - {ref}")
        print()
        print("  Esses produtos precisam de upload manual pelo sistema")
        print("  ou de um lookbook adicional.")
    else:
        print(f"  ✅ Todos os produtos têm foto!")
    print()
    print("  Próximo passo:")
    print("  python3 3_sincronizar_producao.py ← enviar para o Railway")
    print("=" * 60)

if __name__ == '__main__':
    main()
