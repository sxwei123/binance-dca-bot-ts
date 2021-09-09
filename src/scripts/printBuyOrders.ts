import fse from "fs-extra";
import path from "path";

import { getBinanceClient } from "../exchangeAPI/binance";
import { SymbolLotSizeFilter, SymbolPriceFilter } from "binance-api-node";
import { calculateBuyOrders, DCABotConfig } from "../DealManager";
import BigNumber from "bignumber.js";

async function printBuyOrders() {
  const config = await fse.readJSON(path.join(__dirname, "../../config.json"));
  const bClient = getBinanceClient(config.binance);
  const exchangeInfo = await bClient.exchangeInfo();
  const symbol = exchangeInfo.symbols.find((s) => s.symbol === config.dca.pair);

  if (!symbol) {
    throw new Error(`Symbol ${config.dca.pair} is not supported by Binance exchange`);
  }

  const lotSizeFilter = symbol.filters.find((f) => f.filterType === "LOT_SIZE") as
    | SymbolLotSizeFilter
    | undefined;
  const priceFilter = symbol.filters.find(
    (f) => f.filterType === "PRICE_FILTER",
  ) as SymbolPriceFilter;
  if (!lotSizeFilter || !priceFilter) {
    throw new Error("LOT_SIZE or PRICE_FILTER not exist");
  }

  const prices = await bClient.prices({
    symbol: config.dca.pair,
  });
  const currentPriceStr = prices[config.dca.pair];
  console.log(`Current price for ${config.dca.pair} is ${currentPriceStr}`);

  const buyOrders = calculateBuyOrders(new BigNumber(currentPriceStr), config.dca as DCABotConfig, {
    priceFilter,
    lotFilter: lotSizeFilter,
  }).map((bo) => ({
    sequence: bo.sequence,
    deviation: bo.deviation.toFixed(),
    volume: bo.volume.toFixed(),
    price: bo.price.toFixed(),
    averagePrice: bo.averagePrice.toFixed(),
    quantity: bo.quantity.toFixed(),
    totalQuantity: bo.totalQuantity.toFixed(),
    totalVolume: bo.totalVolume.toFixed(),
    exitPrice: bo.exitPrice.toFixed(),
  }));

  console.table(buyOrders, [
    "deviation",
    "quantity",
    "volume",
    "price",
    "averagePrice",
    "exitPrice",
    "totalQuantity",
  ]);
}

printBuyOrders().catch(console.error);
