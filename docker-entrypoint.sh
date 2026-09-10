#!/bin/sh
# The bind mount at /data belongs to the host user, and mounting it replaces whatever
# ownership the build gave the directory — so the app's own user can only write there if
# something fixes the ownership after the mount exists. That has to happen here, at start,
# as root; the image therefore has no USER line and drops privileges itself, below.
set -e

if [ "$(id -u)" = "0" ]; then
  chown -R fineants:fineants /data
  exec setpriv --reuid=fineants --regid=fineants --init-groups "$@"
fi

# Already unprivileged: `docker run --user`, or a runtime that forbids root. Nothing can be
# chowned from here, so /data has to be writable by this uid already — the README says so.
exec "$@"
