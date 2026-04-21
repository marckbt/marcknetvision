#!/usr/bin/env bash
#
# MarckNetVision Dashboard — Red Hat / RHEL / CentOS / Rocky / Alma install script
#
# Uses an SSH Deploy Key for authenticating with GitHub (read-only).
# The script generates an ed25519 key pair owned by the service user,
# prints the public key, and pauses so you can add it at:
#   https://github.com/marckbt/marcknetvision/settings/keys
#
# Usage:
#   sudo bash install-rhel.sh [domain-name]
#
# Example:
#   sudo bash install-rhel.sh dashboard.example.com
#
# Tested on: RHEL 9, Rocky Linux 9, AlmaLinux 9, CentOS Stream 9
#

set -euo pipefail

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
APP_NAME="marcknetvision"
APP_DIR="/opt/${APP_NAME}"
APP_USER="${APP_NAME}"
APP_PORT="${APP_PORT:-3000}"
REPO_SSH_URL="git@github.com:marckbt/marcknetvision.git"
REPO_SETTINGS_URL="https://github.com/marckbt/marcknetvision/settings/keys"
NODE_MAJOR="20"
DOMAIN="${1:-}"   # optional first argument: domain name for Nginx

SSH_DIR="${APP_DIR}/.ssh"
SSH_KEY="${SSH_DIR}/id_ed25519"
SSH_KEY_PUB="${SSH_KEY}.pub"
SSH_CONFIG="${SSH_DIR}/config"
SSH_KNOWN_HOSTS="${SSH_DIR}/known_hosts"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
log()  { printf '\033[1;36m[install]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[warn]\033[0m %s\n' "$*" >&2; }
err()  { printf '\033[1;31m[error]\033[0m %s\n' "$*" >&2; }

require_root() {
  if [[ $EUID -ne 0 ]]; then
    err "This script must be run as root (use sudo)."
    exit 1
  fi
}

detect_pm() {
  if command -v dnf >/dev/null 2>&1; then
    PM="dnf"
  elif command -v yum >/dev/null 2>&1; then
    PM="yum"
  else
    err "Neither dnf nor yum is available. Is this really a Red Hat family system?"
    exit 1
  fi
  log "Using package manager: $PM"
}

# Run a command as the application service user with a login-ish env.
as_app_user() {
  sudo -u "$APP_USER" -H bash -c "$*"
}

# ---------------------------------------------------------------------------
# Steps
# ---------------------------------------------------------------------------
require_root
detect_pm

log "Updating system packages..."
$PM -y update

log "Installing base packages (git, curl, openssh-clients, tools)..."
$PM -y install git curl tar gcc-c++ make policycoreutils-python-utils openssh-clients

# -------------------- Step 1: Node.js -------------------------------------
if ! command -v node >/dev/null 2>&1 || ! node --version | grep -q "^v${NODE_MAJOR}\."; then
  log "Installing Node.js ${NODE_MAJOR}.x from NodeSource..."
  curl -fsSL "https://rpm.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  $PM -y install nodejs
else
  log "Node.js $(node --version) already installed."
fi
log "Node: $(node --version)   npm: $(npm --version)"

# -------------------- Step 2: App user ------------------------------------
# Create the service user with $APP_DIR as its home so the ~/.ssh
# directory naturally lives alongside the app.
if ! id -u "$APP_USER" >/dev/null 2>&1; then
  log "Creating service user '$APP_USER'..."
  useradd --system --home "$APP_DIR" --shell /bin/bash "$APP_USER"
else
  log "User '$APP_USER' already exists."
fi

# Make sure APP_DIR exists and is owned by the app user before we create
# SSH artifacts inside it.
mkdir -p "$APP_DIR"
chown "$APP_USER:$APP_USER" "$APP_DIR"
chmod 755 "$APP_DIR"

# -------------------- Step 3: SSH Deploy Key ------------------------------
log "Setting up SSH deploy key for GitHub in ${SSH_DIR}..."

# .ssh directory, owned by the app user, mode 700
install -d -m 700 -o "$APP_USER" -g "$APP_USER" "$SSH_DIR"

# Generate the key pair (ed25519) if it doesn't already exist.
if [[ ! -f "$SSH_KEY" ]]; then
  log "Generating ed25519 SSH key pair..."
  as_app_user "ssh-keygen -t ed25519 -N '' -f '$SSH_KEY' -C '${APP_NAME}-deploy@$(hostname)'"
else
  log "SSH key already exists at $SSH_KEY — reusing it."
fi

