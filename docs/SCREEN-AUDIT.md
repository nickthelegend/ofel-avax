# Ofel: screen-by-screen audit

## Desk v2 (Nov 13, 2026): rebuilt on Eidolon's UI base

Nick, after the first film: "Ofel should look like the way we built Eidolon… a desk with everything: a trading desk,
price charts and candles." Then: "I want Eidolon to be the BASE of Ofel." The web app now forks Eidolon's design
system and terminal layout (README, Prior work) and keeps Ofel's name, mark, obsidian 3D art and copper first light.

Every screen is judged side by side with the Eidolon screen it was forked from, at 1440 and 375:
`orchestration/shots/avax-ofel/desk-v2/vs-eidolon/vs-<screen>-<width>.jpg` (made by `scripts/qa/vs-eidolon.py`).
Hosted screenshots: `desk-v2/before/` (the old desk) and `desk-v2/after/` (https://ofel-desk.vercel.app after this
round, `scripts/qa/shots.mjs`), and the live judge path with a brand-new wallet in `desk-v2/after/judge-path/`
(`scripts/qa/judge-path.mjs`: Start with a test wallet → Get test funds → seal → Try to open it now → close → one
price → settle privately → claim bond; batch #195, 0 console errors).

| Screen / state | Width | Eidolon counterpart | Score | Notes |
|---|---|---|---|---|
| Desk, signed in (chart, sealed book, ticket, tabs) | 1440 | trade-quoted | 9 | Same grid as Eidolon: night market bar, chart left, centre panel, ticket right, tabs below. Market bar: Chainlink AVAX/USD (Fuji), Coinbase AVAX-USD with 1 h change, last Ofel clear, batch countdown, validators online, 1m/5m/15m/1h. Two-pane chart: real candles + Chainlink, and Ofel's clears with batch markers and the typed limit. |
| Desk | 375 | trade-375 | 9 | Stacks like Eidolon's: bar → chart → ticket → sealed book → tabs. Chart shows 48 candles on phones; limit caption hidden, its axis tag kept. |
| Desk, signed out | 1440 / 375 | trade-empty | 9 | One primary action, "Start with a test wallet"; tabs explain what connecting unlocks. |
| Desk, new empty wallet (setup) | 1440 / 375 | — | 9 | Three checklist rows and one "Get test funds" button; finished in 30 s on the hosted run. |
| Ticket mid-seal → sealed → refused → cleared → settled | 1440 / 375 | trade-quoted (dry-run box) | 9 | Live order status under the button: sealed in the browser (bytes, tx), batch closes, validators open it, one price (fill), settled by eERC transfer, claim bond. "Try to open it now" shows `closeBatch` reverting with TooEarly and all three validators refusing. |
| Tabs: Your orders (P&L), Recent clears, Batches, Private balances, Auditor | 1440 / 375 | trade-rounds / memories / habits | 9 | Eidolon's tab bar and tables; P&L marked at the last clear; tape of clears with prices and matched size, single sizes never shown. |
| Landing | 1440 | home | 9 | Eidolon's structure: night hero with the live desk in a device frame, trust strip, live numbers, three benefits with Ofel's art, who-sees-what, proof list, CTA, footer. |
| Landing | 375 | home-375 | 9 | Who-sees-what fits (Yes / Never / Sealed); section art loads eagerly. |
| Batches list | 1440 / 375 | leaderboard | 9 | One table, state pills, prices, close times. |
| Batch detail | 1440 | round | 9 | Summary card + night verdict (clearing price, proven totals), timeline, orders as stored (limits after close, sizes as commitments, raw input), signatures verified in the browser. |
| Batch detail | 375 | round-375 | 9 | Trader column hidden on phones so side, limit, commitment and status fit. |
| Portfolio | 1440 / 375 | trade-habits | 9 | Private balances (decrypted here, ciphertext shown), orders with P&L and settle actions. |
| Auditor (key active / locked) | 1440 / 375 | trade-rounds | 9 | Opened orders with commitment checks; eERC legs with asset; locked state names the auditor wallet. |
| Validators | 1440 / 375 | leaderboard / round | 9 | Night "online now" card, PoA facts with Explorer links, P-Chain balances and runway. |
| Not found | 1440 / 375 | — | 9 | Empty-state art and one action. |
| Loading / error | both | — | 9 | Skeletons; errors name the source (e.g. P-Chain). P-Chain reads now try the public mirror first, then the official endpoint (the official one rate-limited this Mac with 429s). |

Still short of a 10, honestly: the 1440 sealed-book panel scrolls inside itself below ~900 px of height (Eidolon's
ghost panel does the same); the tAVAX/tUSDC pane has few points because the L1 only clears when someone trades.

## Ship round (Nov 12–13, 2026), the previous desk

Every hosted route and state of https://ofel-desk.vercel.app at 1440 and 375, judged before and after this round.
Screenshots: `orchestration/shots/avax-ofel/ship/before/` (hosted, before) and `.../ship/after/` (hosted, after),
`<route>-1440.png` / `<route>-375.png`. The look is unchanged (obsidian, bone and first light; Epilogue and Libertinus
Mono); fixes are copy, layout, states and function only, plus new objects from the existing art kit.

Signed-in screens use the Test wallet slot filled with the QA roles' keys in the headless browser (`scripts/qa/shots.mjs`,
never written to disk); "new wallet" is a fresh random key that has never been funded.

