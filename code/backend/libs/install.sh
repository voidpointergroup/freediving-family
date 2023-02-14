#!/bin/bash

variable=ids,db,netctx
for i in ${variable//,/ }
do
    cd $i
    npm i
    cd ../
done
