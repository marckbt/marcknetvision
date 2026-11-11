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
# Run — plain HTTP, node directly on 3000 (no TLS):
#   docker run -d --name marcknetvision \
#       --restart unless-stopped \
#       -p 3000:3000 \
#       -v marcknetvision-data:/var/lib/marcknetvision \
#       marcknetvision:latest
#   Passwords and session cookies cross the network unencrypted in this
#   mode (the login page warns about it). Use it on a trusted network only.
#
# Run — with Nginx + Let's Encrypt TLS in front of node:
#   The container needs to be reachable from the public internet on port 80
#   so the HTTP-01 ACME challenge can complete. Mount /etc/letsencrypt to a
#   host volume so issued certs survive container rebuilds.
#
#   docker run -d --name marcknetvision \
#       --restart unless-stopped \
#       -e TLS_DOMAIN=dashboard.example.com \
#       -e TLS_EMAIL=you@example.com \
#       -p 80:80 -p 443:443 \
#       -v marcknetvision-letsencrypt:/etc/letsencrypt \
#       -v marcknetvision-data:/var/lib/marcknetvision \
#       marcknetvision:latest
#   Don't publish port 3000 here: with TLS_DOMAIN set, node listens on
#   127.0.0.1 only, so all traffic goes through HTTPS.
#
# Optional — run with full systemd inside (matches install-rhel.sh exactly,
# but requires cgroup access and writable /run + /tmp):
#   docker run -d --name marcknetvision \
#       --restart unless-stopped \
#       --tmpfs /run --tmpfs /tmp \
#       -v /sys/fs/cgroup:/sys/fs/cgroup:ro \
#       -p 80:80 -p 443:443 -p 3000:3000 \
#       -v marcknetvision-data:/var/lib/marcknetvision \
#       marcknetvision:latest /usr/sbin/init
#
# Logins: users and sessions live in the marcknetvision-data volume, not in
# the image or git, so they survive rebuilds. Back that volume up: it is the
# only copy. Always pass the same named volume; without -v, Docker creates a
# new anonymous one and the container starts with only the admin account.
#
# A new (empty) volume always gets the built-in admin, admin@marcknet.net:
#   - password from ADMIN_INITIAL_PASSWORD if set (pass it once with -e, or
#     with --env-file, and drop it afterwards), otherwise
#   - hash from config/admin-seed.json, which is copied into the image when
#     building from a checkout that has it. It is gitignored, so a fresh git
#     clone won't: create it with `node scripts/auth-tool.js seed` first or
#     use ADMIN_INITIAL_PASSWORD. Keep such an image in a private registry.
# With neither, the container runs but nobody can log in. The admin must
# choose a new password at first login.
#
# Locked out? Set a password, then restart:
#   docker exec -it -u marcknetvision marcknetvision \
#       node scripts/auth-tool.js reset admin@marcknet.net
#   docker restart marcknetvision
#
# Environment variables (logins):
#   ADMIN_INITIAL_PASSWORD — see above. Ignored once the admin exists.
#   SESSION_IDLE_HOURS — log out after this many hours with no activity.
#                 Default 24. An open dashboard tab counts as activity.
#
# Environment variables (TLS):
#   TLS_DOMAIN  — public hostname to issue a cert for. Unset = HTTP only.
#   TLS_EMAIL   — contact for Let's Encrypt account. Unset = registered
#                 with --register-unsafely-without-email.
#   TLS_STAGING — set to "1" to use Let's Encrypt's staging environment
#                 (useful for testing without burning rate limits).
#   TLS_RENEW_DAYS — on startup, renew the existing certificate if it expires
#                 within this many days. Default 7. (The root crontab also
#                 renews twice a day; this covers a container that boots
#                 after being stopped past the normal renewal window.)
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
# Optional explicit cache-busting id for static assets (app.js/style.css).
# Leave empty to let the server derive one from the files' mtimes at boot
# (which already changes on every rebuild). Pass a git SHA for determinism:
#   docker build --build-arg BUILD_ID=$(git rev-parse --short HEAD) .
ARG BUILD_ID=""

