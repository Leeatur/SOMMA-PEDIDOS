FROM node:20-slim

# Instala Python 3 e PyMuPDF para processamento de PDF
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    python3-venv \
    && python3 -m venv /opt/pymupdf \
    && /opt/pymupdf/bin/pip install PyMuPDF \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Garante que o python3 do venv seja o padrão
ENV PATH="/opt/pymupdf/bin:$PATH"

WORKDIR /app

# Copia tudo e faz o build
COPY . .

RUN npm run build

# Garante que os diretórios de upload existem
RUN mkdir -p uploads/products uploads/logos

EXPOSE 8080

CMD ["npm", "run", "start"]
