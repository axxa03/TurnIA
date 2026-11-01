#!/usr/bin/env bash
# Instalación de TurnIA en un Cloud Server DonWeb (Ubuntu 22.04/24.04) como root.
# Uso:  bash deploy/setup.sh dwday-1252350.online
set -euo pipefail
DOMAIN="${1:-_}"
APP_DIR=/opt/turnia
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"

apt-get update -y
apt-get install -y curl ca-certificates nginx git
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
timedatectl set-timezone America/Argentina/Buenos_Aires || true

id turnia >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin turnia
mkdir -p "$APP_DIR" /var/lib/turnia
if [ "$REPO_DIR" != "$APP_DIR" ]; then cp -r "$REPO_DIR"/. "$APP_DIR"/; fi
if [ ! -f "$APP_DIR/.env" ]; then
  cp "$APP_DIR/.env.example" "$APP_DIR/.env"
  sed -i "s|^SESSION_SECRET=.*|SESSION_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")|" "$APP_DIR/.env"
  echo "DB_PATH=/var/lib/turnia/turnia.db" >> "$APP_DIR/.env"
fi
chmod 600 "$APP_DIR/.env"
chown -R turnia:turnia "$APP_DIR" /var/lib/turnia

cp "$APP_DIR/deploy/turnia.service" /etc/systemd/system/turnia.service
systemctl daemon-reload
systemctl enable --now turnia
systemctl restart turnia

# Nginx: se desactivan los sitios por defecto (sites-enabled y conf.d de la imagen) para que TurnIA atienda el puerto 80.
rm -f /etc/nginx/sites-enabled/default /etc/nginx/sites-enabled/turnia
for f in /etc/nginx/conf.d/default.conf; do [ -f "$f" ] && mv "$f" "$f.disabled"; done
sed "s/__DOMAIN__/$DOMAIN www.$DOMAIN/" "$APP_DIR/deploy/nginx.conf" > /etc/nginx/conf.d/turnia.conf
nginx -t
systemctl restart nginx

if command -v ufw >/dev/null; then ufw allow OpenSSH || true; ufw allow 'Nginx Full' || true; fi
sleep 2
curl -fsS http://127.0.0.1:3000/api/health >/dev/null
curl -fsS http://127.0.0.1/api/health && echo && echo "TurnIA OK (app + nginx) → http://$DOMAIN"
echo "HTTPS opcional: apt-get install -y certbot python3-certbot-nginx && certbot --nginx -d $DOMAIN -d www.$DOMAIN"