ENV APP_NAME=${APP_NAME} \
    APP_DIR=${APP_DIR} \
    APP_PORT=${APP_PORT} \
    NODE_ENV=production \
    PORT=${APP_PORT} \
    MNV_DATA_DIR=/var/lib/${APP_NAME} \
    BUILD_ID=${BUILD_ID}

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
    # EPEL provides certbot + python3-certbot-nginx on UBI 9.
    dnf -y install https://dl.fedoraproject.org/pub/epel/epel-release-latest-9.noarch.rpm; \
    dnf -y --allowerasing install nginx certbot python3-certbot-nginx openssl; \
    curl -fsSL "https://rpm.nodesource.com/setup_${NODE_MAJOR}.x" | bash -; \
    dnf -y --allowerasing install nodejs; \
    node --version; \
    npm --version; \
    nginx -v; \
    certbot --version; \
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

# Users and sessions (see "Logins" above). Created before VOLUME so a new
# volume inherits this owner and mode.
RUN install -d -o "${APP_USER}" -g "${APP_USER}" -m 700 "${MNV_DATA_DIR}"
VOLUME ["${MNV_DATA_DIR}"]

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
Environment=MNV_DATA_DIR=${MNV_DATA_DIR}
Environment=BUILD_ID=${BUILD_ID}

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
0 * * * * cd ${APP_DIR} && /usr/bin/node -e "require('./world-weather-scraper').refreshWorldWeather().then(()=>console.log('World weather refreshed')).catch(console.error)" >> /var/log/${APP_NAME}-cron.log 2>&1
CRON

RUN chown "${APP_USER}:${APP_USER}" "/var/spool/cron/${APP_USER}" \
 && chmod 600 "/var/spool/cron/${APP_USER}"

# Root crontab — Let's Encrypt renewal, twice a day. certbot is a no-op
# until the cert is within 30 days of expiry, so this is cheap. The
# deploy-hook reloads nginx in-place so renewals are zero-downtime.
COPY <<ROOTCRON /var/spool/cron/root
# MarckNetVision Let's Encrypt renewal (managed by Dockerfile)
17 3,15 * * * /usr/bin/certbot renew --quiet --deploy-hook "/usr/sbin/nginx -s reload" >> /var/log/letsencrypt-renew.log 2>&1
ROOTCRON
RUN chmod 600 /var/spool/cron/root \
 && touch /var/log/letsencrypt-renew.log

# ---------------------------------------------------------------------------
# Step 6b: Nginx reverse-proxy config
#
#   The HTTP server block is always active. It serves the ACME challenge
#   under /.well-known/acme-challenge/ and proxies everything else to node
#   on $APP_PORT. Once certbot has issued a cert, the --nginx plugin will
#   add a 443 server block in-place and add a redirect on this one.
#
#   Server name is the literal string SERVER_NAME_PLACEHOLDER at build time;
#   the entrypoint substitutes it with $TLS_DOMAIN at run time, or "_"
#   (catch-all) when no domain is configured.
# ---------------------------------------------------------------------------
RUN install -d -m 755 /var/www/certbot /etc/letsencrypt \
 && rm -f /etc/nginx/conf.d/default.conf

COPY <<NGINXCONF /etc/nginx/conf.d/marcknetvision.conf
server {
    listen 80 default_server;
    server_name SERVER_NAME_PLACEHOLDER;

    # ACME HTTP-01 challenge files are written here by certbot --nginx;
    # we keep an explicit alias so the --webroot fallback also works.
    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
        default_type "text/plain";
    }

    location / {
        proxy_pass http://127.0.0.1:${APP_PORT};
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
    }
}
NGINXCONF

# Persist Let's Encrypt material across container rebuilds.
VOLUME ["/etc/letsencrypt"]

