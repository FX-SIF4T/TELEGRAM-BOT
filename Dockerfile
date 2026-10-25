FROM node:20-bookworm-slim AS build

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        build-essential \
        libcairo2-dev \
        libgif-dev \
        libjpeg-dev \
        libpango1.0-dev \
        librsvg2-dev \
        pkg-config \
        python3 \
    && rm -rf /var/lib/apt/lists/*

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund --package-lock=false

COPY . .

FROM node:20-bookworm-slim AS runtime

ENV NODE_ENV=production \
    PYTHON=python3 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        git \
        libcairo2 \
        libgif7 \
        libjpeg62-turbo \
        libpango-1.0-0 \
        librsvg2-2 \
        python3 \
        python3-pymongo \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=build --chown=node:node /app/ /app/
COPY --chown=root:root docker-entrypoint.sh /usr/local/bin/docker-entrypoint

RUN chmod 0755 /usr/local/bin/docker-entrypoint \
    && mkdir -p /app/data \
    && chown node:node /app /app/data

USER node

EXPOSE 3000
VOLUME ["/app/data"]

ENTRYPOINT ["docker-entrypoint"]
CMD ["node", "index.js"]
