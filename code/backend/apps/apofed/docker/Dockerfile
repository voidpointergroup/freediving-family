FROM node:18-alpine as build-env
ARG app
ARG flavor

RUN apk add --update bash make git ca-certificates musl-dev gcc

WORKDIR /code
COPY ./libs ./libs
WORKDIR /code/apps/$app
COPY ./apps/$app/package.json .
COPY ./apps/$app/package-lock.json .
RUN npm ci

COPY ./apps/$app ./
RUN npx ncc build -m src/$flavor.ts -o /app/$flavor --target es2020

FROM node:18-alpine as runtime-env
USER root

WORKDIR /app
COPY --from=build-env /app/$flavor/* .

USER 1000

ENTRYPOINT ["node", "/app/index.js"]
