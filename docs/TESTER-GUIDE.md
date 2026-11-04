# Tester guide

Use this for running mode queues and completing tests. You need **Staff + the matching mode's Tester role** to open a queue. For example, Sword needs Sword Tester. Ask a Bot Admin or Owner if either role is missing.

## Start and finish your session

`/start mode:Sword region:NA` — Open Sword's NA queue when you are ready to test. The bot pings that queue's waitlist role. Region choices are `NA`, `EU` and `AS` (Asia/Australia).

`/next` — Take the next eligible queued player and open their evaluation ticket. Use it again when you are ready for another test.

`/stop` — End your session when you finish or go AFK. When the last tester stops, that queue closes, its waiting queue is cleared and its opening ping is removed.

You can run one testing session in this server at a time. Stop before changing modes or regions. A separate Crystal session can run alongside it. Testers can join queues as players too, but another tester should handle their test.

## Run an evaluation

1. Open the ticket and confirm the player, Minecraft username, region and preferred server.
2. Run the evaluation and keep the scores in the ticket.
3. If they pass, use `/passeval`. The bot assigns interim LT3 and moves the same ticket to that mode's High Tests category for HT3 testing.
4. Use `/format tier:HT3` for the result template. Copy it, fill in the fights and post the completed result.
5. Use `/close tier:HT3` if HT3 was earned, or choose the actual earned tier. Closing records the result, updates the rank/cooldown and saves a transcript before deleting the channel.

`/skip` is only for an evaluation that has not passed. It is blocked after `/passeval`. Use `/close tier:Test Discontinued` when a test cannot be completed; this restores the opening rank and awards no completed-test credit.

## High tests and helpers

High-ranked players go straight to a high ticket: **HT3 → LT2, LT2 → HT2, HT2 → LT1, LT1 → HT1**. HT1 players should make a general support ticket for rank defenses or retirement.

`/add member:@tester` — Add the staff member handling the test. In an unassigned test, the first eligible staff member added becomes its tester. Add the intended tester before adding opponents.

`/addht3` / `/addlt2` — Add an eligible opponent from this mode and region's list.

`/remove member:@person` — Remove an added participant. The opener and original tester cannot be removed this way.

`/rename name:...` — Give a registered ticket a useful name.

Staff can help in a testing ticket without that mode's Tester role. The mode role controls opening its queue. Inside a test ticket, commands infer the mode.

## Profiles, statistics and problems

`/profile member:@player mode:Sword` — Check the saved account, region and rank.

`/stats member:@tester mode:Sword` — Check monthly completed tests. `/testerstats mode:Sword` shows your quota statistics; `/testerlb mode:Sword period:monthly` shows the leaderboard. `weekly` and `all` are also available for the leaderboard.

If a player cannot join, check verification, Enter Waitlist for that mode, whether a tester is online, cooldown, restrictions and an existing test in that mode. A cooldown rejection includes its end time. Don't promise a reset unless an authorized person approves it.

Use the Staff guide for support-ticket tools and LOA. Ask a Regulator about forced tests or deadlines, a CD Resetter/Bot Admin about individual cooldown resets, and a Bot Admin about unlinking an incorrect account.
