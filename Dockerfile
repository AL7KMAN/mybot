FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y \
    curl git python3.12 python3-pip python3.12-venv \
    wget default-jdk lua5.1 luarocks unzip build-essential ant \
    nodejs npm \
    && rm -rf /var/lib/apt/lists/*

RUN luarocks install bit32 || true

RUN wget https://microsoft.com -O packages-microsoft-prod.deb \
    && dpkg -i packages-microsoft-prod.deb \
    && rm packages-microsoft-prod.deb \
    && apt-get update && apt-get install -y dotnet-sdk-9.0

RUN curl --proto '=https' --tlsv1.2 -sSf https://rustup.rs | sh -s -- -y
ENV PATH="/root/.cargo/bin:${PATH}"

WORKDIR /app

COPY . .

RUN npm install

RUN git clone https://github.com /app/prometheus-deobf \
    && cd /app/prometheus-deobf && npm install

RUN python3.12 -m venv /opt/venv \
    && /opt/venv/bin/pip install --no-cache-dir -r requirements.txt || true

RUN mkdir -p tools && \
    git clone https://github.com tools/prometheus && \
    git clone https://github.com tools/wearedevs && \
    mkdir -p /app/tools/wearedevs/lua_linux && \
    cp /usr/bin/lua5.1 /app/tools/wearedevs/lua_linux/lua5.1 && \
    chmod +x /app/tools/wearedevs/lua_linux/lua5.1 && \
    git clone https://github.com tools/moonsec && \
    cd tools/moonsec && dotnet publish -c Release -f net9.0 -o /app/moonsec_bin

RUN git clone https://github.com /app/unluac-rs && \
    cd /app/unluac-rs && \
    cargo install --path packages/unluac-cli

RUN git clone https://github.com /app/unluac-src && \
    cd /app/unluac-src && \
    FILE_TO_PATCH=$(grep -rl "Implicit return must have zero values" src/) && \
    sed -i 's/throw new IllegalStateException("Implicit return must have zero values");/System.err.println("[LM7H-Patch] Implicit return ignored");/' $FILE_TO_PATCH && \
    ant && \
    cp unluac.jar /app/unluac.jar

CMD ["npm", "start"]
