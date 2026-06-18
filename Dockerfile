FROM node:20-slim

# Instala dependências do sistema necessárias para pacotes nativos (sharp, etc)
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Flags por instância (Vite "assa" no build) — Railway passa a var de serviço como build arg
ARG VITE_HIDE_PRONTA_ENTREGA
ENV VITE_HIDE_PRONTA_ENTREGA=$VITE_HIDE_PRONTA_ENTREGA
ARG VITE_TRIAL_LABEL
ENV VITE_TRIAL_LABEL=$VITE_TRIAL_LABEL

# Build cache bust: 2026-06-11-1145
COPY . .

RUN npm run build

# Garante que os diretórios de upload existem
RUN mkdir -p uploads/products uploads/logos

EXPOSE 8080

CMD ["npm", "run", "start"]
