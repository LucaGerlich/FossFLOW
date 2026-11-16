FROM node:24-alpine
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY package.json ./
RUN npm install --no-audit --no-fund
COPY . .
RUN npx next build
CMD ["npx","next","start","-p","3000"]
