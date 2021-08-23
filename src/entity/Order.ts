import BigNumber from "bignumber.js";
import { OrderSide, OrderStatus } from "binance-api-node";
import { Entity, PrimaryGeneratedColumn, Column, ManyToOne } from "typeorm";

import { Deal } from "./Deal";

export interface BuyOrder {
  sequence: number;
  deviation: BigNumber;
  volume: BigNumber;
  price: BigNumber;
  averagePrice: BigNumber;
  quantity: BigNumber;
  totalQuantity: BigNumber;
  totalVolume: BigNumber;
  exitPrice: BigNumber;
}

@Entity()
export class Order {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  // for buy order: 0 to max_no_of_safety_order
  // for sell order: 1000 + the correspondent buy order
  @Column({ type: "int" })
  sequence: number;

  @Column({ length: 32, nullable: true })
  deviation: string;

  // BUY or SELL
  @Column({ length: 4 })
  side: OrderSide;

  @Column({ length: 32 })
  price: string;

  @Column({ length: 32, nullable: true })
  filledPrice: string;

  @Column({ length: 32, nullable: true })
  averagePrice: string;

  @Column({ length: 32, nullable: true })
  exitPrice: string;

  @Column({ type: "int", nullable: true })
  binanceOrderId: number;

  @Column({ length: 32 })
  quantity: string;

  @Column({ length: 32, nullable: true })
  volume: string;

  @Column({ length: 32, nullable: true })
  totalQuantity: string;

  @Column({ length: 16 })
  status: "CREATED" | OrderStatus;

  @ManyToOne(() => Deal, (deal) => deal.orders)
  deal: Deal;
}
