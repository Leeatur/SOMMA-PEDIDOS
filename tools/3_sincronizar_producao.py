#!/usr/bin/env python3
"""
PASSO 3 — Sincronizar tabela de preço do banco local para o Railway (produção).

Uso:
    python3 3_sincronizar_producao.py

O script vai:
  1. Perguntar qual tabela exportar
  2. Gerar um SQL completo (price_table + products + grade_configs + commission_rules)
  3. Perguntar se deseja aplicar diretamente ao Railway ou só salvar o arquivo SQL

ANTES DE RODAR:
  Preencha RAILWAY_DATABASE_URL em config.py com a URL do banco Railway.
  Você encontra em: Railway Dashboard → seu projeto → Variables → DATABASE_URL

  Formato: postgresql://postgres:SENHA@host.railway.app:5432/railway

ATENÇÃO:
  Este script gera SQL com ON CONFLICT DO NOTHING, então é seguro rodar
  múltiplas vezes — não vai duplicar dados.
"""

import sys
import os
import subprocess
import re
from datetime import datetime
from config import PSQL_PATH, DB_LOCAL, DB_LOCAL_USER, RAILWAY_DATABASE_URL

# ── helpers de banco ──────────────────────────────────────────────────────────

def db_query(sql: str, pg_url: str = None) -> str:
    if pg_url:
        cmd = ["psql", pg_url, "-t", "-A", "-c", sql]
    else:
        cmd = [PSQL_PATH, "-U", DB_LOCAL_USER, "-d", DB_LOCAL, "-t", "-A", "-c", sql]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"Erro SQL: {r.stderr}")
    return r.stdout.strip()

def db_rows(sql: str, pg_url: str = None) -> list[list[str]]:
    out = db_query(sql, pg_url)
    if not out:
        return []
    return [row.split('|') for row in out.split('\n') if row]

def db_exec_file(sql_path: str, pg_url: str):
    """Aplica um arquivo SQL no banco de destino."""
    cmd = ["psql", pg_url, "-f", sql_path]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"Erro ao aplicar SQL:\n{r.stderr}")
    return r.stdout

# ── gerador de SQL ────────────────────────────────────────────────────────────

def esc(val) -> str:
    """Escapa string para SQL (retorna NULL para vazio)."""
    if val is None or val == '':
        return 'NULL'
    return "'" + str(val).replace("'", "''") + "'"

def esc_str(val) -> str:
    """Escapa string para SQL (mantém strings vazias como '')."""
    if val is None:
        return 'NULL'
    return "'" + str(val).replace("'", "''") + "'"

def bool_sql(val) -> str:
    """Converte t/f/true/false/True/False para SQL boolean."""
    if val in (True, 'true', 't', '1'):
        return 'true'
    return 'false'

