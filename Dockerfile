# ---------- Build: test + build client ----------
FROM node:26-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci
COPY . .
RUN npm test && npm run build

# ---------- Runtime: chỉ server + client đã build ----------
FROM node:26-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3001
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci --omit=dev --workspace server && npm cache clean --force
COPY shared/src shared/src
COPY server/src server/src
COPY --from=build /app/client/dist client/dist
EXPOSE 3001
USER node
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://localhost:3001/health || exit 1
CMD ["node", "server/src/index.js"]