# Pre-populate known_hosts for github.com so the first git clone doesn't
# prompt for host key confirmation.
log "Adding github.com host keys to known_hosts..."
ssh-keyscan -t rsa,ecdsa,ed25519 github.com 2>/dev/null >>"$SSH_KNOWN_HOSTS"
# Deduplicate in case the script is re-run.
sort -u "$SSH_KNOWN_HOSTS" -o "$SSH_KNOWN_HOSTS"

# Per-user SSH config pinning the identity used for github.com.
cat >"$SSH_CONFIG" <<EOF
Host github.com
    HostName github.com
    User git
    IdentityFile ${SSH_KEY}
    IdentitiesOnly yes
    UserKnownHostsFile ${SSH_KNOWN_HOSTS}
    StrictHostKeyChecking yes
EOF

# Correct ownership and permissions on everything under .ssh
chown -R "$APP_USER:$APP_USER" "$SSH_DIR"
chmod 700 "$SSH_DIR"
chmod 600 "$SSH_KEY"
chmod 644 "$SSH_KEY_PUB" "$SSH_KNOWN_HOSTS" "$SSH_CONFIG"

# Show the public key and pause until the user has added it as a deploy key.
echo
echo "============================================================"
echo "  ADD THIS PUBLIC KEY AS A DEPLOY KEY ON GITHUB"
echo "  URL:  ${REPO_SETTINGS_URL}"
echo "  Name: ${APP_NAME}-$(hostname)"
echo "  Allow write access: NO (read-only is sufficient)"
echo "============================================================"
echo
cat "$SSH_KEY_PUB"
echo
echo "============================================================"
# Only prompt if running on a TTY; otherwise skip so automated runs
# (packer/ansible/etc.) don't hang.
if [[ -t 0 ]]; then
  read -r -p "Press ENTER once the deploy key has been added to GitHub... " _
else
  warn "Non-interactive shell detected — not pausing."
  warn "Make sure the key above has been registered at ${REPO_SETTINGS_URL} before the next step."
fi

# Verify SSH authentication with GitHub. A successful deploy-key auth
# returns exit code 1 with a message like:
#   "Hi marckbt/marcknetvision! You've successfully authenticated..."
log "Testing SSH connection to github.com..."
SSH_TEST_OUT="$(as_app_user "ssh -o BatchMode=yes -T git@github.com" 2>&1 || true)"
echo "$SSH_TEST_OUT"
if ! echo "$SSH_TEST_OUT" | grep -qi "successfully authenticated"; then
  err "GitHub SSH authentication failed. Add the public key above to:"
  err "  ${REPO_SETTINGS_URL}"
  err "Then re-run this script."
  exit 1
fi
log "GitHub SSH authentication succeeded."

# -------------------- Step 4: Clone repo ----------------------------------
if [[ -d "$APP_DIR/.git" ]]; then
  log "Repo already present at $APP_DIR — pulling latest..."
  as_app_user "cd '$APP_DIR' && git pull --ff-only origin main" || warn "git pull failed; continuing."
else
  log "Cloning $REPO_SSH_URL into $APP_DIR..."
  # APP_DIR already exists (we created it above). Clone into a temp dir
  # as the app user, then move contents in, so ownership is correct and
  # we don't clobber the .ssh directory we just set up.
  TMP_CLONE="$(mktemp -d)"
  chown "$APP_USER:$APP_USER" "$TMP_CLONE"
  as_app_user "git clone '$REPO_SSH_URL' '$TMP_CLONE/repo'"
  # Move repo contents into APP_DIR, preserving .ssh
  shopt -s dotglob
  mv "$TMP_CLONE/repo/"* "$APP_DIR/"
  shopt -u dotglob
  rm -rf "$TMP_CLONE"
  chown -R "$APP_USER:$APP_USER" "$APP_DIR"
fi

# -------------------- Step 5: Dependencies --------------------------------
log "Installing npm dependencies..."
as_app_user "cd '$APP_DIR' && npm install --omit=dev || npm install"

# -------------------- Step 6: Data dir & initial data generation ----------
log "Creating data directory and generating initial data..."
as_app_user "mkdir -p '$APP_DIR/public/data'"

# Generate weather and schedule data (non-fatal if they fail — cron will retry)
as_app_user "cd '$APP_DIR' && node -e \"require('./weather-scraper').refreshWeather().then(()=>console.log('Weather ok')).catch(e=>{console.error(e.message);process.exit(0)})\"" \
  || warn "Initial weather fetch failed (continuing)"
as_app_user "cd '$APP_DIR' && node -e \"require('./schedule-scraper').refreshSchedule().then(()=>console.log('Schedule ok')).catch(e=>{console.error(e.message);process.exit(0)})\"" \
  || warn "Initial schedule fetch failed (continuing)"