def generate_sql(table_id: str) -> str:
    lines = [
        "-- Gerado por 3_sincronizar_producao.py",
        f"-- Data: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
        "",
        "BEGIN;",
        "",
    ]

    # ── Fábrica ──
    rows = db_rows(f"""
        SELECT f.id, f.name, f.contact, f.notes
        FROM price_tables pt
        JOIN factories f ON f.id = pt.factory_id
        WHERE pt.id = '{table_id}'
    """)
    if rows:
        r = rows[0]
        lines.append("-- Fábrica")
        lines.append(f"INSERT INTO factories (id, name, contact, notes)")
        lines.append(f"VALUES ({esc(r[0])}, {esc(r[1])}, {esc(r[2])}, {esc(r[3])})")
        lines.append(f"ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name;")
        lines.append("")

    # ── Tabela de preço ──
    rows = db_rows(f"""
        SELECT id, factory_id, name, collection, season, year, active
        FROM price_tables WHERE id = '{table_id}'
    """)
    if rows:
        r = rows[0]
        lines.append("-- Tabela de preço")
        lines.append(f"INSERT INTO price_tables (id, factory_id, name, collection, season, year, active)")
        lines.append(f"VALUES ({esc(r[0])}, {esc(r[1])}, {esc(r[2])}, {esc(r[3])}, {esc(r[4])}, {r[5] or 'NULL'}, {bool_sql(r[6])})")
        lines.append(f"ON CONFLICT (id) DO UPDATE SET name={esc(r[2])}, collection={esc(r[3])}, season={esc(r[4])}, year={r[5] or 'NULL'}, active={bool_sql(r[6])};")
        lines.append("")

    # ── Regras de comissão ──
    rows = db_rows(f"""
        SELECT id, price_table_id, discount_pct, total_commission_pct, rep_commission_pct, office_commission_pct, sort_order
        FROM discount_commission_rules
        WHERE price_table_id = '{table_id}'
        ORDER BY sort_order
    """)
    if rows:
        lines.append(f"-- Regras de comissão ({len(rows)} faixas)")
        lines.append("INSERT INTO discount_commission_rules")
        lines.append("  (id, price_table_id, discount_pct, total_commission_pct, rep_commission_pct, office_commission_pct, sort_order)")
        lines.append("VALUES")
        vals = []
        for r in rows:
            vals.append(f"  ({esc(r[0])}, {esc(r[1])}, {r[2]}, {r[3]}, {r[4]}, {r[5]}, {r[6] or 0})")
        lines.append(',\n'.join(vals))
        lines.append("ON CONFLICT (id) DO NOTHING;")
        lines.append("")

    # ── Produtos ──
    rows = db_rows(f"""
        SELECT id, price_table_id, reference, product_name, model, size_range,
               base_price, type, observation, image_url, active
        FROM products
        WHERE price_table_id = '{table_id}'
        ORDER BY reference
    """)
    if rows:
        lines.append(f"-- Produtos ({len(rows)} itens)")
        lines.append("INSERT INTO products")
        lines.append("  (id, price_table_id, reference, product_name, model, size_range, base_price, type, observation, image_url, active)")
        lines.append("VALUES")
        vals = []
        for r in rows:
            vals.append(
                f"  ({esc(r[0])}, {esc(r[1])}, {esc(r[2])}, {esc(r[3])}, {esc(r[4])}, "
                f"{esc(r[5])}, {r[6]}, {esc(r[7])}, {esc(r[8])}, {esc(r[9])}, {bool_sql(r[10])})"
            )
        lines.append(',\n'.join(vals))
        lines.append("ON CONFLICT (id) DO UPDATE SET")
        lines.append("  product_name = EXCLUDED.product_name,")
        lines.append("  model = EXCLUDED.model,")
        lines.append("  size_range = EXCLUDED.size_range,")
        lines.append("  base_price = EXCLUDED.base_price,")
        lines.append("  observation = EXCLUDED.observation,")
        lines.append("  image_url = COALESCE(EXCLUDED.image_url, products.image_url),")
        lines.append("  active = EXCLUDED.active;")
        lines.append("")

    # ── Grade configs ──
    rows = db_rows(f"""
        SELECT gc.id, gc.product_id, gc.color, gc.sizes::text, gc.total_pieces, gc.sort_order
        FROM grade_configs gc
        JOIN products p ON p.id = gc.product_id
        WHERE p.price_table_id = '{table_id}'
        ORDER BY gc.product_id, gc.sort_order
    """)
    if rows:
        lines.append(f"-- Grade configs ({len(rows)} linhas)")
        lines.append("INSERT INTO grade_configs (id, product_id, color, sizes, total_pieces, sort_order)")
        lines.append("VALUES")
        vals = []
        for r in rows:
            # r[3] é o JSON do sizes (ex: {"36":1,"38":2})
            # esc() já envolve em aspas simples — só adicionamos ::jsonb
            vals.append(
                f"  ({esc(r[0])}, {esc(r[1])}, {esc(r[2])}, {esc(r[3])}::jsonb, {r[4]}, {r[5] or 0})"
            )
        lines.append(',\n'.join(vals))
        lines.append("ON CONFLICT (id) DO NOTHING;")
        lines.append("")

    lines.append("COMMIT;")
    return '\n'.join(lines)

# ── input helpers ─────────────────────────────────────────────────────────────

def ask(prompt: str, default: str = '') -> str:
    suffix = f' [{default}]' if default else ''
    val = input(f'{prompt}{suffix}: ').strip()
    return val if val else default

