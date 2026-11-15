FROM node:22-alpine AS build
ARG APP
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# generate needs the config to load, but never connects, so a placeholder URL is fine
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build npx prisma generate
RUN npx nest build ${APP}

FROM node:22-alpine
ARG APP
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist/apps/${APP} ./dist
CMD ["node", "dist/main.js"]