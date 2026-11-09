FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive
ENV REPO_CORE="https://github.com"
ENV REPO_PROM="https://github.com"
ENV REPO_DEVS="https://github.com"
ENV REPO_MOON="https://github.com"
ENV REPO_RUST="https://github.com"
ENV REPO_JAVA="https://github.com"

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

RUN git clone ${REPO_CORE} /app/prometheus-deobfuscator-core \
    && cd /app/prometheus-deobfuscator-core && npm install

RUN python3.12 -m venv /opt/venv \
    && /opt/venv/bin/pip install --no-cache-dir -r requirements.txt || true

RUN mkdir -p tools \
    && git clone ${REPO_PROM} tools/prometheus \
    && git clone ${REPO_DEVS} tools/wearedevs \
    && mkdir -p /app/tools/wearedevs/lua_linux \
    && cp /usr/bin/lua5.1 /app/tools/wearedevs/lua_linux/lua5.1 \
    && chmod +x /app/tools/wearedevs/lua_linux/lua5.1 \
    && git clone ${REPO_MOON} tools/moonsec \
    && cd tools/moonsec && dotnet publish -c Release -f net9.0 -o /app/moonsec_bin

RUN git clone ${REPO_RUST} /app/unluac-rs \
    && cd /app/unluac-rs \
    && cargo install --path packages/unluac-cli

RUN git clone ${REPO_JAVA} /app/unluac-src \
    && cd /app/unluac-src \
    && FILE_TO_PATCH=$(grep -rl "Implicit return must have zero values" src/) \
    && sed -i 's/throw new IllegalStateException("Implicit return must have zero values");/System.err.println("[LM7H-Patch] Implicit return ignored");/' $FILE_TO_PATCH \
    && ant \
    && cp unluac.jar /app/unluac.jar

CMD ["npm", "start"]
