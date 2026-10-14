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
    fonts-droid-fallback \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/* \
  && python3 -m pip install --no-cache-dir --break-system-packages openpyxl pypdf pymupdf
# pymupdf：PDF 字型優化（移除 PDF 用不到的 name/hinting/glyf 指令）與頁面渲染，見 scripts/sli-eli-font-optimize.py
# fonts-noto-cjk / fonts-droid-fallback：疊字引擎的 CJK 字型（fontkit 按需子集內嵌，見 scripts/pdf-cjk-font.js）。
#   Noto CJK 是 .ttc 集合；DroidSansFallbackFull.ttf 是 standalone TTF，作為 fontkit 解析失敗時的保險。
#   可用 SLI_ELI_CJK_FONT=/path/to/font.ttf 覆寫；PDF_CJK=off 可完全停用（含 CJK 的記錄退回 Excel）。

WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .

ENV PORT=3000
EXPOSE 3000
CMD ["npm", "start"]
