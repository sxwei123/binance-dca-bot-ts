import { Deal } from "./entity/Deal";

export const printDealTable = (deal: Deal): void => {
  console.table(deal.orders, [
    "sequence",
    "deviation",
    "quantity",
    "volume",
    "price",
    "averagePrice",
    "exitPrice",
    "totalQuantity",
  ]);
};
