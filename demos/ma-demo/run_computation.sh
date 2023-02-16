#/bin/sh

set -x

node demos/ma-demo/server.js > demos/ma-demo/logs/server.log &
ids=$!
trap "kill $ids" EXIT
sleep 1

for i in $(seq 1 3); do
    node demos/ma-demo/compute-party.js > demos/ma-demo/logs/compute-$i.log &
    ids="$ids $!"
    trap "kill $ids" EXIT
done

for i in $(seq 1 10); do
    node demos/ma-demo/cli-client.js $i 3 &
    ids="$ids $!"
    trap "kill $ids" EXIT
done

sleep 20