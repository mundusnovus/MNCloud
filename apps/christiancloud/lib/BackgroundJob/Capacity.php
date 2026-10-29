<?php
namespace OCA\ChristianCloud\BackgroundJob;
use OCP\BackgroundJob\TimedJob;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\IConfig;
use OCP\IDBConnection;
class Capacity extends TimedJob {
    public function __construct(ITimeFactory $time, private IConfig $config, private IDBConnection $db) {
        parent::__construct($time); $this->setInterval(300);
    }
    protected function run($argument): void {
        // Reporting only. The primary-store adapter enforces every write atomically.
        $bytes = (int)$this->db->executeQuery('SELECT COALESCE(SUM(bytes),0) FROM christiancloud_objects')->fetchOne();
        $this->config->setAppValue('christiancloud', 'used_bytes', (string)$bytes);
        $this->config->setAppValue('christiancloud', 'full', $bytes >= 256000000000 ? '1' : '0');
    }
}
