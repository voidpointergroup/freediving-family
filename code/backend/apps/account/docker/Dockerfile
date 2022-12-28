# -- builder image -- #

FROM node:16-alpine as build-env
ARG flavor
ENV APP_NAME account

RUN apk add --update bash make git ca-certificates musl-dev gcc

COPY ./apps/$APP_NAME /code/apps/$APP_NAME
COPY ./libs /code/libs
WORKDIR /code/apps/$APP_NAME
RUN npm i

RUN npm run build:$flavor
RUN cp -R ./res /app

# -- runtime image -- #

FROM node:16-alpine as runtime-env
USER root
WORKDIR /app
COPY --from=build-env /app .
USER 1000
ENTRYPOINT ["node", "/app/index.js"]
