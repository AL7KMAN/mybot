FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y curl git python3.12 python3-pip python3.12-venv wget default-jdk lua5.1 luarocks unzip build-essential ant nodejs npm software-properties-common rustc cargo && rm -rf /var/lib/apt/lists/*

RUN luarocks install bit32 || true

RUN curl -sSL https://githubusercontent.com | bash -s -- --version 9.0.100 --install-dir /usr/share/dotnet && ln -s /usr/share/dotnet/dotnet /usr/bin/dotnet

WORKDIR /app

COPY . .

RUN npm install

RUN curl --location --fail --silent --show-error "https://github.com" --output /app/core.zip
RUN unzip /app/core.zip -d /app/
RUN mv /app/Prometheus-Deobfuscator-main /app/prometheus-standalone-core
RUN rm /app/core.zip
RUN cd /app/prometheus-standalone-core && npm install

RUN python3.12 -m venv /opt/venv
RUN /opt/venv/bin/pip install --no-cache-dir -r requirements.txt || true

RUN mkdir -p /app/tools
RUN curl --location --fail --silent "https://github.com" --output /app/tools/prom.zip
RUN unzip /app/tools/prom.zip -d /app/tools/
RUN mv /app/tools/Prometheus-Deobfuscator-main /app/tools/prometheus
RUN rm /app/tools/prom.zip

RUN curl --location --fail --silent "https://github.com" --output /app/tools/devs.zip
RUN unzip /app/tools/devs.zip -d /app/tools/
RUN mv /app/tools/Prometheus-WeAre-Devs-Dumper-main /app/tools/wearedevs
RUN rm /app/tools/devs.zip

RUN mkdir -p /app/tools/wearedevs/lua_linux
RUN cp /usr/bin/lua5.1 /app/tools/wearedevs/lua_linux/lua5.1
RUN chmod +x /app/tools/wearedevs/lua_linux/lua5.1

RUN curl --location --fail --silent "https://github.com" --output /app/tools/moon.zip
RUN unzip /app/tools/moon.zip -d /app/tools/
RUN mv /app/tools/MoonsecDeobfuscator-main /app/tools/moonsec
RUN rm /app/tools/moon.zip

RUN cd /app/tools/moonsec && dotnet publish -c Release -f net9.0 -o /app/moonsec_bin

RUN curl --location --fail --silent "https://github.com" --output /app/unluac_rs.zip
RUN unzip /app/unluac_rs.zip -d /app/
RUN mv /app/unluac-rs-master /app/unluac-rs
RUN rm /app/unluac_rs.zip
RUN cd /app/unluac-rs && cargo install --path packages/unluac-cli

RUN curl --location --fail --silent "https://github.com" --output /app/unluac_java.zip
RUN unzip /app/unluac_java.zip -d /app/
RUN mv /app/unluac-master /app/unluac-src
RUN rm /app/unluac_java.zip
RUN cd /app/unluac-src && FILE_TO_PATCH=$(grep -rl "Implicit return must have zero values" src/) && sed -i 's/throw new IllegalStateException("Implicit return must have zero values");/System.err.println("[LM7H-Patch] Implicit return ignored");/' $FILE_TO_PATCH && ant && cp unluac.jar /app/unluac.jar

CMD ["npm", "start"]
