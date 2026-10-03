FROM python:3.10-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1-mesa-glx libglib2.0-0 ffmpeg cmake build-essential git && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY video/requirements.txt /app/video/requirements.txt
RUN pip install --no-cache-dir -r /app/video/requirements.txt

COPY common/ /app/common/
COPY video/ /app/video/

RUN mkdir -p /app/weights /app/repos

EXPOSE 8002

CMD ["python", "-m", "uvicorn", "video.app:app", "--host", "0.0.0.0", "--port", "8002"]
