FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y \
    curl git python3.12 python3-pip python3.12-venv \
    wget default-jdk lua5.1 luarocks unzip build-essential ant \
    nodejs npm software-properties-common rustc cargo \
    && rm -rf /var/lib/apt/lists/*

RUN luarocks install bit32 || true

RUN curl -sSL https://githubusercontent.com | bash -s -- --version 9.0.100 --install-dir /usr/share/dotnet \
    && ln -s /usr/share/dotnet/dotnet /usr/bin/dotnet

WORKDIR /app

COPY . .

RUN npm install

RUN curl -sSL https://github.com -o core.zip \
    && unzip core.zip \
    && mv Prometheus-Deobfuscator-main /app/prometheus-standalone-core \
    && rm core.zip \
    && cd /app/prometheus-standalone-core \
    && npm install

RUN python3.12 -m venv /opt/venv \
    && /opt/venv/bin/pip install --no-cache-dir -r requirements.txt || true

RUN mkdir -p tools \
    && curl -sSL https://github.com -o prom.zip && unzip prom.zip && mv Prometheus-Deobfuscator-main tools/prometheus && rm prom.zip \
    && curl -sSL https://github.com -o devs.zip && unzip devs.zip && mv Prometheus-WeAre-Devs-Dumper-main tools/wearedevs && rm devs.zip \
    && mkdir -p /app/tools/wearedevs/lua_linux \
    && cp /usr/bin/lua5.1 /app/tools/wearedevs/lua_linux/lua5.1 \
    && chmod +x /app/tools/wearedevs/lua_linux/lua5.1 \
    && curl -sSL https://github.com -o moon.zip && unzip moon.zip && mv MoonsecDeobfuscator-main tools/moonsec && rm moon.zip \
    && cd tools/moonsec && dotnet publish -c Release -f net9.0 -o /app/moonsec_bin

RUN curl -sSL https://github.com -o unluac_rs.zip && unzip unluac_rs.zip && mv unluac-rs-master /app/unluac-rs && rm unluac_rs.zip \
    && cd /app/unluac-rs \
    && cargo install --path packages/unluac-cli

RUN curl -sSL https://github.com -o unluac_java.zip && unzip unluac_java.zip && mv unluac-master /app/unluac-src && rm unluac_java.zip \
    && cd /app/unluac-src \
    && FILE_TO_PATCH=$(grep -rl "Implicit return must have zero values" src/) \
    && sed -i 's/throw new IllegalStateException("Implicit return must have zero values");/System.err.println("[LM7H-Patch] Implicit return ignored");/' $FILE_TO_PATCH \
    && ant \
    && cp unluac.jar /app/unluac.jar

CMD ["npm", "start"]
