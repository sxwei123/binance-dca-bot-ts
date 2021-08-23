import { inspect } from "util";
import winston from "winston";

const consoleLogFormat = winston.format.printf(({ level, message, payload, tag }) =>
  payload
    ? `${level} [${tag}] ${message}\n${inspect(payload, {
        compact: true,
        breakLength: 60,
        depth: Infinity,
        colors: true,
      })}`
    : `${level} [${tag}] ${message}`,
);
const transports = [
  new winston.transports.Console({
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.colorize(),
      consoleLogFormat,
    ),
  }),
];

export const logger = winston.createLogger({
  format: winston.format.json(),
  level: "info",
  transports,
});
