FROM python:3.10-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg libsndfile1 git && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY audio/requirements.txt /app/audio/requirements.txt
RUN pip install --no-cache-dir -r /app/audio/requirements.txt

COPY common/ /app/common/
COPY audio/ /app/audio/

RUN mkdir -p /app/weights /app/repos

EXPOSE 8003

CMD ["python", "-m", "uvicorn", "audio.app:app", "--host", "0.0.0.0", "--port", "8003"]
