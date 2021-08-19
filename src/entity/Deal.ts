import { OrderType } from "binance-api-node";
import { Entity, Column, PrimaryGeneratedColumn, OneToMany } from "typeorm";

import { Order } from "./Order";

@Entity()
export class Deal {
  @PrimaryGeneratedColumn()
  id: number;

  @OneToMany(() => Order, (order) => order.deal, { eager: true })
  orders: Order[];

  // "CREATED", "ACTIVE", "CLOSED", "CANCELED"
  @Column({ length: 16 })
  status: string;

  @Column({ type: "datetime" })
  startAt: Date;

  @Column({ type: "datetime", nullable: true })
  endAt: Date;

  @Column({ length: 32, nullable: true })
  profit: string;

  @Column({ length: 16 })
  pair: string;

  @Column({ length: 32 })
  baseOrderSize: string;

  @Column({ length: 32 })
  safetyOrderSize: string;

  // LONG or SHORT
  @Column({ length: 8 })
  strategy: string;

  // LIMIT or MARKET
  @Column({ length: 16 })
  startOrderType: OrderType;

  // ASAP
  @Column({ length: 16 })
  dealStartCondition: string;

  @Column({ type: "decimal", precision: 5, scale: 2 })
  targetProfitPercentage: number;

  @Column({ type: "int" })
  maxSafetyTradesCount: number;

  @Column({ type: "int" })
  maxActiveSafetyTradesCount: number;

  @Column({ type: "decimal", precision: 5, scale: 2 })
  priceDeviationPercentage: number;

  @Column({ type: "decimal", precision: 5, scale: 2 })
  safetyOrderVolumeScale: number;

  @Column({ type: "decimal", precision: 5, scale: 2 })
  safetyOrderStepScale: number;
}