# ---------------------------------------------------------------------------
# Step 7: Generate initial weather + schedule + world-weather data so the
#   first request the container serves isn't an empty page. Non-fatal if the
#   network is unavailable at build time; the cron jobs will catch up at
#   runtime.
# ---------------------------------------------------------------------------
RUN runuser -u "${APP_USER}" -- bash -c "\
        cd '${APP_DIR}' && \
        node -e \"require('./weather-scraper').refreshWeather().then(()=>console.log('Weather ok')).catch(e=>{console.error(e.message);process.exit(0)})\" && \
        node -e \"require('./schedule-scraper').refreshSchedule().then(()=>console.log('Schedule ok')).catch(e=>{console.error(e.message);process.exit(0)})\" && \
        node -e \"require('./world-weather-scraper').refreshWorldWeather().then(()=>console.log('World weather ok')).catch(e=>{console.error(e.message);process.exit(0)})\" && \
        node -e \"require('./stocks-scraper').refreshStocks().then(()=>console.log('Stocks ok')).catch(e=>{console.error(e.message);process.exit(0)})\" \
    " || echo "[build] initial data fetch skipped (no network) — cron/interval will populate at runtime"

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
APP_PORT="${APP_PORT:-3000}"
TLS_DOMAIN="${TLS_DOMAIN:-}"
TLS_EMAIL="${TLS_EMAIL:-}"
TLS_STAGING="${TLS_STAGING:-0}"

NGINX_CONF=/etc/nginx/conf.d/marcknetvision.conf
NODE_PID=0
CROND_PID=0
NGINX_PID=0

shutdown() {
  echo "[entrypoint] caught signal, stopping children..."
  [[ "${NODE_PID}"  -gt 0 ]] && kill -TERM "${NODE_PID}"  2>/dev/null || true
  [[ "${NGINX_PID}" -gt 0 ]] && kill -QUIT "${NGINX_PID}" 2>/dev/null || true
  [[ "${CROND_PID}" -gt 0 ]] && kill -TERM "${CROND_PID}" 2>/dev/null || true
  wait 2>/dev/null || true
  exit 0
}
trap shutdown TERM INT

# --- Normalise TLS_DOMAIN --------------------------------------------------
# Strip surrounding whitespace, CR (from CRLF env files), a leading
# scheme like https:// (a common copy-paste mistake), and any trailing
# path. Domain names can only contain letters, digits, hyphens, and dots,
# so anything outside that set is dropped.
if [[ -n "${TLS_DOMAIN}" ]]; then
  RAW_DOMAIN="${TLS_DOMAIN}"
  TLS_DOMAIN="${TLS_DOMAIN#http://}"
  TLS_DOMAIN="${TLS_DOMAIN#https://}"
  TLS_DOMAIN="${TLS_DOMAIN%%/*}"
  TLS_DOMAIN="$(printf '%s' "${TLS_DOMAIN}" | tr -d '[:space:]\r')"
  if [[ "${RAW_DOMAIN}" != "${TLS_DOMAIN}" ]]; then
    echo "[entrypoint] cleaned TLS_DOMAIN '${RAW_DOMAIN}' -> '${TLS_DOMAIN}'"
  fi
  if ! [[ "${TLS_DOMAIN}" =~ ^[A-Za-z0-9.-]+$ ]]; then
    echo "[entrypoint] ERROR: TLS_DOMAIN '${TLS_DOMAIN}' is not a valid hostname."
    echo "[entrypoint] Pass just the hostname (e.g. dashboard.example.com),"
    echo "[entrypoint] not a URL. Continuing on HTTP."
    TLS_DOMAIN=""
  fi
fi

# --- Nginx config: substitute SERVER_NAME_PLACEHOLDER ----------------------
# Use '|' as the sed delimiter so a stray '/' in the value (the most
# common cause of "sed: unknown option to s") can't break parsing.
if [[ -n "${TLS_DOMAIN}" ]]; then
  echo "[entrypoint] configuring nginx for domain '${TLS_DOMAIN}'"
  sed -i "s|SERVER_NAME_PLACEHOLDER|${TLS_DOMAIN}|" "${NGINX_CONF}"
else
  echo "[entrypoint] no TLS_DOMAIN set — nginx will serve HTTP for any host"
  sed -i "s|SERVER_NAME_PLACEHOLDER|_|" "${NGINX_CONF}"
fi

