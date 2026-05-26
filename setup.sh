#!/usr/bin/env bash
set -e

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║     SOMMA PEDIDOS — Setup Inicial        ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# ── 1. Verifica Node.js ───────────────────────────────────────────
echo "▶ Verificando Node.js..."
if ! command -v node &>/dev/null; then
  echo "❌ Node.js não encontrado. Instale em https://nodejs.org"
  exit 1
fi
echo "  ✅ Node $(node -v)"

# ── 2. PostgreSQL via Homebrew ────────────────────────────────────
echo ""
echo "▶ Verificando PostgreSQL..."
if ! command -v psql &>/dev/null; then
  echo "  PostgreSQL não encontrado. Instalando via Homebrew..."
  if ! command -v brew &>/dev/null; then
    echo ""
    echo "  ❌ Homebrew não encontrado."
    echo "     Instale em: https://brew.sh"
    echo "     Depois rode este script novamente."
    exit 1
  fi
  brew install postgresql@16
  brew services start postgresql@16
  # Adiciona ao PATH se necessário
  export PATH="/opt/homebrew/opt/postgresql@16/bin:$PATH"
  sleep 3
  echo "  ✅ PostgreSQL instalado e iniciado"
else
  # Garante que está rodando
  if ! pg_isready -q 2>/dev/null; then
    echo "  PostgreSQL instalado mas não rodando. Iniciando..."
    brew services start postgresql@16 2>/dev/null || brew services start postgresql 2>/dev/null || true
    sleep 3
  fi
  echo "  ✅ PostgreSQL $(psql --version | head -1)"
fi

# ── 3. PyMuPDF (para importar catálogos PDF) ─────────────────────
echo ""
echo "▶ Verificando PyMuPDF (Python)..."
if python3 -c "import fitz" &>/dev/null 2>&1; then
  echo "  ✅ PyMuPDF já instalado"
else
  echo "  Instalando PyMuPDF..."
  pip3 install pymupdf --quiet
  echo "  ✅ PyMuPDF instalado"
fi

# ── 4. Banco de dados ─────────────────────────────────────────────
echo ""
echo "▶ Criando banco de dados 'somma_pedidos'..."
createdb somma_pedidos 2>/dev/null && echo "  ✅ Banco criado" || echo "  ℹ️  Banco já existe (ok)"

# ── 5. Dependências backend ───────────────────────────────────────
echo ""
echo "▶ Instalando dependências do backend..."
cd "$(dirname "$0")/backend"
npm install --silent
echo "  ✅ Dependências instaladas"

# ── 6. .env ──────────────────────────────────────────────────────
if [ ! -f .env ]; then
  cp .env.example .env
  # Gera JWT_SECRET aleatório
  SECRET=$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")
  sed -i '' "s/troque_este_segredo_em_producao/$SECRET/" .env
  echo "  ✅ .env criado com JWT_SECRET gerado automaticamente"
else
  echo "  ℹ️  .env já existe (mantido)"
fi

# ── 7. Migrations ─────────────────────────────────────────────────
echo ""
echo "▶ Executando migrations..."
npm run migrate
echo "  ✅ Tabelas criadas"

# ── 8. Seed ───────────────────────────────────────────────────────
echo ""
echo "▶ Inserindo dados iniciais..."
npm run seed

# ── 9. Dependências frontend ──────────────────────────────────────
echo ""
echo "▶ Instalando dependências do frontend..."
cd ../frontend
npm install --silent
echo "  ✅ Dependências instaladas"

# ── 10. Pasta de uploads ──────────────────────────────────────────
echo ""
echo "▶ Criando pastas de uploads..."
mkdir -p ../uploads/products ../uploads/logos
echo "  ✅ Pastas criadas"

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║  ✅ Setup concluído! Para iniciar o sistema:         ║"
echo "║                                                      ║"
echo "║     cd somma-pedidos                                 ║"
echo "║     npm run dev                                      ║"
echo "║                                                      ║"
echo "║  Acesse: http://localhost:5174                       ║"
echo "║  Login:  admin@somma.com.br / somma@2026             ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""
