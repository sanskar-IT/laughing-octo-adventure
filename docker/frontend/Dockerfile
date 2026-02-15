# AI Companion - Frontend Dockerfile
# React + Vite with hot reload support

FROM node:18-alpine as base

# Install dependencies for hot reload
RUN apk add --no-cache git

WORKDIR /app

# Copy package files
COPY package*.json ./
RUN npm ci

# ==========================================
# DEVELOPMENT STAGE
# ==========================================
FROM base as development

ENV NODE_ENV=development
ENV CHOKIDAR_USEPOLLING=true
ENV WDS_SOCKET_PORT=0
ENV VITE_API_URL=http://localhost:3000
ENV VITE_TTS_URL=http://localhost:4000

EXPOSE 6000

# Default command with hot reload
CMD ["npm", "run", "dev", "--", "--port", "6000", "--host"]

# ==========================================
# BUILD STAGE
# ==========================================
FROM base as build

COPY . .
RUN npm run build

# ==========================================
# PRODUCTION STAGE (served by nginx)
# ==========================================
FROM nginx:alpine as production

COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
