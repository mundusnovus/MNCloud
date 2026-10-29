#!/bin/sh
set -eu
: "${OIDC_CLIENT_SECRET:?Set the Cloud OIDC client secret}"
: "${OFFICE_JWT_SECRET:?Set the shared Office JWT secret}"
: "${OBJECTSTORE_S3_BUCKET:?Use a new dedicated non-versioned bucket}"
# The official image copies config files only when it installs or upgrades; keep ours current on every start.
cp /usr/src/nextcloud/config/zzz-christiancloud.config.php /var/www/html/config/zzz-christiancloud.config.php
chown www-data:www-data /var/www/html/config/zzz-christiancloud.config.php
occ() { su -p www-data -s /bin/sh -c 'php /var/www/html/occ "$@"' -- sh "$@"; }
for app in user_oidc eurooffice christiancloud; do
  mkdir -p "/var/www/html/custom_apps/$app"
  cp -a "/opt/christiancloud/apps/$app/." "/var/www/html/custom_apps/$app/"
  chown -R www-data:www-data "/var/www/html/custom_apps/$app"
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
occ theming:config color '#e3261c'
occ theming:config slogan 'Your files, together.'
occ theming:config logo /opt/christiancloud/brand/icons/cloud-mark.svg
occ theming:config favicon /opt/christiancloud/brand/icons/cloud-256.png
occ maintenance:update:htaccess
occ background:cron
# Official apache image provides busybox cron, but does not start it itself.
busybox crond -b -l 8
