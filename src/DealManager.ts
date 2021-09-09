import BigNumber from "bignumber.js";
import {
  Binance,
  Order as BinanceOrder,
  SymbolLotSizeFilter,
  SymbolPriceFilter,
  ExecutionReport,
  Symbol as BinanceSymbol,
  OrderSide,
  OrderStatus,
  OrderType,
} from "binance-api-node";
import delay from "delay";
import { last, sortBy } from "lodash";
import { Repository } from "typeorm";

import { Deal } from "./entity/Deal";
import { BuyOrder, Order } from "./entity/Order";
import { logger } from "./logger";

export interface DCABotConfig {
  pair: string;
  strategy: "LONG";
  baseOrderSize: string;
  safetyOrderSize: string;
  startOrderType: string;
  dealStartCondition: string;
  targetProfitPercentage: number;
  maxSafetyTradesCount: number;
  maxActiveSafetyTradesCount: number;
  priceDeviationPercentage: number;
  safetyOrderVolumeScale: number;
  safetyOrderStepScale: number;
}

const applyFilter = (
  amount: BigNumber,
  max: BigNumber,
  min: BigNumber,
  stepSize: BigNumber,
): BigNumber => {
  if (amount.isGreaterThan(max) || amount.isLessThan(min)) {
    throw new Error("Invalid amount");
  }
  const integerSteps = amount.minus(min).dividedBy(stepSize).integerValue();
  const revisedAmount = min.plus(integerSteps.multipliedBy(stepSize));
  return revisedAmount.isLessThan(min)
    ? min
    : revisedAmount.isGreaterThan(max)
    ? max
    : revisedAmount;
};

export const applyPriceFilter = (price: BigNumber, priceFilter: SymbolPriceFilter): BigNumber => {
  const { minPrice, maxPrice, tickSize } = priceFilter;
  return applyFilter(
    price,
    new BigNumber(maxPrice),
    new BigNumber(minPrice),
    new BigNumber(tickSize),
  );
};

export const applyQuantityFilter = (qty: BigNumber, lotFilter: SymbolLotSizeFilter): BigNumber => {
  const { minQty, maxQty, stepSize } = lotFilter;
  return applyFilter(qty, new BigNumber(maxQty), new BigNumber(minQty), new BigNumber(stepSize));
};

export const calculateBuyOrders = (
  currentPrice: BigNumber,
  config: DCABotConfig,
  filters: {
    priceFilter: SymbolPriceFilter;
    lotFilter: SymbolLotSizeFilter;
  },
): BuyOrder[] => {
  const baseOrderSize = new BigNumber(config.baseOrderSize);
  const safetyOrderSize = new BigNumber(config.safetyOrderSize);
  const targetProfit = new BigNumber(config.targetProfitPercentage).dividedBy(100);
  const priceDeviation = new BigNumber(config.priceDeviationPercentage).dividedBy(100);
  const { maxSafetyTradesCount } = config;
  const safetyOrderVolumeScale = new BigNumber(config.safetyOrderVolumeScale);
  const safetyOrderStepScale = new BigNumber(config.safetyOrderStepScale);

  const orders: BuyOrder[] = [];
  for (
    let safeTypeTradeCount = 0;
    safeTypeTradeCount <= maxSafetyTradesCount;
    safeTypeTradeCount++
  ) {
    if (!safeTypeTradeCount) {
      const quantity = applyQuantityFilter(
        baseOrderSize.dividedBy(currentPrice),
        filters.lotFilter,
      );
      orders.push({
        sequence: 0,
        deviation: new BigNumber(0),
        volume: currentPrice.multipliedBy(quantity),
        price: currentPrice,
        averagePrice: currentPrice,
        quantity,
        totalQuantity: quantity,
        totalVolume: currentPrice.multipliedBy(quantity),
        exitPrice: applyPriceFilter(
          currentPrice.multipliedBy(targetProfit.plus(1)),
          filters.priceFilter,
        ),
      });
    } else {
      const volume = safetyOrderSize.multipliedBy(
        safetyOrderVolumeScale.exponentiatedBy(safeTypeTradeCount - 1),
      );
      const deviation = priceDeviation.multipliedBy(
        new BigNumber(1)
          .minus(safetyOrderStepScale.exponentiatedBy(safeTypeTradeCount))
          .dividedBy(new BigNumber(1).minus(safetyOrderStepScale)),
      );
      const price = applyPriceFilter(
        currentPrice.multipliedBy(new BigNumber(1).minus(deviation)),
        filters.priceFilter,
      );
      const quantity = applyQuantityFilter(volume.dividedBy(price), filters.lotFilter);
      const revisedVolume = price.multipliedBy(quantity);
      const totalVolume = BigNumber.sum(...[...orders.map((o) => o.volume), revisedVolume]);
      const totalQuantity = quantity.plus(last(orders)?.totalQuantity ?? 0);
      const averagePrice = totalVolume.dividedBy(totalQuantity);

      orders.push({
        sequence: safeTypeTradeCount,
        deviation: deviation.multipliedBy(100),
        volume: revisedVolume,
        price,
        quantity,
        totalQuantity,
        totalVolume,
        averagePrice,
        exitPrice: applyPriceFilter(
          averagePrice.multipliedBy(targetProfit.plus(1)),
          filters.priceFilter,
        ),
      });
    }
  }

  return orders;
};

