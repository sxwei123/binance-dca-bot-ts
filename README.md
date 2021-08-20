# Binance DCA Bot

A DCA (Dollar Cost Averaging) Bot for Binance exchange.
If you enjoy DCA bots like the 3Commas' one and don't want to expose your Binance API keys to any third party, this bot is for you.

## Current Limitations

- Only support one trade pair
- Only support LONG deal

## Run the bot

### Docker

### Node.js

## TODOs

- [ ] Add proper logger with timestamp
- [x] Config eslint and prettier
- [ ] implement maxActiveSafetyTradesCount
- [x] Fix ugly type casts (https://github.com/Ashlar/binance-api-node/pull/487)
- [ ] Add unit test and integration test
- [ ] Add Dockerfile and docker-compose.yml
- [ ] Handle websocket reconnection
- [ ] Add DB transaction lock
- [ ] Close deal manually
- [ ] Do paper trading with Binance real data
- [ ] Monitor order status with REST apis
