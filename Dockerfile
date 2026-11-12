FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y \
    curl git python3.12 python3-pip python3.12-venv \
    wget default-jdk lua5.1 luarocks unzip build-essential \
    nodejs npm software-properties-common \
    && rm -rf /var/lib/apt/lists/*

RUN luarocks install bit32 || true

RUN wget https://dot.net/v1/dotnet-install.sh -O dotnet-install.sh \
    && bash dotnet-install.sh --channel 9.0 --install-dir /usr/share/dotnet \
    && ln -s /usr/share/dotnet/dotnet /usr/bin/dotnet \
    && rm dotnet-install.sh

RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
ENV PATH="/root/.cargo/bin:${PATH}"

WORKDIR /app

COPY . .

RUN npm install

RUN git clone https://github.com/prostone4/Prometheus-Deobfuscator.git /app/prometheus-deobf && \
    cd /app/prometheus-deobf && npm install

RUN python3.12 -m venv /opt/venv && /opt/venv/bin/pip install --no-cache-dir -r requirements.txt || true

RUN mkdir -p tools && \
    git clone https://github.com/0x251/Prometheus-Deobfuscator.git tools/prometheus && \
    git clone https://github.com/hutaoshusband/Prometheus-WeAre-Devs-Dumper.git tools/wearedevs && \
    mkdir -p /app/tools/wearedevs/lua_linux && \
    cp /usr/bin/lua5.1 /app/tools/wearedevs/lua_linux/lua5.1 && \
    chmod +x /app/tools/wearedevs/lua_linux/lua5.1 && \
    git clone https://github.com/tupsutumppu/MoonsecDeobfuscator.git tools/moonsec && \
    cd tools/moonsec && dotnet publish -c Release -f net9.0 -o /app/moonsec_bin

RUN git clone https://github.com/x3zvawq/unluac-rs.git /app/unluac-rs && \
    cd /app/unluac-rs && cargo install --path packages/unluac-cli

RUN git clone https://github.com/HansWessels/unluac.git /app/unluac-src && \
    cd /app/unluac-src && \
    grep -rl "Implicit return must have zero values" src/ | xargs -r sed -i 's/throw new IllegalStateException("Implicit return must have zero values");/System.err.println("[LM7H-Patch] Implicit return ignored");/' && \
    chmod +x build.sh && ./build.sh && cp bin/unluac.jar /app/unluac.jar

RUN git clone https://github.com/memcpython/lua-deobfuscators.git /app/lua-deobfuscators

CMD ["npm", "start"]
