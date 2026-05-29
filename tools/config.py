"""
Configurações compartilhadas do Somma Pedidos Tools.
Edite este arquivo com as suas credenciais se necessário.
"""

# ── Banco de dados local ──────────────────────────────────────────────────────
PSQL_PATH    = "/Applications/Postgres.app/Contents/Versions/latest/bin/psql"
DB_LOCAL     = "somma_pedidos"
DB_LOCAL_USER = "uliano"

# ── Cloudflare R2 (armazenamento de imagens) ──────────────────────────────────
R2_ACCOUNT_ID        = "cb405ae344417d22d13576b1b90261fa"
R2_ACCESS_KEY_ID     = "2154177cca6e11c5ed6fa3f3f1bd54d4"
R2_SECRET_ACCESS_KEY = "ec4a09880c5d7df1bc2e88ee4467e90a7d175c86aafa91e850e47010b5b1a098"
R2_BUCKET_NAME       = "somma-pedidos"
R2_PUBLIC_URL        = "https://pub-3b515ed220ef4859b397cb0c0ec695f7.r2.dev"

# ── Railway (banco de produção) ───────────────────────────────────────────────
# Obtenha em: Railway Dashboard → seu projeto → Variables → DATABASE_URL
# Cole aqui e NUNCA commite este arquivo com o valor preenchido no git.
RAILWAY_DATABASE_URL = ""
# Exemplo:
# RAILWAY_DATABASE_URL = "postgresql://postgres:senha@host.railway.app:5432/railway"
