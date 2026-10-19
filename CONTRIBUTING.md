# Contributing

1. `npm install && npm run build && npm test`
2. `npm start` and open http://127.0.0.1:5310
3. Keep pull requests small. New presets go in `scripts/presets-def.json`, then `npm run presets` regenerates `data/presets.json` (uses Neuronpedia's public API, mind the rate limit).
4. Anything the model writes in public must pass `lib/filter.js`. Add a test when you change it.
