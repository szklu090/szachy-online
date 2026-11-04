# Obraz produkcyjny - dziala na Render, Railway, Fly.io, Koyeb, Cloud Run, VPS...
FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

# najpierw zaleznosci (lepsze cache warstw)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# potem kod
COPY public ./public
COPY server.js ./

EXPOSE 3000
ENV PORT=3000
ENV HOST=0.0.0.0

CMD ["node", "server.js"]