chown -R "$APP_USER:$APP_USER" "$APP_DIR"

# -------------------- Step 7: systemd service -----------------------------
log "Writing systemd unit /etc/systemd/system/${APP_NAME}.service..."
NODE_BIN="$(command -v node)"
cat >/etc/systemd/system/${APP_NAME}.service <<EOF
[Unit]
Description=MarckNetVision Dashboard
After=network.target

[Service]
Type=simple
User=${APP_USER}
Group=${APP_USER}
WorkingDirectory=${APP_DIR}
ExecStart=${NODE_BIN} server.js
Restart=on-failure
RestartSec=10
Environment=PORT=${APP_PORT}
Environment=NODE_ENV=production

StandardOutput=journal
StandardError=journal
SyslogIdentifier=${APP_NAME}

# Hardening
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=full
ProtectHome=yes

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now ${APP_NAME}.service
sleep 2
systemctl status --no-pager ${APP_NAME}.service | head -n 15 || true

# -------------------- Step 8: Firewall (firewalld) ------------------------
if systemctl is-active --quiet firewalld; then
  log "Configuring firewalld..."
  firewall-cmd --permanent --add-service=http  || true
  firewall-cmd --permanent --add-service=https || true
  # Also allow direct port access in case nginx isn't used
  firewall-cmd --permanent --add-port=${APP_PORT}/tcp || true
  firewall-cmd --reload
else
  warn "firewalld is not running — skipping firewall setup."
fi

# -------------------- Step 9: Nginx reverse proxy -------------------------
log "Installing Nginx..."
$PM -y install nginx

