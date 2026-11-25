FROM node:20-alpine
WORKDIR /app
COPY . .
ENV HOST=0.0.0.0 PORT=8080
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- http://127.0.0.1:8080/health || exit 1
CMD ["node", "server/server.js"]
