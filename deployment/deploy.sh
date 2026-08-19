#!/usr/bin/env bash
#
# Production deploy for BIMS.
#
# Usage (from the repo root):
#   export EMAIL_HOST="smtp.gmail.com"
#   export EMAIL_HOST_USER="..."
#   export EMAIL_HOST_PASSWORD="..."
#   export EMAIL_PORT="587"
#   export EMAIL_SUBJECT_PREFIX="[BIMS]"
#   sudo -E bash deployment/deploy.sh
#
# NOTE the "-E" on sudo: plain "sudo" starts root with a clean environment,
# so the EMAIL_* vars exported above would NOT reach docker-compose and the
# containers would come up with blank email settings. "-E" carries them
# through.

set -euo pipefail

if [[ $EUID -ne 0 ]]; then
    echo "This script changes files under /var/lib/docker and must be run as root, e.g.:" >&2
    echo "  sudo -E bash deployment/deploy.sh" >&2
    exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="${SCRIPT_DIR}/docker-compose.yml"

if [[ -z "${EMAIL_HOST:-}" ]]; then
    echo "WARNING: EMAIL_HOST is empty in this shell's environment."
    echo "         If you exported EMAIL_* vars before running this with plain"
    echo "         'sudo', re-run with 'sudo -E' instead, or the containers"
    echo "         will start with blank email settings."
fi

# uwsgi, worker, geocontextworker and searchworker all run from the same
# built image (see the default-common-django anchor in docker-compose.yml),
# so all four need to be recreated after a rebuild - not uwsgi alone -
# otherwise the workers silently keep running on the old image/config.
APP_CONTAINERS=(bims_prod_uwsgi bims_prod_worker bims_prod_geocontextworker bims_prod_searchworker)
APP_SERVICES=(uwsgi worker geocontextworker searchworker)

echo "==> Stopping app containers"
for container in "${APP_CONTAINERS[@]}"; do
    docker stop "${container}" 2>/dev/null || true
done

echo "==> Building image (no cache)"
docker-compose -f "${COMPOSE_FILE}" build --no-cache uwsgi

echo "==> Recreating app containers"
docker-compose -f "${COMPOSE_FILE}" up -d "${APP_SERVICES[@]}"

echo "==> Fixing permissions"
chown -R www-data:www-data /var/lib/docker/volumes/deployment_media-data/_data/
chmod -R 755 /var/lib/docker/volumes/deployment_static-data/_data/
chmod o+x /var/lib/docker
chmod o+x /var/lib/docker/volumes

echo "==> Cleaning up unused docker resources"
docker container prune -f
docker image prune -a -f
docker volume prune -f
docker network prune -f
docker builder prune -a -f
docker system prune -a --volumes -f

echo "==> Deploy finished"
