#!/bin/sh
set -eu
: "${OIDC_CLIENT_SECRET:?Set the Cloud OIDC client secret}"
: "${OFFICE_JWT_SECRET:?Set the shared Office JWT secret}"
: "${OBJECTSTORE_S3_BUCKET:?Use a new dedicated non-versioned bucket}"
# The official image copies config files only when it installs or upgrades; keep ours current on every start.
cp /usr/src/nextcloud/config/zzz-christiancloud.config.php /var/www/html/config/zzz-christiancloud.config.php
# The image runs hooks as www-data when it starts as root, so occ is usually run directly.
if [ "$(id -u)" = 0 ]; then occ() { su -p www-data -s /bin/sh -c 'php /var/www/html/occ "$@"' -- sh "$@"; }; else occ() { php /var/www/html/occ "$@"; }; fi
for app in user_oidc eurooffice christiancloud; do
  mkdir -p "/var/www/html/custom_apps/$app"
  cp -a "/opt/christiancloud/apps/$app/." "/var/www/html/custom_apps/$app/"
  [ "$(id -u)" != 0 ] || chown -R www-data:www-data "/var/www/html/custom_apps/$app"
  occ app:enable "$app"
done
occ config:app:set files default_quota --value=3000000000
occ config:app:set user_oidc allow_multiple_user_backends --value=0
occ user_oidc:provider 'Christian Systems' --clientid=christian-cloud --clientsecret-env=OIDC_CLIENT_SECRET \
  --discoveryuri="${OIDC_DISCOVERY_URL:-https://social.christiansystems.org/.well-known/openid-configuration}" \
  --scope='openid profile' --unique-uid=0 --mapping-uid=sub --mapping-display-name=name --check-bearer=0 --bearer-provisioning=0 > /dev/null
occ config:app:set eurooffice DocumentServerUrl --value="${OFFICE_URL:-https://office.christiansystems.org/}"
# AppConfig reads the JWT from system config; keep it out of occ arguments/logs.
occ theming:config name 'Christian Cloud'
occ config:app:set theming productName --value='Christian Cloud' > /dev/null
occ theming:config color '#e3261c'
occ theming:config slogan 'Your files, together.'
occ theming:config logo /opt/christiancloud/brand/icons/cloud-mark.svg
occ theming:config favicon /opt/christiancloud/brand/icons/cloud-256.png
occ maintenance:update:htaccess
# Background jobs: system cron when this process may start it, otherwise on page loads.
if [ "$(id -u)" = 0 ] && command -v busybox >/dev/null 2>&1 && busybox crond -b -l 8 2>/dev/null; then occ background:cron; else occ background:ajax; fi