| Screen / state | Width | Before | What was wrong | Fix | After |
|---|---|---|---|---|---|
| Landing | 1440 | 8 | "Trade size in the dark." didn't say who it's for or what they get; the audience line sat in small print below the buttons; five sections with long copy ("Penumbra-grade privacy…"). | Headline "Trade size without being front-run.", one sub-line naming funds, DAOs and treasuries, one primary action (Open the desk), why-Avalanche line. Four sections: how it works (3 steps), what's private and proven (live L1 numbers + who-sees-what), try it with an empty wallet, check it yourself (contracts, P-Chain txs, Avalanche Explorer). New hero, step, desk and proof objects; OG card. | 9 |
| Landing | 375 | 7.5 | Hero object 340 px tall pushed everything down; eclipse squashed to an oval (fixed height attribute, fluid width); step cards very tall. | Hero object capped at 260 px with `height: auto`; step cards become icon-left rows. | 9 |
| Desk, signed out | 1440 / 375 | 8 | The ticket's only button was a disabled "Connect to seal an order": a dead end for a judge. | It reads "Start with a test wallet" and makes one in a tap. | 9 |
| Desk, new empty wallet | 1440 | 7.5 | "Your orders are sealed, even here / Decrypt my orders" for a wallet that has never ordered; "Opens at" next to status "Open" and "Batch #N seals in" contradicted each other; a four-line explainer. | Order count read from the public `OrderSealed` index first: "No orders from this wallet yet" with no decrypt step (or "N sealed orders from this wallet" + Decrypt). Labels now "Closes at", "closes in", "Sealed until", "At close". Explainer cut to two short sentences. | 9 |
| Desk, signed in with orders | 1440 | 8.5 | Same label and copy issues. | As above. | 9 |
| Desk | 375 | 7 | Strip value "3/3 online · an…" truncated; the list header's Portfolio button wrapped under the tabs; tables wrapped addresses mid-word. | Smaller strip values; Portfolio button hidden on phones (the tab bar has it); one-line table cells, Limit column hidden on phones. | 9 |
| Batches list | 1440 | 8.5 | Three-line intro. | One line. | 9 |
| Batches list | 375 | 6.5 | Batch number centred beside a tall timeline, leaving half of each card empty; "not before 16:02…" cut. | Batch number and order count on one row, the timeline full width under it, price last. | 9 |
| Batch detail (cleared) | 1440 | 8.5 | Long signature explainer; "Fetch and verify signatures" kept its label after verifying. | Short explainer; button becomes "Check again". | 9 |
| Batch detail | 375 | 6 | Orders table broke the commitment column one character per line and cut "Raw input". | One-line cells; index and Tx columns hidden on phones. | 8.5 |
| Portfolio, signed in | 1440 | 8.5 | Two-line intro. | One line. | 9 |
| Portfolio | 375 | 6.5 | Coin object 200 px above the balances; table cut at Price. | Object 96 px; Limit hidden; one-line cells. | 8.5 |
| Portfolio, signed out | 1440 / 375 | 8.5 | — | — | 8.5 |
| Auditor, key active | 1440 | 8 | Settlement amounts had no asset (31,450.00 of what?); addresses mixed lower-case and checksummed. | Each leg's asset read from its eERC `transfer(to, tokenId, …)` call and the token map (tUSDC / tAVAX); every address checksummed. | 9 |
| Auditor | 375 | 6 | Card titles wrapped to three lines; addresses split across lines. | Panel headers stack; one-line cells; #, Opened with, Type and Tx hidden on phones. | 8.5 |
| Auditor, locked (non-auditor wallet) | 1440 / 375 | 9 | — | — | 9 |
| Validators | 1440 | 8.5 | Two-line intro. | One line. | 9 |
| Validators | 375 | 6.5 | Node IDs and BLS keys broken over three lines; balance column cut. | BLS key, weight and endpoint hidden on phones; one-line cells; object 96 px. | 8.5 |
| Not found | 1440 / 375 | 6 | Bare "Not found" heading and a text link. | The empty-state object, "No page at this address" and a Go to the desk button. | 9 |
| Loading (skeletons) | both | 8.5 | — | — | 8.5 |
| L1 unreachable (error) | both | 8.5 | Read from code, not forced on the hosted site: the net pill turns red ("L1 unreachable"), pages show the cracked-seal error box with the RPC, the landing says live data is unavailable. | Landing message shortened. | 8.5 |
| Mid-transaction (Sealing…, sealed receipt, settle) | both | 8.5 | Not re-shot this round (the Nov 12 hosted judge run, batch 6, exercised it end to end). | "At T" wording only. | 8.5 |

## Screens still below 9, and why

- **Batch detail, Portfolio, Auditor and Validators at 375 (8.5):** the tables keep one line per row and scroll
  sideways for the last column or two (Status, Notional). Cards per row would lose the scan-down comparison that
  matters on these pages; left as is.
- **Loading, error and mid-transaction states (8.5):** correct, but not re-captured on the hosted site this round.
