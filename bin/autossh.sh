#!/bin/sh


## from https://serverfault.com/questions/42021/how-to-ping-in-linux-until-host-is-known

URL=lively-kernel.org
USER=jens

#ping_cancelled=false    # Keep track of whether the loop was cancelled, or succeeded
#until ping -c1 "$URL" &>/dev/null; do :; done &    # The "&" backgrounds it
#trap "kill $!; ping_cancelled=true" SIGINT
#wait $!          # Wait for the loop to exit, one way or another
#trap - SIGINT    # Remove the trap, now we're done with it
#echo "Done pinging, cancelled=$ping_cancelled"


until nc -vzw 2 $URL 22; do sleep 2; done

/usr/bin/autossh -t -R 8007:localhost:9005 -R 8008:localhost:3000 -l $USER $URL -N