export class DealManager {
  private currentDeal: Deal | undefined;

  constructor(
    private readonly config: DCABotConfig,
    private readonly priceFilter: SymbolPriceFilter,
    private readonly lotFilter: SymbolLotSizeFilter,
    private readonly dealRepo: Repository<Deal>,
    private readonly orderRepo: Repository<Order>,
    private readonly bClient: Binance,
    private readonly symbol: BinanceSymbol,
  ) {}

  async startOrContinueDeal(): Promise<Deal> {
    const dealFromDB = await this.getActiveDeal();
    if (dealFromDB) {
      this.currentDeal = dealFromDB;
      for (const order of dealFromDB.orders) {
        if (order.status === OrderStatus.NEW && order.binanceOrderId) {
          const bOrderDetail = await this.getOrderDetail(order.binanceOrderId);
          if (bOrderDetail.status !== OrderStatus.NEW) {
            order.status = bOrderDetail.status;
            if (bOrderDetail.status === OrderStatus.FILLED) {
              order.filledPrice = bOrderDetail.price;
            }
            await this.orderRepo.save(order);
          }
        }
      }
    } else {
      logger.info("No active deal, create a new deal");
      const orders = await this.calBuyOrdersBasedOnCurrentPrice();
      this.currentDeal = await this.createDeal(orders);
      await this.activateDeal();
    }

    return this.currentDeal;
  }

  getActiveDeal(): Promise<Deal | undefined> {
    return this.dealRepo.findOne({ status: "ACTIVE" });
  }

  getDeal(id: number): Promise<Deal | undefined> {
    return this.dealRepo.findOne(id);
  }

  async activateDeal(): Promise<void> {
    if (this.currentDeal) {
      this.currentDeal.status = "ACTIVE";
      await this.dealRepo.save(this.currentDeal);
      await this.placeBuyOrders(this.currentDeal.id);
    }
  }

  async createDeal(buyOrders: BuyOrder[]): Promise<Deal> {
    const deal = new Deal();
    Object.assign(deal, this.config);
    deal.status = "CREATED";
    deal.startAt = new Date();
    await this.dealRepo.save(deal);

    for (const buyOrder of buyOrders) {
      const order = new Order();
      order.sequence = buyOrder.sequence;
      order.volume = buyOrder.volume.toFixed();
      order.deviation = buyOrder.deviation.toFixed();
      order.side = OrderSide.BUY;
      order.price = buyOrder.price.toFixed();
      order.quantity = buyOrder.quantity.toFixed();
      order.totalQuantity = buyOrder.totalQuantity.toFixed();
      order.averagePrice = buyOrder.averagePrice.toFixed();
      order.exitPrice = buyOrder.exitPrice.toFixed();
      order.status = "CREATED";
      order.deal = deal;
      await this.orderRepo.save(order);
    }

    return deal;
  }

