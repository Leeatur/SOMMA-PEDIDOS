FROM node:20-slim

WORKDIR /app

# Copia tudo e faz o build
COPY . .

RUN npm run build

# Garante que os diretórios de upload existem
RUN mkdir -p uploads/products uploads/logos

EXPOSE 8080

CMD ["npm", "run", "start"]
