import Binance from "binance-api-node";

export const getBinanceClient = (options: {
  paperTrading: boolean;
  apiKey: string;
  apiSecret: string;
}): ReturnType<typeof Binance> => {
  const binanceOptions = {
    apiKey: options.apiKey,
    apiSecret: options.apiSecret,
  };

  return Binance(binanceOptions);
};
