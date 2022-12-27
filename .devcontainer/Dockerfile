FROM ubuntu:22.04

RUN apt-get update -y && apt-get upgrade -y
RUN apt-get install -y snap
RUN apt-get install -y git build-essentials ca-certificates g++ make curl wget unzip

# install NVM & NPM
RUN curl https://raw.githubusercontent.com/creationix/nvm/master/install.sh | bash
RUN source ~/.bashrc
RUN nvm install 16.16 && nvm alias default 16.16

# install go
RUN snap install go --classic

# install protobuf
RUN curl -LO https://github.com/protocolbuffers/protobuf/releases/download/v21.12/protoc-21.12-linux-x86_64.zip
RUN unzip protoc-21.12-linux-x86_64.zip -d $HOME/.local/bin
RUN printf 'export PATH="$PATH:$HOME/.local/bin"' >> ~/.bashrc
