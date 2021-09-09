# Binance DCA Bot

A DCA (Dollar Cost Averaging) Bot for Binance exchange.
If you enjoy DCA bots like the 3Commas' one and don't want to expose your Binance API keys to any third party, this bot is for you.

## Current Limitations

- Only support one trade pair
- Only support LONG deal
- Only one deal at a time

## Configuration

### Binance API key setup

Login your binance.com account and [generate an API key/secret pair](https://www.binance.com/en/support/faq/360002502072). Create a new JSON file called `config.json` under the root of this project. The content should be like this:

```json
{
  "binance": {
    "apiKey": "YOUR_BINANCE_API_KEY",
    "apiSecret": "YOUR_BINANCE_API_SECRET"
  },
  "dca": {
    "pair": "ETHUSDT",
    "strategy": "LONG",
    "baseOrderSize": "20.0",
    "safetyOrderSize": "40",
    "startOrderType": "LIMIT",
    "dealStartCondition": "ASAP",
    "targetProfitPercentage": 1.0,
    "maxSafetyTradesCount": 8,
    "maxActiveSafetyTradesCount": 8,
    "priceDeviationPercentage": 0.5,
    "safetyOrderVolumeScale": 1.1,
    "safetyOrderStepScale": 1.55
  }
}
```

Put your api key and api secret into the `binance` configs and customize the `dca` configs.
`dca` config explanation:

| Config Name                | Description                                                                                                                                                                                                                                             |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| pair                       | The trading pair. The pair must be supported by binance. Check the availability [here](https://api.binance.com/api/v3/exchangeInfo)                                                                                                                     |
| strategy                   | The trading strategy. Either `LONG` or `SHORT`. Current only `LONG` is supported                                                                                                                                                                        |
| baseOrderSize              | The volume of the first order the bot will create when starting a new deal                                                                                                                                                                              |
| safetyOrderSize            | The base safe order amount you are going to use to average the cost.                                                                                                                                                                                    |
| startOrderType             | Order type the bot will use to start the first order. Either `LIMIT` or `MARKET`. Currently only `LIMIT` is supported                                                                                                                                   |
| dealStartCondition         | When to start a new deal. Currently the bot will start new deal right after the previous deal gets closed                                                                                                                                               |
| targetProfitPercentage     | The target profit percentage. For example, after 5 orders your average price is 1000, and the `targetProfitPercentage` is 1, the take profit (sell order) will be priced at 1010.                                                                       |
| maxSafetyTradesCount       | The max no of safety orders the bot will place                                                                                                                                                                                                          |
| maxActiveSafetyTradesCount | The max no of active safety buy orders. Not implemented yet. The bot will place all buy orders when the deal starts                                                                                                                                     |
| priceDeviationPercentage   | The percentage difference in price to create the first Safety Order. All Safety Orders are calculated from the price the initial `baseOrderSize` was filled on the exchange account.                                                                    |
| safetyOrderVolumeScale     | This value is used to multiply the amount of funds used by the last Safety Order that was created. Using a larger amount of funds for Safety Orders allows your bot to be more aggressive at Dollar Cost Averaging the price of the asset being traded. |
| safetyOrderStepScale       | This value is used to multiply the Price Deviation percentage used by the last Safety Order placed on the exchange account.                                                                                                                             |

## Pre calculation

Print the pre-calculated buy orders table by running script

```sh
yarn print-buy-orders
```

![Print Table](/screenshots/print-table.png?raw=true)

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

## Disclaimer

Use at your own risk.
