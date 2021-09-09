import winston from "winston";

const consoleLogFormat = winston.format.printf(
  ({ level, message, timestamp }) => `${level} ${timestamp}: ${message}`,
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
