FROM python:3.10-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    exiftool ffmpeg && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY metadata/requirements.txt /app/metadata/requirements.txt
RUN pip install --no-cache-dir -r /app/metadata/requirements.txt

COPY common/ /app/common/
COPY metadata/ /app/metadata/

EXPOSE 8004

CMD ["python", "-m", "uvicorn", "metadata.app:app", "--host", "0.0.0.0", "--port", "8004"]
