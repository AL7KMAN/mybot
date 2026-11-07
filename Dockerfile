FROM ubuntu:24.04

RUN apt-get update && apt-get install -y \
    curl git python3.12 python3-pip python3.12-venv \
    wget default-jdk lua5.1 unzip \
    && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://deb.nodesource.com/setup_18.x | bash - \
    && apt-get install -y nodejs

RUN wget https://dot.net/v1/dotnet-install.sh -O dotnet-install.sh \
    && bash dotnet-install.sh --channel 9.0 --install-dir /usr/share/dotnet \
    && ln -s /usr/share/dotnet/dotnet /usr/bin/dotnet \
    && rm dotnet-install.sh

WORKDIR /app

COPY . .

RUN npm install

RUN git clone https://github.com/prostone4/Prometheus-Deobfuscator.git /app/prometheus-deobf
RUN cd /app/prometheus-deobf && npm install

RUN python3.12 -m venv /opt/venv
RUN /opt/venv/bin/pip install -r requirements.txt

RUN mkdir -p tools && \
    git clone https://github.com/0x251/Prometheus-Deobfuscator.git tools/prometheus && \
    git clone https://github.com/hutaoshusband/Prometheus-WeAre-Devs-Dumper.git tools/wearedevs && \
    mkdir -p /app/tools/wearedevs/lua_linux && \
    cp /usr/bin/lua5.1 /app/tools/wearedevs/lua_linux/lua5.1 && \
    chmod +x /app/tools/wearedevs/lua_linux/lua5.1 && \
    git clone https://github.com/tupsutumppu/MoonsecDeobfuscator.git tools/moonsec && \
    cd tools/moonsec && dotnet publish -c Release -f net9.0 -o /app/moonsec_bin

RUN wget https://codeload.github.com/atrexus/unluau/tar.gz/refs/heads/master -O unluau.tar.gz && \
    tar -xzf unluau.tar.gz && \
    mv unluau-master unluau-src && \
    cd unluau-src && \
    sed -i 's/<TargetFramework>.*<\/TargetFramework>/<TargetFramework>net9.0<\/TargetFramework>/g' src/Unluau.CLI/Unluau.CLI.csproj && \
    dotnet publish src/Unluau.CLI/Unluau.CLI.csproj -c Release -f net9.0 -r linux-x64 --self-contained false -p:PublishSingleFile=true -o /app/unluau-bin && \
    chmod +x /app/unluau-bin/Unluau.CLI

CMD ["npm", "start"]
