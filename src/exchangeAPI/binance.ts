import Binance from "binance-api-node";

export const getBinanceClient = (options: {
  paperTrading: boolean;
  apiKey: string;
  apiSecret: string;
}): ReturnType<typeof Binance> => {
  const binanceOptions = options.paperTrading
    ? {
        httpBase: "https://testnet.binance.vision",
        wsBase: "wss://testnet.binance.vision",
        apiKey: options.apiKey,
        apiSecret: options.apiSecret,
      }
    : {
        apiKey: options.apiKey,
        apiSecret: options.apiSecret,
      };

  return Binance(binanceOptions);
};
