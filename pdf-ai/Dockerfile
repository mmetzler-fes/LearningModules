# PDF-Import mit KI-Erkennung (docling) für LearningModules – siehe README.md.
# Eigenes, großes Image (PyTorch und Modelle): Wer es nicht braucht, lässt den
# Container weg; Struktur-Import und „Seiten als Bilder“ macht der Renderer.
FROM python:3.12-slim

LABEL org.opencontainers.image.title="LearningModules pdf-ai" \
      org.opencontainers.image.source="https://github.com/mmetzler-fes/LearningModules" \
      org.opencontainers.image.licenses="AGPL-3.0-or-later"

# Tesseract für gescannte Seiten (OCR), libgl/glib für die Bildverarbeitung.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      tesseract-ocr tesseract-ocr-deu tesseract-ocr-eng libgl1 libglib2.0-0 \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV HOME=/app \
    HF_HOME=/app/models \
    PYTHONUNBUFFERED=1 \
    OMP_NUM_THREADS=4

# PyTorch nur für die CPU – ohne CUDA wird das Image einige GB kleiner.
COPY requirements.txt .
RUN pip install --no-cache-dir --extra-index-url https://download.pytorch.org/whl/cpu -r requirements.txt

COPY convert.py server.py ./
# Modelle beim Bauen holen – danach läuft der Dienst ohne Internet.
RUN python -c "import convert; convert.warm_up()"

ARG PDF_AI_VERSION=dev
ENV PDF_AI_VERSION=${PDF_AI_VERSION} \
    PDF_AI_PORT=8091

RUN useradd --system --no-create-home pdfai && chown -R pdfai /app
USER pdfai

EXPOSE 8091
HEALTHCHECK --interval=60s --timeout=5s --start-period=120s \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8091/health', timeout=4)"
CMD ["python", "server.py"]
