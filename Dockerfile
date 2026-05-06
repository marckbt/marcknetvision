# syntax=docker/dockerfile:1.6
#
# MarckNetVision Dashboard — RHEL 9 UBI Init container image
#
# Mirrors install-rhel.sh as closely as a container can: same RHEL 9 base,
# same /opt/marcknetvision layout, same service user, same systemd unit,
# same cronie-driven data refresh. Things that belong on the host (firewall,
# SELinux, Nginx, Let's Encrypt, SSH deploy keys for git pulling) are
# intentionally left out — point them at this container from outside.
#
# Build:
#   docker build -t marcknetvision:latest .
#
# Run (default — node runs as PID 1, container stays up indefinitely with -d):
#   docker run -d --name marcknetvision \
#       --restart unless-stopped \
#       -p 3000:3000 \
#       marcknetvision:latest
#
# Optional — run with full systemd inside (matches install-rhel.sh exactly,
# but requires cgroup access and writable /run + /tmp):
#   docker run -d --name marcknetvision \
#       --restart unless-stopped \
#       --tmpfs /run --tmpfs /tmp \
#       -v /sys/fs/cgroup:/sys/fs/cgroup:ro \
#       -p 3000:3000 \
#       marcknetvision:latest /usr/sbin/init
#

FROM registry.access.redhat.com/ubi9/ubi-init:latest

# ---------------------------------------------------------------------------
# Build-time configuration (override with --build-arg if needed)
# ---------------------------------------------------------------------------
ARG APP_NAME=marcknetvision
ARG APP_USER=marcknetvision
ARG APP_DIR=/opt/marcknetvision
ARG APP_PORT=3000
ARG NODE_MAJOR=20

ENV APP_NAME=${APP_NAME} \
    APP_DIR=${APP_DIR} \
    APP_PORT=${APP_PORT} \
    NODE_ENV=production \
    PORT=${APP_PORT}

# ---------------------------------------------------------------------------
# Step 1: Base packages + Node.js 20 (NodeSource RPM repo)
#   --allowerasing handles the curl vs curl-minimal conflict that bites
#   on UBI base images, identical to the fix in install-rhel.sh.
# ---------------------------------------------------------------------------
RUN set -eux; \
    dnf -y --allowerasing update; \
    dnf -y --allowerasing install \
        git tar gcc-c++ make policycoreutils-python-utils \
        openssh-clients cronie; \
    if ! command -v curl >/dev/null 2>&1; then \
        dnf -y --allowerasing install curl-minimal || dnf -y --allowerasing install curl; \
    fi; \
    curl -fsSL "https://rpm.nodesource.com/setup_${NODE_MAJOR}.x" | bash -; \
    dnf -y --allowerasing install nodejs; \
    node --version; \
    npm --version; \
    dnf clean all; \
    rm -rf /var/cache/dnf /var/cache/yum

# ---------------------------------------------------------------------------
# Step 2: Service user + application directory
# ---------------------------------------------------------------------------
RUN set -eux; \
    useradd --system --home "${APP_DIR}" --shell /bin/bash "${APP_USER}"; \
    mkdir -p "${APP_DIR}/public/data" "${APP_DIR}/scripts"; \
    chown -R "${APP_USER}:${APP_USER}" "${APP_DIR}"

WORKDIR ${APP_DIR}

# ---------------------------------------------------------------------------
# Step 3: Install npm dependencies
#   Copy manifests first so this layer caches across code-only changes.
# ---------------------------------------------------------------------------
COPY --chown=${APP_USER}:${APP_USER} package.json package-lock.json* ./
RUN runuser -u "${APP_USER}" -- bash -c "cd '${APP_DIR}' && (npm install --omit=dev || npm install)"

# ---------------------------------------------------------------------------
# Step 4: Copy the rest of the application source
#   .dockerignore should exclude node_modules, Archive/, *.gif, *.zip, etc.
# ---------------------------------------------------------------------------
COPY --chown=${APP_USER}:${APP_USER} . ${APP_DIR}/

# Make sure the data dir exists and is writable after the bulk COPY.
RUN install -d -o "${APP_USER}" -g "${APP_USER}" -m 755 "${APP_DIR}/public/data"

# ---------------------------------------------------------------------------
# Step 5: systemd unit (same as install-rhel.sh, minus ProtectHome which
#   doesn't make sense when the app's home IS the working directory)
# ---------------------------------------------------------------------------
COPY <<UNIT /etc/systemd/system/marcknetvision.service
[Unit]
Description=MarckNetVision Dashboard
After=network.target

[Service]
Type=simple
User=${APP_USER}
Group=${APP_USER}
WorkingDirectory=${APP_DIR}
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=10
Environment=PORT=${APP_PORT}
Environment=NODE_ENV=production

StandardOutput=journal
StandardError=journal
SyslogIdentifier=marcknetvision

# Hardening
NoNewPrivileges=yes
PrivateTmp=yes

[Install]
WantedBy=multi-user.target
UNIT

