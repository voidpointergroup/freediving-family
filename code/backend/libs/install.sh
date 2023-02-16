#!/bin/bash

cd bus
bash generate.sh
cd ../

libsF=shared
for i in ${libsF//,/ }
do
    cd $i
    npm i
    cd ../
done
