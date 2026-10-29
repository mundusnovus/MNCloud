<?php
// Nextcloud reads config files before its own classes can load, so the capped store is loaded only when first
// used (by then IObjectStore and S3 exist). This file may be read more than once per request.
if (!defined('CHRISTIANCLOUD_STORE_AUTOLOAD')) {
    define('CHRISTIANCLOUD_STORE_AUTOLOAD', true);
    spl_autoload_register(static function (string $class): void {
        if ($class === 'ChristianSystems\\CappedObjectStore') require_once '/opt/christiancloud/storage/CappedObjectStore.php';
    });
}
$CONFIG = [
    'eurooffice' => [
        'jwt_secret' => getenv('OFFICE_JWT_SECRET'), 'jwt_header' => 'AuthorizationJwt',
        'customization_loaderName' => 'Christian Office',
        'customization_loaderLogo' => 'https://office.christiansystems.org/christian-office/brand/icons/office-mark.svg',
        'customization_logo' => ['image' => 'https://office.christiansystems.org/christian-office/brand/icons/office-mark.svg', 'url' => 'https://office.christiansystems.org/'],
        'customization_customer' => ['name' => 'Christian Systems', 'www' => 'https://christiansystems.org', 'info' => 'Christian Office — free and open source'],
    ],
    'default_quota' => '3000000000',
    'skeletondirectory' => '',
    'defaultapp' => 'christiancloud',
    'overwriteprotocol' => 'https',
    'overwritehost' => getenv('CLOUD_HOST') ?: 'cloud.christiansystems.org',
    'overwrite.cli.url' => 'https://' . (getenv('CLOUD_HOST') ?: 'cloud.christiansystems.org'),
    'htaccess.RewriteBase' => '/',
    'user_oidc' => ['use_pkce' => true],
    'objectstore' => [
        'class' => '\\ChristianSystems\\CappedObjectStore',
        'arguments' => [
            'bucket' => getenv('OBJECTSTORE_S3_BUCKET'),
            'hostname' => getenv('OBJECTSTORE_S3_HOST'),
            'port' => 443,
            'key' => getenv('OBJECTSTORE_S3_KEY'),
            'secret' => getenv('OBJECTSTORE_S3_SECRET'),
            'region' => getenv('OBJECTSTORE_S3_REGION') ?: 'auto',
            'use_ssl' => true, 'use_path_style' => true, 'autocreate' => false,
        ],
    ],
];
