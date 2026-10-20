# The bot account

The mind has its own X account, separate from @neurocracyfun. Handle: [@neurocracymind](https://x.com/neurocracymind) (user id 1165034468966617089, `NC_BOT_HANDLE=neurocracymind`). Its bio is fixed and set by hand; the code never changes it. Only the avatar and the display name follow the round.

## Every round

When a 30 minute round closes and the result applies, the account does three things at the same time:

1. Changes its profile picture to the winning persona (X API v1.1 `account/update_profile_image`).
2. Changes its display name to the persona name (X API v1.1 `account/update_profile` with only the `name` parameter, max 50 characters): one persona `The Owl`, a pair from `public/img/hybrids/names.json` (`The Octopus Chef`, `The Owl Captain`), three or more `The Owl and friends`, nothing from the library `The Octopus Chef`. Set `NC_BOT_RENAME=0` to keep the name fixed.
3. Writes one post (X API v2 `POST /2/tweets`) with the round illustration attached (`POST /2/media/upload`).

Post format:

```
This round's vote: {pct}% {Noun}, {pct}% {Noun}. So right now I am {persona}. {optional short model line} Got a question or something you want me to do?
```

Example, a 50 50 tie between The Sea and The Chef:

```
This round's vote: 50% Octopus, 50% Chef. So right now I am The Octopus Chef. Eight arms, one kitchen. Tonight I am stirring a seaweed broth with one arm and plating scallops with three more. Got a question or something you want me to do?
```

A single persona: `This round's vote: 100% Owl. So right now I am The Owl. ... Got a question or something you want me to do?`

- The vote line always comes first and uses short nouns: Owl, Cat, Pirate, Degen, Fossil, Astronomer, Octopus, Chef, Ghost, Bard, Lord, Romantic (a community feature uses its own name). Shares are each candidate's part of the round's total vote weight. A round nobody voted on shows 100% for the persona it wears.
- Persona names: one library persona uses its name. A mix uses a hand-picked hybrid name when there is one (`chef+ocean` is The Octopus Chef), otherwise the names are listed (`The Owl and The Cat`). Nothing from the library steered: The Octopus Chef.
- Length: the whole post must fit 280 characters. First the model line is dropped, then the persona list gets shorter (`The Owl, The Cat and 3 more`). The vote line and the closing question are never dropped.
- The model line is the steered model's draft after the normal filter. If it already ends with the closing question, it is not repeated.

## Images

| Case | Avatar | Image on the post |
|---|---|---|
| One of the 12 library personas (owl, cat, pirate, degen, dino, space, ocean, chef, ghost, bard, lord, romantic) | `public/img/avatars/{id}.png`, 400x400 on cream paper, built by `python3 scripts/build-avatars.py` from `public/img/minds/` | full 4:3 drawing `public/img/minds/{id}.webp` |
| A mix | the hybrid drawing (X crops it square) | the hybrid drawing |
| Nothing from the library | `public/img/avatars/default.png` (octopus chef) | `public/img/hybrids/chef+ocean.jpg` |

Hybrids are looked up by the sorted persona combo key, for example `chef+ocean`. Seeded hybrids ship in `public/img/hybrids/`. Any other mix is generated once with an image API in the house style (wobbly hand-drawn ink lines, sparse hatching, paper grain, light ochre and sage wash, cream paper, no text, no logos) and cached on the data disk (`/var/data/avatars`), so a repeated combo costs nothing. The site shows the round's image through `/api/round` (`avatarUrl`, `personas`).

Image providers, set with `NC_IMAGE_PROVIDER`:

| Provider | Model (default) | Size | Price per image |
|---|---|---|---|
| `openai` | `gpt-image-1`, medium quality | 1536x1024 | $0.063 |
| `xai` | `grok-imagine-image` | 3:2 | $0.02 |

Prices from the OpenAI model page and the xAI pricing page as of October 2026. With 12 single personas free and hybrids cached, the cost is only paid the first time a new mix wins.

## Limits and safety

- The avatar and display name change together, only when the persona set differs from the current one, at most once every `NC_AVATAR_MIN_MINUTES` (30) and `NC_AVATAR_DAILY_MAX` (24) times per UTC day. Avatar images over 700 KB are skipped.
- Posts follow the existing caps (`X_DAILY_POST_CAP`, one post per round).
- If the media upload fails, the post goes out text only and the error is logged.
- `NC_AVATAR=0` by default. Under `DRY_RUN=1` nothing is sent to X and no image API is called, unless `NC_AVATAR_GEN_IN_DRY=1`, which allows generation only.
- Keys come from env and are never logged. The bot uses `X_APP_KEY`, `X_APP_SECRET`, `X_ACCESS_TOKEN`, `X_ACCESS_SECRET` of the bot account.

## Scripts

- `node scripts/bot-sim-round.js [out.md]` runs one round locally with mocked X and image API and writes the would-be post.
- `CONFIRM=1 node scripts/bot-test-post.js` sends one real test post with the bot keys (sets the default avatar and the name The Octopus Chef, uploads the octopus chef, posts `Test post. ` plus the 50 50 example above). Without `CONFIRM=1` it only prints.

All env vars are listed in `docs/render-env.md`.
