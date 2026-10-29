# Capacity accounting

The S3 primary-store adapter permits at most 256,000,000,000 bytes of object
payload. Account quota is 3,000,000,000 bytes. These are decimal GB. This includes
primary-store trash, versions and generated objects, not just live user files.
Use a NEW, dedicated bucket with object versioning disabled. No other credentials,
services or maintenance tools may write directly to it. Never switch an existing
bucket to this adapter without a complete accounting migration.

Writes spool to a temporary file (maximum 3 GB), then take a PostgreSQL advisory
lock shared by all Cloud processes. A durable reservation is committed before
S3 is called. The lock is held across the S3 operation; successful writes settle
to their actual length. Failed/ambiguous writes retain the larger old/new size.
Deletes free a reservation only after S3 confirms deletion. Copies pass through
the same write path. Reads do not take the lock. This intentionally serializes
object writes: a modest service trades throughput for a strict capacity boundary.

The ledger is christiancloud_objects in the Cloud database. Back it up with the
Nextcloud database and keep it paired with the bucket. Never delete pending rows
just because a request failed. Check actual S3 object size under the same advisory
lock, then settle the reservation. After a crash, a smaller overwrite or confirmed
delete can also release an over-reservation. Do not reset the ledger on deployment.
S3 multipart staging and provider metadata are outside the object-payload cap;
configure bucket lifecycle cleanup for aborted multipart uploads. Physical billing
may therefore exceed the payload total. No bucket versioning or replication.

The five-minute Capacity job reports usage; it does not mutate account quotas.
Unprovisioned accounts receive the 3 GB Nextcloud default at first OIDC login.
New writes are rejected at the cap even before the reporting job runs.

Runtime validation is still required with PostgreSQL + an S3-compatible bucket:
concurrent writes across the cap, overwrite growth/shrink, copies, delete, interrupted
S3 writes, chunked DAV uploads and restoration. The local development Mac lacks
Docker/PHP. Do not open public registration until these checks pass. Keep sufficient
local ephemeral disk for concurrent spooled uploads; per-account quota does not
limit aggregate staging disk across simultaneous requests.