  async closeDeal(dealId: number): Promise<void> {
    let deal = await this.dealRepo.findOne(dealId);
    if (!deal) {
      logger.error(`Deal ${dealId} not found`);
      return;
    }

    // cancel all unfilled buy orders
    for (const order of deal.orders) {
      if (order.side === OrderSide.BUY && order.status === "NEW" && order.binanceOrderId) {
        await this.cancelOrder(order);
      }
    }

    while (deal?.orders.find((o) => o.status === OrderStatus.NEW)) {
      await delay(2000);
      deal = await this.dealRepo.findOne(dealId);
    }
    if (!deal) {
      logger.error(`Deal ${dealId} not found`);
      return;
    }

    let filledBuyVolume = new BigNumber(0);
    let filledSellVolume = new BigNumber(0);
    for (const order of deal.orders) {
      if (order.side === OrderSide.BUY) {
        if (order.status === "FILLED") {
          filledBuyVolume = filledBuyVolume.plus(
            new BigNumber(order.filledPrice).multipliedBy(order.quantity),
          );
        }
      } else {
        if (order.status === "FILLED") {
          filledSellVolume = filledSellVolume.plus(
            new BigNumber(order.price).multipliedBy(new BigNumber(order.quantity)),
          );
        }
      }
    }
    const profit = filledSellVolume.minus(filledBuyVolume).toFixed();

    deal.status = "CLOSED";
    deal.endAt = new Date();
    deal.profit = profit;
    await this.dealRepo.save(deal);
    logger.info(deal);
    logger.info(`Deal ${deal.id} closed, profit: ${profit}`);
  }

  async getOrderDetail(binanceOrderId: number): Promise<BinanceOrder> {
    return await this.bClient.getOrder({
      symbol: this.config.pair,
      orderId: binanceOrderId,
    });
  }

  async cancelOrder(order: Order): Promise<void> {
    try {
      const result = await this.bClient.cancelOrder({
        symbol: this.config.pair,
        orderId: order.binanceOrderId,
      });
      logger.info(
        `${result.side} order ${result.orderId} has been cancelled, status ${result.status}`,
      );
    } catch (err) {
      logger.error("Failed to cancel order", order, err);
    }
  }

  async placeBinanceOrder(order: Order): Promise<BinanceOrder | undefined> {
    try {
      const newOrder = await this.bClient.order({
        newClientOrderId: order.id,
        side: order.side,
        symbol: this.config.pair,
        type: OrderType.LIMIT,
        price: order.price,
        quantity: order.quantity,
      });

      logger.info(`${order.id}/${order.binanceOrderId}: New ${order.side} order has been placed`);
      return newOrder;
    } catch (err) {
      logger.error("Failed to place order", order, err);
    }
  }

  async placeBuyOrders(dealId: number): Promise<void> {
    const activeDeal = await this.getDeal(dealId);
    if (!activeDeal) {
      throw new Error(`Active deal ${dealId} not found`);
    }

    this.currentDeal = activeDeal;
    const orders = this.currentDeal.orders;
    const buyOrders = sortBy(
      orders.filter((o) => o.side === "BUY"),
      ["sequence"],
    );

    for (const bo of buyOrders) {
      if (!bo.binanceOrderId && bo.status === "CREATED") {
        await this.placeBinanceOrder(bo);
      }
    }
  }

