#/bin/sh

set -x

node demos/ma-demo/server.js > demos/ma-demo/logs/server.log &
ids=$!
trap "kill $ids" EXIT
sleep 1

compute_ids=""
for i in $(seq 1 3); do
    node demos/ma-demo/compute-party.js > demos/ma-demo/logs/compute-$i.log &
    compute_ids="$compute_ids $!"
    ids="$ids $!"
    trap "kill $ids" EXIT
done

for i in $(seq 1 10); do
    node demos/ma-demo/cli-client.js $(expr $i + 3) $i $i &
    ids="$ids $!"
    trap "kill $ids" EXIT
done

for id in $compute_ids; do
    tail --pid=$id -f /dev/null
done