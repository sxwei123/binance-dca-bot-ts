import BigNumber from "bignumber.js";
import {
  Binance,
  OrderSide,
  Order as BinanceOrder,
  SymbolLotSizeFilter,
  SymbolPriceFilter,
  ExecutionReport,
} from "binance-api-node";
import { last, sortBy } from "lodash";
import { Repository } from "typeorm";

import { Deal } from "./entity/Deal";
import { BuyOrder, Order } from "./entity/Order";

export interface DCABotConfig {
  pair: string;
  strategy: string;
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

export class DealManager {
  private currentDeal: Deal | undefined;

  constructor(
    private readonly config: DCABotConfig,
    private readonly priceFilter: SymbolPriceFilter,
    private readonly lotFilter: SymbolLotSizeFilter,
    private readonly dealRepo: Repository<Deal>,
    private readonly orderRepo: Repository<Order>,
    private readonly bClient: Binance,
  ) {}

  async startOrContinueDeal(): Promise<Deal> {
    const dealFromDB = await this.getActiveDeal();
    if (dealFromDB) {
      this.currentDeal = dealFromDB;
    } else {
      console.log("No active deal, create a new deal");
      const orders = await this.calculateBuyOrders();
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
      order.side = "BUY";
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
    const deal = await this.dealRepo.findOne(dealId);
    if (!deal) {
      console.error(`Deal ${dealId} not found`);
      return;
    }

    let filledBuyVolume = new BigNumber(0);
    const filledSellVolume = new BigNumber(0);
    for (const order of deal.orders) {
      if (order.side === "BUY") {
        if (order.status === "NEW" && order.binanceOrderId) {
          await this.cancelOrder(order);
          order.status = "CANCELED";
          await this.orderRepo.save(order);
        }
        if (order.status === "FILLED") {
          filledBuyVolume = filledBuyVolume.plus(
            new BigNumber(order.filledPrice).multipliedBy(order.quantity),
          );
        }
      } else {
        if (order.status === "FILLED") {
          filledSellVolume.plus(
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
    console.log(deal);
    console.log(`Deal ${deal.id} closed, profit: ${profit}`);
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
      console.log(
        `${result.side} order ${result.orderId} has been cancelled, status ${result.status}`,
      );
    } catch (err) {
      console.error("Failed to cancel order", order, err);
    }
  }

  async placeBinanceOrder(
    clientOrderId: string,
    side: OrderSide,
    price: string,
    quantity: string,
  ): Promise<BinanceOrder> {
    const newOrder = await this.bClient.order({
      newClientOrderId: clientOrderId,
      side,
      symbol: this.config.pair,
      type: "LIMIT",
      price,
      quantity,
    });

    console.log(`New ${side} order ${clientOrderId} has been placed, ${price} * ${quantity}`);
    return newOrder;
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
        await this.placeBinanceOrder(`${bo.id}`, "BUY", bo.price, bo.quantity);
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
      console.log(`Order ${clientOrderId} not found`);
      return;
    }
    const deal = await this.dealRepo.findOne(order.deal.id);
    if (!deal || deal.status !== "ACTIVE") {
      console.warn(`Invalid deal ${order.deal.id}`);
      return;
    }

    if (order.side === "BUY") {
      switch (orderStatus) {
        case "NEW":
          order.binanceOrderId = orderId;
          order.status = "NEW";
          await this.orderRepo.save(order);
          break;

        case "FILLED":
          const existingSellOrder = deal.orders.find(
            (o) => o.side === "SELL" && o.status === "NEW",
          );
          if (existingSellOrder) {
            await this.cancelOrder(existingSellOrder);
          }

          order.binanceOrderId = orderId;
          order.status = "FILLED";
          order.filledPrice = price;
          await this.orderRepo.save(order);
          // Cancel existing sell order (if any)
          // and create a new take-profit order

          let newSellOrder = new Order();
          newSellOrder.deal = deal;
          newSellOrder.side = "SELL";
          newSellOrder.status = "CREATED";
          newSellOrder.price = order.exitPrice;
          newSellOrder.quantity = order.totalQuantity;
          newSellOrder.sequence = 1000 + order.sequence;
          newSellOrder = await this.orderRepo.save(newSellOrder);

          const bSellOrder = await this.placeBinanceOrder(
            newSellOrder.id,
            "SELL",
            newSellOrder.price,
            newSellOrder.quantity,
          );
          newSellOrder.status = "NEW";
          newSellOrder.binanceOrderId = bSellOrder.orderId;
          newSellOrder = await this.orderRepo.save(newSellOrder);
          break;

        case "PARTIALLY_FILLED":
        case "CANCELED":
        case "REJECTED":
        case "EXPIRED":
          order.status = orderStatus;
          await this.orderRepo.save(order);
          break;

        default:
          console.error("Invalid order status", orderStatus);
      }
    } else {
      order.status = orderStatus;
      order.binanceOrderId = orderId;
      await this.orderRepo.save(order);
      if (orderStatus === "FILLED") {
        await this.closeDeal(deal.id);
      }
    }
  }

  private applyPriceFilter(price: BigNumber): BigNumber {
    const { minPrice, maxPrice, tickSize } = this.priceFilter;
    return applyFilter(
      price,
      new BigNumber(maxPrice),
      new BigNumber(minPrice),
      new BigNumber(tickSize),
    );
  }

  private applyQuantityFilter(qty: BigNumber): BigNumber {
    const { minQty, maxQty, stepSize } = this.lotFilter;
    return applyFilter(qty, new BigNumber(maxQty), new BigNumber(minQty), new BigNumber(stepSize));
  }

  async calculateBuyOrders(): Promise<BuyOrder[]> {
    const prices = await this.bClient.prices();
    const currentPriceStr = prices[this.config.pair];
    console.log(`Current price for ${this.config.pair} is ${currentPriceStr}`);

    const currentPrice = this.applyPriceFilter(new BigNumber(currentPriceStr));

    const baseOrderSize = new BigNumber(this.config.baseOrderSize);
    const safetyOrderSize = new BigNumber(this.config.safetyOrderSize);
    const targetProfit = new BigNumber(this.config.targetProfitPercentage).dividedBy(100);
    const priceDeviation = new BigNumber(this.config.priceDeviationPercentage).dividedBy(100);
    const { maxSafetyTradesCount } = this.config;
    const safetyOrderVolumeScale = new BigNumber(this.config.safetyOrderVolumeScale);
    const safetyOrderStepScale = new BigNumber(this.config.safetyOrderStepScale);

    const orders: BuyOrder[] = [];
    for (
      let safeTypeTradeCount = 0;
      safeTypeTradeCount <= maxSafetyTradesCount;
      safeTypeTradeCount++
    ) {
      if (!safeTypeTradeCount) {
        const quantity = this.applyQuantityFilter(baseOrderSize.dividedBy(currentPrice));
        orders.push({
          sequence: 0,
          deviation: new BigNumber(0),
          volume: currentPrice.multipliedBy(quantity),
          price: currentPrice,
          averagePrice: currentPrice,
          quantity,
          totalQuantity: quantity,
          exitPrice: this.applyPriceFilter(currentPrice.multipliedBy(targetProfit.plus(1))),
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
        const price = this.applyPriceFilter(
          currentPrice.multipliedBy(new BigNumber(1).minus(deviation)),
        );
        const quantity = this.applyQuantityFilter(volume.dividedBy(price));
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
          averagePrice,
          exitPrice: this.applyPriceFilter(averagePrice.multipliedBy(targetProfit.plus(1))),
        });
      }
    }

    return orders;
  }
}
