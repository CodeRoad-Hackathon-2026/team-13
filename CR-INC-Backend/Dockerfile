FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /srv

# psql is what db/migrate.sh drives; the migration runner is a shell script on
# purpose, so the image that applies migrations needs a client. git and ssh are
# what the Change Delivery Agent drives, for the same reason.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        postgresql-client ca-certificates git openssh-client \
    && rm -rf /var/lib/apt/lists/*

# GitHub's published host keys, checked in rather than scanned at build time:
# ssh-keyscan trusts whatever DNS answers during the build, while a file in git
# is reviewable. Refresh it when GitHub rotates a key.
COPY deploy/github_known_hosts /etc/ssh/ssh_known_hosts

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8001

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001"]
