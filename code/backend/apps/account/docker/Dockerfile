FROM node:18-alpine as build-env
ARG app
ARG flavor

RUN apk add --update bash make git ca-certificates musl-dev gcc protoc

WORKDIR /code
COPY ./libs ./libs
RUN cd ./libs && bash install.sh && cd ../
WORKDIR /code/apps/$app
COPY ./apps/$app/package.json .
COPY ./apps/$app/package-lock.json .
RUN npm i

COPY ./apps/$app ./
RUN npm run codegen
RUN npx ncc build src/$flavor/index.ts -o /app --target es2020
RUN cp -R ./res /app

FROM node:18-alpine as runtime-env
USER root

WORKDIR /app
COPY --from=build-env /app .

USER 1000

ENTRYPOINT ["node", "/app/index.js"]
