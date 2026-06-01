# 📋 Manual de Sobrevivência — Somma Gestão Comercial

> **Leia isto se você é a pessoa que vai dar continuidade a este projeto**  
> Criado em: Junho/2026 | Mantido por: Uliano (US Gestão Empresarial)

---

## 🏢 O que é este sistema?

**Somma Gestão Comercial** é um CRM para gestão de pedidos comerciais da empresa **US Gestão Empresarial**.  
Usado pelos representantes comerciais para registrar pedidos, prospectar clientes e acompanhar comissões.

**Empresas que usam o sistema:**
- Somma Gestão Comercial (holding)
- Representantes que vendem marcas: OUZZARE, TEEZZ, etc.

---

## 🔗 URLs e Acessos Principais

| Serviço | URL/Acesso |
|---------|------------|
| **App em produção** | https://somma-pedidos-production.up.railway.app |
| **GitHub (código)** | https://github.com/Leeatur/SOMMA-PEDIDOS |
| **Railway (deploy/hosting)** | https://railway.app → login com conta Google/GitHub do Uliano |
| **Banco de dados** | PostgreSQL hospedado no Railway (ver variáveis de ambiente) |

---

## 🔐 Credenciais do Sistema

### Login Admin Principal
- **E-mail:** somma.uliano@hotmail.com  
- **Senha padrão:** `somma@2026` *(resetada automaticamente a cada deploy pelo seed)*

### Outros admins criados
- admin2@somma.com.br / somma@2026
- admin3@somma.com.br / somma@2026

> ⚠️ As senhas dos admins são **resetadas automaticamente** toda vez que um deploy acontece.  
> Isso está no arquivo `backend/src/scripts/seed.ts` — pode ser alterado lá.

### Banco de Dados PostgreSQL (Railway)
- As credenciais ficam nas **variáveis de ambiente do Railway**
- Acesse: railway.app → projeto Somma → aba Variables
- Variável principal: `DATABASE_URL`

---

## 🏗️ Arquitetura do Sistema

```
somma-pedidos/
├── frontend/          # React + Vite + TypeScript + Tailwind CSS
│   ├── src/pages/     # Páginas do app
│   ├── src/api/       # Chamadas à API
│   └── src/stores/    # Estado global (Zustand)
│
├── backend/           # Node.js + Express + TypeScript
│   ├── src/controllers/  # Lógica de negócio
│   ├── src/routes/       # Rotas da API
│   └── src/scripts/      # Migrations, seed, fixPkte
│
├── Dockerfile         # Build e deploy no Railway
└── railway.json       # Configuração do Railway
```

### Stack tecnológica
| Camada | Tecnologia |
|--------|-----------|
| Frontend | React 18, Vite, TypeScript, Tailwind CSS |
| Backend | Node.js, Express, TypeScript |
| Banco de dados | PostgreSQL |
| Hosting | Railway.app |
| Código | GitHub (github.com/Leeatur/SOMMA-PEDIDOS) |
| Mapas | Leaflet + OpenStreetMap |
| PWA | vite-plugin-pwa (app instalável no celular) |
| Imagens/Arquivos | Cloudflare R2 (AWS S3 compatible) |

---

## 🚀 Como fazer Deploy

**Automático:** Qualquer push para a branch `main` do GitHub dispara o deploy no Railway.

```bash
git add .
git commit -m "sua mensagem"
git push origin main
```

O Railway vai:
1. Buildar o Docker container
2. Instalar dependências (frontend + backend)
3. Rodar migrations do banco
4. Rodar seed (reseta senhas admin)
5. Iniciar o servidor

**Tempo de deploy:** ~3-5 minutos

---

## 💾 Banco de Dados

