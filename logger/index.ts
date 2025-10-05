import pino, { type LoggerOptions } from "pino";

const level = Bun.env.LOG_LEVEL ?? "debug";
const createBaseLogger = () => {
  const options: LoggerOptions = {
    level,
    base: {
      service: "tastebase",
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      /**
       * The formatters.level function customizes Pino's log
       * output to include the log level as a string label (e.g., "info")
       * instead of the default numeric value.
       *
       * NOTE (anikait): Maybe in production it would be better to use numbers, but
       * for now parsing the logs quickly is what I am after and labels
       * help me with that.
       */
      level(label) {
        return { level: label };
      },
    },
  };

  if (Bun.env.LOG_PRETTY === "true") {
    try {
      const transport = pino.transport({
        target: "pino-pretty",
        options: {
          singleLine: true,
          colorize: true,
          translateTime: "SYS:standard",
        },
      });

      return pino(options, transport);
    } catch (error) {
      console.error(
        "Pretty logging requested but 'pino-pretty' is unavailable. Falling back to JSON logs.",
      );

      if (error instanceof Error && error.stack) {
        console.error(`${error.stack}`);
      } else if (error) {
        console.error(`${String(error)}`);
      }
    }
  }

  return pino(options);
};

export const baseLogger = createBaseLogger();
export type AppLogger = typeof baseLogger;
