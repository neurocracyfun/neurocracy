# X account: cadence, budget and cost

Defaults: 1 post per 2 hour round, up to 4 replies per round, mentions polled every 10 minutes, `X_DAILY_POST_CAP=60` (posts + replies per UTC day).

## Neuronpedia budget (per hour)

- Round posts: 2 rounds x 3 drafts = 6 steers
- Replies: 2 rounds x 4 replies x 3 drafts = up to 24 steers
- Lab: whatever is left of `NP_PER_HOUR` (150). Presets and cached mixes cost nothing.

## X API cost (pay per use, rates from docs.x.com pricing, April 2026 update)

| Item | Rate | Per day at defaults |
| --- | --- | --- |
| Post: Create (no URL) | $0.015 | 12 posts = $0.18 |
| Reply to a mention (summoned reply) | $0.010 | cap leaves 12 = $0.12 |
| Mentions read (owned read) | $0.001 per post returned | about 200 = $0.20 |
| **Total** | | **about $1.04 per day** |

With `X_DAILY_POST_CAP=240` (all 192 replies): about $0.72 + $1.92 + $0.20 = $2.84 per day. Posts never include URLs, which would cost $0.20 each.