# Validate the config before we try to start nginx.
nginx -t

# --- Start crond (background) ----------------------------------------------
echo "[entrypoint] starting crond..."
/usr/sbin/crond -n &
CROND_PID=$!

# --- Login data volume -----------------------------------------------------
# A host-path mount can arrive owned by root; node runs as the app user.
MNV_DATA_DIR="${MNV_DATA_DIR:-/var/lib/marcknetvision}"
install -d -m 700 "${MNV_DATA_DIR}"
chown -R "${APP_USER}:${APP_USER}" "${MNV_DATA_DIR}"

# --- Start node (background) -----------------------------------------------
echo "[entrypoint] starting node server.js on port ${APP_PORT} as ${APP_USER}..."
cd "${APP_DIR}"
runuser -u "${APP_USER}" -- /usr/bin/node server.js &
NODE_PID=$!

# Give node a moment to bind so nginx's first proxy_pass succeeds.
for _ in $(seq 1 20); do
  if (exec 3<>/dev/tcp/127.0.0.1/"${APP_PORT}") 2>/dev/null; then
    exec 3<&- 3>&-
    break
  fi
  sleep 0.5
done

# --- Start nginx (background) ----------------------------------------------
echo "[entrypoint] starting nginx..."
/usr/sbin/nginx
# nginx daemonizes by default; capture the master pid for signaling.
NGINX_PID=$(cat /run/nginx.pid 2>/dev/null || pidof nginx | awk '{print $NF}')

# --- TLS provisioning (optional) -------------------------------------------
# Only attempt if a domain is configured. Skip if a live cert already
# exists in the mounted /etc/letsencrypt volume.
if [[ -n "${TLS_DOMAIN}" ]]; then
  CERT_LIVE="/etc/letsencrypt/live/${TLS_DOMAIN}/fullchain.pem"
  if [[ ! -s "${CERT_LIVE}" ]]; then
    echo "[entrypoint] requesting Let's Encrypt cert for ${TLS_DOMAIN}..."

    CERTBOT_ARGS=(
      --nginx
      -d "${TLS_DOMAIN}"
      --cert-name "${TLS_DOMAIN}"
      --non-interactive
      --agree-tos
      --redirect
      --keep-until-expiring
    )
    if [[ -n "${TLS_EMAIL}" ]]; then
      CERTBOT_ARGS+=( -m "${TLS_EMAIL}" )
    else
      CERTBOT_ARGS+=( --register-unsafely-without-email )
    fi
    if [[ "${TLS_STAGING}" == "1" ]]; then
      echo "[entrypoint] using Let's Encrypt STAGING (test certs, not trusted)"
      CERTBOT_ARGS+=( --staging )
    fi

    if /usr/bin/certbot "${CERTBOT_ARGS[@]}"; then
      echo "[entrypoint] certificate issued and nginx reconfigured for HTTPS."
    else
      echo "[entrypoint] WARNING: certbot failed. Continuing on HTTP."
      echo "[entrypoint] Common causes: port 80 not reachable from the public"
      echo "[entrypoint] internet, DNS for ${TLS_DOMAIN} not pointing here, or"
      echo "[entrypoint] LE rate limit hit. Re-run after fixing; certs persist"
      echo "[entrypoint] in the /etc/letsencrypt volume."
    fi
  else
    echo "[entrypoint] existing Let's Encrypt cert found for ${TLS_DOMAIN}."

    # --- Renew on startup if the cert expires soon -------------------------
    # The root crontab renews twice a day, but a container that has been
    # stopped for a while can boot with a cert that is nearly (or already)
    # expired and would serve it until the next cron tick. Check the expiry
    # up front and renew immediately when it is inside the threshold.
    #
    # `openssl x509 -checkend N` exits non-zero when the cert WILL expire
    # within N seconds. certbot's own renewal window is 30 days, so a cert
    # inside our (smaller) threshold is always eligible — no --force-renewal
    # needed, which keeps us clear of Let's Encrypt rate limits.
    RENEW_DAYS="${TLS_RENEW_DAYS:-7}"
    RENEW_SECS=$(( RENEW_DAYS * 86400 ))

    CERT_END="$(openssl x509 -enddate -noout -in "${CERT_LIVE}" 2>/dev/null | cut -d= -f2)"
    if [[ -n "${CERT_END}" ]]; then
      CERT_END_EPOCH="$(date -d "${CERT_END}" +%s 2>/dev/null || echo 0)"
      NOW_EPOCH="$(date +%s)"
      if [[ "${CERT_END_EPOCH}" -gt 0 ]]; then
        DAYS_LEFT=$(( (CERT_END_EPOCH - NOW_EPOCH) / 86400 ))
        echo "[entrypoint] certificate expires ${CERT_END} (${DAYS_LEFT} day(s) left)"
      fi
    fi

    if openssl x509 -checkend "${RENEW_SECS}" -noout -in "${CERT_LIVE}" >/dev/null 2>&1; then
      echo "[entrypoint] more than ${RENEW_DAYS} day(s) remaining — no renewal needed."
    else
      echo "[entrypoint] certificate expires within ${RENEW_DAYS} day(s) — renewing now..."
      RENEW_ARGS=( renew --cert-name "${TLS_DOMAIN}" --non-interactive
                   --deploy-hook "/usr/sbin/nginx -s reload" )
      if [[ "${TLS_STAGING}" == "1" ]]; then
        RENEW_ARGS+=( --staging )
      fi
      if /usr/bin/certbot "${RENEW_ARGS[@]}"; then
        echo "[entrypoint] renewal check complete."
      else
        echo "[entrypoint] WARNING: renewal failed — continuing with the existing"
        echo "[entrypoint] certificate. Common causes: port 80 unreachable from the"
        echo "[entrypoint] public internet, DNS not pointing here, or an LE rate"
        echo "[entrypoint] limit. The twice-daily cron job will retry."
      fi
    fi

    # The cert is on disk but the running nginx config doesn't reference it
    # yet. Have certbot re-install (no new request, no rate-limit cost).
    #
    # NOTE: `certbot install` selects the cert by lineage name (--cert-name),
    # NOT by domain. Passing -d here makes certbot prompt with
    #   "Which certificate would you like to install?"
    # which fails under --non-interactive. Use --cert-name instead.
    echo "[entrypoint] configuring nginx for HTTPS..."
    /usr/bin/certbot install --nginx \
      --cert-name "${TLS_DOMAIN}" \
      --non-interactive --redirect \
      || echo "[entrypoint] WARNING: certbot install failed; serving HTTP only."
  fi