def main():
    print("=" * 60)
    print("  SOMMA PEDIDOS — Sincronizar tabela para produção (Railway)")
    print("=" * 60)
    print()

    # ── Selecionar tabela ────────────────────────────────────────────────────
    rows = db_rows("SELECT id, name FROM price_tables WHERE active=true ORDER BY name")
    if not rows:
        print("Nenhuma tabela ativa encontrada no banco local.")
        sys.exit(1)

    print("Tabelas disponíveis:")
    for i, (tid, tname) in enumerate(rows):
        # Status dos produtos
        total  = db_query(f"SELECT COUNT(*) FROM products WHERE price_table_id='{tid}'")
        fotos  = db_query(f"SELECT COUNT(*) FROM products WHERE price_table_id='{tid}' AND image_url IS NOT NULL AND image_url!=''")
        print(f"  {i+1}. {tname}")
        print(f"       {total} produtos | {fotos} com foto")

    idx_str = ask("\nNúmero da tabela a exportar")
    try:
        idx = int(idx_str) - 1
        table_id, table_name = rows[idx]
    except (ValueError, IndexError):
        print("Seleção inválida.")
        sys.exit(1)

    print(f"\nTabela selecionada: {table_name}")

    # ── Gerar SQL ────────────────────────────────────────────────────────────
    print("\nGerando SQL de migração...")
    sql = generate_sql(table_id)

    # Salva o arquivo
    safe_name = re.sub(r'[^\w\-]', '_', table_name)[:50]
    sql_filename = f"migration_{safe_name}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.sql"
    sql_path = os.path.join(os.path.dirname(__file__), sql_filename)

    with open(sql_path, 'w', encoding='utf-8') as f:
        f.write(sql)

    n_products = len(db_rows(f"SELECT id FROM products WHERE price_table_id='{table_id}'"))
    print(f"  → Arquivo salvo: {sql_filename}")
    print(f"  → {n_products} produtos incluídos")

    # ── Aplicar no Railway ───────────────────────────────────────────────────
    print()
    print("─" * 60)
    railway_url = RAILWAY_DATABASE_URL.strip()

    if not railway_url:
        print("⚠️  RAILWAY_DATABASE_URL não está configurada em config.py")
        print()
        print("Para aplicar manualmente:")
        print(f"  psql 'SUA_DATABASE_URL' -f {sql_path}")
        print()
        print("Você encontra a DATABASE_URL em:")
        print("  Railway Dashboard → seu projeto → Variables → DATABASE_URL")
        print("─" * 60)
        sys.exit(0)

    apply = ask("Aplicar diretamente no Railway agora? (s/n)", "s").lower().startswith('s')
    if not apply:
        print(f"\nSQL salvo em: {sql_path}")
        print(f"Para aplicar manualmente:")
        print(f"  psql 'sua_url' -f {sql_path}")
        sys.exit(0)

    print("\nConectando ao Railway...")
    try:
        # Testa a conexão
        version = db_query("SELECT version()", pg_url=railway_url)
        print(f"  → Conectado: {version[:60]}...")
    except Exception as e:
        print(f"  ✗ Falha na conexão: {e}")
        print(f"\nVerifique RAILWAY_DATABASE_URL em config.py")
        sys.exit(1)

    print(f"\nAplicando {sql_filename} no Railway...")
    try:
        out = db_exec_file(sql_path, railway_url)
        print(f"  ✅ Aplicado com sucesso!")
        if out.strip():
            print("  Saída do banco:")
            for line in out.strip().split('\n'):
                print(f"    {line}")
    except Exception as e:
        print(f"  ✗ Erro ao aplicar: {e}")
        print(f"\nO arquivo SQL foi salvo em: {sql_path}")
        print("Você pode aplicar manualmente e verificar o erro.")
        sys.exit(1)

    # Verificação pós-aplicação
    print()
    print("Verificando no Railway...")
    try:
        count = db_query(
            f"SELECT COUNT(*) FROM products WHERE price_table_id='{table_id}'",
            pg_url=railway_url
        )
        print(f"  → {count} produtos na tabela em produção ✅")
    except Exception as e:
        print(f"  ⚠️  Não foi possível verificar: {e}")

    print()
    print("=" * 60)
    print("  ✅ PRODUÇÃO ATUALIZADA!")
    print(f"  Tabela: {table_name}")
    print(f"  Arquivo SQL guardado em: {sql_path}")
    print("=" * 60)

if __name__ == '__main__':
    main()
