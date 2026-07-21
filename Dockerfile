# syntax=docker/dockerfile:1

FROM node:24-alpine AS dependencias
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM node:24-alpine AS producao
WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000

# dumb-init entrega os sinais do Docker ao Node em vez de deixa-lo como PID 1.
RUN apk add --no-cache dumb-init

COPY --from=dependencias /app/node_modules ./node_modules
COPY package.json ./
COPY server ./server
COPY scripts ./scripts
COPY public ./public

# A imagem oficial ja traz o usuario "node" (uid 1000) sem privilegios.
USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/saude').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "server/index.js"]
