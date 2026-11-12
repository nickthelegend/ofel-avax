# Ofel: screen-by-screen audit (ship round, Nov 12–13, 2026)

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
