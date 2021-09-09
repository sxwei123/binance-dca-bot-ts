# Binance DCA Bot

A DCA (Dollar Cost Averaging) Bot for Binance exchange.
If you enjoy DCA bots like the 3Commas' one and don't want to expose your Binance API keys to any third party, this bot is for you.

## Current Limitations

- Only support one trade pair
- Only support LONG deal
- Only one deal at a time

## Configuration

## Pre calculation

Print the pre-calculated buy orders table by running script

```sh
yarn print-buy-orders
```

## Run the bot

### Node.js

Tested with node 14. Should work for node 12+.

```sh
yarn install

# run directly from typescript source code
yarn start

# or run the javascript with pm2
yarn serve
```

## TODOs

- [ ] Do paper trading with Binance real data
- [ ] implement maxActiveSafetyTradesCount
- [ ] Add unit test and integration test
- [ ] Add Dockerfile and docker-compose.yml
- [ ] Handle websocket reconnection in case the device goes offline
- [ ] Close deal manually
- [ ] Monitor order status with REST apis
- [ ] take account for trading fees
- [ ] Handle partially filled orders
- [ ] Add dockerfile and docker-compose file for easy deployment
