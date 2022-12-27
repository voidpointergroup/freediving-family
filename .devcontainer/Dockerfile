FROM ubuntu:22.04

RUN apt-get update -y && apt-get upgrade -y
RUN apt-get install -y git build-essentials ca-certificates g++ make curl wget unzip

# install NVM & NPM
ENV NVM_DIR /usr/local/nvm
ENV NODE_VERSION 16.16
ENV NODE_PATH $NVM_DIR/v$NODE_VERSION/lib/node_modules
ENV PATH $NVM_DIR/v$NODE_VERSION/bin:$PATH

RUN curl https://raw.githubusercontent.com/creationix/nvm/master/install.sh | bash
RUN nvm install $NODE_VERSION && nvm alias default $NODE_VERSION

# install protobuf
RUN curl -LO https://github.com/protocolbuffers/protobuf/releases/download/v21.12/protoc-21.12-linux-x86_64.zip
RUN unzip protoc-21.12-linux-x86_64.zip -d $HOME/.local/bin
ENV PATH $HOME/.local/bin:$PATH
