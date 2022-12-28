FROM node:16-alpine as build-env

RUN apk add --update bash make git ca-certificates musl-dev gcc

WORKDIR /code
COPY ./package.json .
COPY ./package-lock.json .
RUN npm i

COPY . .
RUN npm run codegen:graphql
RUN npm run build
RUN cp -R ./res /app

FROM node:16-alpine as runtime-env
USER root

WORKDIR /app
COPY --from=build-env /app .

USER 1000

ENTRYPOINT ["node", "/app/index.js"]
