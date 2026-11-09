# --- Build: library, app and server ------------------------------------------
FROM node:24 AS build

WORKDIR /app

# Package manifests first, so dependency layers cache across code changes
COPY package*.json ./
COPY packages/fossflow-lib/package*.json ./packages/fossflow-lib/
COPY packages/fossflow-app/package*.json ./packages/fossflow-app/
COPY packages/fossflow-backend/package*.json ./packages/fossflow-backend/

# Reproducible install from the lockfile
RUN npm ci

COPY . .

RUN npm run build:lib && npm run build:app && npm run build --workspace=packages/fossflow-backend

# --- Server production dependencies only, from the same lockfile -------------
FROM node:24 AS server-deps

WORKDIR /app

COPY package*.json ./
COPY packages/fossflow-lib/package*.json ./packages/fossflow-lib/
COPY packages/fossflow-app/package*.json ./packages/fossflow-app/
COPY packages/fossflow-backend/package*.json ./packages/fossflow-backend/

RUN npm ci --omit=dev --workspace=packages/fossflow-backend

# --- Runtime: nginx serves the app, the server runs behind it ----------------
FROM node:24-alpine

# Install web server packages, with the Alpine fixes released after the base image
RUN apk upgrade --no-cache && apk add --no-cache nginx openssl su-exec

# Server: compiled code, SQL migrations and production dependencies (pure JS, no native addons)
COPY --from=server-deps /app/node_modules /app/node_modules
COPY --from=build /app/packages/fossflow-backend/package.json /app/packages/fossflow-backend/package.json
COPY --from=build /app/packages/fossflow-backend/dist /app/packages/fossflow-backend/dist
COPY --from=build /app/packages/fossflow-backend/drizzle /app/packages/fossflow-backend/drizzle

# npm isn't needed at runtime: remove it, and the packages it bundles
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx

# Copy the built React app to Nginx's web server directory
COPY --from=build /app/packages/fossflow-app/build /usr/share/nginx/html

# Copy nginx configuration
COPY nginx.conf /etc/nginx/http.d/default.conf

# Copy and set up entrypoint script
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

# Persistent data (encryption key, legacy diagrams to import)
RUN mkdir -p /data

EXPOSE 80

ENV NODE_ENV=production
ENV BACKEND_PORT=3001
# nginx reaches the server on localhost; don't expose the API to other
# containers around nginx. Override for direct access.
ENV BACKEND_HOST=127.0.0.1

ENTRYPOINT ["/docker-entrypoint.sh"]
