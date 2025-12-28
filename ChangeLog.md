# Where to resume
Changes 12/28
- Implemented physical weeapon-weapon collisions. Tips now collide. When clashes occur no damage is dealt. Balls bounce away from impact. Added CD to tip collisions.
- Added directional knockback on weapon hits.
- Added velocity dampening on ball-ball collisions.
- Implemented tip velocity physics. Collsions consider ball movement, weapon rotation speed.
- Added weapon weight as a prameter. Effects knockback strength

Issues
- Still some overlap in visualization of objects. 
- Sim takes longer to resolve now.
- Collision dampening is maybe too aggressive and weapon strikes not explosive enough. 
- Directional knockback needs more work.

Next up:
- Event log
- 


-------------------------------------------------------------------------------------------

Changes 12/27
- Interactions were infrequent and the visualization was too fast for the human eye
- Tightened arena, enlarged balls, slowed velocity, added slight gravity well. Simulations last about 800 ticks now or roughly 2-3 minutes. 
- Weapons weren't rotating, adjusted omega, looks better.
- Added PNG upload for balls. Works well enough.
- Added PNG upload for weapons. Not working very well.
- Adjusted render order so balls look more like the weapon begins at their edge. Need to rework png mapping to the weapon range and tip so its not just an orb. Possibly make weapon tips track dimension of png and adjust the size. I'm not sure. Need to think more on this one. 

Immediate next steps:
- Fix weapon PNGS
- Fix render order
- Tweak arena render a bit more
- Make collisions feel more impactful. Add velocity to weapon strikes and momentum decay from bounces and ball-ball collision.
- See about making an exe or hosting somewhere, maybe corval.club secret link?
- Weapon range and tip maybe don't need to be rendered at all? 

Next logical options:
1) Phase 4 polish (HP bars, hit flashes, timeline)
2) Freeze v0.1 sim spec + simVersion
3) Begin Phase 5 design (Ball NFT + match/betting contracts)
4) Return to Phase 3 to build advanced weapon logic
5) Discuss aesthetic considerations
6) Reasses arena size, health points, the size of the balls

Last discussed direction:
- Pausing before Phase 4 polish / Phase 5
