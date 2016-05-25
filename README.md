# lively4-server
Alternative to accessing GitHub directly

After cloning the repo, cd into `lively4-server`. 
Run `npm install` to install all required packages.
Run `node httpServer.js -h` for command line argument information.

## Publict Example Instances ...

- https://lively-kernel.org/lively4/
- https://lively-kernel.org/lively4S2/

# Setup

Either run httpServer.js directly, or use a script like bin/lively4S1.sh


# Self-supporting development of lively4-server

We use two instances of lively4-server to evolve the system in a self supporting way.
The two server have each their own checkout of the git repository. 

Each server gets restarted in an endless loop, so errors will lead to a server restart. 

## Server Updating

An external watcher observes changes to the source file and restarts the server accordingly. 

- a) The first server pulls changes from github before (re-)starting
- b) The source of the second server can be changed from within lively4 and pushed to github

## Development / Deployment Cycles

This setup allows for two differntly long development cycles that depend on each other.

The second server allows for a very short feedback loops of changing code and restarting the server automatically. The changes can break the second server in any way without interrupting the development process. Once the server runs stable again, the changes can be commited and pushed to githup. 

Once the new code is on github the first server can be asked to restart itself and before doing so, the new code gets pulled from github. If by any chances the server crashes, it will continously try to pull changes from github, allowing to push fixes from the second server to github or make the changes directly on github. 

There might be problems that will require admin access or similar to the server, but these occasions should be minimalized with the new development workflow. 