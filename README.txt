 __       __  ________   ______   _______    ______   __    __        _______    ______   __        __       
|  \  _  |  \|        \ /      \ |       \  /      \ |  \  |  \      |       \  /      \ |  \      |  \      
| $$ / \ | $$| $$$$$$$$|  $$$$$$\| $$$$$$$\|  $$$$$$\| $$\ | $$      | $$$$$$$\|  $$$$$$\| $$      | $$      
| $$/  $\| $$| $$__    | $$__| $$| $$__/ $$| $$  | $$| $$$\| $$      | $$__/ $$| $$__| $$| $$      | $$      
| $$  $$$\ $$| $$  \   | $$    $$| $$    $$| $$  | $$| $$$$\ $$      | $$    $$| $$    $$| $$      | $$      
| $$ $$\$$\$$| $$$$$   | $$$$$$$$| $$$$$$$ | $$  | $$| $$\$$ $$      | $$$$$$$\| $$$$$$$$| $$      | $$      
| $$$$  \$$$$| $$_____ | $$  | $$| $$      | $$__/ $$| $$ \$$$$      | $$__/ $$| $$  | $$| $$_____ | $$_____ 
| $$$    \$$$| $$     \| $$  | $$| $$       \$$    $$| $$  \$$$      | $$    $$| $$  | $$| $$     \| $$     \
 \$$      \$$ \$$$$$$$$ \$$   \$$ \$$        \$$$$$$  \$$   \$$       \$$$$$$$  \$$   \$$ \$$$$$$$$ \$$$$$$$$
                                                                                                             
                                                                                                             
--------------------------------------------------------------------------------------------------------------
by Corval and ChatGPT :^) 

BET ON YOUR BALLS

WHAT IS WEAPON BALL?

- Inspired by earclacks weapon ball simulation game. Weapon ball is the beginning of a revolutionary gaming and gambling hub.
- Written primarily in typescript.
- Weapon ball uses a randomly generated seed to simulate a battle between two balls with orbiting weapons in a small arena. Balls bounce and collide
with weapon strikes deducting health from the victim. A victor emerges when the opponent's HP reaches ZERO.
- Weapons and balls have customizable stats like size, damage, speed, etc. This allows for a variety of matchups.
- The arena size is customizable.
- Balls can have custom skins as can weapons. 
- A visualizer written in typescript is also included. 

WHY WEAPON BALL
- I think people would love to bet on some crap like this and I think it will be really fun to build games and betting pools around these simulations.

Current state:
- Simulation and visualizer. Basic working arena and 1v1 ball setup.

In final build:
- The seed will be randomly generated using Paintswap VRF. 
- Seed will be obscured until visualization is complete and then revealed for trustless verification. Anyone can re-run any seed to confirm the legitimacy
of the match's result.
- Betting markets for each arena. 
- Different game modes including PvE and PvP.
- Permissionless match setups so anyone can use the framework to set up matches. 
- A working front end to host all this crap. 
- Ball pack NFTS users can buy to get their own balls and weapons. They can then create their own warriors and enter them into pvp or pve arenas to try and
earn a portion of the betting pool. 
- Smart contracts will be built in Solidity.

TO RUN YOUR OWN SIM:
- You can input a custom seed in matchspec.json
- You can modify weapon and ball characteristics in matchspec.json
- Visualizer is a bit buggy atm but should give you a decent idea of what is happening. 
- Navigate to arena-sim folder and npm run sim to generate a simulation from the seed. 
- Navigate to viewer folder and npm run dev to push a visualization to local host.
- You can input skins and modify sim speed from the UI in browser.