SERVER_NAME="${DOMAIN:-_}"
NGINX_CONF="/etc/nginx/conf.d/${APP_NAME}.conf"
log "Writing Nginx config to ${NGINX_CONF} (server_name: ${SERVER_NAME})..."
cat >"${NGINX_CONF}" <<EOF
server {
    listen 80;
    server_name ${SERVER_NAME};

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
EOF

# -------------------- Step 10: SELinux ------------------------------------
if command -v getenforce >/dev/null 2>&1 && [[ "$(getenforce)" != "Disabled" ]]; then
  log "Configuring SELinux to allow Nginx → Node.js proxy..."
  setsebool -P httpd_can_network_connect 1 || warn "Could not set httpd_can_network_connect"
  if [[ "$APP_PORT" -lt 1024 ]]; then
    semanage port -a -t http_port_t -p tcp "$APP_PORT" 2>/dev/null || \
      semanage port -m -t http_port_t -p tcp "$APP_PORT" 2>/dev/null || true
  fi
fi

log "Validating and starting Nginx..."
nginx -t
systemctl enable --now nginx

# -------------------- Step 11: HTTPS via Let's Encrypt (optional) ---------
if [[ -n "$DOMAIN" ]]; then
  log "Installing certbot for Let's Encrypt..."
  $PM -y install epel-release || true
  $PM -y install certbot python3-certbot-nginx
  log "Requesting certificate for ${DOMAIN}..."
  if certbot --nginx -d "${DOMAIN}" --non-interactive --agree-tos \
       --register-unsafely-without-email --redirect; then
    log "SSL configured successfully."
  else
    warn "Certbot failed. Re-run later with: certbot --nginx -d ${DOMAIN}"
  fi
else
  log "No domain provided — skipping Let's Encrypt. Re-run with a domain arg to enable HTTPS."
fi

# -------------------- Step 12: Cron jobs for data refresh -----------------
log "Installing cron jobs for periodic data refresh..."
$PM -y install cronie
systemctl enable --now crond

CRON_LOG="/var/log/${APP_NAME}-cron.log"
UPDATE_LOG="/var/log/${APP_NAME}-update.log"
touch "$CRON_LOG" "$UPDATE_LOG"
chown "$APP_USER:$APP_USER" "$CRON_LOG" "$UPDATE_LOG"

# Allow the app user to restart its own service (used by the nightly
# auto-update script after a successful `git pull`).
SUDOERS_FILE="/etc/sudoers.d/${APP_NAME}"
log "Granting ${APP_USER} permission to restart ${APP_NAME}.service via sudo..."
cat >"$SUDOERS_FILE" <<EOF
# Allow the ${APP_USER} service user to restart its own systemd unit
# (used by the nightly git-pull auto-update cron job).
${APP_USER} ALL=(root) NOPASSWD: /bin/systemctl restart ${APP_NAME}.service, /usr/bin/systemctl restart ${APP_NAME}.service
EOF
chmod 440 "$SUDOERS_FILE"
visudo -cf "$SUDOERS_FILE" >/dev/null

# Nightly auto-update script: fetch, and if origin/main is ahead of local,
# pull, run `npm install` when package*.json changed, then restart the
# service. Designed to be idempotent and quiet when there's nothing to do.
UPDATE_SCRIPT="${APP_DIR}/scripts/auto-update.sh"
log "Installing nightly auto-update script at ${UPDATE_SCRIPT}..."
install -d -m 755 -o "$APP_USER" -g "$APP_USER" "${APP_DIR}/scripts"
cat >"$UPDATE_SCRIPT" <<EOF
#!/usr/bin/env bash
# Auto-update script for ${APP_NAME}. Run as ${APP_USER} from cron.
set -euo pipefail

cd "${APP_DIR}"

ts() { date '+%Y-%m-%d %H:%M:%S'; }
echo "[\$(ts)] checking for updates..."

git fetch --quiet origin main

LOCAL="\$(git rev-parse HEAD)"
REMOTE="\$(git rev-parse origin/main)"

if [[ "\$LOCAL" == "\$REMOTE" ]]; then
  echo "[\$(ts)] already up to date (\${LOCAL:0:7})."
  exit 0
fi

echo "[\$(ts)] new commits found: \${LOCAL:0:7} -> \${REMOTE:0:7}"

# Did package.json or package-lock.json change between LOCAL and REMOTE?
DEPS_CHANGED=0
if git diff --name-only "\$LOCAL" "\$REMOTE" | grep -Eq '^(package\.json|package-lock\.json)\$'; then
  DEPS_CHANGED=1
fi

echo "[\$(ts)] pulling..."
git pull --ff-only origin main

if [[ "\$DEPS_CHANGED" -eq 1 ]]; then
  echo "[\$(ts)] dependencies changed — running npm install..."
  npm install --omit=dev || npm install
else
  echo "[\$(ts)] dependencies unchanged — skipping npm install."
fi

echo "[\$(ts)] restarting ${APP_NAME}.service..."
sudo -n /bin/systemctl restart ${APP_NAME}.service

echo "[\$(ts)] update complete: now at \$(git rev-parse --short HEAD)."
EOF
chown "$APP_USER:$APP_USER" "$UPDATE_SCRIPT"
chmod 750 "$UPDATE_SCRIPT"

# Write out a cron file for the app user (replaces prior entries safely).
# Cron runs as APP_USER, so any `git pull` uses the same ~/.ssh/config +
# deploy key we set up above.
CRON_TMP="$(mktemp)"
cat >"$CRON_TMP" <<EOF
# MarckNetVision scheduled jobs (managed by install-rhel.sh)

# Refresh weather + schedule data every 30 minutes
*/30 * * * * cd ${APP_DIR} && ${NODE_BIN} -e "require('./weather-scraper').refreshWeather().then(()=>console.log('Weather refreshed')).catch(console.error)"  >> ${CRON_LOG} 2>&1
*/30 * * * * cd ${APP_DIR} && ${NODE_BIN} -e "require('./schedule-scraper').refreshSchedule().then(()=>console.log('Schedule refreshed')).catch(console.error)" >> ${CRON_LOG} 2>&1

# Nightly git pull + restart (3:30 AM local time)
30 3 * * * ${UPDATE_SCRIPT} >> ${UPDATE_LOG} 2>&1
EOF
crontab -u "$APP_USER" "$CRON_TMP"
rm -f "$CRON_TMP"

# -------------------- Done ------------------------------------------------
IP="$(hostname -I 2>/dev/null | awk '{print $1}' || echo "<your-server-ip>")"
echo
log "Installation complete."
echo
echo "  App directory:    ${APP_DIR}"
echo "  Service:          systemctl status ${APP_NAME}"
echo "  Logs:             journalctl -u ${APP_NAME} -f"
echo "  Cron log:         tail -f ${CRON_LOG}"
echo "  Update log:       tail -f ${UPDATE_LOG}"
echo "  Auto-update:      ${UPDATE_SCRIPT} (runs nightly at 3:30 AM)"
echo "  Deploy key:       ${SSH_KEY_PUB}"
if [[ -n "$DOMAIN" ]]; then
  echo "  Open in browser:  https://${DOMAIN}  (or http://${DOMAIN})"
else
  echo "  Open in browser:  http://${IP}/"
fi
echo
echo "To update the app later:"
echo "  sudo -u ${APP_USER} -H git -C ${APP_DIR} pull --ff-only origin main"
echo "  sudo systemctl restart ${APP_NAME}"
echo
