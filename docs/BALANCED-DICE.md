# Balanced dice v2

All modes use the same hardcoded core policy: AI, hot-seat, online player rolls,
and online timer rolls. Opening contests remain ordinary independent dice.
Short-game opening dice enter the starter's repeat history but remain classified
as opening events in diagnostics. No UI toggle is provided during this trial.

Each seat retains its last two accepted pairs in `MatchState.recentDice` (including
blocked rolls), canonicalized without regard to die order for comparison. A pair
from the previous own turn has weight 0.65, two own turns ago 0.85; if it appeared
on both, weight 0.25 replaces both penalties. Other pairs have weight 1.
The bounded history survives save/reconnect and resets for each new game. Old
saves without this field start with empty history on their next roll.

Catch-up applies only in a pure race: neither player is on the bar, and neither
has an opposing checker anywhere ahead on their remaining path. Both absolute
and relative gap conditions must hold. Strength is the minimum of
`clamp((gap - 25) / 25)` and `clamp((gap / leaderPips - 0.25) / 0.25)`.
Only the trailing seat receives help. Each pair's usefulness is the greatest pip
reduction achievable by a legal turn. Its factor ranges from 0.8 to 1.2 at full
strength, interpolated by usefulness between the least and most productive rolls.
Equal usefulness gives no correction. Match score and AI difficulty have no effect.

Weights multiply and normalize across 36 ordered outcomes. Sampling uses eight
independent uniform die draws (base-six digits); with no corrections the first
two draws are returned directly. Every pair stays possible; there are no forced
wins or guaranteed comeback rolls. This is intentionally a non-classical dice
distribution. Change or remove the policy centrally in `balanced-dice.ts` /
`game.ts`, rather than implementing different rules in controllers.

Validation covers exact weights, race detection, help caps, saved-state migration,
blocked rolls, game reset and a seeded 50,000-sample distribution
check. These checks establish implementation behavior, not player enjoyment or
calibrated comeback rates; those require playtesting.

### Block cooldown

Two blocked outcomes within the last five **own completed turns** disable catch-up
for the next five own turns. A blocked outcome means at least one die could not
be played, including partial doubles (fewer than four moves) and entirely blocked
rolls. A winning turn is not a block merely because dice remained after the last
checker was borne off. Repeat suppression always remains active.

Only a new blocked turn with at least two blocks in its five-turn window restarts
the five-turn cooldown. Clean turns decrement the timer without retriggering it
from old blocks; opponent turns do not decrement it. The triggering turn is not
one of the next five suppressed turns. State is kept per seat in `blockedTurns`
and `catchupCooldown`, saved with the match and reset for a new game. Old saves
start with no block history or cooldown. Resignations and doubling decisions do
not count as completed dice turns.
