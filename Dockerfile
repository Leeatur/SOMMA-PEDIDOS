FROM node:20-slim

WORKDIR /app

# Build cache bust: 2026-06-02-2241
COPY . .

RUN npm run build

# Garante que os diretórios de upload existem
RUN mkdir -p uploads/products uploads/logos

EXPOSE 8080

CMD ["npm", "run", "start"]