# ---------------------------------------------------------------------------
# Step 6: Cron jobs for periodic data refresh
#   (No nightly git-pull job here — containers are updated by rebuilding
#   the image, not by pulling code at runtime.)
# ---------------------------------------------------------------------------
RUN set -eux; \
    install -d -o "${APP_USER}" -g "${APP_USER}" /var/log; \
    touch "/var/log/${APP_NAME}-cron.log"; \
    chown "${APP_USER}:${APP_USER}" "/var/log/${APP_NAME}-cron.log"

COPY <<CRON /var/spool/cron/marcknetvision
# MarckNetVision scheduled data refresh (managed by Dockerfile)
*/30 * * * * cd ${APP_DIR} && /usr/bin/node -e "require('./weather-scraper').refreshWeather().then(()=>console.log('Weather refreshed')).catch(console.error)"  >> /var/log/${APP_NAME}-cron.log 2>&1
*/30 * * * * cd ${APP_DIR} && /usr/bin/node -e "require('./schedule-scraper').refreshSchedule().then(()=>console.log('Schedule refreshed')).catch(console.error)" >> /var/log/${APP_NAME}-cron.log 2>&1
CRON

RUN chown "${APP_USER}:${APP_USER}" "/var/spool/cron/${APP_USER}" \
 && chmod 600 "/var/spool/cron/${APP_USER}"

# ---------------------------------------------------------------------------
# Step 7: Generate initial weather + schedule data so the first request
#   the container serves isn't an empty page. Non-fatal if the network is
#   unavailable at build time; the cron jobs will catch up at runtime.
# ---------------------------------------------------------------------------
RUN runuser -u "${APP_USER}" -- bash -c "\
        cd '${APP_DIR}' && \
        node -e \"require('./weather-scraper').refreshWeather().then(()=>console.log('Weather ok')).catch(e=>{console.error(e.message);process.exit(0)})\" && \
        node -e \"require('./schedule-scraper').refreshSchedule().then(()=>console.log('Schedule ok')).catch(e=>{console.error(e.message);process.exit(0)})\" \
    " || echo "[build] initial data fetch skipped (no network) — cron will populate at runtime"

# ---------------------------------------------------------------------------
# Step 8: Enable services for the optional systemd-mode entrypoint
#   (used only if the container is started with `/usr/sbin/init`).
# ---------------------------------------------------------------------------
RUN systemctl enable marcknetvision.service crond.service

# ---------------------------------------------------------------------------
# Step 9: Default entrypoint script
#
#   Runs node in the FOREGROUND as PID-1's child — that's what keeps
#   `docker run -d` alive indefinitely. crond is launched in the background
#   so the every-30-min data refresh jobs still fire. When node exits
#   (e.g. on `docker stop` SIGTERM), the script exits and the container
#   stops cleanly; with `--restart unless-stopped` Docker brings it back.
# ---------------------------------------------------------------------------
COPY <<'ENTRYPOINT' /usr/local/bin/marcknetvision-entrypoint.sh
#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/marcknetvision}"
APP_USER="${APP_USER:-marcknetvision}"

# Forward SIGTERM/SIGINT to the node child so `docker stop` is graceful.
trap 'echo "[entrypoint] caught signal, stopping..."; kill -TERM "${NODE_PID:-0}" 2>/dev/null || true; wait "${NODE_PID:-0}" 2>/dev/null || true; exit 0' TERM INT

# Start cron in the background. -n keeps it in the foreground from cron's
# perspective (no double-fork), but `&` puts it behind us in the shell so
# we can hand control to node. It's reaped by this shell on exit.
echo "[entrypoint] starting crond..."
/usr/sbin/crond -n &
CROND_PID=$!

echo "[entrypoint] starting node server.js as ${APP_USER}..."
cd "${APP_DIR}"
runuser -u "${APP_USER}" -- /usr/bin/node server.js &
NODE_PID=$!

# Wait specifically on node — if the app dies, we exit (and Docker's
# restart policy decides what happens next). crond dying alone shouldn't
# bring the container down; we log it and keep going.
wait "${NODE_PID}"
NODE_EXIT=$?
echo "[entrypoint] node exited with status ${NODE_EXIT}"
kill -TERM "${CROND_PID}" 2>/dev/null || true
exit "${NODE_EXIT}"
ENTRYPOINT
RUN chmod 755 /usr/local/bin/marcknetvision-entrypoint.sh

EXPOSE ${APP_PORT}

# Ask Docker to verify the app is actually serving on $APP_PORT. If the
# healthcheck fails repeatedly, orchestrators (compose / swarm / k8s)
# will restart the container.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -fsS "http://127.0.0.1:${APP_PORT}/" >/dev/null || exit 1

# Default = foreground-node entrypoint (keeps the container running on
# any Docker host, no privileged flags required).
# Override with `/usr/sbin/init` at run time to use the systemd path.
STOPSIGNAL SIGTERM
CMD ["/usr/local/bin/marcknetvision-entrypoint.sh"]
