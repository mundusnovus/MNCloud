FROM nextcloud:33.0.10-apache@sha256:5ded1127972ea84c29792215f0621c71929ed315cc47be946b489c7a1c1ad305
COPY vendor/ /tmp/cs-vendor/
RUN echo 'e3f8bc89d07e87993a805eab774b49a14c6b732edf5c9f705df2389596ab9e71  /tmp/cs-vendor/user_oidc.tar.gz' | sha256sum -c - \
 && echo '12a0cb41694bdf9e29a99d569069d15cc711bf54290ef8ae24d4b668ceeab9fd  /tmp/cs-vendor/eurooffice.tar.gz' | sha256sum -c - \
 && mkdir -p /opt/christiancloud/apps \
 && tar -xzf /tmp/cs-vendor/user_oidc.tar.gz -C /opt/christiancloud/apps \
 && tar -xzf /tmp/cs-vendor/eurooffice.tar.gz -C /opt/christiancloud/apps \
 && rm -rf /tmp/cs-vendor
COPY apps/ /opt/christiancloud/apps/
COPY brand/ /opt/christiancloud/brand/
COPY server/storage/ /opt/christiancloud/storage/
COPY server/config/christiancloud.config.php /usr/src/nextcloud/config/zzz-christiancloud.config.php
COPY server/hooks/ /docker-entrypoint-hooks.d/before-starting/
COPY server/apache.conf /etc/apache2/conf-available/christiancloud.conf
# Apache runs PHP under the prefork MPM; make sure it is the only one loaded, then check the configuration.
RUN (a2dismod -f mpm_event mpm_worker || true) && a2enmod mpm_prefork headers rewrite && a2enconf christiancloud \
 && ls /etc/apache2/mods-enabled/ | grep mpm && apache2ctl -t
ENV NEXTCLOUD_TRUSTED_DOMAINS=cloud.christiansystems.org PHP_MEMORY_LIMIT=512M PHP_UPLOAD_LIMIT=3G
EXPOSE 80
