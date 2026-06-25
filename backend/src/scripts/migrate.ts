import { pool } from '../config/database'
import dotenv from 'dotenv'

dotenv.config()

const SQL = `
-- Extensões
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Usuários
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(20) NOT NULL CHECK (role IN ('admin', 'representante')),
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Fábricas / Marcas
CREATE TABLE IF NOT EXISTS factories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  logo_url VARCHAR(500),
  contact TEXT,
  notes TEXT,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Acesso de usuários a fábricas (representante vê só as fábricas liberadas)
CREATE TABLE IF NOT EXISTS user_factory_access (
  user_id    UUID NOT NULL REFERENCES users(id)     ON DELETE CASCADE,
  factory_id UUID NOT NULL REFERENCES factories(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, factory_id)
);

-- Tabelas de Preço
CREATE TABLE IF NOT EXISTS price_tables (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id UUID NOT NULL REFERENCES factories(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  collection VARCHAR(100),
  season VARCHAR(50),
  year INTEGER,
  active BOOLEAN DEFAULT true,
  imported_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Regras Desconto × Comissão
CREATE TABLE IF NOT EXISTS discount_commission_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  price_table_id UUID NOT NULL REFERENCES price_tables(id) ON DELETE CASCADE,
  discount_pct DECIMAL(5,2) NOT NULL,
  total_commission_pct DECIMAL(5,2) NOT NULL,
  rep_commission_pct DECIMAL(5,2) NOT NULL,
  office_commission_pct DECIMAL(5,2) NOT NULL,
  guide_commission_pct DECIMAL(5,2) NOT NULL DEFAULT 0,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
-- 3ª via de comissão (modo fábrica NXO: Loja=rep, Escritório=office, Guia=guide). Default 0 → instâncias 2-vias intactas.
ALTER TABLE discount_commission_rules ADD COLUMN IF NOT EXISTS guide_commission_pct DECIMAL(5,2) NOT NULL DEFAULT 0;

-- Produtos / Referências
CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  price_table_id UUID NOT NULL REFERENCES price_tables(id) ON DELETE CASCADE,
  reference VARCHAR(50) NOT NULL,
  type VARCHAR(10) NOT NULL CHECK (type IN ('regular', 'pack')),
  product_name VARCHAR(255),
  model VARCHAR(255),
  size_range VARCHAR(50),
  base_price DECIMAL(10,2) NOT NULL,
  category VARCHAR(100),
  observation TEXT,
  image_url VARCHAR(500),
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
-- Coluna adicionada depois (só existia em produção via ALTER manual)
ALTER TABLE products ADD COLUMN IF NOT EXISTS blocked_sizes TEXT[] DEFAULT '{}';
-- size_range pode ser uma lista longa de tamanhos (ex.: cintos 60..125) — amplia p/ 255
ALTER TABLE products ALTER COLUMN size_range TYPE VARCHAR(255);
-- Estoque por variante: { "<cor>": { "<tamanho>": qtd } }; atualizado pela importação diária
ALTER TABLE products ADD COLUMN IF NOT EXISTS stock JSONB DEFAULT '{}';
ALTER TABLE products ADD COLUMN IF NOT EXISTS stock_updated_at TIMESTAMPTZ;

-- Galeria de fotos por produto (várias imagens). products.image_url continua sendo a
-- foto-capa (1ª imagem) para compatibilidade com listagens/telas existentes.
CREATE TABLE IF NOT EXISTS product_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  url VARCHAR(500) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_product_images_product ON product_images(product_id);
-- Backfill: produtos que já têm foto-capa entram na galeria como 1ª imagem (idempotente)
INSERT INTO product_images (product_id, url, sort_order)
SELECT id, image_url, 0 FROM products p
WHERE image_url IS NOT NULL AND image_url <> ''
  AND NOT EXISTS (SELECT 1 FROM product_images pi WHERE pi.product_id = p.id);

-- Composição da Grade Fechada por Produto
-- Regular (TE...): uma linha sem cor, sizes = {"34":1,"36":1,...}
-- Pack (PKTE...): uma linha por cor, sizes = {"36":1,"38":2,...}
CREATE TABLE IF NOT EXISTS grade_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  color VARCHAR(100),
  sizes JSONB NOT NULL,
  total_pieces INTEGER NOT NULL,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Clientes
CREATE TABLE IF NOT EXISTS clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  trade_name VARCHAR(255),
  cnpj VARCHAR(20),
  cpf VARCHAR(15),
  address TEXT,
  city VARCHAR(100),
  state VARCHAR(50),
  zip VARCHAR(10),
  phone VARCHAR(30),
  email VARCHAR(255),
  rep_id UUID REFERENCES users(id) ON DELETE SET NULL,
  notes TEXT,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
-- Colunas adicionadas depois (só existiam em produção via ALTER manual)
ALTER TABLE clients ADD COLUMN IF NOT EXISTS state_registration VARCHAR(30);
ALTER TABLE clients ADD COLUMN IF NOT EXISTS whatsapp VARCHAR(30);
ALTER TABLE clients ADD COLUMN IF NOT EXISTS buyer_name VARCHAR(255);

-- Status de Pedido (configuráveis)
CREATE TABLE IF NOT EXISTS order_statuses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  color VARCHAR(7) NOT NULL DEFAULT '#6B7280',
  sort_order INTEGER DEFAULT 0,
  is_initial BOOLEAN DEFAULT false,
  is_final BOOLEAN DEFAULT false,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Pedidos
CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  offline_id VARCHAR(100) UNIQUE,
  order_number SERIAL,
  client_id UUID NOT NULL REFERENCES clients(id),
  rep_id UUID NOT NULL REFERENCES users(id),
  factory_id UUID NOT NULL REFERENCES factories(id),
  price_table_id UUID NOT NULL REFERENCES price_tables(id),
  status_id UUID REFERENCES order_statuses(id),
  discount_pct DECIMAL(5,2) DEFAULT 0,
  total_commission_pct DECIMAL(5,2) DEFAULT 0,
  rep_commission_pct DECIMAL(5,2) DEFAULT 0,
  office_commission_pct DECIMAL(5,2) DEFAULT 0,
  total_pieces INTEGER DEFAULT 0,
  total_value DECIMAL(12,2) DEFAULT 0,
  rep_commission_value DECIMAL(12,2) DEFAULT 0,
  office_commission_value DECIMAL(12,2) DEFAULT 0,
  guide_commission_pct DECIMAL(5,2) DEFAULT 0,
  guide_commission_value DECIMAL(12,2) DEFAULT 0,
  notes TEXT,
  synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Itens do Pedido
CREATE TABLE IF NOT EXISTS order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id),
  reference VARCHAR(50) NOT NULL,
  boxes_count INTEGER NOT NULL DEFAULT 1,
  unit_price DECIMAL(10,2) NOT NULL,
  total_pieces INTEGER NOT NULL DEFAULT 0,
  subtotal DECIMAL(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
-- Colunas adicionadas depois (só existiam em produção via ALTER manual)
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS original_unit_price DECIMAL(10,2);
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS custom_grade JSONB;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS commission_manual_override BOOLEAN DEFAULT false;
-- Ícone (emoji) opcional por status de pedido
ALTER TABLE order_statuses ADD COLUMN IF NOT EXISTS icon VARCHAR(20);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS guide_commission_pct DECIMAL(5,2) DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS guide_commission_value DECIMAL(12,2) DEFAULT 0;
-- Transportadora do pedido (usada no updateOrderInfo) — faltava no migrate
ALTER TABLE orders ADD COLUMN IF NOT EXISTS transportadora VARCHAR(200);

-- Histórico de Status
CREATE TABLE IF NOT EXISTS order_status_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  from_status_id UUID REFERENCES order_statuses(id),
  to_status_id UUID NOT NULL REFERENCES order_statuses(id),
  changed_by UUID NOT NULL REFERENCES users(id),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Refresh Tokens
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token VARCHAR(512) UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Configurações da empresa
CREATE TABLE IF NOT EXISTS company_settings (
  key VARCHAR(100) PRIMARY KEY,
  value TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Colunas extras nos pedidos (adicionadas em v2)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_terms VARCHAR(200);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS freight_type VARCHAR(10) DEFAULT 'CIF';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_date DATE;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS industry_order_number VARCHAR(100);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS buyer_name VARCHAR(200);

-- Coluna whatsapp nos clientes (adicionada em v2)
ALTER TABLE clients ADD COLUMN IF NOT EXISTS whatsapp VARCHAR(30);

-- Inscrição Estadual nos clientes (adicionada em v5)
ALTER TABLE clients ADD COLUMN IF NOT EXISTS state_registration VARCHAR(50);

-- Soft delete de pedidos (lixeira) — v6
ALTER TABLE orders ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_orders_deleted ON orders(deleted_at) WHERE deleted_at IS NOT NULL;

-- Sizes por item de pedido (v3 — grade livre por referência)
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS sizes JSONB DEFAULT '{}';

-- v4 — permite excluir tabela de preços sem perder histórico de pedidos
-- orders.price_table_id → nullable + ON DELETE SET NULL
ALTER TABLE orders ALTER COLUMN price_table_id DROP NOT NULL;
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'orders_price_table_id_fkey' AND table_name = 'orders'
  ) THEN
    ALTER TABLE orders DROP CONSTRAINT orders_price_table_id_fkey;
  END IF;
END $$;
ALTER TABLE orders ADD CONSTRAINT orders_price_table_id_fkey
  FOREIGN KEY (price_table_id) REFERENCES price_tables(id) ON DELETE SET NULL;

-- order_items.product_id → nullable + ON DELETE SET NULL
ALTER TABLE order_items ALTER COLUMN product_id DROP NOT NULL;
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'order_items_product_id_fkey' AND table_name = 'order_items'
  ) THEN
    ALTER TABLE order_items DROP CONSTRAINT order_items_product_id_fkey;
  END IF;
END $$;
ALTER TABLE order_items ADD CONSTRAINT order_items_product_id_fkey
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL;

-- Prospecção de clientes
CREATE TABLE IF NOT EXISTS prospecting_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rep_id UUID NOT NULL REFERENCES users(id),
  osm_id VARCHAR(50),
  name VARCHAR(255) NOT NULL,
  trade_name VARCHAR(255),
  cnpj VARCHAR(20),
  address TEXT,
  city VARCHAR(100),
  state VARCHAR(2),
  phone VARCHAR(30),
  lat DECIMAL(10,7),
  lng DECIMAL(10,7),
  segment VARCHAR(100),
  status VARCHAR(30) NOT NULL DEFAULT 'prospecto' CHECK (status IN ('prospecto','contatado','visita_agendada','visitado','convertido','descartado')),
  notes TEXT,
  contacted_at TIMESTAMPTZ,
  client_id UUID REFERENCES clients(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Portal de pedidos para clientes (link compartilhável)
CREATE TABLE IF NOT EXISTS customer_portals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rep_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  factory_ids UUID[] NOT NULL DEFAULT '{}',
  token VARCHAR(64) UNIQUE NOT NULL,
  name VARCHAR(200) NOT NULL DEFAULT 'Catálogo',
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
-- Coluna adicionada depois (estava só em produção via ALTER manual)
ALTER TABLE customer_portals ADD COLUMN IF NOT EXISTS price_table_ids UUID[] NOT NULL DEFAULT '{}';
CREATE INDEX IF NOT EXISTS idx_customer_portals_token ON customer_portals(token);
CREATE INDEX IF NOT EXISTS idx_customer_portals_rep ON customer_portals(rep_id);

-- Catálogos de Pronta Entrega (PE) — vincula tabela de preços + portal do cliente
CREATE TABLE IF NOT EXISTS pe_catalogs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  factory_id UUID REFERENCES factories(id) ON DELETE CASCADE,
  price_table_id UUID REFERENCES price_tables(id) ON DELETE CASCADE,
  portal_id UUID REFERENCES customer_portals(id) ON DELETE CASCADE,
  rep_id UUID REFERENCES users(id) ON DELETE SET NULL,
  item_count INTEGER DEFAULT 0,
  last_import_at TIMESTAMPTZ,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pe_catalogs_portal ON pe_catalogs(portal_id);
CREATE INDEX IF NOT EXISTS idx_pe_catalogs_price_table ON pe_catalogs(price_table_id);

-- Metas (por fábrica/marca ou por representante)
CREATE TABLE IF NOT EXISTS goals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type VARCHAR(20) NOT NULL,
  factory_id UUID REFERENCES factories(id) ON DELETE CASCADE,
  rep_id UUID REFERENCES users(id) ON DELETE CASCADE,
  label VARCHAR(255) NOT NULL,
  target_pieces INTEGER NOT NULL DEFAULT 0,
  period_label VARCHAR(100),
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_goals_factory ON goals(factory_id);
CREATE INDEX IF NOT EXISTS idx_goals_rep ON goals(rep_id);

-- Dispensa de alertas de "aniversário" de pedidos (a cada 15 dias) — v7
-- Cada linha registra que o alerta de um pedido para um determinado marco
-- (15, 30, 45... dias) foi dispensado. Como o marco faz parte da chave,
-- o alerta volta a aparecer naturalmente no próximo múltiplo de 15 dias
-- caso o pedido continue em aberto.
CREATE TABLE IF NOT EXISTS order_alert_dismissals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  milestone_days INTEGER NOT NULL,
  dismissed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  dismissed_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(order_id, milestone_days)
);
CREATE INDEX IF NOT EXISTS idx_order_alert_dismissals_order ON order_alert_dismissals(order_id);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_prospecting_rep ON prospecting_contacts(rep_id);
CREATE INDEX IF NOT EXISTS idx_prospecting_status ON prospecting_contacts(status);
CREATE INDEX IF NOT EXISTS idx_products_price_table ON products(price_table_id);
CREATE INDEX IF NOT EXISTS idx_products_reference ON products(reference);
-- Índice ÚNICO exigido pelo ON CONFLICT (price_table_id, reference) na importação
-- Wrapped em bloco para não travar se ainda houver duplicados no banco
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'uq_products_table_ref') THEN
    BEGIN
      CREATE UNIQUE INDEX uq_products_table_ref ON products(price_table_id, reference);
    EXCEPTION WHEN others THEN
      RAISE WARNING 'uq_products_table_ref não criado (duplicados ainda presentes): %', SQLERRM;
    END;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_grade_configs_product ON grade_configs(product_id);
CREATE INDEX IF NOT EXISTS idx_orders_client ON orders(client_id);
CREATE INDEX IF NOT EXISTS idx_orders_rep ON orders(rep_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status_id);
CREATE INDEX IF NOT EXISTS idx_orders_factory ON orders(factory_id);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_clients_rep ON clients(rep_id);
CREATE INDEX IF NOT EXISTS idx_discount_rules_table ON discount_commission_rules(price_table_id);

-- Condições de pagamento pré-cadastradas (selecionáveis no formulário de pedidos)
CREATE TABLE IF NOT EXISTS payment_conditions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(200) NOT NULL,
  sort_order INTEGER DEFAULT 0,
  admin_only BOOLEAN DEFAULT false,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE payment_conditions ADD COLUMN IF NOT EXISTS admin_only BOOLEAN DEFAULT false;

-- Remove restrição UNIQUE(price_table_id, reference) para permitir que a mesma referência
-- exista em múltiplas tabelas de preço e quantas vezes for necessário dentro da mesma tabela
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_price_table_id_reference_key;

-- Limite de desconto à vista por tabela de preços.
-- Quando preenchido, o sistema bloqueia o campo "Desc. À Vista" no pedido acima desse %.
-- NULL = sem limite.
ALTER TABLE price_tables ADD COLUMN IF NOT EXISTS max_cash_discount_pct NUMERIC(5,2) DEFAULT NULL;

-- Flag para pedidos com desconto especial (fora das regras pré-cadastradas).
-- Quando TRUE, o pedido exibe o badge "⚠ Revisar desc/comissão" para o admin.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS needs_review_discount BOOLEAN DEFAULT FALSE;

-- Desconto À Vista separado do desconto comercial (prazo).
-- discount_pct = prazo + cash; cash_discount_pct = só à vista (não afeta comissão).
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cash_discount_pct DECIMAL(5,2) DEFAULT 0;

-- Bairro no cadastro de clientes
ALTER TABLE clients ADD COLUMN IF NOT EXISTS neighborhood VARCHAR(150);
`

async function migrate() {
  const client = await pool.connect()
  try {
    console.log('🗄️  Executando migrations...')
    await client.query(SQL)
    console.log('✅ Migrations concluídas com sucesso!')
  } catch (err) {
    console.error('❌ Erro nas migrations:', err)
    process.exit(1)
  } finally {
    client.release()
    await pool.end()
  }
}

migrate()