### Tabelas principais
| Tabela | O que guarda |
|--------|-------------|
| `users` | Representantes e admins |
| `clients` | Clientes/lojistas |
| `orders` | Pedidos comerciais |
| `order_items` | Itens de cada pedido |
| `order_statuses` | Status do fluxo de pedidos |
| `products` | Catálogo de produtos |
| `price_tables` | Tabelas de preço por coleção |
| `factories` | Indústrias/marcas |
| `prospecting_contacts` | Prospecção geolocalizada |
| `company_settings` | Configurações da empresa |
| `discount_commission_rules` | Regras de comissão |

### Como acessar o banco em produção
```bash
# Variáveis de ambiente no Railway → DATABASE_URL
# Formato: postgresql://user:password@host:port/database

# Conectar via psql (instalar psql antes):
psql "postgresql://..."
```

---

## 📦 Serviços Externos Utilizados

### 1. Railway (Hosting)
- **Site:** https://railway.app
- **Login:** conta do Uliano
- **Projeto:** "somma-pedidos"
- **Serviços:** App (Docker) + PostgreSQL database
- **Custo:** ~$5-20/mês dependendo do uso

### 2. Cloudflare R2 (Armazenamento de Imagens)
- Usado para: fotos de produtos, logos das fábricas
- Credenciais: variáveis de ambiente `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_ENDPOINT`
- Acesse: https://dash.cloudflare.com → R2

### 3. GitHub (Código Fonte)
- **Repositório:** https://github.com/Leeatur/SOMMA-PEDIDOS
- **Branch principal:** `main`
- **Login:** conta GitHub do Uliano

### 4. OpenStreetMap / Overpass API (Prospecção)
- Usado no módulo de Prospecção para buscar empresas no mapa
- **Gratuito, sem chave de API**
- Limitação: dados do Brasil são incompletos

### 5. BrasilAPI (Consulta CNPJ)
- Usado para consultar dados de CNPJ na Receita Federal
- **Gratuito, sem chave de API**
- URL: https://brasilapi.com.br/api/cnpj/v1/{cnpj}

---

## 👥 Usuários e Perfis

### Perfil Admin
- Acessa tudo
- Pode criar/editar/excluir usuários, status, fábricas, tabelas de preço
- Vê relatórios de todos os representantes
- Vê dashboard com resumo de vendas do dia

### Perfil Representante
- Vê apenas seus próprios pedidos e clientes
- Faz prospecção geolocalizada
- Acessa catálogo das marcas que trabalha
- Não vê configurações do sistema

---

## 🔧 Desenvolvimento Local

### Requisitos
- Node.js 20+
- PostgreSQL (local)
- Git

### Setup inicial
```bash
git clone https://github.com/Leeatur/SOMMA-PEDIDOS.git
cd SOMMA-PEDIDOS

# Instalar dependências
npm install --prefix frontend --legacy-peer-deps
npm install --prefix backend

# Configurar variáveis de ambiente
cp backend/.env.example backend/.env
# Editar backend/.env com suas credenciais locais

# Criar banco e rodar migrations
npm run migrate

# Rodar em desenvolvimento
npm run dev
# Frontend: http://localhost:5174
# Backend: http://localhost:3001
```

---

## ⚠️ Avisos Importantes

1. **Senhas admin resetam no deploy** — é proposital, veja `backend/src/scripts/seed.ts`
2. **Service worker PWA** — pode causar cache desatualizado no browser. Hard refresh (Ctrl+Shift+R) ou aba anônima resolve
3. **frontend/.npmrc** — tem `legacy-peer-deps=true` porque `react-leaflet` exige isso
4. **fixPkteGrades** — script que roda no startup para corrigir produtos PKTE. Não crítico, mas importante para os packs
5. **Backup do banco** — Railway faz backup automático. Configure alertas de uso no painel

---

## 📞 Contatos Técnicos

- **Desenvolvedor do sistema:** Claude (AI Assistant) via FleetView/Anthropic
- **Proprietário:** Uliano — US Gestão Empresarial
- **Assistente de desenvolvimento:** Claude Code (claude.ai)

---

*Última atualização: Junho/2026*
