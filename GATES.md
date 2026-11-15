# Gates — screens redesign

## G1 menu screens
OWNS: Menus.tsx, Room.tsx, menus.css, icons.tsx, main.tsx, App.tsx
CHECK: NODE_PATH=$HOME/.npm/_npx/9833c18b2d85bc59/node_modules node e2e/screens.e2e.cjs
EXPECT: exit=0, offenders=0; presence, no UI emoji, no overflow, tap targets, RU/EN at 360/768/1440
EVIDENCE: RED on merged base 8a0d7ec: exit=1, offenders=223 (e.g. 360 RU home: emoji in button 🌐 Играть онлайн; missing .menu-row). Base default online e2e exit=0, ERRORS=[]; typecheck/build exit=0; core 25/25. Logs: /tmp/nardy-base.log, /tmp/nardy-g1-red.log, /tmp/nardy-g2-red.log. GREEN after Task 5: exit=0, offenders=0 (/tmp/nardy-g1-green.log), RU/EN × 360/768/1440. Intermediate G1: Task 2 offenders=145 (home clean), Task 3=91 (setup/create clean), Task 4=24 (lobby/settings clean).

## G2 game HUD
OWNS: GameHud.tsx, game-hud.css, Game.tsx
CHECK: NODE_PATH=$HOME/.npm/_npx/9833c18b2d85bc59/node_modules node e2e/hud.e2e.cjs; default + all modes of online.e2e.cjs
EXPECT: exit=0 each; hud offenders=0
EVIDENCE: RED on merged base 8a0d7ec: exit=1, offenders=3; 360 RU/EN and 1440 RU each found 0 .strip, expected 2. Base board→HUD gap measured 103.28125px (threshold 16px). GREEN: pending Task 7.
