# Pathology teaching platform — no dependencies beyond Node.js.
FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY server ./server
COPY public ./public
COPY content ./content
COPY tools ./tools
ENV NODE_ENV=production PORT=3000 DATA_DIR=/data
# publishing writes content/ (the live copy); the server runs as the unprivileged "node" user
RUN mkdir -p /data && chown -R node:node /app /data
# Drafts, unpublished uploads, history and sessions: mount a persistent volume here.
VOLUME /data
EXPOSE 3000
USER node
CMD ["node", "server/server.js"]
