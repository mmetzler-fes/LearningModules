# Renderer für Arbeitsblätter: Spec → .odt/.pdf (siehe README.md).
# Eigenes Image neben learningmodules-server, damit LibreOffice nur dort steckt,
# wo Arbeitsblätter gebraucht werden.
FROM python:3.12-slim

LABEL org.opencontainers.image.title="LearningModules worksheet-renderer" \
      org.opencontainers.image.source="https://github.com/mmetzler-fes/LearningModules" \
      org.opencontainers.image.licenses="AGPL-3.0-or-later"

# Writer für die PDF-Umwandlung, Math für die Formelobjekte (StarMath),
# Draw und python3-uno, um Zeichnungen aus .odt als SVG zu exportieren.
# Liberation ist metrisch gleich zu Arial/Courier New – darauf rechnet der
# Generator die Tabellenbreiten.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      libreoffice-writer-nogui libreoffice-math-nogui libreoffice-draw-nogui python3-uno \
      fonts-liberation fonts-dejavu-core \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY tools/ tools/
COPY templates/ templates/
COPY server.py .

ARG RENDERER_VERSION=dev
ENV RENDERER_VERSION=${RENDERER_VERSION} \
    RENDERER_PORT=8090 \
    RENDERER_PROFILE_DIR=/tmp/profiles \
    HOME=/tmp \
    PYTHONUNBUFFERED=1

RUN useradd --system --no-create-home renderer
USER renderer

EXPOSE 8090
HEALTHCHECK --interval=60s --timeout=5s \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8090/health', timeout=4)"
CMD ["python", "server.py"]
