FROM ubuntu:24.04

RUN apt-get update && apt-get install -y \
    curl \
    git \
    python3.12 \
    python3-pip \
    python3.12-venv \
    wget \
    default-jdk \
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

RUN python3.12 -m venv /opt/venv
RUN /opt/venv/bin/pip install -r requirements.txt

RUN mkdir -p tools && \
    git clone https://github.com/0x251/Prometheus-Deobfuscator.git tools/prometheus && \
    git clone https://github.com/hutaoshusband/Prometheus-WeAre-Devs-Dumper.git tools/wearedevs && \
    git clone https://github.com/tupsutumppu/MoonsecDeobfuscator.git tools/moonsec && \
    cd tools/moonsec && dotnet publish -c Release -o /app/moonsec_bin

RUN curl -L https://github.com/FModel/unluac/releases/download/1.2.3/unluac.jar -o /app/unluac.jar && \
    curl -L https://github.com/1-3-7/disrobe/releases/latest/download/disrobe-linux-amd64 -o /app/disrobe && \
    chmod +x /app/disrobe

CMD ["npm", "start"]
