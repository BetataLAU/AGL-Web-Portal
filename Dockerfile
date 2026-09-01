# ===== AGL Web Portal - Railway 部署（含 SLI/ELI 跨平台 PDF 生成） =====
# 安裝 Python（openpyxl 填表）+ LibreOffice（xlsx → pdf）+ 中文字型
FROM node:22-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python-is-python3 \
    make \
    g++ \
    libreoffice-core \
    libreoffice-calc \
    libreoffice-writer \
    fonts-dejavu \
    fonts-liberation \
    fonts-noto-cjk \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/* \
  && python3 -m pip install --no-cache-dir openpyxl

WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .

ENV PORT=3000
EXPOSE 3000
CMD ["npm", "start"]
