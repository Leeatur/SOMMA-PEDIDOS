# Somma Pedidos — Ferramentas de Importação de Coleções

Pasta com scripts Python para importar novas coleções de forma completa e repetível.

---

## Instalação (só na primeira vez)

```bash
cd tools/
pip3 install -r requirements.txt
```

---

## Fluxo completo para uma nova coleção

### 1. Importar planilha Excel → banco local

```bash
python3 1_importar_excel.py
```

O script vai perguntar:
- Caminho do arquivo Excel (ex: `/Users/uliano/Desktop/TEEZZ 524 INV 2027.xlsx`)
- Qual aba tem os produtos (ex: `Feminina` ou `Masculina`)
- Nome da fábrica (ex: `TEEZZ`)
- Nome da tabela de preço (ex: `TEEZZ - TABELA 524 INV 2027 FEMININA`)
- Coleção, estação, ano
- Regras de comissão (ou usar os padrões TEEZZ)

**Formato esperado do Excel:**
| Col | Conteúdo |
|-----|----------|
| 0 | Referência (TE##### ou PKTE#####) |
| 1 | Nome do produto |
| 2 | Modelagem |
| 3 | Grade/tamanhos |
| 4 | Preço base (valor positivo) |
| 5-7 | Preços com desconto (ignorados) |
| 8 | Observação |

Aba `Packs` (opcional): grades detalhadas dos packs PKTE.

---

### 2. Importar fotos dos lookbooks PDF → R2

```bash
python3 2_importar_fotos_pdf.py
```

O script vai perguntar:
- Qual tabela de preço atualizar
- Se deseja copiar fotos de outras tabelas com mesmas referências ← faça isso SEMPRE primeiro!
- Caminhos dos PDFs dos lookbooks (um por vez, Enter em branco para terminar)
- Escala de renderização (1.5 é um bom equilíbrio qualidade/velocidade)

**Dicas:**
- Se a tabela Feminina compartilha refs com a Masculina, diga "s" para copiar primeiro — economiza muito tempo
- Pode adicionar vários PDFs: lookbook masculino, feminino, cápsula, etc.
- Refs não encontradas em nenhum PDF precisam de upload manual no sistema

---

### 3. Sincronizar para produção (Railway)

```bash
python3 3_sincronizar_producao.py
```

**Antes de rodar:** preencha `RAILWAY_DATABASE_URL` em `config.py`:
```python
RAILWAY_DATABASE_URL = "postgresql://postgres:SENHA@host.railway.app:5432/railway"
```

Onde encontrar:
> Railway Dashboard → seu projeto → `Variables` → `DATABASE_URL`

O script:
1. Gera um arquivo `migration_NOME_TABELA_DATA.sql`
2. Pergunta se deseja aplicar diretamente
3. Se sim, conecta no Railway e aplica
4. Verifica o resultado

O SQL usa `ON CONFLICT DO NOTHING` — seguro rodar múltiplas vezes.

---

## Configurações

Edite `config.py` para alterar:
- Credenciais do banco local (se mudar o usuário/DB)
- Credenciais do R2 (se mudar o bucket)
- URL do Railway (necessário para o passo 3)

---

## Resumo rápido

```
Nova coleção chegou?
       ↓
[1] python3 1_importar_excel.py   → importa produtos no banco local
       ↓
[2] python3 2_importar_fotos_pdf.py → importa fotos dos lookbooks para o R2
       ↓
[3] python3 3_sincronizar_producao.py → envia tudo para o Railway (produção)
       ↓
Pronto! A nova coleção está no app.
```

---

## Arquivos gerados

- `migration_NOME_DATA.sql` — SQL de migração gerado pelo passo 3. Guarde-os como histórico.

---

## Problemas comuns

| Problema | Solução |
|----------|---------|
| `psql: command not found` | Verifique o caminho em `config.py` → `PSQL_PATH` |
| `ModuleNotFoundError: fitz` | `pip3 install PyMuPDF` |
| `ModuleNotFoundError: boto3` | `pip3 install boto3` |
| Fotos não aparecem em produção | Verifique as variáveis R2 no Railway Dashboard |
| Conexão Railway falha | Verifique `RAILWAY_DATABASE_URL` em `config.py` |
| Excel com preços negativos | Normal — o script sempre usa col 4 (preço positivo) |
