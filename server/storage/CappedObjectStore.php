<?php
// SPDX-License-Identifier: AGPL-3.0-only
namespace ChristianSystems;

use OCP\Files\ObjectStore\IObjectStore;
use OC\Files\ObjectStore\S3;
use PDO;
use RuntimeException;

/** New, dedicated, non-versioned buckets only. Every writer must use this adapter.
 * Durable reservations survive an ambiguous S3 failure. They are never released
 * until a confirmed overwrite or deletion, so a crash fails closed.
 */
class CappedObjectStore implements IObjectStore {
    private IObjectStore $store;
    private PDO $db;
    private int $cap;
    public function __construct(array $params) {
        $this->cap = 256000000000; // GB, decimal, as advertised
        $this->store = new S3($params);
        $this->db = new PDO('pgsql:host=' . getenv('POSTGRES_HOST') . ';port=' . (getenv('POSTGRES_PORT') ?: '5432') . ';dbname=' . getenv('POSTGRES_DB'), getenv('POSTGRES_USER'), getenv('POSTGRES_PASSWORD'), [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
        $this->db->exec('CREATE TABLE IF NOT EXISTS christiancloud_objects (urn TEXT PRIMARY KEY, bytes BIGINT NOT NULL CHECK(bytes >= 0), pending BOOLEAN NOT NULL DEFAULT FALSE)');
    }
    public function getStorageId() { return $this->store->getStorageId(); }
    public function readObject($urn) { return $this->store->readObject($urn); }
    public function objectExists($urn) { return $this->store->objectExists($urn); }
    public function preSignedUrl(string $urn, \DateTimeInterface $expiration): ?string { return null; }
    private function lock(): void { $this->db->query('SELECT pg_advisory_lock(1129530195, 256)'); }
    private function unlock(): void { $this->db->query('SELECT pg_advisory_unlock(1129530195, 256)'); }
    private function execute(string $sql, array $values = []): \PDOStatement { $s = $this->db->prepare($sql); $s->execute($values); return $s; }
    public function writeObject($urn, $stream, ?string $mimetype = null) {
        // Count unknown-length/chunked streams before reserving; bounded disk use.
        $temp = tmpfile();
        if ($temp === false) throw new RuntimeException('Cloud cannot prepare this upload.');
        try {
            $bytes = 0;
            while (!feof($stream)) {
                $chunk = fread($stream, 1048576);
                if ($chunk === false || ($chunk === '' && !feof($stream))) throw new RuntimeException('Upload stream failed.');
                $bytes += strlen($chunk);
                if ($bytes > 3000000000) throw new RuntimeException('This file exceeds the 3 GB account allowance.');
                if (fwrite($temp, $chunk) !== strlen($chunk)) throw new RuntimeException('Cloud upload staging is full.');
            }
            rewind($temp);
            $this->lock();
            try {
                $row = $this->execute('SELECT bytes FROM christiancloud_objects WHERE urn=?', [$urn])->fetch(PDO::FETCH_ASSOC);
                if (!$row && $this->store->objectExists($urn)) throw new RuntimeException('Unaccounted object: reconcile the bucket before writing.');
                $old = $row ? (int)$row['bytes'] : 0;
                $used = (int)$this->db->query('SELECT COALESCE(SUM(bytes),0) FROM christiancloud_objects')->fetchColumn();
                $reservation = max($old, $bytes);
                if ($used - $old + $reservation > $this->cap) throw new RuntimeException('Cloud is full; uploads are paused.');
                // Autocommit BEFORE touching S3. A crash cannot lose the reservation.
                $this->execute('INSERT INTO christiancloud_objects(urn,bytes,pending) VALUES(?,?,TRUE) ON CONFLICT(urn) DO UPDATE SET bytes=EXCLUDED.bytes,pending=TRUE', [$urn, $reservation]);
                $this->store->writeObject($urn, $temp, $mimetype);
                $this->execute('UPDATE christiancloud_objects SET bytes=?,pending=FALSE WHERE urn=?', [$bytes, $urn]);
            } finally { $this->unlock(); }
        } finally { if (is_resource($temp)) fclose($temp); } // the S3 client may already have closed it
    }
    public function deleteObject($urn) {
        $this->lock();
        try {
            $this->store->deleteObject($urn);
            $this->execute('DELETE FROM christiancloud_objects WHERE urn=?', [$urn]);
        } finally { $this->unlock(); }
    }
    public function copyObject($from, $to) {
        $stream = $this->readObject($from);
        try { $this->writeObject($to, $stream); } finally { if (is_resource($stream)) fclose($stream); }
    }
}