  async refreshDealOnOrderUpdate(executionReportEvt: ExecutionReport): Promise<void> {
    const { originalClientOrderId, newClientOrderId, orderId, orderStatus, price } =
      executionReportEvt;

    const clientOrderId = originalClientOrderId || newClientOrderId;
    const order = await this.orderRepo.findOne(clientOrderId, {
      relations: ["deal"],
    });
    if (!order) {
      logger.info(`Order ${clientOrderId} not found`);
      return;
    }
    const deal = await this.dealRepo.findOne(order.deal.id);
    if (!deal) {
      logger.warn(`Invalid deal ${order.deal.id}`);
      return;
    }

    if (order.side === "BUY") {
      switch (orderStatus) {
        case "NEW":
          if (order.status === "CREATED") {
            order.binanceOrderId = orderId;
            order.status = OrderStatus.NEW;
            await this.orderRepo.save(order);
            logger.info(
              `${clientOrderId}/${order.binanceOrderId}: NEW buy order. Price: ${price}, Amount: ${order.quantity}`,
            );
          }
          break;

        case "FILLED":
          if (
            order.status === "CREATED" ||
            order.status === "NEW" ||
            order.status === "PARTIALLY_FILLED"
          ) {
            const existingSellOrder = deal.orders.find(
              (o) => o.side === "SELL" && o.status === "NEW",
            );
            if (existingSellOrder) {
              await this.cancelOrder(existingSellOrder);
            }

            order.binanceOrderId = orderId;
            order.status = OrderStatus.FILLED;
            order.filledPrice = price;
            await this.orderRepo.save(order);
            logger.info(
              `${clientOrderId}/${order.binanceOrderId}: Buy order ${order.side} has been FILLED. Price: ${price}, Amount: ${order.quantity}`,
            );
            // Cancel existing sell order (if any)
            // and create a new take-profit order

            let newSellOrder = new Order();
            newSellOrder.deal = deal;
            newSellOrder.side = OrderSide.SELL;
            newSellOrder.status = "CREATED";
            newSellOrder.price = order.exitPrice;
            newSellOrder.quantity = order.totalQuantity;
            newSellOrder.volume = new BigNumber(order.exitPrice)
              .multipliedBy(order.totalQuantity)
              .toFixed();
            newSellOrder.sequence = 1000 + order.sequence;
            newSellOrder = await this.orderRepo.save(newSellOrder);

            const bSellOrder = await this.placeBinanceOrder(newSellOrder);
            if (bSellOrder) {
              newSellOrder.status = OrderStatus.NEW;
              newSellOrder.binanceOrderId = bSellOrder.orderId;
              newSellOrder = await this.orderRepo.save(newSellOrder);
            }
          }

          break;

        case "PARTIALLY_FILLED":
        case "CANCELED":
        case "REJECTED":
        case "EXPIRED":
          order.status = orderStatus;
          await this.orderRepo.save(order);
          logger.info(
            `${clientOrderId}/${order.binanceOrderId}: Buy order is ${orderStatus}. Price: ${price}, Amount: ${order.quantity}`,
          );
          break;

        default:
          logger.error("Invalid order status", orderStatus);
      }
    } else {
      order.status = orderStatus;
      order.binanceOrderId = orderId;
      await this.orderRepo.save(order);
      logger.info(
        `${clientOrderId}/${order.binanceOrderId}: Sell order is ${orderStatus}. Price: ${price}, Amount: ${order.quantity}`,
      );

      if (orderStatus === "FILLED") {
        await this.closeDeal(deal.id);
      }
    }
  }

  private async calBuyOrdersBasedOnCurrentPrice(): Promise<BuyOrder[]> {
    const prices = await this.bClient.prices();
    const currentPriceStr = prices[this.config.pair];
    logger.info(`Current price for ${this.config.pair} is ${currentPriceStr}`);

    const buyOrders = calculateBuyOrders(new BigNumber(currentPriceStr), this.config, {
      priceFilter: this.priceFilter,
      lotFilter: this.lotFilter,
    });

    const lastBuyOrder = last(buyOrders);
    if (!lastBuyOrder) {
      throw new Error("Must have at least one buy order");
    }
    const accountInfo = await this.bClient.accountInfo();
    const balance = accountInfo.balances.find((b) => b.asset === this.symbol.quoteAsset);
    if (!balance) {
      throw new Error(`Quote asset ${this.symbol.quoteAsset} is not supported`);
    }
    if (lastBuyOrder.totalVolume.isGreaterThan(new BigNumber(balance.free))) {
      throw new Error(
        `Not enough ${
          this.symbol.quoteAsset
        } balance to support this deal. ${lastBuyOrder.totalVolume.toFixed()} is needed, only ${
          balance.free
        } available in the wallet`,
      );
    }
    return buyOrders;
  }
}
