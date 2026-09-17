FROM node:20-bookworm-slim

# Solo los componentes de LibreOffice que necesitamos hoy (Writer para
# doc/docx/odt/rtf, Impress para ppt/pptx) — más chico y estable que el
# metapaquete completo. Cuando se active xlsx, agregar libreoffice-calc acá.
RUN apt-get update && apt-get install -y --no-install-recommends \
      libreoffice-writer \
      libreoffice-impress \
      libreoffice-core \
      libreoffice-common \
      fonts-dejavu \
      fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
COPY server.js ./

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

# No root — el proceso de conversión solo necesita escribir en /tmp.
RUN useradd --create-home --shell /usr/sbin/nologin converter \
    && chown -R converter:converter /app
USER converter

CMD ["node", "server.js"]
