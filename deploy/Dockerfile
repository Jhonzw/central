# Central: Node puro, sem npm install. Roda como o usuário "node", com o
# sistema de arquivos só leitura (o compose liga isso); escreve só em /dados.
FROM node:24.22.1-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production TZ=America/Sao_Paulo \
    CENTRAL_ESCUTA=0.0.0.0 CENTRAL_BANCO=/dados/central.sqlite3 \
    CENTRAL_CHAVE_ARQ=/segredos/chave CENTRAL_CONFIG=/config/local.json
COPY src ./src
COPY migrations ./migrations
USER node
EXPOSE 7800
HEALTHCHECK --interval=60s --timeout=5s CMD node -e "fetch('http://127.0.0.1:7800/api/sessao').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "src/server.ts"]
