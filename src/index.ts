import "reflect-metadata";
import {
  ExecutionReport,
  SymbolLotSizeFilter,
  SymbolPriceFilter,
  UserDataStreamEvent,
} from "binance-api-node";
import cron from "node-cron";
import { createConnection } from "typeorm";

import config from "../config.json";
import { DCABotConfig, DealManager } from "./DealManager";
import { Deal } from "./entity/Deal";
import { Order } from "./entity/Order";
import { getBinanceClient } from "./exchangeAPI/binance";
import { printDealTable } from "./utils";

const isExecutionReport = (userEvt: UserDataStreamEvent): userEvt is ExecutionReport => {
  return `${userEvt.eventType}` === "executionReport";
};

const run = async () => {
  const dbConn = await createConnection("default");
  const dealRepo = dbConn.getRepository(Deal);
  const orderRepo = dbConn.getRepository(Order);

  const bClient = getBinanceClient(config.binance);

  console.log(`Trading on pair ${config.dca.pair}`);

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

  const orderManager = new DealManager(
    config.dca as DCABotConfig,
    priceFilter,
    lotSizeFilter,
    dealRepo,
    orderRepo,
    bClient,
  );

  await bClient.ws.user((evt) => {
    if (isExecutionReport(evt)) {
      console.log(
        `${evt.originalClientOrderId}/${evt.orderId}: ${evt.side} order status updated to ${evt.orderStatus}. Price: ${evt.price}, Amount: ${evt.quantity}`,
      );
      orderManager.refreshDealOnOrderUpdate(evt);
    }
  });

  let deal = await orderManager.startOrContinueDeal();
  printDealTable(deal);

  cron.schedule("* * * * *", async () => {
    const newDeal = await orderManager.startOrContinueDeal();
    if (deal.id !== newDeal.id) {
      console.log("New deal created!");
      printDealTable(newDeal);
      deal = newDeal;
    }
  });
};

run();
