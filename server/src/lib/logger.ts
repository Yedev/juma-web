import pino, { type LoggerOptions, type DestinationStream } from "pino";
import path from "path";
import fs from "fs";

const LOG_DIR = process.env.LOG_DIR || path.resolve(__dirname, "../../logs");
const LOG_LEVEL = process.env.LOG_LEVEL || (process.env.NODE_ENV === "production" ? "info" : "debug");
const ENABLE_FILE_LOG = process.env.LOG_TO_FILE !== "false";
const ENABLE_PRETTY = process.env.NODE_ENV !== "production" && process.env.LOG_PRETTY !== "false";

// 容量预算：app.log 单文件 20MB × 最多 10 个 = 200MB；error.log 单文件 5MB × 4 个 = 20MB
// pino-roll 通过 limit.count 控制总文件数，超过则自动清理最旧的文件
const APP_LOG_SIZE = "20m";
const APP_LOG_KEEP = 10;
const ERROR_LOG_SIZE = "5m";
const ERROR_LOG_KEEP = 4;

if (ENABLE_FILE_LOG) {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  } catch (err) {
    console.error("Failed to create log dir:", LOG_DIR, err);
  }
}

function buildStreams(): DestinationStream {
  const streams: { level?: pino.Level; stream: DestinationStream }[] = [];

  if (ENABLE_PRETTY) {
    streams.push({
      level: LOG_LEVEL as pino.Level,
      stream: pino.transport({
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "yyyy-mm-dd HH:MM:ss.l",
          ignore: "pid,hostname",
          singleLine: false,
        },
      }) as unknown as DestinationStream,
    });
  } else {
    streams.push({
      level: LOG_LEVEL as pino.Level,
      stream: process.stdout,
    });
  }

  if (ENABLE_FILE_LOG) {
    streams.push({
      level: LOG_LEVEL as pino.Level,
      stream: pino.transport({
        target: "pino-roll",
        options: {
          file: path.join(LOG_DIR, "app.log"),
          frequency: "daily",
          size: APP_LOG_SIZE,
          mkdir: true,
          limit: { count: APP_LOG_KEEP },
          dateFormat: "yyyy-MM-dd",
        },
      }) as unknown as DestinationStream,
    });

    streams.push({
      level: "error",
      stream: pino.transport({
        target: "pino-roll",
        options: {
          file: path.join(LOG_DIR, "error.log"),
          frequency: "daily",
          size: ERROR_LOG_SIZE,
          mkdir: true,
          limit: { count: ERROR_LOG_KEEP },
          dateFormat: "yyyy-MM-dd",
        },
      }) as unknown as DestinationStream,
    });
  }

  return pino.multistream(streams, { dedupe: true });
}

const baseOptions: LoggerOptions = {
  level: LOG_LEVEL,
  base: { service: "juma-server" },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "req.headers['x-sign']",
      "*.password",
      "*.token",
      "*.code",
    ],
    remove: false,
    censor: "[REDACTED]",
  },
};

export const logger = pino(baseOptions, buildStreams());

export default logger;
