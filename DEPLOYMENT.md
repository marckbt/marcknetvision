# MarckNetVision Deployment Guide

Deploy the MarckNetVision Dashboard on a simple Linux server (Ubuntu/Debian).

---

## Prerequisites

- A Linux server (Ubuntu 20.04+ or Debian 11+ recommended)
- SSH access with sudo privileges
- A domain name (optional, but recommended)
- Port 3000 open in your firewall (or 80/443 if using Nginx)

---

## Step 1: Install Node.js

```bash
# Install Node.js 20.x (LTS)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Verify installation
node --version   # Should show v20.x.x
npm --version
```

---

## Step 2: Install Git and Clone the Repository

```bash
sudo apt-get install -y git

# Clone the repo
cd /opt
sudo git clone https://github.com/marckbt/marcknetvision.git
sudo chown -R $USER:$USER /opt/marcknetvision
cd /opt/marcknetvision
```

---

## Step 3: Install Dependencies

```bash
npm install
```

---

## Step 4: Create the Data Directory

The app writes weather and schedule data to `public/data/`. Create it:

```bash
mkdir -p public/data
```

---

## Step 5: Generate Initial Data

Before starting the server, generate weather and schedule data:

```bash
node -e "const { refreshWeather } = require('./weather-scraper'); refreshWeather().then(() => console.log('Weather data generated')).catch(console.error)"
node -e "const { refreshSchedule } = require('./schedule-scraper'); refreshSchedule().then(() => console.log('Schedule data generated')).catch(console.error)"
```

---

## Step 6: Test the Server

```bash
# Start the server to verify it works
PORT=3000 node server.js
```

Open `http://YOUR_SERVER_IP:3000` in a browser. Press `Ctrl+C` to stop once verified.

---

## Step 7: Set Up as a System Service (systemd)

Create a service file so the app starts automatically and restarts on failure:

```bash
sudo nano /etc/systemd/system/marcknetvision.service
```

Paste the following:

```ini
[Unit]
Description=MarckNetVision Dashboard
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/marcknetvision
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=10
Environment=PORT=3000
Environment=NODE_ENV=production

# Logging
StandardOutput=journal
StandardError=journal
SyslogIdentifier=marcknetvision

[Install]
WantedBy=multi-user.target
```

Set ownership and enable the service:

```bash
# Give www-data ownership
sudo chown -R www-data:www-data /opt/marcknetvision

# Reload systemd, enable, and start
sudo systemctl daemon-reload
sudo systemctl enable marcknetvision
sudo systemctl start marcknetvision

# Check status
sudo systemctl status marcknetvision
```

Useful service commands:

```bash
sudo systemctl stop marcknetvision      # Stop
sudo systemctl restart marcknetvision   # Restart
sudo journalctl -u marcknetvision -f    # View live logs
```

---

## Step 8: Set Up Nginx Reverse Proxy (Recommended)

Using Nginx lets you serve the app on port 80/443 with a domain name.

```bash
sudo apt-get install -y nginx
```

Create a site config:

```bash
sudo nano /etc/nginx/sites-available/marcknetvision
```

Paste the following (replace `your-domain.com` with your domain or server IP):

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Enable the site and restart Nginx:

```bash
sudo ln -s /etc/nginx/sites-available/marcknetvision /etc/nginx/sites-enabled/
sudo nginx -t                 # Test config
sudo systemctl restart nginx
```

---

## Step 9: Add SSL with Let's Encrypt (Optional)

If you have a domain name pointed at your server:

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

Certbot will automatically configure Nginx for HTTPS and set up auto-renewal.

---

## Step 10: Set Up a Cron Job for Data Refresh

The weather and schedule data should be refreshed periodically. Create a cron job:

```bash
sudo crontab -u www-data -e
```

Add these lines to refresh data every 30 minutes:

```cron
# Refresh weather data every 30 minutes
*/30 * * * * cd /opt/marcknetvision && /usr/bin/node -e "const { refreshWeather } = require('./weather-scraper'); refreshWeather().then(() => console.log('Weather refreshed')).catch(console.error)" >> /var/log/marcknetvision-cron.log 2>&1

# Refresh sports schedule every 30 minutes
*/30 * * * * cd /opt/marcknetvision && /usr/bin/node -e "const { refreshSchedule } = require('./schedule-scraper'); refreshSchedule().then(() => console.log('Schedule refreshed')).catch(console.error)" >> /var/log/marcknetvision-cron.log 2>&1
```

Create the log file:

```bash
sudo touch /var/log/marcknetvision-cron.log
sudo chown www-data:www-data /var/log/marcknetvision-cron.log
```

---

## Step 11: Firewall Configuration

If using UFW (Ubuntu's default firewall):

```bash
# If using Nginx (recommended)
sudo ufw allow 'Nginx Full'

# If running Node directly without Nginx
sudo ufw allow 3000

# Verify
sudo ufw status
```

---

## Updating the Application

To pull new changes and redeploy:

```bash
cd /opt/marcknetvision
sudo -u www-data git pull origin main
sudo -u www-data npm install        # Only if dependencies changed
sudo systemctl restart marcknetvision
```

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| App won't start | Check logs: `sudo journalctl -u marcknetvision -n 50` |
| Port already in use | Find process: `sudo lsof -i :3000` and kill it |
| No weather/schedule data | Run the data generation commands from Step 5 |
| Nginx 502 Bad Gateway | Ensure the Node app is running: `sudo systemctl status marcknetvision` |
| Permission denied errors | Fix ownership: `sudo chown -R www-data:www-data /opt/marcknetvision` |
| Can't reach from browser | Check firewall: `sudo ufw status` and ensure port is open |

---

## Directory Structure on Server

```
/opt/marcknetvision/
├── server.js                 # Express server (main entry point)
├── weather-scraper.js        # NWS/WU weather data fetcher
├── schedule-scraper.js       # ESPN/SC2 schedule fetcher
├── package.json
├── public/
│   ├── index.html            # Dashboard HTML
│   ├── app.js                # Frontend application logic
│   ├── style.css             # Styles and theming
│   ├── favicon.svg           # Browser tab icon
│   ├── icons/wx/             # 1992 retro weather GIF icons
│   └── data/                 # Generated JSON data (weather, schedule)
└── node_modules/
```
