FROM node:20 AS base

RUN apt-get update && apt-get install -y \
  python3 \
  make \
  g++ \
  libcairo2-dev \
  libpango1.0-dev \
  libjpeg-dev \
  libgif-dev \
  librsvg2-dev

FROM base as build
WORKDIR /app
COPY . ./
RUN npm ci --ignore-scripts
RUN npm run build
RUN npm prune --omit=dev

FROM base
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package*.json ./
COPY --from=build /app/dist ./dist
EXPOSE 6020
CMD ["node","dist/main"]