fi

# --- Block on node ---------------------------------------------------------
# Node is the app — if it dies, the container should exit so Docker can
# restart it. crond and nginx are infrastructure; we don't tie container
# lifecycle to them.
wait "${NODE_PID}"
NODE_EXIT=$?
echo "[entrypoint] node exited with status ${NODE_EXIT}"
[[ "${NGINX_PID}" -gt 0 ]] && kill -QUIT "${NGINX_PID}" 2>/dev/null || true
[[ "${CROND_PID}" -gt 0 ]] && kill -TERM "${CROND_PID}" 2>/dev/null || true
exit "${NODE_EXIT}"
ENTRYPOINT
RUN chmod 755 /usr/local/bin/marcknetvision-entrypoint.sh

EXPOSE 80 443 ${APP_PORT}

# Ask Docker to verify the app is actually serving. We hit nginx on :80
# (the proxied path) — that exercises both the reverse proxy and node in
# one probe. If nginx redirected :80 → :443 (post-cert), -L follows it.
# /healthz is the one app route that doesn't need a login.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD curl -fsSL -o /dev/null "http://127.0.0.1/healthz" \
        || curl -fsS -o /dev/null "http://127.0.0.1:${APP_PORT}/healthz" \
        || exit 1

# Default = foreground-node entrypoint (keeps the container running on
# any Docker host, no privileged flags required).
# Override with `/usr/sbin/init` at run time to use the systemd path.
STOPSIGNAL SIGTERM
CMD ["/usr/local/bin/marcknetvision-entrypoint.sh"]
