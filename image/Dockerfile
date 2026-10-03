FROM python:3.10-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1-mesa-glx libglib2.0-0 git && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY image/requirements.txt /app/image/requirements.txt
RUN pip install --no-cache-dir -r /app/image/requirements.txt

COPY common/ /app/common/
COPY image/ /app/image/

RUN mkdir -p /app/weights /app/repos

EXPOSE 8001

CMD ["python", "-m", "uvicorn", "image.app:app", "--host", "0.0.0.0", "--port", "8001"]
