# SOMMA PEDIDOS — Contexto para o Claude

## O que é o sistema

CRM B2B para a **Somma Gestão Comercial**, empresa de representação comercial de moda (marcas TEEZZ e OUZZARE).
Permite que representantes criem e gerenciem pedidos de venda, e que clientes façam pedidos diretamente via um **Portal do Cliente** com link compartilhável.

## Estrutura principal

```
somma-pedidos/
├── frontend/          # React + Vite + TypeScript + Tailwind CSS
│   └── src/
│       ├── pages/
│       │   ├── NewOrder.tsx        # Criar pedido (representante)
│       │   ├── OrderEdit.tsx       # Editar pedido existente
│       │   ├── OrderPrint.tsx      # Impressão/PDF do pedido
│       │   ├── CustomerPortal.tsx  # Portal do cliente (link público)
│       │   ├── Products.tsx        # Catálogo de produtos com fotos
│       │   ├── PriceTables.tsx     # Tabelas de preço por fábrica
│       │   ├── Reports.tsx         # Relatórios (vendas, comissões, etc.)
│       │   └── Orders.tsx          # Lista de pedidos
│       ├── api/client.ts           # Axios + todos os endpoints da API
│       └── components/ui/
│           └── PhotosZipImportModal.tsx  # Import de fotos via ZIP
└── backend/           # Node.js + Express + TypeScript + PostgreSQL
    └── src/
        ├── controllers/
        │   ├── ordersController.ts        # CRUD pedidos + comissões
        │   ├── reportsController.ts       # Relatórios agregados
        │   ├── priceTablesController.ts   # Tabelas + upload de fotos
        │   └── portalController.ts        # Endpoints do portal público
        └── routes/index.ts
```

## Tecnologias

| Camada | Stack |
|--------|-------|
| Frontend | React 19, Vite, TypeScript, Tailwind CSS, React Query, Zustand |
| Backend | Node.js, Express, TypeScript, PostgreSQL (pg) |
| Hosting | Railway.app (Docker) |
| Fotos | Upload individual + importação via ZIP (compressão canvas no browser) |

## Fluxo principal

1. Admin cria **Tabela de Preço** com produtos (import Excel) e fotos (ZIP)
2. Admin cria **Portal do Cliente** vinculando tabelas → gera link
3. Rep compartilha link via WhatsApp/e-mail
4. Cliente acessa link → digita CNPJ → visualiza catálogo → monta carrinho → finaliza pedido
5. Pedido aparece em **Pedidos** para o rep revisar/confirmar

## Branches / Deploy

- `main` → produção (deploy manual via Railway)
- `develop` → staging (auto-deploy às 23h BRT)

## Banco de dados

- **Produção**: `postgresql://postgres:OQcLtrTkYHUbMAmOWptwILfPafyLmjAN@yamanote.proxy.rlwy.net:34775/railway`
- **Staging**: `postgresql://postgres:MtZaYMijFbaaemkYKqLVgPzgUzClcOsr@acela.proxy.rlwy.net:16817/railway`
- `tools/config.py` — **gitignored, jamais commitar**

## Tabelas importantes (PostgreSQL)

| Tabela | Descrição |
|--------|-----------|
| `orders` | Pedidos — inclui `commission_manual_override` (bool) |
| `order_items` | Itens com `original_unit_price` para desconto na impressão |
| `products` | Produtos com `image_url` (campo de foto) |
| `price_tables` | Tabelas de preço por fábrica |
| `customer_portals` | Portais públicos com token único |
| `discount_commission_rules` | Regras de desconto × comissão |
| `factories` | Fabricantes (TEEZZ, OUZZARE) |
| `clients` | Clientes com CNPJ |

## Último desenvolvimento (junho/2025)

### commission_manual_override
Quando admin define comissão manualmente em **Editar Pedido**:
- Flag `commission_manual_override = TRUE` ativado na tabela `orders`
- Todas as funções de recalc (`addOrderItems`, `updateOrderItem`, `deleteOrderItem`) **preservam** os valores manuais
- `changeOrderPriceTable` **reseta** o flag (nova tabela = recalc automático)
- Novo endpoint `DELETE /orders/:id/commission` → reseta para automático
- Frontend: badge "⚠ OVERRIDE ATIVO" + botão "Resetar para automático"
- Relatório de Comissões: edição inline (clique no valor → input → Enter)

### Portal do Cliente
- Removida etapa redundante de seleção de tabela/fábrica após CNPJ
- Catálogo carrega direto após validação do CNPJ

### Import de fotos via ZIP
- Regex corrigida: `/([A-Z]{2,4}\d+)/i` — aceita ZZ, TE, PKTE, ZO, etc.
- Compressão canvas no browser antes do upload (25-44 MB → ~300 KB)

## Padrões de código

- `useRef` para prevenir reset de campos numéricos durante digitação
- `invalidateQueries({ refetchType: 'all' })` para invalidar cache após salvar
- Captura de Enter com `useCapture=true` em modais para evitar fechamento indevido
- Comissão sempre calculada sobre preço cheio (sem desconto à vista)
