FROM node:20-slim

# Instala dependências do sistema necessárias para pacotes nativos (sharp, etc)
# + PyMuPDF (fitz): usado pelo importador de Catálogo PDF p/ extrair texto e fotos.
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    make \
    g++ \
    --no-install-recommends \
    && pip3 install --no-cache-dir --break-system-packages pymupdf \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Flags por instância (Vite "assa" no build) — Railway passa a var de serviço como build arg
ARG VITE_HIDE_PRONTA_ENTREGA
ENV VITE_HIDE_PRONTA_ENTREGA=$VITE_HIDE_PRONTA_ENTREGA
ARG VITE_TRIAL_LABEL
ENV VITE_TRIAL_LABEL=$VITE_TRIAL_LABEL
ARG VITE_SINGLE_COMMISSION
ENV VITE_SINGLE_COMMISSION=$VITE_SINGLE_COMMISSION
ARG VITE_FACTORY_COMMISSION
ENV VITE_FACTORY_COMMISSION=$VITE_FACTORY_COMMISSION
ARG VITE_MULTI_GRADE
ENV VITE_MULTI_GRADE=$VITE_MULTI_GRADE
ARG VITE_MIN_ORDER_VALUE
ENV VITE_MIN_ORDER_VALUE=$VITE_MIN_ORDER_VALUE
ARG VITE_PAYMENT_DRIVEN_DISCOUNT
ENV VITE_PAYMENT_DRIVEN_DISCOUNT=$VITE_PAYMENT_DRIVEN_DISCOUNT
ARG VITE_MAPS_URL
ENV VITE_MAPS_URL=$VITE_MAPS_URL

# Build cache bust: 2026-06-11-1145
COPY . .

RUN npm run build

# Garante que os diretórios de upload existem
RUN mkdir -p uploads/products uploads/logos

EXPOSE 8080

CMD ["npm", "run", "start"]
