FROM node:20.10.0-alpine as base

RUN apt-get update && apt-get install -y \
    ffmpeg \
    python3 \
    make \
    g++ \
    libcairo2-dev \
    libpango1.0-dev \
    libjpeg-dev \
    libgif-dev \
    librsvg2-dev \

FROM base as build
WORKDIR /app
COPY . ./
RUN npm ci
RUN npm run build

FROM base
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/*.json ./
COPY --from=build /app/dist ./dist
COPY --from=build /app/key.config ./key.config
EXPOSE 6020
CMD ["node","dist/main"]